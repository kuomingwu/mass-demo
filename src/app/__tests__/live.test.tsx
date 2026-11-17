// @vitest-environment jsdom
// The two pages that talk to the real validation gateway, exercised against an in-memory stand-in for it:
// admin "Live topology" tab (sample vs live, add site, open account) and customer "Self-hosted GPU" page
// (activate -> key -> enable a model -> the slice shows up for the operator).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { SessionProvider } from '../SessionContext';
import { NotifyProvider } from '../../components/Notify';
import { AppRoutes } from '../routes';
import { setPortal, type Portal } from '../portal';
import { server } from '../../server/api';
import { setLocale } from '../../i18n/core';
import type { Locale } from '../../i18n/types';

const ADMIN_KEY = 'maas_admin_test';
const GATEWAY = 'http://127.0.0.1:8787';

/** Minimal in-memory gateway: same routes, status codes and payload shapes as poc/gateway.mjs. */
function makeGateway() {
  const g = {
    calls: [] as { method: string; path: string; auth: string | null; body: unknown }[],
    sites: [{ id: 'tw-taipei-1', name: 'Taipei DC 1', region: 'tw-north', location: 'Neihu' }],
    tenants: [] as { id: string; name: string; status: string; key: string | null; code: string }[],
    slices: [] as { id: string; model: string; tenants: string[] }[],
    events: [] as { ts: string; type: string; [k: string]: unknown }[],
  };
  const reply = (status: number, json: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => json, headers: { get: () => null } });
  const fail = (status: number, code: string) => reply(status, { error: { code, message: code } });
  const node = () => ({
    id: 'node-1',
    name: 'gpu-node-01',
    online: true,
    lastHeartbeat: '2026-11-17T00:00:00.000Z',
    gpu: { name: 'Test GPU', totalMiB: 12000, usedMiB: 2000, reserveMiB: 1500, sliceBudgetMiB: 10500, utilizationPct: 0, temperatureC: 40 },
    strategy: 'vram-budget',
    runtime: 'ollama 0.0',
    slices: g.slices.map((s) => ({ id: s.id, model: s.model, state: 'ready', detail: null, budgetMiB: 1024, measuredMiB: 500, sharing: 'shared', inflight: 0, tenants: s.tenants.map((t) => ({ id: t, name: g.tenants.find((x) => x.id === t)?.name ?? t })) })),
    freeMiB: 10500 - g.slices.length * 1024,
  });
  const handler = async (input: unknown, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const url = String(input);
    const path = url.replace(GATEWAY, '');
    const auth = init?.headers?.authorization?.replace('Bearer ', '') ?? null;
    const body = init?.body ? JSON.parse(init.body) : undefined;
    g.calls.push({ method: init?.method ?? 'GET', path, auth, body });
    if (!url.startsWith(GATEWAY)) throw new TypeError('Failed to fetch');
    if (path.startsWith('/admin/')) {
      if (auth !== ADMIN_KEY) return fail(401, 'INVALID_ADMIN_KEY');
      if (path === '/admin/v1/topology')
        return reply(200, {
          now: '2026-11-17T00:00:00.000Z',
          mode: 'on-demand',
          generation: 3,
          catalog: [{ id: 'gemma-3-270m', sliceMiB: 1024 }],
          sites: g.sites.map((s, i) => ({ ...s, enrollmentTokenPending: i > 0, nodes: i === 0 ? [node()] : [] })),
          unassigned: [],
          tenants: g.tenants.map((t) => ({ id: t.id, name: t.name, status: t.status, balanceUsd: 1, spentUsd: 0, deployments: g.slices.filter((s) => s.tenants.includes(t.id)).length })),
          events: g.events,
        });
      if (path === '/admin/v1/sites') {
        g.sites.push({ id: 'site-2', name: body.name, region: body.region, location: body.location });
        return reply(201, { siteId: 'site-2', enrollmentToken: 'maas_boot_test' });
      }
      if (path === '/admin/v1/tenants') {
        const t = { id: `t-${g.tenants.length + 1}`, name: body.name, status: 'pending', key: null, code: `act_test${g.tenants.length + 1}` };
        g.tenants.push(t);
        return reply(201, { tenantId: t.id, activationCode: t.code });
      }
    }
    if (path === '/portal/v1/activate') {
      const t = g.tenants.find((x) => x.code === body.activationCode);
      if (!t) return fail(401, 'INVALID_ACTIVATION_CODE');
      if (t.status === 'active') return fail(409, 'ACTIVATION_CODE_USED');
      t.status = 'active';
      t.key = `sk-maas_${t.id}`;
      return reply(201, { tenantId: t.id, name: t.name, apiKey: t.key });
    }
    const tenant = g.tenants.find((x) => x.key && x.key === auth);
    if (!tenant) return fail(401, 'INVALID_API_KEY');
    const mine = g.slices.filter((s) => s.tenants.includes(tenant.id));
    if (path === '/portal/v1/me') return reply(200, { tenantId: tenant.id, name: tenant.name, balanceUsd: 1, spentUsd: 0, limits: { tpm: 20000, rpm: 60, tpmUsed: 0 }, keys: [], today: { requests: 0, ok: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 } });
    if (path === '/portal/v1/sites') return reply(200, { mode: 'on-demand', data: g.sites.map((s, i) => ({ ...s, onlineNodes: i === 0 ? 1 : 0, freeMiB: 9000, largestFreeMiB: 9000 })) });
    if (path === '/v1/models') return reply(200, { data: [{ id: 'gemma-3-270m', status: mine.length ? 'ready' : 'not-loaded' }] });
    const view = (s: { id: string; model: string; tenants: string[] }) => ({ sliceId: s.id, model: s.model, siteId: 'tw-taipei-1', siteName: 'Taipei DC 1', nodeId: 'node-1', vramMiB: 1024, measuredMiB: 500, state: 'ready', detail: null, sharedWith: s.tenants.length - 1 });
    if (path === '/portal/v1/deployments' && !body) return reply(200, { data: mine.map(view) });
    if (path === '/portal/v1/deployments') {
      const existing = g.slices.find((s) => s.model === body.model);
      if (existing) {
        if (!existing.tenants.includes(tenant.id)) existing.tenants.push(tenant.id);
        return reply(200, { ...view(existing), carved: false });
      }
      const s = { id: `sl-${g.slices.length + 1}`, model: body.model, tenants: [tenant.id] };
      g.slices.push(s);
      return reply(201, { ...view(s), carved: true });
    }
    if (path === '/portal/v1/deployments/remove') {
      const s = g.slices.find((x) => x.id === body.sliceId);
      if (!s) return fail(404, 'NOT_FOUND');
      s.tenants = s.tenants.filter((t) => t !== tenant.id);
      if (!s.tenants.length) g.slices = g.slices.filter((x) => x !== s);
      return reply(200, { sliceId: body.sliceId, released: !s.tenants.length });
    }
    return fail(404, 'NOT_FOUND');
  };
  return { g, handler };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let gw: ReturnType<typeof makeGateway>;

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  server.options.latency = [0, 0];
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
  window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, media: '', dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  Object.defineProperty(window, 'innerWidth', { value: 1400, writable: true });
});
beforeEach(() => {
  gw = makeGateway();
  vi.stubGlobal('fetch', vi.fn(gw.handler));
  localStorage.setItem('maas-demo-tour-v1', 'done');
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
  setPortal('all');
  setLocale('zh-TW');
  localStorage.clear();
  sessionStorage.clear();
});

const settle = (ms = 60) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
async function mount(portal: Portal, path: string, persona: string, locale: Locale = 'zh-TW') {
  setPortal(portal);
  setLocale(locale);
  localStorage.setItem('maas-demo-persona', persona);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(React.createElement(ThemeProvider, null, React.createElement(SessionProvider, null, React.createElement(NotifyProvider, null, React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(AppRoutes))))));
  });
  await settle();
}
const main = () => container!.querySelector('main')!;
const text = () => main().textContent ?? '';
function button(label: string, within: Element = main()) {
  const b = Array.from(within.querySelectorAll('button')).find((x) => x.textContent?.trim() === label);
  if (!b) throw new Error(`button "${label}" not found`);
  return b as HTMLButtonElement;
}
async function click(label: string, within?: Element) {
  const b = button(label, within);
  expect(b.disabled, `"${label}" should be enabled`).toBe(false);
  await act(async () => b.click());
  await settle();
}
async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const section = (tour: string) => main().querySelector(`[data-tour="${tour}"]`)!;

describe('管理後台：即時拓樸', () => {
  it('未連線：顯示標明為範例的實測拓樸，不發出任何請求，操作按鈕停用', async () => {
    await mount('admin', '/local-gpu?tab=topology', 'owner');
    expect(text()).toContain('範例資料');
    expect(text()).toContain('Taipei Neihu DC 1');
    expect(text()).toContain('sl-5c121f');
    expect(gw.g.calls).toHaveLength(0);
    expect(button('加入機房', section('localgpu-topo-site')).disabled).toBe(true);
    expect(button('開帳號', section('localgpu-topo-account')).disabled).toBe(true);
  });

  it('連結帶管理金鑰：直接連線、換成即時資料，金鑰只存在這個分頁的 sessionStorage', async () => {
    await mount('admin', `/local-gpu?tab=topology&key=${ADMIN_KEY}`, 'owner');
    expect(text()).toContain('即時資料');
    expect(text()).toContain('Taipei DC 1');
    expect(text()).not.toContain('sl-5c121f');
    expect(gw.g.calls[0]).toMatchObject({ path: '/admin/v1/topology', auth: ADMIN_KEY });
    expect(JSON.parse(sessionStorage.getItem('maas-demo-poc-admin')!)).toMatchObject({ key: ADMIN_KEY });
    expect(localStorage.getItem('maas-demo-poc-admin')).toBeNull();
  });

  it('管理金鑰錯誤：顯示錯誤、維持範例資料', async () => {
    await mount('admin', '/local-gpu?tab=topology&key=wrong', 'owner');
    expect(text()).toContain('管理金鑰不正確');
    expect(text()).toContain('範例資料');
    expect(sessionStorage.getItem('maas-demo-poc-admin')).toBeNull();
  });

  it('連不上閘道：說明原因、維持範例資料', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await mount('admin', `/local-gpu?tab=topology&key=${ADMIN_KEY}`, 'owner');
    expect(text()).toContain('連不上閘道');
    expect(text()).toContain('範例資料');
  });

  it('加入機房得到一次性註冊權杖與啟動指令；開客戶帳號得到一次性啟用碼；拓樸跟著更新', async () => {
    await mount('admin', `/local-gpu?tab=topology&key=${ADMIN_KEY}`, 'owner');
    const site = section('localgpu-topo-site');
    await type(site.querySelectorAll('input')[0], 'Kaohsiung DC 2');
    await click('加入機房', site);
    expect(site.textContent).toContain("MAAS_BOOTSTRAP_TOKEN='maas_boot_test' node agent.mjs");
    expect(text()).toContain('Kaohsiung DC 2');
    expect(text()).toContain('這個機房還沒有機器加入');

    const account = section('localgpu-topo-account');
    await type(account.querySelectorAll('input')[0], 'Acme');
    await click('開帳號', account);
    expect(account.textContent).toContain('act_test1');
    expect(gw.g.calls.find((c) => c.path === '/admin/v1/tenants')).toMatchObject({ auth: ADMIN_KEY, body: { name: 'Acme', creditUsd: 1, models: ['gemma-3-270m'] } });
    expect(text()).toContain('待啟用');
  });

  it('客戶角色沒有 cluster.read：看不到拓樸，也不發請求', async () => {
    await mount('all', `/local-gpu?tab=topology&key=${ADMIN_KEY}`, 'tenant-admin');
    expect(text()).not.toContain('即時資料');
    expect(text()).not.toContain('範例資料');
    expect(gw.g.calls).toHaveLength(0);
  });
});

describe('客戶入口：自有 GPU 實機', () => {
  it('連結帶啟用碼 → 啟用 → 金鑰只顯示一次 → 選機房與模型 → 切片就緒', async () => {
    gw.g.tenants.push({ id: 't-1', name: 'Acme', status: 'pending', key: null, code: 'act_test1' });
    await mount('customer', '/live-gpu?code=act_test1', 'tenant-admin');
    expect(gw.g.calls).toHaveLength(0);
    await click('啟用', section('livegpu-activate'));
    expect(text()).toContain('已啟用：Acme（t-1）');
    expect(section('livegpu-key').textContent).toContain('sk-maas_t-1');
    expect(text()).toContain('還沒有就緒的模型');

    await click('啟用', section('livegpu-deploy'));
    expect(gw.g.calls.find((c) => c.path === '/portal/v1/deployments' && c.body)).toMatchObject({ auth: 'sk-maas_t-1', body: { model: 'gemma-3-270m', siteId: 'tw-taipei-1' } });
    expect(section('livegpu-deploy').textContent).toContain('已在 Taipei DC 1 切出 1,024 MiB');
    expect(section('livegpu-deploy').textContent).toContain('sl-1');
    expect(section('livegpu-deploy').textContent).toContain('就緒');
    expect(text()).not.toContain('還沒有就緒的模型');
    expect(gw.g.slices).toEqual([{ id: 'sl-1', model: 'gemma-3-270m', tenants: ['t-1'] }]);

    await click('停用', section('livegpu-deploy'));
    expect(gw.g.slices).toHaveLength(0);
  });

  it('啟用碼錯誤或已使用：顯示伺服器的錯誤代碼，不會登入', async () => {
    gw.g.tenants.push({ id: 't-1', name: 'Acme', status: 'active', key: 'sk-maas_t-1', code: 'act_used' });
    await mount('customer', '/live-gpu?code=act_wrong', 'tenant-admin');
    await click('啟用', section('livegpu-activate'));
    expect(text()).toContain('401 INVALID_ACTIVATION_CODE');
    const input = section('livegpu-activate').querySelectorAll('input')[1];
    await type(input, 'act_used');
    await click('啟用', section('livegpu-activate'));
    expect(text()).toContain('409 ACTIVATION_CODE_USED');
    expect(sessionStorage.getItem('maas-demo-poc-customer')).toBeNull();
  });

  it('第二個客戶啟用同一個模型：共用現有切片', async () => {
    gw.g.tenants.push({ id: 't-1', name: 'Acme', status: 'active', key: 'sk-maas_t-1', code: 'x' }, { id: 't-2', name: 'Beta', status: 'pending', key: null, code: 'act_test2' });
    gw.g.slices.push({ id: 'sl-1', model: 'gemma-3-270m', tenants: ['t-1'] });
    await mount('customer', '/live-gpu?code=act_test2', 'tenant-admin');
    await click('啟用', section('livegpu-activate'));
    await click('啟用', section('livegpu-deploy'));
    expect(section('livegpu-deploy').textContent).toContain('直接共用');
    expect(section('livegpu-deploy').textContent).toContain('與另外 1 個客戶共用');
    expect(gw.g.slices).toHaveLength(1);
  });

  it('兩個入口各有各的頁面：客戶入口沒有拓樸，管理後台沒有客戶啟用頁', async () => {
    await mount('customer', `/local-gpu?tab=topology&key=${ADMIN_KEY}`, 'tenant-admin');
    expect(text()).not.toContain('即時資料');
    expect(gw.g.calls).toHaveLength(0);
    act(() => root!.unmount());
    container!.remove();
    await mount('admin', '/live-gpu?code=act_test1', 'owner');
    expect(main().querySelector('[data-tour="livegpu-activate"]')).toBeNull();
  });

  it('英文介面：兩頁都沒有中文', async () => {
    await mount('admin', `/local-gpu?tab=topology&key=${ADMIN_KEY}`, 'owner', 'en');
    expect(text()).toContain('Live data');
    expect(text()).not.toMatch(/[一-鿿]/);
    act(() => root!.unmount());
    container!.remove();
    await mount('customer', '/live-gpu', 'tenant-admin', 'en');
    expect(text()).toContain('Activate your account');
    expect(text()).not.toMatch(/[一-鿿]/);
  });
});
