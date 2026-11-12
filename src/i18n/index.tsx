/**
 * i18n 的 React 介面。
 * - useT()：t(key, params?)（{name} 插補；'@key' 參數巢狀翻譯）、t.n(key, count, params?) 複數、t.has(key)、t.locale。
 * - useLocale()：locale、setLocale 與依語言的格式器 fmtNumber／fmtUsd／fmtTwd／fmtDate／fmtDateTime／fmtCompact／fmtPct、pick()。
 * - I18nProvider：設定 <html lang>（store 本身不需 Provider，測試可直接掛載元件）。
 */
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { applyHtmlLang, getLocale, hasKey, setLocale, subscribe, translate, translatePlural } from './core';
import * as F from './format';
import type { Locale, TParams } from './types';

export type { Locale, TParams } from './types';
export { LOCALES, LOCALE_NATIVE_NAMES, LOCALE_TAGS, DEFAULT_LOCALE, LOCALE_STORAGE_KEY, detectLocale, isLocale } from './types';
export { getLocale, setLocale, translate, translatePlural, zh, tCurrent, interpolate } from './core';

export interface TFunction {
  (key: string, params?: TParams): string;
  /** 複數：`${key}.one`／`${key}.other`，{count} 自動帶入 */
  n: (key: string, count: number, params?: TParams) => string;
  has: (key: string) => boolean;
  locale: Locale;
}

export function makeT(locale: Locale): TFunction {
  const t = ((key: string, params?: TParams) => translate(locale, key, params)) as TFunction;
  t.n = (key, count, params) => translatePlural(locale, key, count, params);
  t.has = (key) => hasKey(locale, key);
  t.locale = locale;
  return t;
}

/** 伺服器訊息：有 messageKey（且字典有此鍵）時以目前語言翻譯，否則退回 zh-TW message */
export function apiMessage(t: TFunction, err: { message: string; messageKey?: string; params?: TParams } | null | undefined): string {
  if (!err) return '';
  return err.messageKey && t.has(err.messageKey) ? t(err.messageKey, err.params) : err.message;
}

/** 稽核原因／其他「zh 文字 + 可選鍵」欄位：有鍵時翻譯，否則退回 zh-TW 文字 */
export function keyedText(t: TFunction, text: string | undefined, key?: string, params?: TParams): string {
  if (key && t.has(key)) return t(key, params);
  return text ?? '';
}

/**
 * 以鍵翻譯，鍵不存在時回傳 fallback（通常是資料層的 zh-TW 文字）。
 * 用於渲染「資料驅動」的文案（導覽步驟、流程圖節點、模型描述…），讓渲染端與字典可以分開完成。
 */
export function tf(t: TFunction, key: string, fallback: string | undefined, params?: TParams): string {
  return t.has(key) ? t(key, params) : (fallback ?? '');
}

/**
 * 枚舉標籤：鍵為 `data.<MAP_NAME>.<value>`（例如 data.CLUSTER_STATUS_LABELS.waiting），
 * 不存在時回傳 fallback（資料層既有的 zh-TW 標籤）。
 */
export function tl(t: TFunction, mapName: string, value: string, fallback?: string): string {
  return tf(t, `data.${mapName}.${value}`, fallback ?? value);
}

/** 種子租戶名稱：`server.tenant.<id>.name`，執行期新增的租戶（使用者輸入）原樣顯示 */
export function tenantLabel(t: TFunction, id: string | null | undefined, name: string | undefined): string {
  return id ? tf(t, `server.tenant.${id}.name`, name ?? id) : name ?? '';
}

/**
 * 主體（使用者／服務主體）顯示名稱：種子使用者 `server.user.<id>.displayName`；
 * API 金鑰的服務主體名稱由伺服器以 zh('server.const.keyPrincipalName') 產生，這裡依目前語言重組；其餘原樣顯示（人名為 allowlist 專有名詞）。
 */
export function principalLabel(t: TFunction, id: string | null | undefined, name: string | undefined): string {
  if (id && t.has(`server.user.${id}.displayName`)) return t(`server.user.${id}.displayName`);
  const prefix = translate('zh-TW', 'server.const.keyPrincipalName', { name: '' });
  if (name && prefix && name.startsWith(prefix)) return t('server.const.keyPrincipalName', { name: name.slice(prefix.length) });
  return name ?? id ?? '';
}

/** 多語資料欄位（例如 models.ts 的 descriptionI18n）：目前語言 → en → 基底（zh-TW） */
export function pickI18n(locale: Locale, base: string, i18n?: Partial<Record<Locale, string>> | null): string {
  if (!i18n) return base;
  return i18n[locale] ?? (locale === 'ja' ? i18n.en : undefined) ?? base;
}

export interface LocaleApi {
  locale: Locale;
  setLocale: (l: Locale) => void;
  fmtNumber: (n: number, opts?: Intl.NumberFormatOptions) => string;
  fmtUsd: (n: number, digits?: number) => string;
  fmtTwd: (n: number, digits?: number) => string;
  fmtPct: (n: number, digits?: number) => string;
  fmtCompact: (n: number) => string;
  fmtDate: (iso: string | null | undefined) => string;
  fmtDateTime: (iso: string) => string;
  fmtShortDate: (iso: string) => string;
  /** 多語資料欄位 */
  pick: (base: string, i18n?: Partial<Record<Locale, string>> | null) => string;
}

export function makeLocaleApi(locale: Locale): LocaleApi {
  return {
    locale,
    setLocale,
    fmtNumber: (n, opts) => F.fmtNumber(locale, n, opts),
    fmtUsd: (n, digits) => F.fmtUsd(locale, n, digits),
    fmtTwd: (n, digits) => F.fmtTwd(locale, n, digits),
    fmtPct: (n, digits) => F.fmtPct(locale, n, digits),
    fmtCompact: (n) => F.fmtCompact(locale, n),
    fmtDate: (iso) => F.fmtDate(locale, iso),
    fmtDateTime: (iso) => F.fmtDateTime(locale, iso),
    fmtShortDate: (iso) => F.fmtShortDate(locale, iso),
    pick: (base, i18n) => pickI18n(locale, base, i18n),
  };
}

function useCurrentLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

export function useT(): TFunction {
  const locale = useCurrentLocale();
  return useMemo(() => makeT(locale), [locale]);
}

export function useLocale(): LocaleApi {
  const locale = useCurrentLocale();
  return useMemo(() => makeLocaleApi(locale), [locale]);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useCurrentLocale();
  useEffect(() => {
    applyHtmlLang(locale);
    // 分頁標題（index.html 的 <title> 為 zh-TW 預設值）
    document.title = translate(locale, 'shell.docTitle');
  }, [locale]);
  return <>{children}</>;
}
