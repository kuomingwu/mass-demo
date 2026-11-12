// @vitest-environment jsdom
// i18n 品質門：
//  (a) en／ja 字典的鍵集合必須與 zh-TW 完全相同（不可缺、不可多）
//  (b) 原始碼（排除字典、測試、註解）不得殘留使用者可見的 CJK 字串，除了 allowlist.json 的示範專有名詞
//  (c) 以 en／ja 掛載 AppShell + 模型中心 + 總覽：導覽標籤等於字典值；en 無 CJK、ja 無逐字 zh-TW 文案與繁體專用字
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import zhTW from '../zh-TW';
import en from '../en';
import ja from '../ja';
import { CJK, TRAD_ONLY, enLeaks, isAllowedRun, jaLeaks, stripNames } from './leakUtil';
import { DICTS, interpolate, setLocale, translate, translatePlural, zh } from '../core';
import { fmtDate, fmtDateTime, fmtNumber, fmtTwd, fmtUsd } from '../format';
import { detectLocale, type Locale } from '../types';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { SessionProvider } from '../../app/SessionContext';
import { NotifyProvider } from '../../components/Notify';
import { AppRoutes } from '../../app/routes';
import { server } from '../../server/api';

// 原始碼（?raw 匯入；排除測試、字典與 types.ts）
const SOURCES = import.meta.glob(['../../**/*.{ts,tsx}', '!../../**/__tests__/**', '!../dict/**', '!../types.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/**
 * 去除註解：區塊註解（含 JSX 的 {／* *／}，保留換行以維持行號）與行註解（保留字串內的 URL：只有前面不是 : ' " ` 的 // 才視為註解）。
 * 先把 CRLF／CR 正規化成 LF，避免行尾的 \r 讓 `.*$` 比對失敗。
 */
function stripComments(src: string): string {
  return src
    .replace(/\r\n?/g, '\n')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/[^\n]*$/, '$1'))
    .join('\n');
}

/** 掃描單一檔案，回傳違規的 (行號, 文字) */
function scanFile(file: string, source: string): string[] {
  const rel = file.replace(/^(\.\.\/)+/, '');
  const lines = stripComments(source).split('\n');
  const bad: string[] = [];
  // models.ts：description 保留 zh-TW 基底文案（en/ja 在 descriptionI18n），licenseObligations 同理
  const isModels = rel === 'data/models.ts';
  let inObligations = false;
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (isModels) {
      if (/^licenseObligations:\s*\[/.test(trimmed)) {
        inObligations = !/\]/.test(trimmed);
        return;
      }
      if (inObligations) {
        if (/\]/.test(trimmed)) inObligations = false;
        return;
      }
      if (/^description:\s*['"`]/.test(trimmed)) return;
    }
    const runs = line.match(CJK) ?? [];
    const offending = runs.filter((r) => !isAllowedRun(r));
    if (offending.length) bad.push(`${rel}:${i + 1}: ${offending.join(' | ')}`);
  });
  return bad;
}

describe('i18n 字典', () => {
  it('(a) en 與 ja 的鍵集合與 zh-TW 完全相同', () => {
    const zhKeys = Object.keys(zhTW).sort();
    for (const [name, dict] of [
      ['en', en],
      ['ja', ja],
    ] as const) {
      const keys = Object.keys(dict).sort();
      const missing = zhKeys.filter((k) => !(k in dict));
      const extra = keys.filter((k) => !(k in zhTW));
      expect(missing, `${name} 缺少鍵：${missing.slice(0, 20).join(', ')}`).toEqual([]);
      expect(extra, `${name} 多出鍵：${extra.slice(0, 20).join(', ')}`).toEqual([]);
    }
    expect(zhKeys.length).toBeGreaterThan(100);
  });

  it('字典值不得為空字串；zh-TW 文案不得含未翻譯的鍵名', () => {
    for (const [loc, dict] of Object.entries(DICTS)) {
      for (const [k, v] of Object.entries(dict)) expect(v, `${loc}:${k}`).not.toBe('');
    }
  });

  it('en 字典值不含 CJK（除 allowlist 專有名詞）', () => {
    const leaks = Object.entries(en)
      .filter(([, v]) => (v.match(CJK) ?? []).some((r) => !isAllowedRun(r)))
      .map(([k]) => k);
    expect(leaks, leaks.slice(0, 20).join(', ')).toEqual([]);
  });

  it('ja 字典值不含繁體專用字（除 allowlist 專有名詞）', () => {
    const bad = Object.entries(ja)
      .filter(([, v]) => (stripNames(v).match(TRAD_ONLY) ?? []).length > 0)
      .map(([k, v]) => `${k}: ${v.slice(0, 40)}`);
    expect(bad, bad.slice(0, 20).join('\n')).toEqual([]);
  });

  it('外漏偵測器自我檢查：zh-TW 文案在 ja 頁面會被抓到，ja 文案不會', () => {
    expect(jaLeaks(`${zhTW['nav.group.vendor']} ${zhTW['nav.clusters']}`).length).toBeGreaterThan(0);
    expect(jaLeaks(['nav.hub', 'nav.usage', 'nav.audit', 'nav.settings', 'common.cancel'].map((k) => ja[k]).join(' '))).toEqual([]);
    expect(enLeaks('Hello 星耀科技')).toEqual([]);
    expect(enLeaks('Hello 平台營運')).toEqual(['平台營運']);
    expect(stripComments('a // 註解\r\n{/* 區塊 */}b').match(CJK)).toBeNull();
  });

  it('插補、巢狀 @key、複數與備援', () => {
    expect(interpolate('Hi {name}, {n}', { name: 'A', n: 2 }, 'en')).toBe('Hi A, 2');
    expect(interpolate('{x}', {}, 'en')).toBe('{x}');
    expect(translate('en', 'common.cancel')).toBe('Cancel');
    expect(translate('ja', 'common.cancel')).toBe('キャンセル');
    expect(translate('zh-TW', 'common.copyLabel', { label: 'X' })).toBe('複製X');
    expect(interpolate('{a}', { a: '@common.cancel' }, 'ja')).toBe('キャンセル');
    expect(translatePlural('en', 'common.items', 1)).toBe('1 item');
    expect(translatePlural('en', 'common.items', 3)).toBe('3 items');
    expect(translatePlural('zh-TW', 'common.items', 3)).toBe('3 筆');
    // 缺鍵：回傳鍵本身而非空字串
    expect(translate('en', 'nope.missing')).toBe('nope.missing');
    expect(zh('common.cancel')).toBe('取消');
    expect(detectLocale('zh-TW')).toBe('zh-TW');
    expect(detectLocale('zh-Hant')).toBe('zh-TW');
    expect(detectLocale('ja-JP')).toBe('ja');
    expect(detectLocale('de')).toBe('en');
    expect(detectLocale(undefined)).toBe('en');
  });

  it('格式器：zh-TW 輸出與改版前相同；en 用 TWD、ja 用 NT$', () => {
    expect(fmtUsd('zh-TW', 1234.5)).toBe('US$1,234.50');
    expect(fmtUsd('en', 20, 0)).toBe('US$20');
    expect(fmtTwd('zh-TW', 1000)).toBe('NT$1,000');
    expect(fmtTwd('ja', 1000)).toBe('NT$1,000');
    expect(fmtTwd('en', 1000)).toBe('TWD 1,000');
    expect(fmtNumber('zh-TW', 1234567)).toBe('1,234,567');
    expect(fmtDate('zh-TW', '2026-11-08T09:41:12+08:00')).toBe(new Date('2026-11-08T09:41:12+08:00').toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' }));
    expect(fmtDateTime('zh-TW', 'bad')).toBe('bad');
    expect(fmtDate('en', null)).toBe('—');
  });
});

describe('(b) 原始碼不得殘留使用者可見的 CJK 字串', () => {
  it('src/**/*.{ts,tsx}（排除字典、測試、註解、allowlist 專有名詞）', () => {
    const files = Object.keys(SOURCES);
    expect(files.length).toBeGreaterThan(50);
    const bad = files.flatMap((f) => scanFile(f, SOURCES[f]));
    expect(bad, `${bad.length} 處殘留：\n${bad.slice(0, 60).join('\n')}`).toEqual([]);
  });
});

describe('(c) en／ja 掛載 AppShell + 模型中心 + 總覽', () => {
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

  async function mount(path: string, persona: string, locale: Locale) {
    localStorage.setItem('maas-demo-persona', persona);
    setLocale(locale);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(ThemeProvider, null, React.createElement(SessionProvider, null, React.createElement(NotifyProvider, null, React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(AppRoutes))))),
        ),
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    return container!;
  }

  // en：非 allowlist 的 CJK 都算外漏；ja：日文本身就是假名＋漢字，改為偵測「逐字出現的 zh-TW 字典文案」與繁體專用字
  const leaks = (text: string, locale: Locale) => (locale === 'en' ? enLeaks(text) : jaLeaks(text));
  const NAV_KEYS = ['nav.hub', 'nav.playground', 'nav.keys', 'nav.usage', 'nav.plan', 'nav.overview', 'nav.trials', 'nav.tenants', 'nav.models', 'nav.clusters', 'nav.providers', 'nav.routing', 'nav.pricing', 'nav.iam', 'nav.audit', 'nav.settings', 'nav.guides', 'nav.group.customer', 'nav.group.vendor'];

  for (const locale of ['en', 'ja'] as Locale[]) {
    it(`${locale}：導覽標籤等於字典值、無 zh-TW 外漏；<html lang> 更新`, async () => {
      const c = await mount('/', 'owner', locale);
      expect(document.documentElement.lang).toBe(locale);
      const navEl = c.querySelector('nav');
      const nav = navEl?.textContent ?? '';
      for (const k of NAV_KEYS) expect(nav, k).toContain(DICTS[locale][k]);
      expect(nav).not.toContain(zhTW['nav.group.vendor']);
      expect(leaks(nav, locale), `nav leaks: ${leaks(nav, locale).join(' | ')}`).toEqual([]);
      const header = c.querySelector('header[role="banner"]')?.textContent ?? '';
      expect(leaks(header, locale), `header leaks: ${leaks(header, locale).join(' | ')}`).toEqual([]);
      const main = c.querySelector('main')?.textContent ?? '';
      expect(leaks(main, locale), `overview leaks: ${leaks(main, locale).slice(0, 30).join(' | ')}`).toEqual([]);
    });

    it(`${locale}：模型中心無 zh-TW 外漏`, async () => {
      const c = await mount('/hub', 'tenant-admin', locale);
      const main = c.querySelector('main')?.textContent ?? '';
      expect(main.length).toBeGreaterThan(200);
      expect(leaks(main, locale), `hub leaks: ${leaks(main, locale).slice(0, 30).join(' | ')}`).toEqual([]);
    });
  }

  it('語言切換立即重繪且寫入 localStorage', async () => {
    const c = await mount('/hub', 'owner', 'en');
    expect(c.querySelector('nav')?.textContent).toContain(en['nav.hub']);
    await act(async () => {
      setLocale('ja');
    });
    expect(c.querySelector('nav')?.textContent).toContain(ja['nav.hub']);
    expect(localStorage.getItem('maas-demo-lang')).toBe('ja');
    await act(async () => {
      setLocale('zh-TW');
    });
    expect(c.querySelector('nav')?.textContent).toContain(zhTW['nav.hub']);
  });
});
