// MaaS local-GPU POC — control plane + OpenAI-compatible gateway (single process, zero dependencies).
//
//   Customer data plane   GET  /v1/models
//                         POST /v1/chat/completions        (stream and non-stream)
//   Agent API             POST /agent/v1/enroll            (bootstrap token -> node id + node token)
//                         POST /agent/v1/heartbeat         (telemetry + actual slice state -> desired slice state)
//   Admin API             GET  /admin/v1/overview          (nodes, slices, tenants, today's usage)
//                         POST /admin/v1/profile           ({ profile }) switch the partition profile
//
// Everything persisted goes to the storage root on the data drive (default D:/maas-poc-storage):
//   state/   control-plane state (tenants and balances, key hashes, node registry)
//   ledger/  usage-YYYY-MM-DD.jsonl — one line per request, metadata only (zero retention: no prompt, no completion)
//   logs/    gateway.log
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig, storage, readJson, writeJson, makeLogger, sha256, randomToken, today } from './lib.mjs';

const cfg = loadConfig();
const dirs = storage(cfg);
const log = makeLogger(path.join(dirs.logs, 'gateway.log'), 'gateway');
const STATE_FILE = path.join(dirs.state, 'control-plane.json');
const KEYS_FILE = path.join(dirs.state, 'poc-keys.local.json'); // POC ONLY: plaintext keys so the test script can run
const NODE_STALE_MS = 20_000;

// ---------- state ----------
let state = readJson(STATE_FILE, null);
let plain = readJson(KEYS_FILE, null);
if (!state || !plain) {
  plain = { warning: 'POC ONLY. Production never stores plaintext keys; only the SHA-256 hash is kept.', admin: randomToken('maas_admin'), bootstrap: randomToken('maas_boot'), tenants: {} };
  state = { createdAt: new Date().toISOString(), adminKeyHash: sha256(plain.admin), bootstrapHash: sha256(plain.bootstrap), activeProfile: cfg.activeProfile, generation: 1, tenants: {}, keys: {}, nodes: {} };
  for (const t of cfg.tenants) {
    const key = randomToken('sk-maas');
    plain.tenants[t.id] = key;
    state.tenants[t.id] = { ...t, spentUsd: 0 };
    state.keys[sha256(key)] = { keyId: `key-${t.id}`, tenantId: t.id, createdAt: new Date().toISOString() };
  }
  writeJson(KEYS_FILE, plain);
  writeJson(STATE_FILE, state);
  log('info', 'initialised control-plane state', { stateFile: STATE_FILE });
}
let dirty = false;
const persist = () => {
  dirty = true;
};
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  try {
    writeJson(STATE_FILE, state);
  } catch (e) {
    log('error', 'persist failed', { error: String(e) });
  }
}, 1000).unref();

// ---------- in-memory runtime ----------
const windows = new Map(); // tenantId -> [{ ts, tokens }]
const inflight = new Map(); // `${nodeId}/${sliceId}` -> number
const publicModels = Object.entries(cfg.models).map(([runtimeModel, m]) => ({ runtimeModel, ...m }));
const byPublicId = new Map(publicModels.map((m) => [m.publicId, m]));

function desiredSlices() {
  return cfg.profiles[state.activeProfile]?.slices ?? [];
}

function usedInWindow(tenantId) {
  const now = Date.now();
  const arr = (windows.get(tenantId) ?? []).filter((e) => now - e.ts < 60_000);
  windows.set(tenantId, arr);
  return { tokens: arr.reduce((a, e) => a + e.tokens, 0), requests: arr.length, oldest: arr[0]?.ts ?? now };
}

// ---------- http helpers ----------
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-expose-headers': 'x-maas-request-id, x-maas-node, x-maas-slice, x-maas-retention, x-ratelimit-limit-tokens, x-ratelimit-remaining-tokens, retry-after',
};

function send(res, status, body, headers = {}) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length, ...CORS, ...headers });
  res.end(buf);
}
function fail(res, status, code, message, headers = {}) {
  send(res, status, { error: { code, message, type: status === 429 ? 'rate_limit_error' : status >= 500 ? 'server_error' : 'invalid_request_error' } }, headers);
}
async function readBody(req, limit = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('payload too large'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('invalid JSON body'), { status: 400 });
  }
}
const bearer = (req) => {
  const h = req.headers.authorization ?? '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
};
function safeEqualHash(token, hash) {
  if (!token || !hash) return false;
  const a = Buffer.from(sha256(token));
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- ledger ----------
function appendLedger(entry) {
  fs.appendFileSync(path.join(dirs.ledger, `usage-${today()}.jsonl`), JSON.stringify(entry) + '\n');
}
function readLedger(day = today()) {
  try {
    return fs
      .readFileSync(path.join(dirs.ledger, `usage-${day}.jsonl`), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

// ---------- routing ----------
function nodeFresh(n) {
  return Date.now() - new Date(n.lastHeartbeat ?? 0).getTime() < NODE_STALE_MS;
}
/** Pick a ready slice for (tenant, model): a tenant's dedicated slice first, then the least-busy shared slice. */
function pickSlice(tenantId, model) {
  const candidates = [];
  for (const node of Object.values(state.nodes)) {
    if (!nodeFresh(node)) continue;
    for (const sl of node.slices ?? []) {
      if (sl.model !== model.runtimeModel || sl.state !== 'ready') continue;
      if (sl.sharing === 'dedicated' && sl.tenantId !== tenantId) continue;
      const key = `${node.id}/${sl.id}`;
      candidates.push({ node, slice: sl, key, busy: inflight.get(key) ?? 0 });
    }
  }
  candidates.sort((a, b) => (a.slice.sharing === 'dedicated' ? 0 : 1) - (b.slice.sharing === 'dedicated' ? 0 : 1) || a.busy - b.busy);
  return candidates[0] ?? null;
}

function toText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === 'string' ? p : p?.type === 'text' ? (p.text ?? '') : '')).join('');
  return '';
}

// ---------- customer API ----------
function authTenant(req, res) {
  const token = bearer(req);
  const rec = token ? state.keys[sha256(token)] : null;
  if (!rec) {
    fail(res, 401, 'INVALID_API_KEY', 'Missing or invalid API key.');
    return null;
  }
  return { tenant: state.tenants[rec.tenantId], keyId: rec.keyId };
}
const tenantAllows = (tenant, publicId) => tenant.models === '*' || tenant.models.includes(publicId);

function listModels(req, res) {
  const auth = authTenant(req, res);
  if (!auth) return;
  const data = publicModels
    .filter((m) => tenantAllows(auth.tenant, m.publicId))
    .map((m) => {
      const ready = Object.values(state.nodes).some((n) => nodeFresh(n) && (n.slices ?? []).some((s) => s.model === m.runtimeModel && s.state === 'ready' && (s.sharing !== 'dedicated' || s.tenantId === auth.tenant.id)));
      return { id: m.publicId, object: 'model', owned_by: 'maas-poc', hosting: 'self-hosted', origin: m.origin, license: m.license, pricing: { input_per_1m_usd: m.priceInPerM, output_per_1m_usd: m.priceOutPerM }, status: ready ? 'ready' : 'not-loaded' };
    });
  send(res, 200, { object: 'list', data });
}

async function chatCompletions(req, res) {
  const requestId = `req_${crypto.randomBytes(9).toString('base64url')}`;
  const started = Date.now();
  const auth = authTenant(req, res);
  if (!auth) return;
  const { tenant, keyId } = auth;
  const base = { 'x-maas-request-id': requestId, 'x-maas-retention': tenant.zeroRetention ? 'none' : 'standard' };
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return fail(res, e.status ?? 400, 'VALIDATION', e.message, base);
  }
  const model = byPublicId.get(body.model);
  const record = (status, code, extra = {}) =>
    appendLedger({ ts: new Date().toISOString(), requestId, tenantId: tenant.id, keyId, model: body.model ?? null, status, code, promptTokens: 0, completionTokens: 0, costUsd: 0, durationMs: Date.now() - started, ...extra });

  if (!model || !Array.isArray(body.messages) || body.messages.length === 0) {
    record(400, 'VALIDATION');
    return fail(res, 400, 'VALIDATION', !model ? `Unknown model "${body.model}". See GET /v1/models.` : '"messages" must be a non-empty array.', base);
  }
  if (!tenantAllows(tenant, model.publicId)) {
    record(403, 'MODEL_NOT_ALLOWED');
    return fail(res, 403, 'MODEL_NOT_ALLOWED', `Model "${model.publicId}" is not in this tenant's catalog.`, base);
  }
  if (tenant.balanceUsd <= 0) {
    record(402, 'INSUFFICIENT_CREDITS');
    return fail(res, 402, 'INSUFFICIENT_CREDITS', 'Prepaid credits are exhausted. Top up to continue.', base);
  }
  const used = usedInWindow(tenant.id);
  const rl = { 'x-ratelimit-limit-tokens': String(tenant.tpmLimit), 'x-ratelimit-remaining-tokens': String(Math.max(0, tenant.tpmLimit - used.tokens)) };
  if (used.tokens >= tenant.tpmLimit || used.requests >= tenant.rpmLimit) {
    const retry = Math.max(1, Math.ceil((60_000 - (Date.now() - used.oldest)) / 1000));
    record(429, 'RATE_LIMITED');
    return fail(res, 429, 'RATE_LIMITED', `Rate limit reached (${tenant.tpmLimit} TPM / ${tenant.rpmLimit} RPM).`, { ...base, ...rl, 'retry-after': String(retry) });
  }
  const target = pickSlice(tenant.id, model);
  if (!target) {
    record(503, 'MODEL_NOT_READY');
    return fail(res, 503, 'MODEL_NOT_READY', `No ready GPU slice is serving "${model.publicId}" right now.`, { ...base, 'retry-after': '10' });
  }
  if (target.busy >= (target.slice.maxInflight ?? 2) * 4) {
    record(429, 'SLICE_SATURATED');
    return fail(res, 429, 'SLICE_SATURATED', 'The GPU slice queue is full. Retry shortly.', { ...base, 'retry-after': '2' });
  }

  const { node, slice, key } = target;
  const headers = { ...base, ...rl, 'x-maas-node': node.id, 'x-maas-slice': slice.id };
  const stream = body.stream === true;
  const options = { num_ctx: slice.numCtx ?? 4096 };
  if (Number.isFinite(body.max_tokens)) options.num_predict = body.max_tokens;
  if (Number.isFinite(body.temperature)) options.temperature = body.temperature;
  if (Number.isFinite(body.top_p)) options.top_p = body.top_p;
  if (body.stop) options.stop = Array.isArray(body.stop) ? body.stop : [body.stop];
  const upstreamBody = { model: model.runtimeModel, messages: body.messages.map((m) => ({ role: m.role, content: toText(m.content) })), stream, options, keep_alive: -1 };

  inflight.set(key, (inflight.get(key) ?? 0) + 1);
  const ac = new AbortController();
  let clientGone = false;
  res.on('close', () => {
    if (!res.writableEnded) {
      clientGone = true;
      ac.abort();
    }
  });
  let promptTokens = 0;
  let completionTokens = 0;
  let ttftMs = null;
  let status = 200;
  let code = 'OK';
  let evalMs = null;
  try {
    const up = await fetch(`${slice.endpoint}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(upstreamBody), signal: ac.signal });
    if (!up.ok) {
      status = 502;
      code = 'UPSTREAM_ERROR';
      const text = await up.text().catch(() => '');
      log('warn', 'runtime error', { requestId, upstream: up.status, text: text.slice(0, 200) });
      fail(res, 502, code, 'The inference runtime returned an error.', headers);
    } else if (!stream) {
      const j = await up.json();
      ttftMs = Date.now() - started;
      promptTokens = j.prompt_eval_count ?? 0;
      completionTokens = j.eval_count ?? 0;
      evalMs = j.eval_duration ? j.eval_duration / 1e6 : null;
      send(
        res,
        200,
        {
          id: `chatcmpl-${requestId}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: model.publicId,
          choices: [{ index: 0, message: { role: 'assistant', content: j.message?.content ?? '' }, finish_reason: j.done_reason === 'length' ? 'length' : 'stop' }],
          usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
        },
        headers,
      );
    } else {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive', ...CORS, ...headers });
      const id = `chatcmpl-${requestId}`;
      const created = Math.floor(Date.now() / 1000);
      const sse = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      sse({ id, object: 'chat.completion.chunk', created, model: model.publicId, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
      const decoder = new TextDecoder();
      let buf = '';
      let chunks = 0;
      let finish = 'stop';
      for await (const part of up.body) {
        buf += decoder.decode(part, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const j = JSON.parse(line);
          const text = j.message?.content ?? '';
          if (text) {
            if (ttftMs === null) ttftMs = Date.now() - started;
            chunks += 1;
            sse({ id, object: 'chat.completion.chunk', created, model: model.publicId, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
          }
          if (j.done) {
            promptTokens = j.prompt_eval_count ?? 0;
            completionTokens = j.eval_count ?? chunks;
            evalMs = j.eval_duration ? j.eval_duration / 1e6 : null;
            finish = j.done_reason === 'length' ? 'length' : 'stop';
          }
        }
      }
      if (!completionTokens) completionTokens = chunks; // aborted mid-stream: bill what was actually streamed
      sse({ id, object: 'chat.completion.chunk', created, model: model.publicId, choices: [{ index: 0, delta: {}, finish_reason: finish }] });
      if (body.stream_options?.include_usage) sse({ id, object: 'chat.completion.chunk', created, model: model.publicId, choices: [], usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens } });
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (e) {
    if (clientGone) {
      status = 499;
      code = 'CLIENT_CLOSED';
    } else {
      status = 502;
      code = 'UPSTREAM_UNREACHABLE';
      log('error', 'upstream failed', { requestId, error: String(e) });
      if (!res.headersSent) fail(res, 502, code, 'The inference runtime is unreachable.', headers);
      else res.end();
    }
  } finally {
    inflight.set(key, Math.max(0, (inflight.get(key) ?? 1) - 1));
    const costUsd = (promptTokens * model.priceInPerM + completionTokens * model.priceOutPerM) / 1e6;
    if (promptTokens + completionTokens > 0) {
      tenant.balanceUsd = Math.round((tenant.balanceUsd - costUsd) * 1e9) / 1e9;
      tenant.spentUsd = Math.round(((tenant.spentUsd ?? 0) + costUsd) * 1e9) / 1e9;
      const arr = windows.get(tenant.id) ?? [];
      arr.push({ ts: Date.now(), tokens: promptTokens + completionTokens });
      windows.set(tenant.id, arr);
      persist();
    }
    // Zero retention: the ledger holds metering metadata only — never the prompt or the completion.
    appendLedger({
      ts: new Date().toISOString(),
      requestId,
      tenantId: tenant.id,
      keyId,
      model: model.publicId,
      nodeId: node.id,
      sliceId: slice.id,
      sharing: slice.sharing,
      stream,
      status,
      code,
      promptTokens,
      completionTokens,
      costUsd,
      ttftMs,
      durationMs: Date.now() - started,
      evalMs,
      tokPerSec: evalMs && completionTokens ? Math.round((completionTokens / evalMs) * 1e5) / 100 : null,
    });
  }
}

// ---------- agent API ----------
async function enroll(req, res) {
  const body = await readBody(req);
  if (!safeEqualHash(bearer(req), state.bootstrapHash)) return fail(res, 401, 'INVALID_BOOTSTRAP_TOKEN', 'Bootstrap token rejected.');
  const nodeId = `node-${crypto.randomBytes(4).toString('hex')}`;
  const nodeToken = randomToken('maas_node');
  state.nodes[nodeId] = { id: nodeId, name: String(body.name ?? nodeId).slice(0, 64), site: String(body.site ?? '').slice(0, 64), tokenHash: sha256(nodeToken), enrolledAt: new Date().toISOString(), lastHeartbeat: null, slices: [] };
  persist();
  log('info', 'node enrolled', { nodeId, name: state.nodes[nodeId].name });
  send(res, 201, { nodeId, nodeToken, heartbeatMs: cfg.node.heartbeatMs });
}

async function heartbeat(req, res) {
  const body = await readBody(req);
  const node = state.nodes[body.nodeId];
  if (!node || !safeEqualHash(bearer(req), node.tokenHash)) return fail(res, 401, 'INVALID_NODE_TOKEN', 'Unknown node or bad node token.');
  node.lastHeartbeat = new Date().toISOString();
  node.agentVersion = body.agentVersion;
  node.gpu = body.gpu;
  node.runtime = body.runtime;
  node.partitioning = body.partitioning;
  node.slices = Array.isArray(body.slices) ? body.slices : [];
  node.appliedGeneration = body.appliedGeneration;
  persist();
  send(res, 200, { generation: state.generation, profile: state.activeProfile, slices: desiredSlices() });
}

// ---------- admin API ----------
function isAdmin(req) {
  return safeEqualHash(bearer(req), state.adminKeyHash);
}
function overview(res) {
  const ledger = readLedger();
  const ok = ledger.filter((e) => e.status === 200);
  const byTenant = {};
  for (const e of ledger) {
    const t = (byTenant[e.tenantId] ??= { requests: 0, ok: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 });
    t.requests += 1;
    if (e.status === 200) t.ok += 1;
    t.promptTokens += e.promptTokens;
    t.completionTokens += e.completionTokens;
    t.costUsd += e.costUsd;
  }
  send(res, 200, {
    now: new Date().toISOString(),
    storageRoot: cfg.storageRoot,
    profile: state.activeProfile,
    generation: state.generation,
    profiles: Object.fromEntries(Object.entries(cfg.profiles).map(([k, v]) => [k, { description: v.description, slices: v.slices }])),
    nodes: Object.values(state.nodes).map(({ tokenHash, ...n }) => ({ ...n, online: nodeFresh(n), slices: (n.slices ?? []).map((s) => ({ ...s, inflight: inflight.get(`${n.id}/${s.id}`) ?? 0 })) })),
    tenants: Object.values(state.tenants).map((t) => ({ id: t.id, name: t.name, type: t.type, balanceUsd: t.balanceUsd, spentUsd: t.spentUsd ?? 0, tpmLimit: t.tpmLimit, tpmUsed: usedInWindow(t.id).tokens, models: t.models })),
    today: { requests: ledger.length, ok: ok.length, promptTokens: ok.reduce((a, e) => a + e.promptTokens, 0), completionTokens: ok.reduce((a, e) => a + e.completionTokens, 0), revenueUsd: ledger.reduce((a, e) => a + e.costUsd, 0), byTenant },
  });
}
async function switchProfile(req, res) {
  const body = await readBody(req);
  if (!cfg.profiles[body.profile]) return fail(res, 400, 'VALIDATION', `Unknown profile. Available: ${Object.keys(cfg.profiles).join(', ')}`);
  state.activeProfile = body.profile;
  state.generation += 1;
  persist();
  log('info', 'partition profile switched', { profile: body.profile, generation: state.generation });
  send(res, 200, { profile: state.activeProfile, generation: state.generation });
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/v1/models') return listModels(req, res);
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') return await chatCompletions(req, res);
    if (req.method === 'POST' && url.pathname === '/agent/v1/enroll') return await enroll(req, res);
    if (req.method === 'POST' && url.pathname === '/agent/v1/heartbeat') return await heartbeat(req, res);
    if (url.pathname.startsWith('/admin/')) {
      if (!isAdmin(req)) return fail(res, 401, 'INVALID_ADMIN_KEY', 'Admin key required.');
      if (req.method === 'GET' && url.pathname === '/admin/v1/overview') return overview(res);
      if (req.method === 'POST' && url.pathname === '/admin/v1/profile') return await switchProfile(req, res);
    }
    fail(res, 404, 'NOT_FOUND', 'No such endpoint.');
  } catch (e) {
    log('error', 'unhandled', { path: url.pathname, error: String(e?.stack ?? e) });
    if (!res.headersSent) fail(res, e.status ?? 500, 'INTERNAL', 'Internal error.');
    else res.end();
  }
});
server.listen(cfg.gateway.port, cfg.gateway.host, () => {
  log('info', `gateway listening on http://${cfg.gateway.host}:${cfg.gateway.port}`, { storageRoot: cfg.storageRoot, profile: state.activeProfile });
});
const shutdown = () => {
  try {
    writeJson(STATE_FILE, state);
  } catch {
    /* ignore */
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
