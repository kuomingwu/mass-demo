/** 依語言的數字／貨幣／日期格式（Intl）。zh-TW 的輸出與改版前完全相同（既有測試依賴）。 */
import { LOCALE_TAGS, type Locale } from './types';

export function fmtNumber(locale: Locale, n: number, opts?: Intl.NumberFormatOptions): string {
  return n.toLocaleString(LOCALE_TAGS[locale], opts);
}

/** 美元：所有語言皆以 US$ 前綴（en-US 千分位），例如 US$1,234.50 */
export function fmtUsd(_locale: Locale, n: number, digits = 2): string {
  return `US$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** 新台幣：zh-TW／ja 用 NT$，en 用 TWD 前綴 */
export function fmtTwd(locale: Locale, n: number, digits = 0): string {
  const num = n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return locale === 'en' ? `TWD ${num}` : `NT$${num}`;
}

export function fmtPct(locale: Locale, n: number, digits = 1): string {
  return `${n.toLocaleString(LOCALE_TAGS[locale], { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

/** 精簡數字（1.2K／3.4M／1.0B） */
export function fmtCompact(locale: Locale, n: number): string {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e3).toFixed(0)}K`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString(LOCALE_TAGS[locale]);
}

export function fmtDateTime(locale: Locale, iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(LOCALE_TAGS[locale], { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtDate(locale: Locale, iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(LOCALE_TAGS[locale], { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/** 短日期（月／日），圖表軸用 */
export function fmtShortDate(locale: Locale, iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(LOCALE_TAGS[locale], { month: '2-digit', day: '2-digit' });
}
