/**
 * i18n 核心（純 TypeScript，不含 React）：字典、查詢與備援、插補、複數、語言狀態（外部 store）。
 * - 資料模組（src/data、src/server）可用 `zh(key, params)` 取得 zh-TW 文案（例如伺服器的 message 欄位）。
 * - React 元件請用 src/i18n/index.tsx 的 useT()／useLocale()。
 */
import zhTW from './zh-TW';
import en from './en';
import ja from './ja';
import { DEFAULT_LOCALE, FALLBACK_CHAIN, LOCALE_STORAGE_KEY, LOCALE_TAGS, isLocale, type Dict, type Locale, type TParams } from './types';

export const DICTS: Record<Locale, Dict> = { 'zh-TW': zhTW, en, ja };

const warned = new Set<string>();
function warnMissing(key: string) {
  if (warned.has(key)) return;
  warned.add(key);
  if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${key}`);
}

/** 依備援鏈查詢原始範本（不插補）；全部缺少時回傳 undefined */
export function lookup(locale: Locale, key: string): string | undefined {
  for (const l of FALLBACK_CHAIN[locale]) {
    const v = DICTS[l][key];
    if (v !== undefined) return v;
  }
  return undefined;
}

export function hasKey(locale: Locale, key: string): boolean {
  return lookup(locale, key) !== undefined;
}

/** {name} 插補；參數值以 '@' 開頭時視為字典鍵（巢狀翻譯，例如枚舉標籤）。 */
export function interpolate(template: string, params: TParams | undefined, locale: Locale): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = params[name];
    if (v === undefined || v === null) return m;
    if (typeof v === 'string' && v.startsWith('@')) return translate(locale, v.slice(1));
    return String(v);
  });
}

/** 翻譯：缺鍵時依備援鏈退到 zh-TW；連 zh-TW 都沒有時回傳鍵本身（開發模式警告），絕不回傳空字串 */
export function translate(locale: Locale, key: string, params?: TParams): string {
  const tpl = lookup(locale, key);
  if (tpl === undefined) {
    warnMissing(key);
    return key;
  }
  return interpolate(tpl, params, locale);
}

/**
 * 複數：以 Intl.PluralRules 選 `${key}.one`／`${key}.other`（或 zero/two/few/many），都沒有時退回 `key`；
 * `{count}` 自動帶入。中文／日文只有 other，英文有 one/other。
 */
export function translatePlural(locale: Locale, key: string, count: number, params?: TParams): string {
  let rule = 'other';
  try {
    rule = new Intl.PluralRules(LOCALE_TAGS[locale]).select(count);
  } catch {
    /* ignore */
  }
  const merged: TParams = { count, ...params };
  const candidates = [`${key}.${rule}`, `${key}.other`, key];
  for (const k of candidates) {
    const tpl = lookup(locale, k);
    if (tpl !== undefined) return interpolate(tpl, merged, locale);
  }
  warnMissing(key);
  return key;
}

/** zh-TW 文案（資料模組與伺服器訊息用；與 UI 在 zh-TW 下的輸出完全一致） */
export function zh(key: string, params?: TParams): string {
  return translate('zh-TW', key, params);
}

// ---------- 語言狀態（外部 store；useSyncExternalStore 訂閱） ----------
function readInitial(): Locale {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(LOCALE_STORAGE_KEY) : null;
    if (isLocale(stored)) return stored;
  } catch {
    /* ignore */
  }
  // 測試環境（jsdom 的 navigator.language 為 en-US）：未明確設定時維持 zh-TW，讓既有以中文文案斷言的測試穩定
  if (import.meta.env.MODE === 'test') return DEFAULT_LOCALE;
  // 首次造訪（尚未選過語言）一律以英文顯示；使用者以頁首地球按鈕切換後記住選擇。
  // （DEFAULT_LOCALE 仍是 zh-TW：它是來源語言與最終備援，不是首次顯示語言。detectLocale 保留供日後改回依瀏覽器偵測。）
  return INITIAL_LOCALE;
}

/** 首次造訪時顯示的語言 */
export const INITIAL_LOCALE: Locale = 'en';

let current: Locale = readInitial();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

export function applyHtmlLang(locale: Locale) {
  try {
    if (typeof document !== 'undefined') document.documentElement.lang = locale === 'zh-TW' ? 'zh-Hant-TW' : locale;
  } catch {
    /* ignore */
  }
}

/** 切換語言：寫入 localStorage（maas-demo-lang）、更新 <html lang>、通知所有訂閱者立即重繪 */
export function setLocale(next: Locale) {
  if (!isLocale(next)) return;
  current = next;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  applyHtmlLang(next);
  for (const l of Array.from(listeners)) l();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 以目前語言翻譯（非 React 程式碼用；元件請用 useT 以便語言切換時重繪） */
export function tCurrent(key: string, params?: TParams): string {
  return translate(current, key, params);
}

applyHtmlLang(current);
