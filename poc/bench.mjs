// MaaS local-GPU POC — acceptance tests + throughput benchmark, all through the customer-facing gateway.
// Writes a JSON + Markdown report to <storageRoot>/reports (D: drive) — the "written test report" a trial ends with.
//
//   node bench.mjs                 functional acceptance + shared-slice benchmark
//   node bench.mjs --with-dedicated   also switch to the dedicated profile, test it, and switch back
//   node bench.mjs --quick         fewer benchmark rounds
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig, storage, readJson, percentile, sleep, today } from './lib.mjs';

const run = promisify(execFile);
const cfg = loadConfig();
const dirs = storage(cfg);
const BASE = `http://${cfg.gateway.host}:${cfg.gateway.port}`;
const keys = readJson(path.join(dirs.state, 'poc-keys.local.json'), null);
if (!keys) {
  console.error('No keys found. Start the gateway first: node gateway.mjs');
  process.exit(1);
}
const QUICK = process.argv.includes('--quick');
const WITH_DEDICATED = process.argv.includes('--with-dedicated');
const MAX_TOKENS = 160;
const PROMPT = 'Explain in about 120 words how a GPU speeds up large language model inference. Plain prose, no lists.';
const PROMPT_ZH = '請用大約一百字的繁體中文，說明地方政府導入生成式 AI 客服時應注意的三件事。';

const auth = (key) => ({ authorization: `Bearer ${key}`, 'content-type': 'application/json' });
async function api(method, pathname, key, body) {
  const res = await fetch(BASE + pathname, { method, headers: key ? auth(key) : { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* not JSON */
  }
  return { status: res.status, headers: res.headers, json };
}
const chat = (key, model, extra = {}) => api('POST', '/v1/chat/completions', key, { model, messages: [{ role: 'user', content: PROMPT }], max_tokens: MAX_TOKENS, temperature: 0.2, ...extra });

/** One streaming request; measures TTFT and decode speed as the customer sees them. */
async function streamOnce(key, model, prompt = PROMPT) {
  const t0 = performance.now();
  const res = await fetch(BASE + '/v1/chat/completions', { method: 'POST', headers: auth(key), body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: MAX_TOKENS, temperature: 0.2, stream: true, stream_options: { include_usage: true } }) });
  if (!res.ok) return { ok: false, status: res.status };
  const decoder = new TextDecoder();
  let buf = '';
  let ttft = null;
  let usage = null;
  let text = '';
  let done = false;
  for await (const part of res.body) {
    buf += decoder.decode(part, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const ev = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (!ev.startsWith('data: ')) continue;
      const payload = ev.slice(6);
      if (payload === '[DONE]') {
        done = true;
        continue;
      }
      const j = JSON.parse(payload);
      const delta = j.choices?.[0]?.delta?.content;
      if (delta) {
        if (ttft === null) ttft = performance.now() - t0;
        text += delta;
      }
      if (j.usage) usage = j.usage;
    }
  }
  const total = performance.now() - t0;
  const out = usage?.completion_tokens ?? 0;
  return { ok: true, done, ttftMs: ttft, totalMs: total, promptTokens: usage?.prompt_tokens ?? 0, completionTokens: out, tokPerSec: out && ttft !== null && total > ttft ? out / ((total - ttft) / 1000) : null, requestId: res.headers.get('x-maas-request-id'), slice: res.headers.get('x-maas-slice'), sample: text.slice(0, 120) };
}

async function gpuSample() {
  try {
    const { stdout } = await run('nvidia-smi', ['--query-gpu=memory.used,utilization.gpu,power.draw,temperature.gpu', '--format=csv,noheader,nounits'], { windowsHide: true });
    const v = stdout.trim().split(',').map((x) => Number(x.trim()));
    return { memoryUsedMiB: v[0], utilizationPct: v[1], powerW: v[2], temperatureC: v[3] };
  } catch {
    return null;
  }
}

/** Run `jobs` (each: { key, model, prompt }) concurrently for `rounds` rounds while sampling the GPU. */
async function load(label, jobs, rounds) {
  const samples = [];
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const s = await gpuSample();
      if (s) samples.push(s);
      await sleep(500);
    }
  })();
  const t0 = performance.now();
  const results = [];
  for (let r = 0; r < rounds; r++) results.push(...(await Promise.all(jobs.map((j) => streamOnce(j.key, j.model, j.prompt).then((x) => ({ ...x, model: j.model }))))));
  const wallMs = performance.now() - t0;
  sampling = false;
  await sampler;
  const ok = results.filter((r) => r.ok && r.completionTokens > 0);
  const perModel = {};
  for (const m of [...new Set(jobs.map((j) => j.model))]) {
    const rs = ok.filter((r) => r.model === m);
    const tokens = rs.reduce((a, r) => a + r.completionTokens, 0);
    perModel[m] = {
      requests: rs.length,
      completionTokens: tokens,
      aggregateTokPerSec: round(tokens / (wallMs / 1000)),
      perRequestTokPerSecP50: round(percentile(rs.map((r) => r.tokPerSec).filter(Boolean), 50)),
      ttftMsP50: round(percentile(rs.map((r) => r.ttftMs), 50)),
      ttftMsP95: round(percentile(rs.map((r) => r.ttftMs), 95)),
    };
  }
  const avg = (k) => (samples.length ? round(samples.reduce((a, s) => a + s[k], 0) / samples.length) : null);
  const out = { label, concurrency: jobs.length, rounds, wallMs: round(wallMs), errors: results.length - ok.length, totalAggregateTokPerSec: round(ok.reduce((a, r) => a + r.completionTokens, 0) / (wallMs / 1000)), perModel, gpu: { utilizationPctAvg: avg('utilizationPct'), powerWAvg: avg('powerW'), memoryUsedMiBMax: samples.length ? Math.max(...samples.map((s) => s.memoryUsedMiB)) : null, temperatureCMax: samples.length ? Math.max(...samples.map((s) => s.temperatureC)) : null } };
  console.log(`  ${label}: ${out.totalAggregateTokPerSec} tok/s total, GPU ${out.gpu.utilizationPctAvg}% ${out.gpu.powerWAvg} W`);
  return out;
}
const round = (n) => (n === null || n === undefined || Number.isNaN(n) ? null : Math.round(n * 10) / 10);

function ledgerToday() {
  try {
    return fs
      .readFileSync(path.join(dirs.ledger, `usage-${today()}.jsonl`), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
const overview = async () => (await api('GET', '/admin/v1/overview', keys.admin)).json;

async function waitReady(profile, sliceIds, timeoutMs = 240_000) {
  const t0 = Date.now();
  for (;;) {
    const o = await overview();
    const node = o.nodes.find((n) => n.online);
    const states = Object.fromEntries((node?.slices ?? []).map((s) => [s.id, s.state]));
    if (o.profile === profile && node?.appliedGeneration === o.generation && sliceIds.every((id) => states[id] && states[id] !== 'loading' && states[id] !== 'verifying')) return { node, waitedMs: Date.now() - t0 };
    if (Date.now() - t0 > timeoutMs) throw new Error(`slices not ready after ${timeoutMs} ms: ${JSON.stringify(states)}`);
    await sleep(2000);
  }
}

async function main() {
  const report = { generatedAt: new Date().toISOString(), storageRoot: cfg.storageRoot, gateway: BASE, checks: [], benchmarks: [], notes: [] };
  const check = (id, title, pass, detail) => {
    report.checks.push({ id, title, pass: !!pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${title}${detail ? ' — ' + detail : ''}`);
  };

  // ---------- environment ----------
  const { node } = await waitReady(cfg.activeProfile, cfg.profiles[cfg.activeProfile].slices.map((s) => s.id)).catch(async (e) => {
    console.error(String(e.message));
    return { node: (await overview()).nodes.find((n) => n.online) };
  });
  if (!node) {
    console.error('No online node. Start the agent: node agent.mjs');
    process.exit(1);
  }
  report.node = { id: node.id, name: node.name, agentVersion: node.agentVersion, gpu: node.gpu, runtime: node.runtime, partitioning: node.partitioning, slices: node.slices };
  const gov = keys.tenants['t-gov'];
  const star = keys.tenants['t-star'];
  const before = await overview();
  const ledgerStart = ledgerToday().length;

  // ---------- A. functional acceptance ----------
  console.log('\n== Functional acceptance ==');
  check('A01', 'Node enrolled, online, heartbeat fresh', node.online, `${node.name} / ${node.gpu?.name} / agent ${node.agentVersion}`);
  check('A02', 'Every slice in the active profile is ready and inside its VRAM budget', node.slices.length > 0 && node.slices.every((s) => s.state === 'ready'), node.slices.map((s) => `${s.id}=${s.state} ${s.measuredMiB ?? s.vramMiB}/${s.budgetMiB} MiB`).join(', '));
  const m1 = await api('GET', '/v1/models', star);
  check('A03', 'GET /v1/models lists the catalog with prices and readiness', m1.status === 200 && m1.json.data.length === 3 && m1.json.data.every((m) => m.pricing), m1.json?.data?.map((m) => `${m.id}:${m.status}`).join(', '));
  const m2 = await api('GET', '/v1/models', gov);
  check('A04', 'Public-sector tenant sees only its allowed catalog', m2.status === 200 && m2.json.data.length === 2 && !m2.json.data.some((m) => m.id === 'llama-3.2-3b'), m2.json?.data?.map((m) => m.id).join(', '));
  const noKey = await api('POST', '/v1/chat/completions', null, { model: 'gemma-3-4b', messages: [{ role: 'user', content: 'hi' }] });
  check('A05', 'Request without an API key is rejected', noKey.status === 401, `HTTP ${noKey.status} ${noKey.json?.error?.code}`);
  const broke = await chat(keys.tenants['t-broke'], 'gemma-3-4b');
  check('A06', 'Exhausted prepaid credits return 402', broke.status === 402 && broke.json.error.code === 'INSUFFICIENT_CREDITS', `HTTP ${broke.status} ${broke.json?.error?.code}`);
  const notAllowed = await chat(gov, 'llama-3.2-3b');
  check('A07', 'Model outside the tenant catalog returns 403', notAllowed.status === 403, `HTTP ${notAllowed.status} ${notAllowed.json?.error?.code}`);
  const unknown = await chat(star, 'no-such-model');
  check('A08', 'Unknown model returns 400', unknown.status === 400, `HTTP ${unknown.status} ${unknown.json?.error?.code}`);
  const notLoaded = await chat(star, 'gemma-3-taide-12b');
  check('A09', 'Model with no ready slice returns 503 with Retry-After', notLoaded.status === 503 && notLoaded.headers.get('retry-after'), `HTTP ${notLoaded.status} ${notLoaded.json?.error?.code}, Retry-After ${notLoaded.headers.get('retry-after')}s`);
  const ok1 = await chat(star, 'gemma-3-4b');
  check('A10', 'Non-streaming chat completion succeeds with usage', ok1.status === 200 && ok1.json.usage.completion_tokens > 0, `${ok1.json?.usage?.prompt_tokens} in / ${ok1.json?.usage?.completion_tokens} out, slice ${ok1.headers.get('x-maas-slice')}`);
  check('A11', 'Response carries retention, node and slice headers', ok1.headers.get('x-maas-retention') === 'none' && ok1.headers.get('x-maas-node') && ok1.headers.get('x-maas-slice'), `x-maas-retention=${ok1.headers.get('x-maas-retention')}, x-maas-node=${ok1.headers.get('x-maas-node')}`);
  const s1 = await streamOnce(star, 'llama-3.2-3b');
  check('A12', 'Streaming completion sends SSE chunks, a usage chunk and [DONE]', s1.ok && s1.done && s1.completionTokens > 0 && s1.ttftMs !== null, `TTFT ${round(s1.ttftMs)} ms, ${s1.completionTokens} tokens, ${round(s1.tokPerSec)} tok/s, slice ${s1.slice}`);
  check('A13', 'Requests for different models land on different slices', ok1.headers.get('x-maas-slice') !== s1.slice, `${ok1.headers.get('x-maas-slice')} vs ${s1.slice}`);
  const tiny = keys.tenants['t-tiny'];
  const t1 = await chat(tiny, 'llama-3.2-3b');
  const t2 = await chat(tiny, 'llama-3.2-3b');
  check('A14', 'Tenant over its TPM limit gets 429 with Retry-After', (t1.status === 200 || t1.status === 429) && t2.status === 429 && t2.headers.get('retry-after'), `first HTTP ${t1.status}, second HTTP ${t2.status}, Retry-After ${t2.headers.get('retry-after')}s`);

  // ledger + balance reconciliation
  await sleep(1500);
  const mine = ledgerToday().slice(ledgerStart);
  const after = await overview();
  const sumCost = mine.reduce((a, e) => a + e.costUsd, 0);
  const balDrop = before.tenants.reduce((a, t) => a + t.balanceUsd, 0) - after.tenants.reduce((a, t) => a + t.balanceUsd, 0);
  const e1 = mine.find((e) => e.requestId === ok1.headers.get('x-maas-request-id'));
  const expected = e1 ? (e1.promptTokens * cfg.models['gemma3:4b'].priceInPerM + e1.completionTokens * cfg.models['gemma3:4b'].priceOutPerM) / 1e6 : -1;
  check('A15', 'Every authenticated request (allowed and denied) is in the ledger on the data drive', mine.length === 8 && !!e1, `${mine.length} ledger lines in ${path.join(dirs.ledger, `usage-${today()}.jsonl`)}`);
  check('A16', 'Ledger cost equals tokens x price, and balances dropped by the same total', e1 && Math.abs(e1.costUsd - expected) < 1e-12 && Math.abs(sumCost - balDrop) < 1e-9, `ledger US$${sumCost.toFixed(8)} vs balance drop US$${balDrop.toFixed(8)}`);
  const forbidden = ['messages', 'prompt', 'content', 'completion', 'text'];
  check('A17', 'Zero retention: no prompt or completion text is stored in the ledger', mine.every((e) => forbidden.every((k) => !(k in e))), `fields: ${Object.keys(e1 ?? {}).join(', ')}`);

  // ---------- B. throughput on shared slices ----------
  console.log('\n== Benchmark (shared slices) ==');
  const rounds = QUICK ? 1 : 2;
  const job = (model, n) => Array.from({ length: n }, () => ({ key: star, model }));
  await streamOnce(star, 'gemma-3-4b'); // warm-up
  await streamOnce(star, 'llama-3.2-3b');
  for (const model of ['gemma-3-4b', 'llama-3.2-3b']) for (const c of QUICK ? [1, 4] : [1, 2, 4]) report.benchmarks.push({ group: 'solo', ...(await load(`${model} alone, concurrency ${c}`, job(model, c), rounds)) });
  for (const c of QUICK ? [1] : [1, 2]) report.benchmarks.push({ group: 'contended', ...(await load(`both slices busy, concurrency ${c} each`, [...job('gemma-3-4b', c), ...job('llama-3.2-3b', c)], rounds)) });

  // interference: how much a slice slows down when the neighbouring slice is busy (compute is time-shared)
  const solo = (m) => report.benchmarks.find((b) => b.group === 'solo' && b.concurrency === 1 && b.perModel[m])?.perModel[m].aggregateTokPerSec;
  const cont = report.benchmarks.find((b) => b.group === 'contended' && b.concurrency === 2);
  report.interference = Object.fromEntries(['gemma-3-4b', 'llama-3.2-3b'].map((m) => [m, { soloTokPerSec: solo(m), contendedTokPerSec: cont?.perModel[m]?.aggregateTokPerSec ?? null, retainedPct: solo(m) && cont ? round((cont.perModel[m].aggregateTokPerSec / solo(m)) * 100) : null }]));

  // ---------- C. dedicated profile (whole GPU to one tenant) ----------
  if (WITH_DEDICATED) {
    console.log('\n== Dedicated profile ==');
    const sw = await api('POST', '/admin/v1/profile', keys.admin, { profile: 'dedicated-1' });
    check('C01', 'Control plane accepts the profile switch', sw.status === 200, `generation ${sw.json?.generation}`);
    try {
      const { node: n2, waitedMs } = await waitReady('dedicated-1', ['slice-d']);
      const d = n2.slices.find((s) => s.id === 'slice-d');
      report.dedicated = { switchMs: waitedMs, slice: d };
      check('C02', 'Agent reconciled: old slices unloaded, dedicated slice loaded', n2.slices.length === 1 && ['ready', 'cpu-offload', 'over-budget'].includes(d.state), `${d.state} ${d.measuredMiB ?? d.vramMiB}/${d.budgetMiB} MiB after ${Math.round(waitedMs / 1000)} s${d.detail ? ' (' + d.detail + ')' : ''}`);
      if (d.state === 'ready') {
        const other = await chat(star, 'gemma-3-taide-12b');
        check('C03', 'Another tenant cannot use the dedicated slice', other.status === 503, `HTTP ${other.status} ${other.json?.error?.code}`);
        const old = await chat(star, 'gemma-3-4b');
        check('C04', 'Models from the previous profile are no longer served', old.status === 503, `HTTP ${old.status} ${old.json?.error?.code}`);
        await streamOnce(gov, 'gemma-3-taide-12b', PROMPT_ZH);
        const b = await load('gemma-3-taide-12b dedicated, concurrency 1', [{ key: gov, model: 'gemma-3-taide-12b', prompt: PROMPT_ZH }], rounds);
        report.benchmarks.push({ group: 'dedicated', ...b });
        check('C05', 'Owning tenant gets completions from its dedicated slice', b.errors === 0 && b.totalAggregateTokPerSec > 0, `${b.totalAggregateTokPerSec} tok/s, TTFT p50 ${b.perModel['gemma-3-taide-12b'].ttftMsP50} ms`);
      } else {
        report.notes.push(`Dedicated slice ended in state "${d.state}": ${d.detail ?? ''}. The agent reports it instead of serving a degraded endpoint.`);
      }
    } catch (e) {
      check('C02', 'Agent reconciled: old slices unloaded, dedicated slice loaded', false, String(e.message));
    } finally {
      await api('POST', '/admin/v1/profile', keys.admin, { profile: cfg.activeProfile });
      const back = await waitReady(cfg.activeProfile, cfg.profiles[cfg.activeProfile].slices.map((s) => s.id)).catch(() => null);
      check('C06', 'Switched back to the shared profile and slices are ready again', !!back && back.node.slices.every((s) => s.state === 'ready'), back ? `${Math.round(back.waitedMs / 1000)} s` : 'timeout');
    }
  }

  // ---------- capacity + unit economics from measured numbers ----------
  const best = Math.max(...report.benchmarks.filter((b) => b.group !== 'dedicated').map((b) => b.totalAggregateTokPerSec));
  const power = report.benchmarks.find((b) => b.totalAggregateTokPerSec === best)?.gpu.powerWAvg ?? null;
  report.capacity = {
    peakAggregateTokPerSec: best,
    outputTokensPerDayAt: Object.fromEntries([0.1, 0.3, 0.6].map((u) => [`util${Math.round(u * 100)}`, Math.round(best * 86400 * u)])),
    gpuPowerWAtPeak: power,
    note: 'Output tokens only, measured through the gateway on this machine. A laptop GPU proves the control flow, not production economics.',
  };
  const final = await overview();
  report.totals = { passed: report.checks.filter((c) => c.pass).length, failed: report.checks.filter((c) => !c.pass).length, ledgerLines: ledgerToday().length - ledgerStart, today: final.today, tenants: final.tenants };

  // ---------- write the report to the data drive ----------
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const jsonFile = path.join(dirs.reports, `poc-report-${stamp}.json`);
  fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dirs.reports, 'latest.json'), JSON.stringify(report, null, 2));
  const md = [
    `# MaaS local-GPU POC test report`,
    ``,
    `- Generated: ${report.generatedAt}`,
    `- Node: ${report.node.name} — ${report.node.gpu.name}, ${report.node.gpu.memoryTotalMiB} MiB, driver ${report.node.gpu.driver}`,
    `- Runtime: ${report.node.runtime.kind} ${report.node.runtime.version}; partitioning: ${report.node.partitioning.strategy} (${report.node.partitioning.isolation})`,
    `- Storage root: ${cfg.storageRoot}`,
    `- Result: ${report.totals.passed} passed, ${report.totals.failed} failed`,
    ``,
    `## Acceptance checks`,
    ``,
    `| ID | Check | Result | Detail |`,
    `|---|---|---|---|`,
    ...report.checks.map((c) => `| ${c.id} | ${c.title} | ${c.pass ? 'PASS' : 'FAIL'} | ${String(c.detail ?? '').replace(/\|/g, '/')} |`),
    ``,
    `## Throughput`,
    ``,
    `| Scenario | Concurrency | Total tok/s | TTFT p50 (ms) | GPU util % | GPU W |`,
    `|---|---|---|---|---|---|`,
    ...report.benchmarks.map((b) => `| ${b.label} | ${b.concurrency} | ${b.totalAggregateTokPerSec} | ${Object.values(b.perModel).map((m) => m.ttftMsP50).join(' / ')} | ${b.gpu.utilizationPctAvg} | ${b.gpu.powerWAvg} |`),
    ``,
    `## Slice interference (compute is time-shared)`,
    ``,
    ...Object.entries(report.interference).map(([m, v]) => `- ${m}: ${v.soloTokPerSec} tok/s alone, ${v.contendedTokPerSec} tok/s when the other slice is busy (${v.retainedPct}% retained)`),
    ``,
    ...(report.notes.length ? [`## Notes`, ``, ...report.notes.map((n) => `- ${n}`), ``] : []),
  ].join('\n');
  fs.writeFileSync(path.join(dirs.reports, `poc-report-${stamp}.md`), md);
  fs.writeFileSync(path.join(dirs.reports, 'latest.md'), md);
  console.log(`\n${report.totals.passed} passed, ${report.totals.failed} failed. Report: ${jsonFile}`);
  process.exit(report.totals.failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
