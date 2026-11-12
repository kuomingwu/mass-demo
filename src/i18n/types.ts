/** 支援的語言。zh-TW 為預設與最終備援（所有文案的來源語言）。 */
export type Locale = 'zh-TW' | 'en' | 'ja';
export const LOCALES: readonly Locale[] = ['zh-TW', 'en', 'ja'] as const;
export const DEFAULT_LOCALE: Locale = 'zh-TW';
/** 語言的原生名稱（語言切換選單用；刻意不翻譯） */
export const LOCALE_NATIVE_NAMES: Record<Locale, string> = { 'zh-TW': '繁體中文', en: 'English', ja: '日本語' };
/** BCP 47 標籤（Intl 用） */
export const LOCALE_TAGS: Record<Locale, string> = { 'zh-TW': 'zh-TW', en: 'en-US', ja: 'ja-JP' };
/** 備援鏈：ja → en → zh-TW；en → zh-TW */
export const FALLBACK_CHAIN: Record<Locale, readonly Locale[]> = { 'zh-TW': ['zh-TW'], en: ['en', 'zh-TW'], ja: ['ja', 'en', 'zh-TW'] };
export const LOCALE_STORAGE_KEY = 'maas-demo-lang';

/** 平面字典：穩定鍵（例如 nav.hub、hub.hero.title）→ 文案；{name} 為插補參數 */
export type Dict = Record<string, string>;
/** 插補參數；字串值以 '@' 開頭時視為另一個字典鍵（例如 '@data.tierPolicy.local'），會以目前語言解析 */
export type TParams = Record<string, string | number | boolean | null | undefined>;

export function isLocale(v: unknown): v is Locale {
  return v === 'zh-TW' || v === 'en' || v === 'ja';
}

/** navigator.language → Locale：zh* → zh-TW、ja* → ja、其餘 → en */
export function detectLocale(language: string | undefined | null): Locale {
  const l = (language ?? '').toLowerCase();
  if (l.startsWith('zh')) return 'zh-TW';
  if (l.startsWith('ja')) return 'ja';
  return 'en';
}
