// @vitest-environment jsdom
// 兩個入口（客戶入口／管理後台）由同一份程式碼建置：路由、導覽、示範角色與操作指引各自獨立。
// 入口只是封裝邊界；伺服器端授權由 src/auth 與 src/server 的測試涵蓋。
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { SessionProvider } from '../SessionContext';
import { NotifyProvider } from '../../components/Notify';
import { AppRoutes } from '../routes';
import { NAV_GROUPS, navGroupsFor } from '../AppShell';
import { getPortal, portalHasRoute, setPortal, type Portal } from '../portal';
import { defaultPersona, isVendorPersona, personaAllowed, personasForPortal } from '../portalPersonas';
import { GUIDES, getGuide, visibleGuides } from '../../data/guides';
import { PERSONAS } from '../../server/seed';
import { server } from '../../server/api';
import { setLocale, translate } from '../../i18n/core';
import type { Locale } from '../../i18n/types';
import { enLeaks, jaLeaks } from '../../i18n/__tests__/leakUtil';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

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

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  setPortal('all');
  setLocale('zh-TW');
  localStorage.clear();
});

async function mount(portal: Portal, path: string, storedPersona?: string, locale: Locale = 'zh-TW') {
  setPortal(portal);
  setLocale(locale);
  if (storedPersona) localStorage.setItem('maas-demo-persona', storedPersona);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(React.createElement(ThemeProvider, null, React.createElement(SessionProvider, null, React.createElement(NotifyProvider, null, React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(AppRoutes))))));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
  const nav = container.querySelector('nav[data-tour="nav"]')!;
  return {
    text: container.textContent ?? '',
    navText: nav.textContent ?? '',
    navLinks: Array.from(nav.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? ''),
    main: container.querySelector('main')?.textContent ?? '',
  };
}

describe('入口設定', () => {
  it('測試與開發預設為合併主控台；路由歸屬依入口判斷', () => {
    expect(getPortal()).toBe('all');
    for (const r of ['/hub', '/hub/trial', '/hub?tab=faq', '#/plan']) {
      expect(portalHasRoute(r, 'customer'), r).toBe(true);
      expect(portalHasRoute(r, 'admin'), r).toBe(false);
    }
    for (const r of ['/trials', '/tenants/t-star', '/models', '/deployments', '/clusters/cl-tpe-a', '/local-gpu?tab=poc', '/providers', '/routing', '/pricing?tab=unit']) {
      expect(portalHasRoute(r, 'admin'), r).toBe(true);
      expect(portalHasRoute(r, 'customer'), r).toBe(false);
    }
    for (const r of ['/', '/playground', '/keys', '/usage', '/iam', '/audit', '/settings', '/guides', '/forbidden']) {
      expect(portalHasRoute(r, 'admin') && portalHasRoute(r, 'customer') && portalHasRoute(r, 'all'), r).toBe(true);
    }
  });

  it('示範角色：管理後台只有我們的角色，客戶入口只有客戶角色，兩邊不重疊且合起來是全部', () => {
    const admin = personasForPortal('admin').map((p) => p.id);
    const customer = personasForPortal('customer').map((p) => p.id);
    expect(admin).toEqual(['owner', 'cluster-operator', 'finance']);
    expect(admin.every(isVendorPersona)).toBe(true);
    expect(customer.some(isVendorPersona)).toBe(false);
    expect([...admin, ...customer].sort()).toEqual(PERSONAS.map((p) => p.id).sort());
    expect(personaAllowed('owner', 'customer')).toBe(false);
    expect(personaAllowed('tenant-admin', 'admin')).toBe(false);
    expect(personaAllowed('nope', 'all')).toBe(false);
    expect(defaultPersona('customer')).toBe('tenant-admin');
    expect(defaultPersona('admin')).toBe('owner');
    expect(personasForPortal('all')).toHaveLength(PERSONAS.length);
  });

  it('導覽群組：客戶入口沒有平台營運；管理後台沒有模型中心與試用與方案', () => {
    const paths = (p: Portal, vendor: boolean) => navGroupsFor(p, vendor).flatMap((g) => g.items.map((i) => i.to));
    expect(navGroupsFor('customer', false).map((g) => g.id)).toEqual(['customer', 'account', 'help']);
    expect(paths('customer', false).every((to) => portalHasRoute(to, 'customer'))).toBe(true);
    expect(navGroupsFor('admin', true).map((g) => g.id)).toEqual(['vendor', 'customer', 'help']);
    expect(navGroupsFor('admin', true)[1].titleKey).toBe('nav.group.tenantTools');
    expect(paths('admin', true).every((to) => portalHasRoute(to, 'admin'))).toBe(true);
    expect(paths('admin', true)).not.toContain('/hub');
    expect(paths('admin', true)).not.toContain('/plan');
    expect(paths('admin', true)).toEqual(expect.arrayContaining(['/playground', '/keys', '/usage', '/local-gpu']));
    // 合併主控台與拆分前相同
    expect(navGroupsFor('all', true)).toEqual(NAV_GROUPS.filter((g) => !g.customerOnly));
    expect(navGroupsFor('all', false)).toEqual(NAV_GROUPS.filter((g) => !g.vendorOnly));
  });
});

describe('操作指引依入口提供', () => {
  it('合併主控台維持 13 則且不含入口專屬步驟', () => {
    const all = visibleGuides('all');
    expect(all.map((g) => g.id)).toEqual(GUIDES.map((g) => g.id));
    expect(all).toHaveLength(13);
    for (const g of all) for (const st of g.steps) expect(!st.portals || st.portals.includes('all'), `${g.id}/${st.id}`).toBe(true);
    expect(getGuide('welcome-customer', 'all')).toBeUndefined();
  });

  for (const portal of ['customer', 'admin'] as const) {
    it(`${portal}：每則指引的頁面、步驟路由與建議角色都屬於這個入口，並有開場與結尾`, () => {
      const list = visibleGuides(portal);
      expect(list.length).toBeGreaterThanOrEqual(6);
      expect(list[0].id).toBe(portal === 'customer' ? 'welcome-customer' : 'welcome');
      for (const g of list) {
        expect(g.journey).toBe(portal === 'customer' ? 'customer' : 'vendor');
        expect(g.recommendedPersona && personaAllowed(g.recommendedPersona, portal), `${g.id} persona ${g.recommendedPersona}`).toBe(true);
        expect(g.pages.length, `${g.id} pages`).toBeGreaterThanOrEqual(1);
        for (const p of g.pages) expect(portalHasRoute(p.route, portal), `${g.id} page ${p.route}`).toBe(true);
        for (const st of g.steps) if (st.route) expect(portalHasRoute(st.route, portal), `${g.id}/${st.id} ${st.route}`).toBe(true);
        expect(g.steps.length, g.id).toBeGreaterThanOrEqual(4);
        expect(g.steps[0].target, `${g.id} 開場應為置中對話框`).toBeUndefined();
        expect(g.steps[g.steps.length - 1].target, `${g.id} 結尾應為置中對話框`).toBeUndefined();
        // 每個步驟在三種語系都有文案
        for (const st of g.steps) {
          for (const l of ['zh-TW', 'en', 'ja'] as const) {
            for (const field of ['title', 'body'] as const) {
              const key = `guides.${g.id}.step.${st.id}.${field}`;
              expect(translate(l, key), key).not.toBe(key);
            }
          }
        }
      }
    });
  }

  it('兩個入口的指引合起來涵蓋全部 13 則；試用申請兩邊各走一半', () => {
    const c = visibleGuides('customer').map((g) => g.id);
    const a = visibleGuides('admin').map((g) => g.id);
    for (const g of GUIDES) expect(c.includes(g.id) || a.includes(g.id), g.id).toBe(true);
    expect(c).toEqual(expect.arrayContaining(['hub-first-call', 'create-key-playground', 'denied-request-access', 'assign-role-approval', 'trial-request']));
    expect(a).toEqual(expect.arrayContaining(['connect-own-gpu', 'register-cluster', 'deploy-model', 'onboard-tenant', 'connect-provider-bailian', 'routing-spillover', 'billing', 'trial-request']));
    expect(c).not.toContain('register-cluster');
    expect(a).not.toContain('hub-first-call');
    const ids = (p: Portal) => getGuide('trial-request', p)!.steps.map((s) => s.id);
    expect(ids('customer')).toEqual(['intro', 'hub-trial', 'form', 'done-dialog-customer', 'done-customer']);
    expect(ids('admin')).toEqual(['intro-admin', 'queue-admin', 'review', 'approved', 'tenant', 'done-admin']);
    expect(ids('all')).toEqual(['intro', 'hub-trial', 'form', 'done-dialog', 'queue', 'review', 'approved', 'tenant', 'done']);
    expect(getGuide('welcome', 'admin')!.steps.map((s) => s.id)).not.toContain('nav-hub');
  });
});

describe('客戶入口', () => {
  it('首頁是模型中心；導覽沒有任何平台營運項目', async () => {
    const r = await mount('customer', '/');
    expect(r.navText).toContain('客戶入口');
    expect(r.navText).toContain('帳戶與團隊');
    expect(r.navText).not.toContain('平台營運');
    expect(r.navLinks).toEqual(expect.arrayContaining(['/hub', '/playground', '/keys', '/usage', '/plan', '/iam', '/audit', '/settings', '/guides']));
    for (const to of ['/clusters', '/local-gpu', '/tenants', '/pricing', '/trials', '/models', '/providers', '/routing']) expect(r.navLinks, to).not.toContain(to);
    expect(r.text).toContain('MaaS 控制台');
    expect(r.text).not.toContain('MaaS 管理後台');
    expect(r.main).toContain('模型');
  });

  it('平台營運的網址在客戶入口不存在（404），即使瀏覽器存著我們的角色也會退回客戶角色', async () => {
    for (const path of ['/clusters', '/local-gpu', '/pricing', '/tenants/t-star', '/trials', '/models']) {
      const r = await mount('customer', path, 'owner');
      expect(r.main, path).toContain('404');
      expect(r.navText, path).not.toContain('平台營運');
      act(() => root!.unmount());
      container!.remove();
      root = null;
      container = null;
    }
  });
});

describe('管理後台', () => {
  it('首頁是營運總覽；導覽有平台營運與租戶支援工具，沒有模型中心與試用與方案', async () => {
    const r = await mount('admin', '/');
    expect(r.navText).toContain('平台營運');
    expect(r.navText).toContain('租戶支援工具');
    expect(r.navText).not.toContain('帳戶與團隊');
    expect(r.navLinks).toEqual(expect.arrayContaining(['/', '/trials', '/tenants', '/models', '/clusters', '/local-gpu', '/providers', '/routing', '/pricing', '/iam', '/audit', '/playground', '/keys', '/usage', '/guides']));
    expect(r.navLinks).not.toContain('/hub');
    expect(r.navLinks).not.toContain('/plan');
    expect(r.text).toContain('MaaS 管理後台');
  });

  it('客戶專屬的網址在管理後台不存在（404）；存著客戶角色時退回平台擁有者', async () => {
    for (const path of ['/hub', '/hub/trial', '/plan']) {
      const r = await mount('admin', path, 'tenant-admin');
      expect(r.main, path).toContain('404');
      expect(r.navText, path).toContain('平台營運');
      act(() => root!.unmount());
      container!.remove();
      root = null;
      container = null;
    }
  });

  it('試用申請頁不顯示「開啟申請表」（表單在客戶入口）', async () => {
    const r = await mount('admin', '/trials');
    expect(container!.querySelector('[data-tour="trials-open-form"]')).toBeNull();
    expect(r.main.length).toBeGreaterThan(50);
  });
});

describe('入口專屬文案的多語品質', () => {
  const cases: [Portal, string][] = [
    ['customer', '/guides?guide=welcome-customer'],
    ['customer', '/guides?guide=trial-request'],
    ['admin', '/guides?guide=welcome'],
    ['admin', '/guides?guide=trial-request'],
  ];
  for (const [portal, path] of cases) {
    it(`${portal} ${path}：en 無 CJK、ja 無 zh-TW 外漏`, async () => {
      const en = await mount(portal, path, undefined, 'en');
      expect(enLeaks(en.text), `en ${path}`).toEqual([]);
      act(() => root!.unmount());
      container!.remove();
      root = null;
      container = null;
      const ja = await mount(portal, path, undefined, 'ja');
      expect(jaLeaks(ja.text), `ja ${path}`).toEqual([]);
    });
  }
});
