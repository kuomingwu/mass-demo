/**
 * Client for the local-GPU validation gateway (poc/gateway.mjs).
 *
 * The rest of the demo runs on an in-browser mock server. These calls are the exception: they go over HTTP to a real
 * control plane on the same machine, which drives a real GPU. Nothing is fetched until the user connects.
 * When the gateway is not reachable (the hosted demo cannot reach a local address) the pages fall back to SAMPLE_TOPOLOGY,
 * a snapshot of a real run, and label it as a sample.
 */
import { POC_GATEWAY_DEFAULT } from './localGpu';

export type SliceState = 'ready' | 'pending' | 'loading' | 'verifying' | 'rejected-no-capacity' | 'over-budget' | 'cpu-offload' | 'model-missing' | 'failed' | 'not-loaded';

export interface LiveSlice {
  id: string;
  model: string;
  state: SliceState;
  detail: string | null;
  budgetMiB: number;
  measuredMiB: number | null;
  sharing: string;
  inflight: number;
  tenants: { id: string; name: string }[];
}
export interface LiveNode {
  id: string;
  name: string;
  online: boolean;
  lastHeartbeat: string | null;
  gpu: { name: string; totalMiB: number; usedMiB: number; reserveMiB: number; sliceBudgetMiB: number; utilizationPct: number | null; temperatureC: number | null } | null;
  strategy: string | null;
  runtime: string | null;
  slices: LiveSlice[];
  freeMiB: number;
}
export interface LiveSite {
  id: string;
  name: string;
  region: string;
  location: string;
  enrollmentTokenPending: boolean;
  nodes: LiveNode[];
}
export interface LiveEvent {
  ts: string;
  type: string;
  name?: string;
  siteId?: string | null;
  tenant?: string;
  model?: string;
  sliceId?: string;
  vramMiB?: number;
  mode?: string;
  count?: number;
}
export interface LiveTopology {
  now: string;
  mode: string;
  generation: number;
  catalog: { id: string; sliceMiB: number | null }[];
  sites: LiveSite[];
  unassigned: LiveNode[];
  tenants: { id: string; name: string; status: string; balanceUsd: number; spentUsd: number; deployments: number }[];
  events: LiveEvent[];
}

export interface PortalSite {
  id: string;
  name: string;
  region: string;
  location: string;
  onlineNodes: number;
  freeMiB: number;
  largestFreeMiB: number;
}
export interface Deployment {
  sliceId: string;
  model: string;
  siteId: string;
  siteName: string | null;
  nodeId: string;
  vramMiB: number;
  measuredMiB: number | null;
  state: SliceState;
  detail: string | null;
  sharedWith: number;
  carved?: boolean;
}
export interface PortalAccount {
  tenantId: string;
  name: string;
  balanceUsd: number;
  spentUsd: number;
  limits: { tpm: number; rpm: number; tpmUsed: number };
  keys: { keyId: string; prefix: string }[];
  today: { requests: number; ok: number; promptTokens: number; completionTokens: number; costUsd: number };
}
export interface CatalogModel {
  id: string;
  status: 'ready' | 'not-loaded';
}

export type Role = 'admin' | 'customer';
export interface Conn {
  url: string;
  key: string;
}

const storeKey = (role: Role) => `maas-demo-poc-${role}`;

/** Connection details live in sessionStorage only: they survive a reload of this tab and nothing else. */
export function loadConn(role: Role): Conn {
  try {
    const raw = sessionStorage.getItem(storeKey(role));
    if (raw) {
      const j = JSON.parse(raw) as Partial<Conn>;
      return { url: j.url || POC_GATEWAY_DEFAULT, key: j.key || '' };
    }
  } catch {
    /* storage unavailable */
  }
  return { url: POC_GATEWAY_DEFAULT, key: '' };
}
export function saveConn(role: Role, conn: Conn | null) {
  try {
    if (conn) sessionStorage.setItem(storeKey(role), JSON.stringify(conn));
    else sessionStorage.removeItem(storeKey(role));
  } catch {
    /* storage unavailable */
  }
}

export class PocError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const base = (url: string) => url.replace(/\/+$/, '');

/** One JSON call to the gateway. Throws PocError for an HTTP error and for an unreachable gateway (status 0). */
export async function pocCall<T>(conn: Conn, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(base(conn.url) + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(conn.key ? { authorization: `Bearer ${conn.key}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new PocError(0, 'UNREACHABLE', e instanceof Error ? e.message : String(e));
  }
  const json = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) throw new PocError(res.status, json?.error?.code ?? 'HTTP_ERROR', json?.error?.message ?? `HTTP ${res.status}`);
  return json as T;
}

export interface ChatResult {
  text: string;
  nodeId: string | null;
  sliceId: string | null;
  retention: string | null;
  requestId: string | null;
  ttftMs: number | null;
  totalMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
}

/** Streaming chat completion through the OpenAI-compatible endpoint. onDelta receives each text fragment as it arrives. */
export async function pocChat(conn: Conn, model: string, prompt: string, onDelta: (text: string) => void): Promise<ChatResult> {
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(base(conn.url) + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${conn.key}` },
      body: JSON.stringify({ model, stream: true, stream_options: { include_usage: true }, max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
    });
  } catch (e) {
    throw new PocError(0, 'UNREACHABLE', e instanceof Error ? e.message : String(e));
  }
  if (!res.ok || !res.body) {
    const json = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    throw new PocError(res.status, json?.error?.code ?? 'HTTP_ERROR', json?.error?.message ?? `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  let ttftMs: number | null = null;
  let usage: { prompt_tokens: number; completion_tokens: number } | null = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 2);
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      const j = JSON.parse(line.slice(6)) as { choices?: { delta?: { content?: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number } };
      const delta = j.choices?.[0]?.delta?.content;
      if (delta) {
        if (ttftMs === null) ttftMs = performance.now() - t0;
        text += delta;
        onDelta(delta);
      }
      if (j.usage) usage = j.usage;
    }
  }
  return {
    text,
    nodeId: res.headers.get('x-maas-node'),
    sliceId: res.headers.get('x-maas-slice'),
    retention: res.headers.get('x-maas-retention'),
    requestId: res.headers.get('x-maas-request-id'),
    ttftMs,
    totalMs: performance.now() - t0,
    promptTokens: usage?.prompt_tokens ?? null,
    completionTokens: usage?.completion_tokens ?? null,
  };
}

/** Snapshot of a real run on the validation machine (2026-11-17). Shown, labelled as a sample, while not connected. */
export const SAMPLE_TOPOLOGY: LiveTopology = {
  now: '2026-11-17T15:14:09.000Z',
  mode: 'on-demand',
  generation: 15,
  catalog: [
    { id: 'gemma-3-270m', sliceMiB: 1024 },
    { id: 'llama-3.2-3b', sliceMiB: 3584 },
    { id: 'gemma-3-4b', sliceMiB: 3840 },
    { id: 'gemma-3-taide-12b', sliceMiB: 10496 },
  ],
  sites: [
    {
      id: 'tw-taipei-1',
      name: 'Taipei Neihu DC 1',
      region: 'tw-north',
      location: 'Neihu, Taipei',
      enrollmentTokenPending: false,
      nodes: [
        {
          id: 'node-d6945e6d',
          name: 'gpu-node-01',
          online: true,
          lastHeartbeat: '2026-11-17T15:14:08.000Z',
          gpu: { name: 'NVIDIA GeForce RTX 4080 Laptop GPU', totalMiB: 12282, usedMiB: 4449, reserveMiB: 1536, sliceBudgetMiB: 10746, utilizationPct: 0, temperatureC: 47 },
          strategy: 'vram-budget',
          runtime: 'ollama 0.40.16',
          slices: [
            { id: 'sl-5c121f', model: 'gemma-3-270m', state: 'ready', detail: null, budgetMiB: 1024, measuredMiB: 505, sharing: 'shared', inflight: 0, tenants: [{ id: 't-acme', name: 'Acme Demo' }] },
            { id: 'sl-8f2f15', model: 'llama-3.2-3b', state: 'ready', detail: null, budgetMiB: 3584, measuredMiB: 2640, sharing: 'shared', inflight: 0, tenants: [{ id: 't-browser', name: 'Browser Demo' }] },
          ],
          freeMiB: 6138,
        },
      ],
    },
    { id: 'tw-kaohsiung-2', name: 'Kaohsiung DC 2', region: 'tw-south', location: 'Qianzhen, Kaohsiung', enrollmentTokenPending: true, nodes: [] },
  ],
  unassigned: [],
  tenants: [
    { id: 't-browser', name: 'Browser Demo', status: 'active', balanceUsd: 0.999997, spentUsd: 0.000003, deployments: 1 },
    { id: 't-acme', name: 'Acme Demo', status: 'active', balanceUsd: 0.999999, spentUsd: 0.000001, deployments: 1 },
    { id: 't-beta', name: 'Beta Corp', status: 'active', balanceUsd: 1, spentUsd: 0, deployments: 0 },
  ],
  events: [
    { ts: '2026-11-17T15:13:59.000Z', type: 'slice-carved', tenant: 'Browser Demo', siteId: 'tw-taipei-1', model: 'llama-3.2-3b', vramMiB: 3584, sliceId: 'sl-8f2f15' },
    { ts: '2026-11-17T15:13:57.000Z', type: 'tenant-activated', tenant: 'Browser Demo' },
    { ts: '2026-11-17T15:13:55.000Z', type: 'site-added', name: 'Kaohsiung DC 2', siteId: 'tw-kaohsiung-2' },
    { ts: '2026-11-17T15:13:49.000Z', type: 'slice-left', tenant: 'Beta Corp', model: 'gemma-3-270m', sliceId: 'sl-5c121f' },
    { ts: '2026-11-17T15:13:43.000Z', type: 'slice-released', model: 'llama-3.2-3b', sliceId: 'sl-f9992d', vramMiB: 3584 },
    { ts: '2026-11-17T15:13:37.000Z', type: 'slice-shared', tenant: 'Beta Corp', siteId: 'tw-taipei-1', model: 'gemma-3-270m', sliceId: 'sl-5c121f' },
    { ts: '2026-11-17T15:13:28.000Z', type: 'slice-carved', tenant: 'Acme Demo', siteId: 'tw-taipei-1', model: 'gemma-3-270m', vramMiB: 1024, sliceId: 'sl-5c121f' },
    { ts: '2026-11-17T15:13:21.000Z', type: 'node-enrolled', name: 'gpu-node-01', siteId: 'tw-taipei-1' },
  ],
};
