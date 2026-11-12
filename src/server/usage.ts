// 示範資料：以固定種子產生 39 天用量（2026-10-01 ～ 11-08）（確保每次載入一致）
// 每筆記錄標示推論層級：local（我們自建的 GPU）、cloud（我們代理呼叫雲端供應商）、spillover（自建容量不足溢出到雲端）。
//
// 自建層採「供給側」產生：每個就緒部署每日能服務的 tokens ＝ tokPerSec × 副本 × 利用率 × 86400 × 當日係數，
// 再依消費專案的權重拆到各專案；GPU 時數 ＝ tokens ÷ (每卡 tok/s × 3600)。因此一定滿足
//   Σ gpuHours（每叢集）≤ 配置 GPU × 小時數，且各模型每日 tokens 推得的 tok/s ≤ 部署容量 × 利用率。
// 每筆自建用量都標示服務它的部署（deploymentId／sharing）：專屬部署的 tokens 含於 GPU 時數不另計費，共用部署按牌價（快取讀取 × 0.1、快取寫入 × 1.25）。
// 雲端列的 costUsd 是供應商牌價成本；向客戶的價格與我們的實際成本（議價折扣）在 api.ts 計算。
import { MODEL_BY_ID } from '../data/models';
import type { ProviderId } from '../data/models';
import { CLUSTERS, DEPLOYMENTS, tokPerSecPerGpu, type Deployment, type PoolSharing } from '../data/clusters';
import { PROJECTS } from './seed';
import { zh } from '../i18n/core';

export type UsageTier = 'local' | 'cloud' | 'spillover';

export const TIER_LABELS: Record<UsageTier, string> = {
  local: zh('data.TIER_LABELS.local'),
  cloud: zh('data.TIER_LABELS.cloud'),
  spillover: zh('data.TIER_LABELS.spillover'),
};

export interface UsageRecord {
  date: string; // YYYY-MM-DD
  tenantId: string;
  projectId: string;
  modelId: string;
  providerId: ProviderId;
  tier: UsageTier;
  /** 自建層：實際服務此筆用量的部署；雲端層為 null */
  deploymentId: string | null;
  /** 自建層：服務部署的共用／專屬；專屬 → tokens 含於 GPU 時數（0 token 費）；雲端層為 null */
  sharing: PoolSharing | null;
  /** 雲端層：實際送達的供應商區域（溢出／代理）；自建層為機房區域 */
  region: string;
  requests: number;
  errors: number;
  inputTokens: number;
  /** 快取讀取（命中前綴快取）的輸入 tokens：以輸入牌價 × 快取讀取倍率（示意 0.1）計價；為 inputTokens 的一部分 */
  cachedInputTokens: number;
  /** 快取寫入的輸入 tokens：以輸入牌價 × 快取寫入倍率（示意 1.25）計價；為 inputTokens 的一部分，與 cachedInputTokens 不重疊 */
  cacheWriteTokens: number;
  outputTokens: number;
  /** 雲端層：供應商牌價成本（USD）；自建層為 0（向客戶收的是我們的牌價，於帳務計算） */
  costUsd: number;
  avgTtftMs: number;
  /** 自建層：此筆用量折算的 GPU 時數（tokens ÷ 每卡 tok/s ÷ 3600；示範估算） */
  gpuHours: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 自建部署 → 消費它的專案與權重（每日 tokens 依權重拆分）。
 * - 聯合金融 p-risk 只走新竹 B 的兩個專屬部署（風控文件、僅自建）；p-advisor 走台北 A 的共用 Qwen（按牌價）。
 * - 公部門 p-gov-qa 只用非中國來源模型（gpt-oss／Llama／TAIDE／EmbeddingGemma）。
 */
export const DEPLOYMENT_CONSUMERS: Record<string, { projectId: string; weight: number }[]> = {
  'dep-qwen27b-shared': [
    { projectId: 'p-cs-bot', weight: 0.5 },
    { projectId: 'p-doc-rag', weight: 0.3 },
    { projectId: 'p-advisor', weight: 0.2 },
  ],
  'dep-embed-shared': [{ projectId: 'p-doc-rag', weight: 1 }],
  'dep-gptoss-shared': [
    { projectId: 'p-cs-bot', weight: 0.4 },
    { projectId: 'p-doc-rag', weight: 0.45 },
    { projectId: 'p-gov-qa', weight: 0.15 },
  ],
  'dep-llama70b-shared': [
    { projectId: 'p-doc-rag', weight: 0.6 },
    { projectId: 'p-gov-qa', weight: 0.4 },
  ],
  'dep-taide-shared': [{ projectId: 'p-gov-qa', weight: 1 }],
  'dep-gemma-embed-shared': [{ projectId: 'p-gov-qa', weight: 1 }],
  'dep-union-assist-dedicated': [{ projectId: 'p-risk', weight: 1 }],
  'dep-union-qwen27b-dedicated': [{ projectId: 'p-risk', weight: 1 }],
};

/** 各專案的雲端用量（代理／溢出）：以專案 RPM 為基礎的需求側估算；spillover 代表「自建優先別名」溢出到雲端的那一段 */
const PROJECT_CLOUD_MODELS: Record<string, { modelId: string; region: string; share: number; spillover?: boolean }[]> = {
  'p-cs-bot': [
    { modelId: 'qwen3.7-plus', region: 'ap-southeast-1', share: 0.1, spillover: true },
    { modelId: 'qwen3.8-flash', region: 'ap-southeast-1', share: 0.08 },
    { modelId: 'claude-haiku-4.5', region: 'anthropic-global', share: 0.03 },
  ],
  'p-doc-rag': [
    { modelId: 'qwen3.8-max', region: 'ap-southeast-1', share: 0.025 },
    { modelId: 'qwen3-rerank', region: 'ap-southeast-1', share: 0.2 },
  ],
  'p-vision-qc': [{ modelId: 'qwen3-vl-plus', region: 'ap-southeast-1', share: 0.35 }],
  'p-risk': [{ modelId: 'qwen3-coder-plus', region: 'ap-southeast-1', share: 0.05 }],
  'p-advisor': [
    { modelId: 'qwen3.7-plus', region: 'ap-southeast-1', share: 0.1, spillover: true },
    { modelId: 'gemini-2.5-flash', region: 'google-global', share: 0.05 },
  ],
  'p-legacy': [],
  'p-gov-qa': [],
};

/** 自建層平均每請求 tokens（RAG／agent 工作負載的長上下文；公部門問答較短） */
const LOCAL_TOKENS_PER_REQUEST: Record<string, number> = { 'p-gov-qa': 1_800 };
const DEFAULT_LOCAL_TOKENS_PER_REQUEST = 6_000;
/** 自建層輸入／輸出比例（RAG 長上下文：輸入佔多數；與混合牌價 70／30 一致） */
const LOCAL_INPUT_SHARE = 0.7;
/** 週末流量係數（B2B 客服／內部助理仍有基礎流量） */
const WEEKEND_FACTOR = 0.7;

export const USAGE_END_DATE = new Date('2026-11-08T00:00:00+08:00');

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 部署在某一天是否存在（依 createdAt；縮至零／0 副本不產生用量） */
function activeOn(dep: Deployment, dayEnd: Date): boolean {
  return dep.status === 'ready' && dep.replicas > 0 && new Date(dep.createdAt).getTime() <= dayEnd.getTime();
}

/** 預設 39 天：涵蓋 2026-10-01 ～ 2026-11-08，讓「上月（整月）」與「本月至今」的對帳單都有完整用量 */
export function generateUsage(days = 39, deployments: Deployment[] = DEPLOYMENTS): UsageRecord[] {
  const rand = mulberry32(20261108);
  const out: UsageRecord[] = [];
  const projectById = Object.fromEntries(PROJECTS.map((p) => [p.id, p]));
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(USAGE_END_DATE);
    d.setDate(d.getDate() - i);
    const dow = d.getDay();
    // 雜訊只往下（≤ 1），確保每日 tokens 推得的 tok/s 不會超過部署容量 × 利用率
    const dayFactor = (dow === 0 || dow === 6 ? WEEKEND_FACTOR : 1) * (0.88 + rand() * 0.12);
    const date = fmtDate(d);
    const dayEnd = new Date(d.getTime() + 86_400_000);

    // (1) 自建層：供給側（部署容量 × 利用率）
    for (const dep of deployments) {
      if (!activeOn(dep, dayEnd)) continue;
      const consumers = DEPLOYMENT_CONSUMERS[dep.id] ?? [];
      if (consumers.length === 0) continue;
      const m = MODEL_BY_ID[dep.modelId];
      const cluster = CLUSTERS.find((c) => c.id === dep.clusterId);
      const perGpu = tokPerSecPerGpu(m, cluster?.gpuType ?? 'H100 80GB', dep.quantization);
      const isEmbedding = m.capabilities.includes('embedding');
      // 整個部署當日服務的 tokens（≤ 容量 × 利用率 × 86400）
      const dayTokens = dep.tokPerSec * dep.replicas * dep.utilization * 86_400 * dayFactor;
      for (const c of consumers) {
        const p = projectById[c.projectId];
        if (!p) continue;
        const tokens = Math.round(dayTokens * c.weight * (0.9 + rand() * 0.1));
        const perReq = LOCAL_TOKENS_PER_REQUEST[p.id] ?? DEFAULT_LOCAL_TOKENS_PER_REQUEST;
        const requests = Math.max(1, Math.round(tokens / (isEmbedding ? 400 : perReq)));
        const inputTokens = isEmbedding ? tokens : Math.round(tokens * LOCAL_INPUT_SHARE);
        const outputTokens = isEmbedding ? 0 : tokens - inputTokens;
        const cachedInputTokens = isEmbedding ? 0 : Math.round(inputTokens * (0.2 + rand() * 0.2));
        // 快取寫入：每次新前綴第一次進快取（約輸入 5–10%）；與快取讀取不重疊
        const cacheWriteTokens = isEmbedding ? 0 : Math.round(inputTokens * (0.05 + rand() * 0.05));
        const errors = Math.round(requests * (0.002 + rand() * 0.008));
        const gpuHours = perGpu > 0 ? (inputTokens + outputTokens) / perGpu / 3600 : 0;
        out.push({
          date,
          tenantId: p.tenantId,
          projectId: p.id,
          modelId: m.id,
          providerId: m.providerId,
          tier: 'local',
          deploymentId: dep.id,
          sharing: dep.sharing,
          region: cluster?.region ?? dep.clusterId,
          requests,
          errors,
          inputTokens,
          cachedInputTokens,
          cacheWriteTokens,
          outputTokens,
          costUsd: 0,
          avgTtftMs: Math.round(160 + rand() * 260),
          gpuHours: Math.round(gpuHours * 100) / 100,
        });
      }
    }

    // (2) 雲端代理／溢出：需求側（專案 RPM × 份額）
    for (const p of PROJECTS) {
      for (const entry of PROJECT_CLOUD_MODELS[p.id] ?? []) {
        const m = MODEL_BY_ID[entry.modelId];
        if (!m) continue;
        const requests = Math.round(p.quotas.rpm * 60 * 8 * entry.share * dayFactor * (0.7 + rand() * 0.6));
        if (requests <= 0) continue;
        const isEmbedding = m.capabilities.includes('embedding') || m.capabilities.includes('rerank');
        const inputTokens = Math.round(requests * (isEmbedding ? 400 : 900 + rand() * 1200));
        const outputTokens = m.maxOutput === 0 ? 0 : Math.round(requests * (250 + rand() * 500));
        const errors = Math.round(requests * (0.004 + rand() * 0.02));
        const costUsd = (inputTokens / 1e6) * m.priceInput + (outputTokens / 1e6) * m.priceOutput;
        out.push({
          date,
          tenantId: p.tenantId,
          projectId: p.id,
          modelId: m.id,
          providerId: m.providerId,
          tier: entry.spillover ? 'spillover' : 'cloud',
          deploymentId: null,
          sharing: null,
          region: entry.region,
          requests,
          errors,
          inputTokens,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens,
          costUsd: Math.round(costUsd * 100) / 100,
          avgTtftMs: Math.round(320 + rand() * 600),
          gpuHours: 0,
        });
      }
    }
  }
  return out;
}

export interface HourlyPoint {
  hour: string; // HH:00
  requests: number;
  errors: number;
}

export function generateHourly(): HourlyPoint[] {
  const rand = mulberry32(42);
  const pts: HourlyPoint[] = [];
  for (let h = 0; h < 24; h++) {
    const diurnal = 0.35 + 0.65 * Math.exp(-Math.pow((h - 14) / 5, 2));
    const requests = Math.round(9000 * diurnal * (0.85 + rand() * 0.3));
    pts.push({ hour: `${String(h).padStart(2, '0')}:00`, requests, errors: Math.round(requests * (0.005 + rand() * 0.015)) });
  }
  return pts;
}
