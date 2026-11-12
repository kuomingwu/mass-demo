// @vitest-environment jsdom
// i18n 路由品質門：以 owner、tenant-admin、gov-admin 在每種語系掛載每個路由，
//  - 畫面文字（含 aria-label／title／placeholder）不得出現未解析的字典鍵（例如 hub.hero.title）
//  - 開發模式不得有 `[i18n] missing key` 警告
//  - en：除 allowlist 專有名詞外不得有 CJK；ja：不得逐字出現 zh-TW 字典文案，也不得有繁體專用字（allowlist 除外）
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { enLeaks, jaLeaks } from './leakUtil';
import { setLocale } from '../core';
import type { Locale } from '../types';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { SessionProvider } from '../../app/SessionContext';
import { NotifyProvider } from '../../components/Notify';
import { AppRoutes } from '../../app/routes';
import { server } from '../../server/api';
import { ALL_ACTIONS } from '../../auth/types';

const ROUTES = [
  '/',
  '/hub',
  '/hub?tab=integrations',
  '/hub?tab=faq',
  '/hub/trial',
  '/playground',
  '/playground?model=flux.1-schnell',
  '/keys',
  '/usage',
  '/usage?tab=statement',
  '/usage?tab=unit',
  '/plan',
  '/trials',
  '/tenants',
  '/tenants?tab=trials',
  '/tenants/t-star',
  '/tenants/t-union',
  '/tenants/t-gov',
  '/tenants/t-acme-trial',
  '/models',
  '/deployments',
  '/clusters',
  '/clusters/cl-tpe-a',
  '/clusters/cl-hc-b?tab=deployments',
  '/clusters/cl-hc-b?tab=pools',
  '/clusters/cl-tc-c?tab=events',
  '/providers',
  '/routing',
  '/pricing',
  '/pricing?tab=unit',
  '/pricing?tab=proxy',
  '/pricing?tab=settings',
  '/iam',
  '/iam?tab=roles',
  '/iam?tab=effective',
  '/iam?tab=requests',
  '/iam?tab=audit',
  '/audit',
  '/guides',
  '/guides?guide=welcome',
  '/guides?guide=hub-first-call',
  '/guides?guide=trial-request',
  '/guides?guide=register-cluster',
  '/guides?guide=deploy-model',
  '/guides?guide=onboard-tenant',
  '/guides?guide=create-key-playground',
  '/guides?guide=connect-provider-bailian',
  '/guides?guide=routing-spillover',
  '/guides?guide=assign-role-approval',
  '/guides?guide=billing',
  '/guides?guide=denied-request-access',
  '/settings',
  '/forbidden?action=key.create',
  '/nope',
];
const PERSONAS = ['owner', 'tenant-admin', 'gov-admin'];
const LOCALES: Locale[] = ['zh-TW', 'en', 'ja'];

const RAW_KEY = /\b(?:common|shell|nav|overview|hub|billing|ops|customer|admin|data|server|guides|flows)\.[A-Za-z0-9_.-]+\b(?![@\w-])/g;
/** RBAC 動作代號（例如 billing.configure）與 email 不是字典鍵 */
const NOT_KEYS = new Set<string>(ALL_ACTIONS);
// 流程圖的 SVG 文字會把 billing.export 與下一行黏成 billing.exportallowed：動作代號後直接接小寫字母也不是鍵（真正的鍵會接 .）
const isRawKey = (m: string) => !NOT_KEYS.has(m) && !ALL_ACTIONS.some((a) => m.startsWith(a) && /^[a-z]/.test(m.slice(a.length)));
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
  setLocale('zh-TW');
});

async function mount(path: string, persona: string): Promise<string> {
  localStorage.setItem('maas-demo-persona', persona);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(SessionProvider, null, React.createElement(NotifyProvider, null, React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(AppRoutes)))),
      ),
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  const attrs = Array.from(document.body.querySelectorAll('[aria-label],[title],[placeholder]'))
    .flatMap((el) => ['aria-label', 'title', 'placeholder'].map((a) => el.getAttribute(a) ?? ''))
    .join('\n');
  // 逐一文字節點以換行串接（避免相鄰元素黏在一起，例如 customer. + Request）
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!n.parentElement?.closest('svg')) parts.push(n.nodeValue ?? '');
  // SVG 文字（流程圖）會把長字串斷成多個 tspan：以 <text> 為單位串接
  for (const el of Array.from(document.body.querySelectorAll('svg text'))) parts.push(el.textContent ?? '');
  const text = `${parts.join('\n')}\n${attrs}`;
  act(() => root!.unmount());
  root = null;
  container.remove();
  container = null;
  return text;
}

describe('i18n：每個路由 × 角色 × 語系', () => {
  for (const locale of LOCALES) {
    for (const persona of PERSONAS) {
      it(`${locale} / ${persona}：無未解析鍵、無 missing key 警告${locale === 'en' ? '、無 CJK' : locale === 'ja' ? '、無 zh-TW 外漏' : ''}`, async () => {
        const warns: string[] = [];
        const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
          const msg = String(args[0] ?? '');
          if (msg.includes('[i18n]')) warns.push(msg);
        });
        const rawHits: string[] = [];
        const cjkHits: string[] = [];
        try {
          setLocale(locale);
          for (const path of ROUTES) {
            const text = await mount(path, persona);
            for (const m of new Set((text.match(RAW_KEY) ?? []).filter(isRawKey))) rawHits.push(`${path}: ${m}`);
            if (locale === 'en') {
              const runs = enLeaks(text);
              if (runs.length) cjkHits.push(`${path}: ${runs.slice(0, 12).join(' | ')}`);
            } else if (locale === 'ja') {
              const hits = jaLeaks(text);
              if (hits.length) cjkHits.push(`${path}: ${hits.slice(0, 8).join(' | ')}`);
            }
          }
        } finally {
          spy.mockRestore();
        }
        expect(rawHits, `未解析鍵：\n${rawHits.slice(0, 40).join('\n')}`).toEqual([]);
        expect(warns, warns.slice(0, 20).join('\n')).toEqual([]);
        expect(cjkHits, `${locale} 外漏：\n${cjkHits.slice(0, 40).join('\n')}`).toEqual([]);
      }, 120_000);
    }
  }
});
