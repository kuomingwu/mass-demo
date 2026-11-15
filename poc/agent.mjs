// MaaS local-GPU POC — node agent. Runs ON the GPU machine, next to the inference runtime.
//
// Responsibilities (the same list a production agent has, in miniature):
//   1. Inventory   — detect GPUs and what partitioning the hardware supports (MIG / time-slicing / VRAM budget).
//   2. Enrollment  — exchange a one-time bootstrap token for a node identity; outbound connections only.
//   3. Heartbeat   — report telemetry and the ACTUAL state of every slice; receive the DESIRED state.
//   4. Reconcile   — make actual match desired: admission control, load/unload models, verify VRAM budgets.
//   5. Model cache — check that the weights are present in the local store (D: drive) and record their digests.
//
// On this POC machine the runtime is Ollama (llama.cpp) and the GPU is a consumer card under Windows WDDM:
// no MIG, no MPS. Slices are therefore VRAM budgets enforced by admission control and verified after load;
// GPU compute is time-shared between slices. Production data-centre cards use MIG for hard isolation.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { loadConfig, storage, readJson, writeJson, makeLogger, sleep } from './lib.mjs';

const AGENT_VERSION = '0.1.0-poc';
const run = promisify(execFile);
const cfg = loadConfig();
const dirs = storage(cfg);
const log = makeLogger(path.join(dirs.logs, 'agent.log'), 'agent');
const IDENTITY_FILE = path.join(dirs.state, 'agent-identity.json');
const GATEWAY = process.env.MAAS_GATEWAY ?? `http://${cfg.gateway.host}:${cfg.gateway.port}`;
const RUNTIME = cfg.runtime.baseUrl;

// ---------- 1. inventory ----------
async function gpuInventory() {
  const fields = ['index', 'uuid', 'name', 'memory.total', 'memory.used', 'utilization.gpu', 'temperature.gpu', 'power.draw', 'driver_version'];
  const { stdout } = await run('nvidia-smi', [`--query-gpu=${fields.join(',')}`, '--format=csv,noheader,nounits'], { windowsHide: true });
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const v = line.split(',').map((x) => x.trim());
      return { index: num(v[0]), uuid: v[1], name: v[2], memoryTotalMiB: num(v[3]), memoryUsedMiB: num(v[4]), utilizationPct: num(v[5]), temperatureC: num(v[6]), powerW: num(v[7]), driver: v[8] };
    });
}

/** Which partitioning does this hardware/OS support? Decides the slicing strategy. */
async function detectPartitioning() {
  let mig = 'unsupported';
  try {
    const { stdout } = await run('nvidia-smi', ['--query-gpu=mig.mode.current', '--format=csv,noheader'], { windowsHide: true });
    const v = stdout.trim().split(/\r?\n/)[0]?.trim() ?? '';
    if (/^enabled$/i.test(v)) mig = 'enabled';
    else if (/^disabled$/i.test(v)) mig = 'available-disabled';
  } catch {
    /* field not supported by this driver: leave as unsupported */
  }
  const os = process.platform;
  return {
    os,
    mig,
    mps: os === 'linux' ? 'possible' : 'unsupported',
    // Strategy actually applied by this agent on this node.
    strategy: mig === 'enabled' ? 'mig' : 'vram-budget',
    isolation: mig === 'enabled' ? 'hardware (memory + fault isolation)' : 'admission control + post-load verification (no hardware isolation; compute time-shared)',
  };
}

// ---------- runtime (Ollama) ----------
async function rt(pathname, body, timeoutMs = 300_000) {
  const res = await fetch(`${RUNTIME}${pathname}`, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`runtime ${pathname} -> HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return res.json();
}
const mib = (bytes) => Math.round(bytes / 1048576);

async function runtimeInfo() {
  try {
    const v = await rt('/api/version', null, 5000);
    return { kind: cfg.runtime.kind, version: v.version, ok: true, baseUrl: RUNTIME, modelStore: cfg.runtime.modelStore };
  } catch (e) {
    return { kind: cfg.runtime.kind, ok: false, error: String(e.message ?? e), baseUrl: RUNTIME };
  }
}

// ---------- 5. model cache manifest ----------
async function writeModelManifest() {
  const tags = await rt('/api/tags', null, 10_000);
  const wanted = new Set(Object.keys(cfg.models));
  const manifest = {
    generatedAt: new Date().toISOString(),
    store: cfg.runtime.modelStore,
    note: 'Weights stay in the runtime store on the data drive; this manifest pins which digests the node may serve.',
    models: tags.models.filter((m) => wanted.has(m.name)).map((m) => ({ name: m.name, publicId: cfg.models[m.name].publicId, digest: m.digest, sizeBytes: m.size, family: m.details?.family, parameterSize: m.details?.parameter_size, quantization: m.details?.quantization_level })),
  };
  writeJson(path.join(dirs.models, 'manifest.json'), manifest);
  return new Map(tags.models.map((m) => [m.name, m]));
}

// ---------- 4. reconcile ----------
let identity = readJson(IDENTITY_FILE, null);
let appliedGeneration = 0;
let desired = { generation: 0, slices: [] };
let actual = []; // slice status reported to the control plane
let reconciling = false;

function persistIdentity() {
  writeJson(IDENTITY_FILE, identity);
}

async function reconcile(gpu) {
  if (reconciling) return;
  reconciling = true;
  try {
    const installed = await writeModelManifest();
    const budget = gpu.memoryTotalMiB - cfg.node.reserveMiB;
    const wantModels = new Set(desired.slices.map((s) => s.model));

    // Unload models this agent loaded earlier that are no longer desired (never touch models it did not load).
    for (const m of [...(identity.loadedByAgent ?? [])]) {
      if (wantModels.has(m)) continue;
      log('info', 'unloading model no longer desired', { model: m });
      await rt('/api/generate', { model: m, keep_alive: 0 }).catch((e) => log('warn', 'unload failed', { model: m, error: String(e.message) }));
      identity.loadedByAgent = identity.loadedByAgent.filter((x) => x !== m);
      persistIdentity();
    }
    if ((identity.loadedByAgent ?? []).length === 0) {
      // Clean slate: remember how much VRAM the desktop/OS already uses, so slice usage can be MEASURED, not just reported.
      await sleep(2500);
      identity.baselineUsedMiB = (await gpuInventory())[0].memoryUsedMiB;
      identity.loadedUsedMiB = null;
      persistIdentity();
    }

    // Admission control: slices are admitted in order until the VRAM budget is used up.
    let allocated = 0;
    const next = [];
    for (const s of desired.slices) {
      const baseStatus = { id: s.id, model: s.model, publicId: cfg.models[s.model]?.publicId ?? s.model, sharing: s.sharing, tenantId: s.tenantId ?? null, budgetMiB: s.vramMiB, numCtx: s.numCtx, maxInflight: s.maxInflight, endpoint: RUNTIME };
      if (allocated + s.vramMiB > budget) {
        next.push({ ...baseStatus, state: 'rejected-no-capacity', detail: `needs ${s.vramMiB} MiB, only ${budget - allocated} MiB of the ${budget} MiB budget left` });
        continue;
      }
      allocated += s.vramMiB;
      if (!installed.has(s.model)) {
        if (cfg.runtime.allowPull) {
          log('info', 'pulling model', { model: s.model });
          await rt('/api/pull', { model: s.model, stream: false }, 3_600_000);
        } else {
          next.push({ ...baseStatus, state: 'model-missing', detail: 'weights not in the local store and allowPull is false' });
          continue;
        }
      }
      next.push({ ...baseStatus, state: 'loading' });
    }
    actual = next;

    for (const st of actual) {
      if (st.state !== 'loading') continue;
      const t0 = Date.now();
      try {
        await rt('/api/generate', { model: st.model, keep_alive: -1, options: { num_ctx: st.numCtx } });
        if (!identity.loadedByAgent?.includes(st.model)) {
          identity.loadedByAgent = [...(identity.loadedByAgent ?? []), st.model];
          persistIdentity();
        }
        st.loadMs = Date.now() - t0;
        st.state = 'verifying';
      } catch (e) {
        st.state = 'failed';
        st.detail = String(e.message ?? e);
        log('error', 'model load failed', { slice: st.id, error: st.detail });
      }
    }
    await sleep(1500);
    identity.loadedUsedMiB = (await gpuInventory())[0].memoryUsedMiB;
    persistIdentity();
    await verify();
    appliedGeneration = desired.generation;
    log('info', 'reconciled', { generation: appliedGeneration, slices: actual.map((s) => `${s.id}:${s.state}:${s.vramMiB ?? '-'}MiB`) });
  } finally {
    reconciling = false;
  }
}

/** Post-load verification: is the model fully on the GPU, and inside its VRAM budget? */
async function verify() {
  const ps = await rt('/api/ps', null, 10_000).catch(() => ({ models: [] }));
  const loaded = new Map(ps.models.map((m) => [m.name, m]));
  for (const st of actual) {
    if (!['verifying', 'ready', 'over-budget', 'cpu-offload', 'not-loaded'].includes(st.state)) continue;
    const m = loaded.get(st.model);
    if (!m) {
      st.state = 'not-loaded';
      st.detail = 'the runtime no longer has this model in memory';
      continue;
    }
    st.vramMiB = mib(m.size_vram ?? 0);
    st.totalMiB = mib(m.size ?? 0);
    st.contextLength = m.context_length ?? st.numCtx;
    st.onGpu = m.size_vram >= m.size * 0.98;
    st.gpuPct = m.size ? Math.round((m.size_vram / m.size) * 100) : 0;
    st.state = 'verifying';
  }
  // The runtime under-reports: each model process also holds a CUDA context and scratch buffers.
  // Measure the real GPU delta (nvidia-smi) and spread the unexplained overhead across the loaded slices.
  const live = actual.filter((s) => s.state === 'verifying');
  const reported = live.reduce((a, s) => a + s.vramMiB, 0);
  const delta = identity?.baselineUsedMiB != null && identity?.loadedUsedMiB != null ? identity.loadedUsedMiB - identity.baselineUsedMiB : null;
  const overhead = delta !== null && live.length ? Math.max(0, delta - reported) : 0;
  measurement = delta !== null ? { baselineUsedMiB: identity.baselineUsedMiB, loadedUsedMiB: identity.loadedUsedMiB, gpuDeltaMiB: delta, runtimeReportedMiB: reported, overheadMiB: overhead } : null;
  for (const st of live) {
    st.measuredMiB = st.vramMiB + Math.round(overhead / live.length);
    if (!st.onGpu) {
      st.state = 'cpu-offload';
      st.detail = `only ${st.gpuPct}% of the model is on the GPU; the rest spilled to system RAM`;
    } else if (st.measuredMiB > st.budgetMiB) {
      st.state = 'over-budget';
      st.detail = `uses ${st.measuredMiB} MiB (measured), budget is ${st.budgetMiB} MiB`;
    } else {
      st.state = 'ready';
      st.detail = undefined;
    }
  }
}
let measurement = null;

// ---------- 2. enrollment ----------
async function enroll() {
  if (identity?.nodeId && identity.gateway === GATEWAY) return;
  const boot = process.env.MAAS_BOOTSTRAP_TOKEN ?? readJson(path.join(dirs.state, 'poc-keys.local.json'), {}).bootstrap;
  if (!boot) throw new Error('no bootstrap token: set MAAS_BOOTSTRAP_TOKEN (or start the gateway first)');
  const res = await fetch(`${GATEWAY}/agent/v1/enroll`, { method: 'POST', headers: { authorization: `Bearer ${boot}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: cfg.node.name, site: cfg.node.site }) });
  if (!res.ok) throw new Error(`enroll failed: HTTP ${res.status}`);
  const j = await res.json();
  identity = { gateway: GATEWAY, nodeId: j.nodeId, nodeToken: j.nodeToken, enrolledAt: new Date().toISOString(), loadedByAgent: [] };
  persistIdentity();
  log('info', 'enrolled with control plane', { nodeId: identity.nodeId, gateway: GATEWAY });
}

// ---------- 3. heartbeat loop ----------
async function tick(partitioning) {
  const gpus = await gpuInventory();
  const gpu = gpus[0];
  const runtime = await runtimeInfo();
  if (runtime.ok && !reconciling) await verify().catch(() => {});
  const res = await fetch(`${GATEWAY}/agent/v1/heartbeat`, {
    method: 'POST',
    headers: { authorization: `Bearer ${identity.nodeToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: identity.nodeId, agentVersion: AGENT_VERSION, gpu: { ...gpu, reserveMiB: cfg.node.reserveMiB, sliceBudgetMiB: gpu.memoryTotalMiB - cfg.node.reserveMiB }, runtime, partitioning: { ...partitioning, measurement }, slices: actual, appliedGeneration }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) {
    log('warn', 'node token rejected; re-enrolling');
    identity = null;
    await enroll();
    return;
  }
  if (!res.ok) throw new Error(`heartbeat HTTP ${res.status}`);
  const want = await res.json();
  if (want.generation !== desired.generation || JSON.stringify(want.slices) !== JSON.stringify(desired.slices)) {
    desired = { generation: want.generation, slices: want.slices };
    log('info', 'desired state changed', { profile: want.profile, generation: want.generation });
  }
  if (runtime.ok && appliedGeneration !== desired.generation && !reconciling) {
    reconcile(gpu).catch((e) => log('error', 'reconcile failed', { error: String(e?.stack ?? e) }));
  }
}

async function main() {
  const partitioning = await detectPartitioning();
  const gpus = await gpuInventory();
  log('info', 'inventory', { gpus: gpus.map((g) => `${g.name} ${g.memoryTotalMiB} MiB`), partitioning });
  for (;;) {
    try {
      await enroll();
      break;
    } catch (e) {
      log('warn', 'enroll retry in 3s', { error: String(e.message ?? e) });
      await sleep(3000);
    }
  }
  for (;;) {
    try {
      await tick(partitioning);
    } catch (e) {
      log('warn', 'heartbeat failed', { error: String(e.message ?? e) });
    }
    await sleep(cfg.node.heartbeatMs);
  }
}

// On shutdown, release the VRAM this agent claimed (leave anything else the user loaded alone).
async function shutdown() {
  for (const m of identity?.loadedByAgent ?? []) await rt('/api/generate', { model: m, keep_alive: 0 }, 15_000).catch(() => {});
  if (identity) {
    identity.loadedByAgent = [];
    try {
      persistIdentity();
    } catch {
      /* ignore */
    }
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
if (process.argv.includes('--release')) {
  shutdown();
} else {
  main().catch((e) => {
    log('error', 'agent crashed', { error: String(e?.stack ?? e) });
    process.exit(1);
  });
}
void fs;
