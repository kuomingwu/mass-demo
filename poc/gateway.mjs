// MaaS local-GPU POC — control plane + OpenAI-compatible gateway (single process, zero dependencies).
//
//   Customer data plane   GET  /v1/models
//                         POST /v1/chat/completions        (stream and non-stream)
//   Agent API             POST /agent/v1/enroll            (bootstrap token -> node id + node token)
//                         POST /agent/v1/heartbeat         (telemetry + actual slice state -> desired slice state)
//   Admin API             GET  /admin/v1/overview          (nodes, slices, tenants, today's usage)
//                         POST /admin/v1/profile           ({ profile }) switch the partition profile
//                         POST /admin/v1/tenants           open a customer account -> one-time activation code
//                         POST /admin/v1/sites             add a site (data centre) -> one-time enrollment token for its machines
//                         POST /admin/v1/slices/clear      release every on-demand slice (start a demo from an empty card)
//                         GET  /admin/v1/topology          sites -> nodes -> GPU -> slices -> tenants, plus recent events
//                         GET  /topology                   the admin topology page (topology.html)
//   On-demand slicing     GET  /portal/v1/sites            sites the customer can deploy to
//                         GET  /portal/v1/deployments      the customer's enabled models
//                         POST /portal/v1/deployments      ({ model, siteId }) enable a model: the control plane carves a slice
//                         POST /portal/v1/deployments/remove ({ sliceId }) disable it; an unused slice is released
//   Customer onboarding   POST /portal/v1/activate         (activation code -> first API key, shown once)
//                         GET  /portal/v1/me               (account, balance, limits, keys, today's usage)
//                         POST /portal/v1/keys             create another key
//                         POST /portal/v1/keys/revoke      ({ keyId }) revoke a key
//                         GET  /portal                     the customer activation page (portal.html)
//
// Everything persisted goes to the storage root on the data drive (default D:/maas-poc-storage):
//   state/   control-plane state (tenants and balances, key hashes, node registry)
//   ledger/  usage-YYYY-MM-DD.jsonl — one line per request, metadata only (zero retention: no prompt, no completion)
//   logs/    gateway.log
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig, storage, readJson, writeJson, makeLogger, sha256, randomToken, today, HERE } from './lib.mjs';

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
state.activations ??= {}; // sha256(activation code) -> { tenantId, expiresAt, usedAt }
state.sites ??= {}; // siteId -> { id, name, region, location, bootHash, bootExpiresAt }
state.slices ??= []; // on-demand slices: { id, nodeId, siteId, model, vramMiB, numCtx, maxInflight, sharing, tenants: [] }
state.events ??= []; // recent control-plane events, newest last (shown on the topology page)
const ON_DEMAND = 'on-demand';
function event(type, fields = {}) {
  state.events.push({ ts: new Date().toISOString(), type, ...fields });
  if (state.events.length > 60) state.events.splice(0, state.events.length - 60);
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

/** Desired state for one node. In on-demand mode it is whatever customers have enabled on that node. */
function desiredSlices(node) {
  if (state.activeProfile === ON_DEMAND) return state.slices.filter((sl) => sl.nodeId === node?.id).map(({ nodeId, siteId, tenants, ...sl }) => sl);
  return cfg.profiles[state.activeProfile]?.slices ?? [];
}
/** May this tenant send traffic to this slice? Decided from control-plane state, never from what the agent echoes back. */
function tenantMayUse(sl, tenantId) {
  if (state.activeProfile === ON_DEMAND) return state.slices.some((d) => d.id === sl.id && d.tenants.includes(tenantId));
  return sl.sharing !== 'dedicated' || sl.tenantId === tenantId;
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
      if (!tenantMayUse(sl, tenantId)) continue;
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
  const tenant = state.tenants[rec.tenantId];
  if (!tenant || (tenant.status ?? 'active') !== 'active') {
    fail(res, 403, 'TENANT_NOT_ACTIVE', 'This account is not active.');
    return null;
  }
  return { tenant, keyId: rec.keyId };
}
const tenantAllows = (tenant, publicId) => tenant.models === '*' || tenant.models.includes(publicId);

function listModels(req, res) {
  const auth = authTenant(req, res);
  if (!auth) return;
  const data = publicModels
    .filter((m) => tenantAllows(auth.tenant, m.publicId))
    .map((m) => {
      const ready = Object.values(state.nodes).some((n) => nodeFresh(n) && (n.slices ?? []).some((s) => s.model === m.runtimeModel && s.state === 'ready' && tenantMayUse(s, auth.tenant.id)));
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

// ---------- customer onboarding ----------
function issueKey(tenantId, name) {
  const key = randomToken('sk-maas');
  const keyId = `key-${crypto.randomBytes(4).toString('hex')}`;
  // Only the hash is stored. The plaintext leaves the server exactly once, in this response.
  state.keys[sha256(key)] = { keyId, tenantId, name: String(name ?? 'default').slice(0, 40), prefix: key.slice(0, 12), createdAt: new Date().toISOString() };
  persist();
  return { keyId, key };
}
const keysOf = (tenantId) =>
  Object.values(state.keys)
    .filter((k) => k.tenantId === tenantId)
    .map(({ keyId, name, prefix, createdAt }) => ({ keyId, name: name ?? 'default', prefix: prefix ?? 'sk-maas_', createdAt }));

/** Admin opens a customer account. The customer cannot call anything until they redeem the activation code. */
async function createTenant(req, res) {
  const body = await readBody(req);
  const name = String(body.name ?? '').trim().slice(0, 64);
  if (!name) return fail(res, 400, 'VALIDATION', '"name" is required.');
  const models = body.models === '*' || body.models == null ? '*' : body.models;
  if (models !== '*' && !(Array.isArray(models) && models.length > 0 && models.every((m) => byPublicId.has(m)))) return fail(res, 400, 'VALIDATION', `"models" must be "*" or a list of: ${[...byPublicId.keys()].join(', ')}`);
  const d = cfg.onboarding ?? {};
  const num = (v, fallback) => (Number.isFinite(v) && v >= 0 ? v : fallback);
  const id = `t-${crypto.randomBytes(3).toString('hex')}`;
  state.tenants[id] = {
    id,
    name,
    type: body.type === 'public-sector' ? 'public-sector' : 'enterprise',
    status: 'pending',
    balanceUsd: num(body.creditUsd, d.defaultCreditUsd ?? 1),
    spentUsd: 0,
    tpmLimit: num(body.tpmLimit, d.defaultTpmLimit ?? 20000),
    rpmLimit: num(body.rpmLimit, d.defaultRpmLimit ?? 60),
    models,
    zeroRetention: true,
    createdAt: new Date().toISOString(),
  };
  const code = randomToken('act', 12);
  const expiresAt = new Date(Date.now() + (d.activationTtlHours ?? 24) * 3600_000).toISOString();
  state.activations[sha256(code)] = { tenantId: id, expiresAt, usedAt: null };
  persist();
  event('tenant-created', { tenantId: id, tenant: name });
  log('info', 'tenant created, waiting for activation', { tenantId: id, name });
  send(res, 201, { tenantId: id, status: 'pending', activationCode: code, expiresAt, activationUrl: `http://${cfg.gateway.host}:${cfg.gateway.port}/portal` });
}

/** Customer redeems the one-time code: the account becomes active and the first API key is returned once. */
async function activate(req, res) {
  const body = await readBody(req);
  const rec = state.activations[sha256(String(body.activationCode ?? '').trim())];
  if (!rec) return fail(res, 401, 'INVALID_ACTIVATION_CODE', 'Activation code rejected.');
  if (rec.usedAt) return fail(res, 409, 'ACTIVATION_CODE_USED', 'This activation code has already been used.');
  if (new Date(rec.expiresAt).getTime() < Date.now()) return fail(res, 410, 'ACTIVATION_CODE_EXPIRED', 'This activation code has expired. Ask for a new one.');
  const tenant = state.tenants[rec.tenantId];
  rec.usedAt = new Date().toISOString();
  tenant.status = 'active';
  tenant.activatedAt = rec.usedAt;
  const { keyId, key } = issueKey(tenant.id, 'default');
  event('tenant-activated', { tenantId: tenant.id, tenant: tenant.name });
  log('info', 'tenant activated', { tenantId: tenant.id, keyId });
  send(res, 201, { tenantId: tenant.id, name: tenant.name, status: 'active', apiKey: key, keyId, baseUrl: `http://${cfg.gateway.host}:${cfg.gateway.port}/v1`, note: 'Store this key now. It is not shown again.' });
}

function me(req, res) {
  const auth = authTenant(req, res);
  if (!auth) return;
  const t = auth.tenant;
  const mine = readLedger().filter((e) => e.tenantId === t.id);
  const ok = mine.filter((e) => e.status === 200);
  send(res, 200, {
    tenantId: t.id,
    name: t.name,
    type: t.type,
    status: t.status ?? 'active',
    balanceUsd: t.balanceUsd,
    spentUsd: t.spentUsd ?? 0,
    limits: { tpm: t.tpmLimit, rpm: t.rpmLimit, tpmUsed: usedInWindow(t.id).tokens },
    models: t.models,
    retention: t.zeroRetention ? 'none' : 'standard',
    currentKeyId: auth.keyId,
    keys: keysOf(t.id),
    today: { requests: mine.length, ok: ok.length, promptTokens: ok.reduce((a, e) => a + e.promptTokens, 0), completionTokens: ok.reduce((a, e) => a + e.completionTokens, 0), costUsd: mine.reduce((a, e) => a + e.costUsd, 0) },
  });
}
async function createKey(req, res) {
  const auth = authTenant(req, res);
  if (!auth) return;
  const body = await readBody(req);
  if (keysOf(auth.tenant.id).length >= 10) return fail(res, 409, 'KEY_LIMIT', 'At most 10 keys per account in this POC.');
  const { keyId, key } = issueKey(auth.tenant.id, body.name);
  send(res, 201, { keyId, apiKey: key, note: 'Store this key now. It is not shown again.' });
}
async function revokeKey(req, res) {
  const auth = authTenant(req, res);
  if (!auth) return;
  const body = await readBody(req);
  const hash = Object.keys(state.keys).find((h) => state.keys[h].keyId === body.keyId && state.keys[h].tenantId === auth.tenant.id);
  if (!hash) return fail(res, 404, 'NOT_FOUND', 'No such key in this account.'); // another tenant's key looks exactly like a missing one
  delete state.keys[hash];
  persist();
  log('info', 'key revoked', { tenantId: auth.tenant.id, keyId: body.keyId });
  send(res, 200, { keyId: body.keyId, revoked: true });
}
function portalPage(res) {
  const html = fs.readFileSync(path.join(HERE, 'portal.html'));
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': html.length, 'cache-control': 'no-store' });
  res.end(html);
}

// ---------- sites and on-demand slicing ----------
const onlineNodes = (siteId) => Object.values(state.nodes).filter((n) => nodeFresh(n) && (siteId == null || n.siteId === siteId));
const allocatedMiB = (nodeId) => state.slices.filter((sl) => sl.nodeId === nodeId).reduce((a, sl) => a + sl.vramMiB, 0);
const freeMiB = (node) => Math.max(0, (node.gpu?.sliceBudgetMiB ?? 0) - allocatedMiB(node.id));
const actualSlice = (d) => (state.nodes[d.nodeId]?.slices ?? []).find((x) => x.id === d.id);

async function upsertSite(req, res) {
  const body = await readBody(req);
  const name = String(body.name ?? '').trim().slice(0, 64);
  if (!name) return fail(res, 400, 'VALIDATION', '"name" is required.');
  const id = String(body.id ?? name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || `site-${crypto.randomBytes(3).toString('hex')}`;
  const token = randomToken('maas_boot');
  const existed = !!state.sites[id];
  const bootExpiresAt = new Date(Date.now() + (cfg.onboarding?.enrollTokenTtlHours ?? 24) * 3600_000).toISOString();
  state.sites[id] = { ...(state.sites[id] ?? { createdAt: new Date().toISOString() }), id, name, region: String(body.region ?? '').slice(0, 32), location: String(body.location ?? '').slice(0, 80), bootHash: sha256(token), bootExpiresAt };
  if (!existed) event('site-added', { siteId: id, name });
  persist();
  log('info', existed ? 'site enrollment token reissued' : 'site added', { siteId: id });
  send(res, existed ? 200 : 201, { siteId: id, name, region: state.sites[id].region, location: state.sites[id].location, enrollmentToken: token, expiresAt: bootExpiresAt, note: 'One-time token. Run the agent on the GPU machine with MAAS_BOOTSTRAP_TOKEN set to it.' });
}

function portalSites(req, res) {
  const auth = authTenant(req, res);
  if (!auth) return;
  send(res, 200, {
    mode: state.activeProfile,
    data: Object.values(state.sites).map((x) => {
      const nodes = onlineNodes(x.id);
      return { id: x.id, name: x.name, region: x.region, location: x.location, onlineNodes: nodes.length, freeMiB: nodes.reduce((a, n) => a + freeMiB(n), 0), largestFreeMiB: Math.max(0, ...nodes.map(freeMiB)) };
    }),
  });
}
const deploymentView = (d) => {
  const a = actualSlice(d);
  return { sliceId: d.id, model: cfg.models[d.model].publicId, siteId: d.siteId, siteName: state.sites[d.siteId]?.name ?? null, nodeId: d.nodeId, vramMiB: d.vramMiB, measuredMiB: a?.measuredMiB ?? null, state: a?.state ?? 'pending', detail: a?.detail ?? null, sharedWith: d.tenants.length - 1 };
};
function listDeployments(req, res) {
  const auth = authTenant(req, res);
  if (!auth) return;
  send(res, 200, { data: state.slices.filter((d) => d.tenants.includes(auth.tenant.id)).map(deploymentView) });
}
/** Customer enables a model at a site. Reuse the slice already serving it there, or carve a new one out of free VRAM. */
async function createDeployment(req, res) {
  const auth = authTenant(req, res);
  if (!auth) return;
  const body = await readBody(req);
  const tenant = auth.tenant;
  if (state.activeProfile !== ON_DEMAND) return fail(res, 409, 'NOT_ON_DEMAND', 'The platform is running a fixed partition profile. Switch to "on-demand" first.');
  const model = byPublicId.get(body.model);
  if (!model) return fail(res, 400, 'VALIDATION', `Unknown model "${body.model}".`);
  if (!tenantAllows(tenant, model.publicId)) return fail(res, 403, 'MODEL_NOT_ALLOWED', `Model "${model.publicId}" is not in this account's catalog.`);
  const site = state.sites[body.siteId];
  if (!site) return fail(res, 400, 'VALIDATION', 'Unknown "siteId". See GET /portal/v1/sites.');
  const nodes = onlineNodes(site.id);
  if (nodes.length === 0) return fail(res, 409, 'SITE_HAS_NO_NODES', `Site "${site.name}" has no GPU machine online.`);

  const existing = state.slices.find((d) => d.siteId === site.id && d.model === model.runtimeModel && nodes.some((n) => n.id === d.nodeId));
  if (existing) {
    if (!existing.tenants.includes(tenant.id)) {
      existing.tenants.push(tenant.id);
      event('slice-shared', { sliceId: existing.id, model: model.publicId, siteId: site.id, tenantId: tenant.id, tenant: tenant.name });
      persist();
    }
    return send(res, 200, { ...deploymentView(existing), carved: false });
  }
  const need = model.sliceMiB ?? 4096;
  const node = nodes.filter((n) => freeMiB(n) >= need).sort((a, b) => freeMiB(b) - freeMiB(a))[0];
  if (!node) return fail(res, 409, 'NO_CAPACITY', `"${model.publicId}" needs ${need} MiB; the largest free block at "${site.name}" is ${Math.max(0, ...nodes.map(freeMiB))} MiB.`);
  const d = { id: `sl-${crypto.randomBytes(3).toString('hex')}`, nodeId: node.id, siteId: site.id, model: model.runtimeModel, vramMiB: need, numCtx: model.numCtx ?? 4096, maxInflight: 2, sharing: 'shared', tenants: [tenant.id], createdAt: new Date().toISOString() };
  state.slices.push(d);
  state.generation += 1;
  event('slice-carved', { sliceId: d.id, model: model.publicId, siteId: site.id, nodeId: node.id, vramMiB: need, tenantId: tenant.id, tenant: tenant.name });
  persist();
  log('info', 'slice carved', { sliceId: d.id, nodeId: node.id, model: model.publicId, vramMiB: need, tenantId: tenant.id });
  send(res, 201, { ...deploymentView(d), carved: true });
}
async function removeDeployment(req, res) {
  const auth = authTenant(req, res);
  if (!auth) return;
  const body = await readBody(req);
  const d = state.slices.find((x) => x.id === body.sliceId && x.tenants.includes(auth.tenant.id));
  if (!d) return fail(res, 404, 'NOT_FOUND', 'No such deployment in this account.');
  d.tenants = d.tenants.filter((t) => t !== auth.tenant.id);
  const released = d.tenants.length === 0;
  if (released) {
    state.slices = state.slices.filter((x) => x !== d);
    state.generation += 1;
    event('slice-released', { sliceId: d.id, model: cfg.models[d.model].publicId, siteId: d.siteId, vramMiB: d.vramMiB });
  } else {
    event('slice-left', { sliceId: d.id, model: cfg.models[d.model].publicId, siteId: d.siteId, tenantId: auth.tenant.id, tenant: auth.tenant.name });
  }
  persist();
  send(res, 200, { sliceId: d.id, released });
}

function clearSlices(res) {
  const n = state.slices.length;
  state.slices = [];
  state.generation += 1;
  if (n) event("slices-cleared", { count: n });
  persist();
  send(res, 200, { released: n, generation: state.generation });
}

function topology(res) {
  const nodeView = (n) => {
    const slices = (n.slices ?? []).map((a) => {
      const d = state.slices.find((x) => x.id === a.id);
      return { id: a.id, model: a.publicId, state: a.state, detail: a.detail ?? null, budgetMiB: a.budgetMiB, measuredMiB: a.measuredMiB ?? null, sharing: a.sharing, inflight: inflight.get(`${n.id}/${a.id}`) ?? 0, tenants: (d?.tenants ?? (a.tenantId ? [a.tenantId] : [])).map((t) => ({ id: t, name: state.tenants[t]?.name ?? t })) };
    });
    // slices the control plane has assigned but the agent has not reported yet
    for (const d of state.slices.filter((x) => x.nodeId === n.id && !slices.some((x2) => x2.id === x.id))) slices.push({ id: d.id, model: cfg.models[d.model].publicId, state: 'pending', detail: null, budgetMiB: d.vramMiB, measuredMiB: null, sharing: d.sharing, inflight: 0, tenants: d.tenants.map((t) => ({ id: t, name: state.tenants[t]?.name ?? t })) });
    const budget = n.gpu?.sliceBudgetMiB ?? 0;
    return { id: n.id, name: n.name, online: nodeFresh(n), lastHeartbeat: n.lastHeartbeat, appliedGeneration: n.appliedGeneration ?? null, gpu: n.gpu ? { name: n.gpu.name, totalMiB: n.gpu.memoryTotalMiB, usedMiB: n.gpu.memoryUsedMiB, reserveMiB: n.gpu.reserveMiB, sliceBudgetMiB: budget, utilizationPct: n.gpu.utilizationPct, temperatureC: n.gpu.temperatureC } : null, strategy: n.partitioning?.strategy ?? null, isolation: n.partitioning?.isolation ?? null, runtime: n.runtime ? `${n.runtime.kind} ${n.runtime.version ?? ''}`.trim() : null, slices, freeMiB: Math.max(0, budget - slices.filter((x) => x.state !== 'rejected-no-capacity').reduce((a, x) => a + x.budgetMiB, 0)) };
  };
  const nodes = Object.values(state.nodes);
  send(res, 200, {
    now: new Date().toISOString(),
    mode: state.activeProfile,
    generation: state.generation,
    catalog: publicModels.map((m) => ({ id: m.publicId, sliceMiB: m.sliceMiB ?? null })),
    sites: Object.values(state.sites).map((x) => ({ id: x.id, name: x.name, region: x.region, location: x.location, enrollmentTokenPending: !!x.bootHash && new Date(x.bootExpiresAt).getTime() > Date.now(), nodes: nodes.filter((n) => n.siteId === x.id).map(nodeView) })),
    unassigned: nodes.filter((n) => !n.siteId && nodeFresh(n)).map(nodeView),
    tenants: Object.values(state.tenants).filter((t) => t.status).map((t) => ({ id: t.id, name: t.name, status: t.status, balanceUsd: t.balanceUsd, spentUsd: t.spentUsd ?? 0, models: t.models, deployments: state.slices.filter((d) => d.tenants.includes(t.id)).length })),
    events: state.events.slice(-25).reverse(),
  });
}
function staticPage(res, file) {
  const html = fs.readFileSync(path.join(HERE, file));
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': html.length, 'cache-control': 'no-store' });
  res.end(html);
}

// ---------- agent API ----------
async function enroll(req, res) {
  const body = await readBody(req);
  const token = bearer(req);
  const site = Object.values(state.sites).find((x) => x.bootHash && safeEqualHash(token, x.bootHash));
  if (site && new Date(site.bootExpiresAt).getTime() < Date.now()) return fail(res, 401, 'BOOTSTRAP_TOKEN_EXPIRED', 'This enrollment token has expired. Issue a new one for the site.');
  if (!site && !safeEqualHash(token, state.bootstrapHash)) return fail(res, 401, 'INVALID_BOOTSTRAP_TOKEN', 'Bootstrap token rejected.');
  // The site comes from the token the admin issued, not from anything the machine claims about itself.
  const siteId = site?.id ?? null;
  const gpuUuid = typeof body.gpuUuid === 'string' ? body.gpuUuid.slice(0, 80) : null;
  const known = gpuUuid ? Object.values(state.nodes).find((n) => n.gpuUuid === gpuUuid) : null;
  const nodeId = known?.id ?? `node-${crypto.randomBytes(4).toString('hex')}`;
  const nodeToken = randomToken('maas_node');
  if (known && known.siteId !== siteId) state.slices = state.slices.filter((sl) => sl.nodeId !== nodeId); // moved to another site: its old slices no longer apply
  state.nodes[nodeId] = { ...(known ?? {}), id: nodeId, name: String(body.name ?? nodeId).slice(0, 64), site: site?.name ?? String(body.site ?? '').slice(0, 64), siteId, gpuUuid, tokenHash: sha256(nodeToken), enrolledAt: new Date().toISOString(), lastHeartbeat: null, slices: [] };
  if (site) site.bootHash = null; // one-time: the next machine needs a new token
  state.generation += 1;
  event('node-enrolled', { nodeId, name: state.nodes[nodeId].name, siteId });
  persist();
  log('info', 'node enrolled', { nodeId, name: state.nodes[nodeId].name, siteId });
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
  send(res, 200, { generation: state.generation, profile: state.activeProfile, slices: desiredSlices(node) });
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
    tenants: Object.values(state.tenants).map((t) => ({ id: t.id, name: t.name, type: t.type, status: t.status ?? 'active', keys: keysOf(t.id).length, balanceUsd: t.balanceUsd, spentUsd: t.spentUsd ?? 0, tpmLimit: t.tpmLimit, tpmUsed: usedInWindow(t.id).tokens, models: t.models })),
    today: { requests: ledger.length, ok: ok.length, promptTokens: ok.reduce((a, e) => a + e.promptTokens, 0), completionTokens: ok.reduce((a, e) => a + e.completionTokens, 0), revenueUsd: ledger.reduce((a, e) => a + e.costUsd, 0), byTenant },
  });
}
async function switchProfile(req, res) {
  const body = await readBody(req);
  if (!cfg.profiles[body.profile]) return fail(res, 400, 'VALIDATION', `Unknown profile. Available: ${Object.keys(cfg.profiles).join(', ')}`);
  state.activeProfile = body.profile;
  state.generation += 1;
  event('mode-changed', { mode: body.profile });
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
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/portal')) return portalPage(res);
    if (req.method === 'GET' && url.pathname === '/topology') return staticPage(res, 'topology.html');
    if (req.method === 'GET' && url.pathname === '/portal/v1/sites') return portalSites(req, res);
    if (req.method === 'GET' && url.pathname === '/portal/v1/deployments') return listDeployments(req, res);
    if (req.method === 'POST' && url.pathname === '/portal/v1/deployments') return await createDeployment(req, res);
    if (req.method === 'POST' && url.pathname === '/portal/v1/deployments/remove') return await removeDeployment(req, res);
    if (req.method === 'POST' && url.pathname === '/portal/v1/activate') return await activate(req, res);
    if (req.method === 'GET' && url.pathname === '/portal/v1/me') return me(req, res);
    if (req.method === 'POST' && url.pathname === '/portal/v1/keys') return await createKey(req, res);
    if (req.method === 'POST' && url.pathname === '/portal/v1/keys/revoke') return await revokeKey(req, res);
    if (req.method === 'POST' && url.pathname === '/agent/v1/enroll') return await enroll(req, res);
    if (req.method === 'POST' && url.pathname === '/agent/v1/heartbeat') return await heartbeat(req, res);
    if (url.pathname.startsWith('/admin/')) {
      if (!isAdmin(req)) return fail(res, 401, 'INVALID_ADMIN_KEY', 'Admin key required.');
      if (req.method === 'GET' && url.pathname === '/admin/v1/overview') return overview(res);
      if (req.method === 'POST' && url.pathname === '/admin/v1/profile') return await switchProfile(req, res);
      if (req.method === 'POST' && url.pathname === '/admin/v1/tenants') return await createTenant(req, res);
      if (req.method === 'POST' && url.pathname === '/admin/v1/sites') return await upsertSite(req, res);
      if (req.method === 'GET' && url.pathname === '/admin/v1/topology') return topology(res);
      if (req.method === 'POST' && url.pathname === '/admin/v1/slices/clear') return clearSlices(res);
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
