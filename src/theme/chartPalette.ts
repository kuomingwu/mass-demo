// 圖表色票（經 dataviz 驗證器檢查：淺色／深色皆通過 CVD 與鄰近色差檢查）
// 類別色依「實體」固定指派，不隨排序或篩選重新上色。
import { zh } from '../i18n/core';
export const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

export const STATUS_COLORS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
};

/** 供應商 → 固定色槽（實體固定） */
export const PROVIDER_SERIES_INDEX: Record<string, number> = {
  bailian: 0,
  openai: 1,
  anthropic: 2,
  google: 3,
  vllm: 4,
  partner: 5,
};

/** 供應商名稱（zh-TW）；UI 用 tl(t, 'PROVIDER_NAMES', id, PROVIDER_NAMES[id]) */
export const PROVIDER_NAMES: Record<string, string> = {
  bailian: zh('data.PROVIDER_NAMES.bailian'),
  openai: zh('data.PROVIDER_NAMES.openai'),
  anthropic: zh('data.PROVIDER_NAMES.anthropic'),
  google: zh('data.PROVIDER_NAMES.google'),
  vllm: zh('data.PROVIDER_NAMES.vllm'),
  partner: zh('data.PROVIDER_NAMES.partner'),
};

export function seriesColor(index: number, dark: boolean): string {
  const arr = dark ? SERIES_DARK : SERIES_LIGHT;
  return arr[index % arr.length];
}

export function formatCompact(n: number): string {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e3).toFixed(0)}K`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString('zh-TW');
}

export function formatUsd(n: number, digits = 2): string {
  return `US$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
