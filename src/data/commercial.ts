/**
 * 商業模型共用常數（「One API」token 事業）：預付儲值、限流層級、快取計價倍率、代理模型價格政策、SLA。
 * 伺服器（src/server/api.ts）與 UI（模型中心、試用與方案、定價與帳務）共用同一份數字；所有數值皆為示意。
 */
import { type ModelInfo, isLocalModel } from './models';
import { zh } from '../i18n/core';

/** 計費模式：預付儲值（餘額扣抵，餘額 ≤ 0 時 Playground／API 回 402）或月結合約（postpaid） */
export type BillingMode = 'prepaid' | 'postpaid';
export const BILLING_MODE_LABELS: Record<BillingMode, string> = { prepaid: zh('data.BILLING_MODE_LABELS.prepaid'), postpaid: zh('data.BILLING_MODE_LABELS.postpaid') };

/** 資料留存政策：零留存（只留計量事件）或 30 天（除錯／稽核用，預設） */
export type RetentionPolicy = 'zero' | '30d';
export const RETENTION_LABELS: Record<RetentionPolicy, string> = { zero: zh('data.RETENTION_LABELS.zero'), '30d': zh('data.RETENTION_LABELS.30d') };
export const DEFAULT_RETENTION: RetentionPolicy = '30d';

/** 儲值金額範圍（示意） */
export const TOPUP_MIN_USD = 10;
export const TOPUP_MAX_USD = 10_000;
export const TOPUP_PRESETS_USD = [50, 100, 500, 1000];
/** 低餘額警示門檻（未設定自動儲值時） */
export const LOW_BALANCE_DEFAULT_USD = 100;

/** 快取計價倍率（Inferel 式）：快取讀取 = 輸入牌價 × 0.1；快取寫入 = 輸入牌價 × 1.25 */
export const DEFAULT_CACHE_READ_MULTIPLIER = 0.1;
export const DEFAULT_CACHE_WRITE_MULTIPLIER = 1.25;

/** 代理閉源／夥伴模型：向客戶 = 供應商牌價 × (1 − 代理折扣)；我們的成本 = 供應商牌價 × (1 − 議價折扣) */
export const DEFAULT_PROXY_DISCOUNT_PCT = 10;
export const DEFAULT_NEGOTIATED_DISCOUNT_PCT = 15;
/** 代理開放模型（阿里雲百煉 Qwen 等）：供應商牌價 + 加價 */
export const DEFAULT_CLOUD_MARKUP_PCT = 15;

export type ProxyKind = 'self-hosted' | 'proxied-open' | 'proxied-closed';
export const PROXY_KIND_LABELS: Record<ProxyKind, string> = { 'self-hosted': zh('data.PROXY_KIND_LABELS.self-hosted'), 'proxied-open': zh('data.PROXY_KIND_LABELS.proxied-open'), 'proxied-closed': zh('data.PROXY_KIND_LABELS.proxied-closed') };

/** 模型的供應類型：自建；代理開放模型（百煉代管的 Qwen／DeepSeek 等）；代理閉源／夥伴（OpenAI、Anthropic、Google、合作夥伴 API） */
export function proxyKindOf(m: Pick<ModelInfo, 'providerId'>): ProxyKind {
  if (isLocalModel(m)) return 'self-hosted';
  return m.providerId === 'bailian' ? 'proxied-open' : 'proxied-closed';
}

export interface PricePolicy {
  cloudMarkupPct: number;
  proxyDiscountPct: number;
  negotiatedDiscountPct: number;
}

/** 向客戶的單價（相對供應商牌價 list；自建模型直接回傳牌價） */
export function customerPriceFactor(m: Pick<ModelInfo, 'providerId' | 'proxyDiscountPct'>, p: PricePolicy): number {
  const kind = proxyKindOf(m);
  if (kind === 'self-hosted') return 1;
  if (kind === 'proxied-open') return 1 + p.cloudMarkupPct / 100;
  return 1 - (m.proxyDiscountPct ?? p.proxyDiscountPct) / 100;
}

/** 我們付給供應商的成本係數（相對供應商牌價）：開放模型 = 牌價；閉源／夥伴 = 牌價 × (1 − 議價折扣) */
export function vendorCostFactor(m: Pick<ModelInfo, 'providerId'>, p: PricePolicy): number {
  const kind = proxyKindOf(m);
  if (kind === 'self-hosted') return 0;
  if (kind === 'proxied-open') return 1;
  return 1 - p.negotiatedDiscountPct / 100;
}

export function roundUsd(n: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** 代理模型卡片用：供應商牌價 → 我們的價格（輸入／輸出或每單位） */
export function proxiedPriceView(m: Pick<ModelInfo, 'providerId' | 'proxyDiscountPct' | 'priceInput' | 'priceOutput' | 'unitType'>, p: PricePolicy): { kind: ProxyKind; listInput: number; listOutput: number; ourInput: number; ourOutput: number; costInput: number; costOutput: number; pctLabel: string; pctLabelKey: string; pctLabelParams?: { pct: number } } {
  const kind = proxyKindOf(m);
  const f = customerPriceFactor(m, p);
  const c = vendorCostFactor(m, p);
  const pctLabelKey = kind === 'proxied-open' ? 'data.PCT_LABEL.markup' : kind === 'proxied-closed' ? 'data.PCT_LABEL.proxyDiscount' : 'data.PCT_LABEL.ourList';
  const pctLabelParams = kind === 'proxied-open' ? { pct: p.cloudMarkupPct } : kind === 'proxied-closed' ? { pct: m.proxyDiscountPct ?? p.proxyDiscountPct } : undefined;
  const pctLabel = zh(pctLabelKey, pctLabelParams);
  return { kind, listInput: m.priceInput, listOutput: m.priceOutput, ourInput: roundUsd(m.priceInput * f), ourOutput: roundUsd(m.priceOutput * f), costInput: roundUsd(m.priceInput * c), costOutput: roundUsd(m.priceOutput * c), pctLabel, pctLabelKey, pctLabelParams };
}

/** 限流層級（GMI 式，依累計消費自動升級；合約客戶直接 Tier 4） */
export interface RateLimitTier {
  level: 0 | 1 | 2 | 3 | 4;
  name: string;
  tpm: number;
  /** 進入此層的累計消費門檻（USD）；Tier 4 為合約 */
  minSpendUsd: number | null;
  note: string;
}

export const RATE_LIMIT_TIERS: RateLimitTier[] = [
  { level: 0, name: 'Tier 0', tpm: 1_000_000, minSpendUsd: 0, note: zh('data.RATE_LIMIT_TIER_NOTES.0') },
  { level: 1, name: 'Tier 1', tpm: 3_000_000, minSpendUsd: 50, note: zh('data.RATE_LIMIT_TIER_NOTES.1') },
  { level: 2, name: 'Tier 2', tpm: 50_000_000, minSpendUsd: 500, note: zh('data.RATE_LIMIT_TIER_NOTES.2') },
  { level: 3, name: 'Tier 3', tpm: 100_000_000, minSpendUsd: 1_000, note: zh('data.RATE_LIMIT_TIER_NOTES.3') },
  { level: 4, name: 'Tier 4', tpm: 300_000_000, minSpendUsd: null, note: zh('data.RATE_LIMIT_TIER_NOTES.4') },
];

/** 依累計消費與是否合約客戶計算限流層級 */
export function tierForSpend(cumulativeSpendUsd: number, contract: boolean): RateLimitTier {
  if (contract) return RATE_LIMIT_TIERS[4];
  let tier = RATE_LIMIT_TIERS[0];
  for (const t of RATE_LIMIT_TIERS) if (t.minSpendUsd !== null && cumulativeSpendUsd >= t.minSpendUsd) tier = t;
  return tier;
}

/** 下一層（Tier 4 為合約，不以消費自動升級） */
export function nextTier(current: RateLimitTier): RateLimitTier | null {
  const n = RATE_LIMIT_TIERS.find((t) => t.level === current.level + 1);
  return n && n.minSpendUsd !== null ? n : null;
}

/** SLA（示意）：共用／專屬可用性、吞吐承諾與服務抵扣 */
export const SLA_TERMS = {
  shared: { availabilityPct: 99.9, label: zh('data.SLA_TERMS.shared.label'), note: zh('data.SLA_TERMS.shared.note') },
  dedicated: { availabilityPct: 99.9, label: zh('data.SLA_TERMS.dedicated.label'), note: zh('data.SLA_TERMS.dedicated.note') },
  credits: [
    { below: 99.9, creditPct: 10, label: zh('data.SLA_TERMS.credits.0.label') },
    { below: 99.0, creditPct: 25, label: zh('data.SLA_TERMS.credits.1.label') },
    { below: 95.0, creditPct: 100, label: zh('data.SLA_TERMS.credits.2.label') },
  ],
  note: zh('data.SLA_TERMS.note'),
} as const;
