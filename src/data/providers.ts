// 示範資料：代理供應商（雲端／夥伴）設定 + 自建推論層摘要（所有端點、金鑰為示意，金鑰由 KMS 管理僅顯示遮罩）
// 雲端供應商只作代理／溢出：我們沒有自建的模型（旗艦 MoE、視覺、第三方）或自建容量耗盡時才使用，向客戶以供應商牌價 + 加價收費。
import { zh } from '../i18n/core';
import type { ProviderId } from './models';
import { fleetPeakTokPerSec } from './clusters';

export type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface ProviderEndpoint {
  region: string;
  /** zh-TW 區域標籤；字典鍵 data.region.<region>（端點備註：data.provider.<id>.endpointNote.<region>） */
  regionLabel: string;
  baseUrl: string;
  note?: string;
  legacy?: boolean;
  /** 金鑰與速率上限皆以區域為單位 */
  keyRef: string;
  rpmLimit: number;
  tpmLimit: number;
  latencyMs: number;
  health: HealthStatus;
}

/**
 * 供應商文案的字典鍵：data.provider.<id>.name／type／description／rateLimitNote／hint.<n>（1 起算）／capacity.gpus／capacity.servingEngine。
 * UI 以 tf(t, key, zh 文字) 顯示目前語言。
 */
export interface ProviderInfo {
  id: ProviderId;
  name: string;
  type: string;
  description: string;
  endpoints: ProviderEndpoint[];
  health: HealthStatus;
  hints: string[];
  rateLimitNote?: string;
  enabled: boolean;
  /** 自建推論層（我們的 GPU 叢集） */
  local?: boolean;
  /** 我們的 GPU 叢集容量與即時指標（示範資料） */
  capacity?: {
    gpus: string;
    nodes: number;
    servingEngine: string;
    utilization: number;
    queueDepth: number;
    kvCacheHitRate: number;
    tokensPerSec: number;
    models: string[];
  };
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'bailian',
    name: zh('data.provider.bailian.name'),
    type: zh('data.provider.bailian.type'),
    description: zh('data.provider.bailian.description'),
    health: 'healthy',
    enabled: true,
    hints: [
      zh('data.provider.bailian.hint.1'),
      zh('data.provider.bailian.hint.2'),
      zh('data.provider.bailian.hint.3'),
    ],
    rateLimitNote: zh('data.provider.bailian.rateLimitNote'),
    endpoints: [
      {
        region: 'ap-southeast-1',
        regionLabel: zh('data.region.ap-southeast-1'),
        baseUrl: 'https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
        keyRef: 'kms://maas-demo/bailian/ap-southeast-1',
        rpmLimit: 1200,
        tpmLimit: 2_000_000,
        latencyMs: 412,
        health: 'healthy',
      },
      {
        region: 'cn-beijing',
        regionLabel: zh('data.region.cn-beijing'),
        baseUrl: 'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
        keyRef: 'kms://maas-demo/bailian/cn-beijing',
        rpmLimit: 1200,
        tpmLimit: 2_000_000,
        latencyMs: 538,
        health: 'healthy',
      },
      {
        region: 'us-east-1',
        regionLabel: zh('data.region.us-east-1'),
        baseUrl: 'https://{WorkspaceId}.us-east-1.maas.aliyuncs.com/compatible-mode/v1',
        keyRef: 'kms://maas-demo/bailian/us-east-1',
        rpmLimit: 600,
        tpmLimit: 1_000_000,
        latencyMs: 690,
        health: 'degraded',
      },
      {
        region: 'eu-central-1',
        regionLabel: zh('data.region.eu-central-1'),
        baseUrl: 'https://{WorkspaceId}.eu-central-1.maas.aliyuncs.com/compatible-mode/v1',
        keyRef: 'kms://maas-demo/bailian/eu-central-1',
        rpmLimit: 600,
        tpmLimit: 1_000_000,
        latencyMs: 752,
        health: 'healthy',
      },
      {
        region: 'ap-northeast-1',
        regionLabel: zh('data.region.ap-northeast-1'),
        baseUrl: 'https://{WorkspaceId}.ap-northeast-1.maas.aliyuncs.com/compatible-mode/v1',
        keyRef: 'kms://maas-demo/bailian/ap-northeast-1',
        rpmLimit: 600,
        tpmLimit: 1_000_000,
        latencyMs: 365,
        health: 'healthy',
      },
      {
        region: 'cn-hongkong',
        regionLabel: zh('data.region.cn-hongkong'),
        baseUrl: 'https://{WorkspaceId}.cn-hongkong.maas.aliyuncs.com/compatible-mode/v1',
        keyRef: 'kms://maas-demo/bailian/cn-hongkong',
        rpmLimit: 600,
        tpmLimit: 1_000_000,
        latencyMs: 298,
        health: 'healthy',
      },
      {
        region: 'legacy-intl',
        regionLabel: zh('data.region.legacy-intl'),
        baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        note: zh('data.provider.bailian.endpointNote.legacy-intl'),
        legacy: true,
        keyRef: 'kms://maas-demo/bailian/ap-southeast-1',
        rpmLimit: 600,
        tpmLimit: 1_000_000,
        latencyMs: 450,
        health: 'healthy',
      },
      {
        region: 'legacy-cn',
        regionLabel: zh('data.region.legacy-cn'),
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        note: zh('data.provider.bailian.endpointNote.legacy-cn'),
        legacy: true,
        keyRef: 'kms://maas-demo/bailian/cn-beijing',
        rpmLimit: 600,
        tpmLimit: 1_000_000,
        latencyMs: 560,
        health: 'healthy',
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'OpenAI API',
    description: zh('data.provider.openai.description'),
    health: 'healthy',
    enabled: true,
    hints: [zh('data.provider.openai.hint.1')],
    endpoints: [
      {
        region: 'openai-global',
        regionLabel: zh('data.region.openai-global'),
        baseUrl: 'https://api.openai.com/v1',
        keyRef: 'kms://maas-demo/openai/global',
        rpmLimit: 5000,
        tpmLimit: 4_000_000,
        latencyMs: 620,
        health: 'healthy',
      },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    type: zh('data.provider.anthropic.type'),
    description: zh('data.provider.anthropic.description'),
    health: 'degraded',
    enabled: true,
    hints: [zh('data.provider.anthropic.hint.1')],
    endpoints: [
      {
        region: 'anthropic-global',
        regionLabel: zh('data.region.anthropic-global'),
        baseUrl: 'https://api.anthropic.com',
        keyRef: 'kms://maas-demo/anthropic/global',
        rpmLimit: 4000,
        tpmLimit: 2_000_000,
        latencyMs: 980,
        health: 'degraded',
      },
    ],
  },
  {
    id: 'google',
    name: 'Google',
    type: zh('data.provider.google.type'),
    description: zh('data.provider.google.description'),
    health: 'healthy',
    enabled: true,
    hints: [],
    endpoints: [
      {
        region: 'google-global',
        regionLabel: zh('data.region.google-global'),
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        keyRef: 'kms://maas-demo/google/global',
        rpmLimit: 2000,
        tpmLimit: 4_000_000,
        latencyMs: 540,
        health: 'healthy',
      },
    ],
  },
  {
    id: 'partner',
    name: zh('data.provider.partner.name'),
    type: zh('data.provider.partner.type'),
    description: zh('data.provider.partner.description'),
    health: 'healthy',
    enabled: true,
    hints: [zh('data.provider.partner.hint.1'), zh('data.provider.partner.hint.2')],
    endpoints: [
      {
        region: 'partner-global',
        regionLabel: zh('data.region.partner-global'),
        baseUrl: 'https://partner-adapter.internal.maas.example/v1',
        keyRef: 'kms://maas-demo/partner/global',
        rpmLimit: 300,
        tpmLimit: 100_000,
        latencyMs: 1800,
        health: 'healthy',
      },
    ],
  },
  {
    id: 'vllm',
    name: zh('data.provider.vllm.name'),
    type: zh('data.provider.vllm.type'),
    description: zh('data.provider.vllm.description'),
    health: 'healthy',
    enabled: true,
    local: true,
    capacity: {
      gpus: zh('data.provider.vllm.capacity.gpus'),
      nodes: 5,
      servingEngine: zh('data.provider.vllm.capacity.servingEngine'),
      /** 已連線機房的加權 GPU 利用率（與總覽一致；由部署推導） */
      utilization: 0.48,
      queueDepth: 8,
      kvCacheHitRate: 0.58,
      /** 尖峰總吞吐（tok/s）：Σ 就緒部署 tokPerSec × 副本，與 clusters.ts 的 tokPerSecPerGpu() 同一套估算（待 vllm bench serve 實測） */
      tokensPerSec: fleetPeakTokPerSec(),
      models: ['qwen3.8-27b', 'maas-assist-27b', 'gpt-oss-120b', 'llama-3.3-70b', 'llama-3.1-taide-lx-8b', 'qwen3-embedding-8b', 'embeddinggemma-300m'],
    },
    hints: [zh('data.provider.vllm.hint.1'), zh('data.provider.vllm.hint.2'), zh('data.provider.vllm.hint.3'), zh('data.provider.vllm.hint.4')],
    endpoints: [
      {
        region: 'tw-tpe-a',
        regionLabel: zh('data.region.tw-tpe-a'),
        baseUrl: 'https://gw-tpe-a.internal.example-maas.local/v1',
        keyRef: 'mtls://maas-demo/tpe-a',
        rpmLimit: 1200,
        tpmLimit: 1_800_000,
        latencyMs: 160,
        health: 'healthy',
      },
      {
        region: 'tw-hc-b',
        regionLabel: zh('data.region.tw-hc-b'),
        baseUrl: 'https://gw-hc-b.internal.example-maas.local/v1',
        note: zh('data.provider.vllm.endpointNote.tw-hc-b'),
        keyRef: 'mtls://maas-demo/hc-b',
        rpmLimit: 1600,
        tpmLimit: 2_400_000,
        latencyMs: 190,
        health: 'healthy',
      },
      {
        region: 'tw-tc-c',
        regionLabel: zh('data.region.tw-tc-c'),
        baseUrl: 'https://gw-tc-c.internal.example-maas.local/v1',
        note: zh('data.provider.vllm.endpointNote.tw-tc-c'),
        keyRef: 'mtls://maas-demo/tc-c',
        rpmLimit: 400,
        tpmLimit: 400_000,
        latencyMs: 240,
        health: 'degraded',
      },
    ],
  },
];

export const PROVIDER_BY_ID: Record<ProviderId, ProviderInfo> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, p]),
) as Record<ProviderId, ProviderInfo>;

export const HEALTH_LABELS: Record<HealthStatus, string> = {
  healthy: zh('data.HEALTH_LABELS.healthy'),
  degraded: zh('data.HEALTH_LABELS.degraded'),
  down: zh('data.HEALTH_LABELS.down'),
  unknown: zh('data.HEALTH_LABELS.unknown'),
};

export interface RouteTarget {
  providerId: ProviderId;
  region: string;
  modelId: string;
  weight: number;
}

/**
 * 溢出門檻（自建部署的飽和訊號；GPU 使用率不是好的訊號——decode 階段頻寬受限時 SM 使用率看起來不高但已飽和）：
 * - queueDepth：每副本等待中的請求數（vllm:num_requests_waiting ÷ 副本數）≥ 此值，示意 3–5
 * - kvCacheUsage：KV cache 使用率（vllm:gpu_cache_usage_perc，0–1）≥ 此值，示意 0.80–0.85
 * 兩者同時成立才溢出。
 */
export interface SpilloverThreshold {
  queueDepth: number;
  kvCacheUsage: number;
  /** @deprecated 舊欄位（GPU 使用率門檻），伺服器已不採用；UI 遷移到 kvCacheUsage 後移除 */
  gpuUtil?: number;
}

export interface ModelRoute {
  id: string;
  alias: string;
  /** zh-TW 說明；字典鍵 data.route.<alias>.description */
  description: string;
  /** 主要目標：自建優先（local-first）的別名只能有自建目標（權重合計 100），雲端只能經由 spillover */
  targets: RouteTarget[];
  fallbackChain: RouteTarget[];
  regionPolicy: 'prefer-intl' | 'prefer-cn' | 'any' | 'intl-only';
  /** 部署政策：我們的自建 GPU 與雲端代理之間的分流原則 */
  placementPolicy: 'local-first' | 'local-only' | 'cloud-first' | 'cost-aware';
  /**
   * 允許的目標區域白名單：targets／fallbackChain／spillover.target 的 region 都必須在此清單內，
   * 伺服器絕不把請求送到不在清單內的區域（例如 prefer-intl 的別名不會出現 cn-beijing）。
   */
  allowedRegions: string[];
  /** （舊欄位，保留相容）自建優先時的溢出門檻；新設定請用 spillover */
  overflow?: SpilloverThreshold;
  /**
   * 溢出（spillover，仿 Azure OpenAI PTU → Standard 的 spillover）：
   * 自建部署每副本等待佇列與 KV cache 使用率同時超過門檻時，把請求送到 target（雲端代理）；
   * 回應以 x-maas-served-by / x-maas-deployment / x-maas-model / x-maas-spillover-from 揭露。
   * 「僅自建」政策的路由 enabled 必為 false，容量耗盡時回 429 local_capacity_exhausted（Retry-After 15 秒）。
   * 租戶未簽署目標區域的跨境同意（Tenant.crossBorderConsent）時，即使路由允許溢出也視同僅自建。
   */
  spillover: { enabled: boolean; threshold: SpilloverThreshold; target: RouteTarget | null };
  retry: { maxAttempts: number; backoffMs: number };
  circuitBreaker: { errorRateThreshold: number; windowSec: number; cooldownSec: number };
  updatedAt: string;
  /** 路由是平台層資源：只有我們的平台擁有者（model.route.update）能更新 */
  updatedBy: string;
}

const T_LOCAL_FIRST: SpilloverThreshold = { queueDepth: 4, kvCacheUsage: 0.85 };
const T_LOCAL_ONLY: SpilloverThreshold = { queueDepth: 4, kvCacheUsage: 0.85 };
const T_EMBED: SpilloverThreshold = { queueDepth: 8, kvCacheUsage: 0.9 };

/** 阿里雲百煉國際站區域（不含中國站 cn-beijing） */
export const BAILIAN_INTL_REGIONS = ['ap-southeast-1', 'us-east-1', 'eu-central-1', 'ap-northeast-1', 'cn-hongkong'];
/** 中國站／中國大陸落地的區域：prefer-intl／intl-only 的路由一律不允許 */
export const CN_REGIONS = ['cn-beijing', 'legacy-cn'];

export const ROUTES: ModelRoute[] = [
  {
    id: 'route-qwen-plus',
    alias: 'qwen-plus',
    description: zh('data.route.qwen-plus.description'),
    targets: [{ providerId: 'vllm', region: 'tw-tpe-a', modelId: 'qwen3.8-27b-vllm', weight: 100 }],
    fallbackChain: [{ providerId: 'bailian', region: 'ap-southeast-1', modelId: 'qwen3.7-plus', weight: 100 }],
    regionPolicy: 'prefer-intl',
    placementPolicy: 'local-first',
    allowedRegions: ['tw-tpe-a', 'tw-hc-b', 'ap-southeast-1'],
    overflow: { ...T_LOCAL_FIRST },
    spillover: { enabled: true, threshold: { ...T_LOCAL_FIRST }, target: { providerId: 'bailian', region: 'ap-southeast-1', modelId: 'qwen3.7-plus', weight: 100 } },
    retry: { maxAttempts: 3, backoffMs: 400 },
    circuitBreaker: { errorRateThreshold: 0.2, windowSec: 60, cooldownSec: 30 },
    updatedAt: '2026-11-02T08:12:00+08:00',
    updatedBy: 'u-owner',
  },
  {
    id: 'route-risk-local',
    alias: 'risk-local',
    description: zh('data.route.risk-local.description'),
    targets: [{ providerId: 'vllm', region: 'tw-hc-b', modelId: 'qwen3.8-27b-vllm', weight: 100 }],
    fallbackChain: [],
    regionPolicy: 'intl-only',
    placementPolicy: 'local-only',
    allowedRegions: ['tw-hc-b'],
    spillover: { enabled: false, threshold: { ...T_LOCAL_ONLY }, target: null },
    retry: { maxAttempts: 2, backoffMs: 500 },
    circuitBreaker: { errorRateThreshold: 0.2, windowSec: 60, cooldownSec: 30 },
    updatedAt: '2026-10-20T10:00:00+08:00',
    updatedBy: 'u-owner',
  },
  {
    id: 'route-gov-chat',
    alias: 'gov-chat',
    description: zh('data.route.gov-chat.description'),
    targets: [{ providerId: 'vllm', region: 'tw-hc-b', modelId: 'gpt-oss-120b-vllm', weight: 100 }],
    fallbackChain: [],
    regionPolicy: 'intl-only',
    placementPolicy: 'local-only',
    allowedRegions: ['tw-hc-b'],
    spillover: { enabled: false, threshold: { queueDepth: 3, kvCacheUsage: 0.8 }, target: null },
    retry: { maxAttempts: 2, backoffMs: 500 },
    circuitBreaker: { errorRateThreshold: 0.2, windowSec: 60, cooldownSec: 30 },
    updatedAt: '2026-09-20T10:00:00+08:00',
    updatedBy: 'u-owner',
  },
  {
    id: 'route-embed-local',
    alias: 'embedding-local',
    description: zh('data.route.embedding-local.description'),
    targets: [{ providerId: 'vllm', region: 'tw-tpe-a', modelId: 'qwen3-embedding-8b-vllm', weight: 100 }],
    fallbackChain: [],
    regionPolicy: 'any',
    placementPolicy: 'local-only',
    allowedRegions: ['tw-tpe-a'],
    spillover: { enabled: false, threshold: { ...T_EMBED }, target: null },
    retry: { maxAttempts: 3, backoffMs: 200 },
    circuitBreaker: { errorRateThreshold: 0.3, windowSec: 60, cooldownSec: 30 },
    updatedAt: '2026-10-12T11:30:00+08:00',
    updatedBy: 'u-owner',
  },
  {
    id: 'route-gov-embed',
    alias: 'gov-embedding',
    description: zh('data.route.gov-embedding.description'),
    targets: [{ providerId: 'vllm', region: 'tw-hc-b', modelId: 'embeddinggemma-300m-vllm', weight: 100 }],
    fallbackChain: [],
    regionPolicy: 'any',
    placementPolicy: 'local-only',
    allowedRegions: ['tw-hc-b'],
    spillover: { enabled: false, threshold: { ...T_EMBED }, target: null },
    retry: { maxAttempts: 3, backoffMs: 200 },
    circuitBreaker: { errorRateThreshold: 0.3, windowSec: 60, cooldownSec: 30 },
    updatedAt: '2026-09-20T10:30:00+08:00',
    updatedBy: 'u-owner',
  },
  {
    id: 'route-qwen-max',
    alias: 'qwen-max',
    description: zh('data.route.qwen-max.description'),
    targets: [
      { providerId: 'bailian', region: 'ap-southeast-1', modelId: 'qwen3.8-max', weight: 70 },
      { providerId: 'bailian', region: 'ap-northeast-1', modelId: 'qwen3.8-max', weight: 30 },
    ],
    fallbackChain: [{ providerId: 'bailian', region: 'cn-hongkong', modelId: 'qwen3.8-max', weight: 100 }],
    regionPolicy: 'intl-only',
    placementPolicy: 'cloud-first',
    allowedRegions: ['ap-southeast-1', 'ap-northeast-1', 'cn-hongkong'],
    spillover: { enabled: false, threshold: { ...T_LOCAL_FIRST }, target: null },
    retry: { maxAttempts: 2, backoffMs: 600 },
    circuitBreaker: { errorRateThreshold: 0.15, windowSec: 60, cooldownSec: 60 },
    updatedAt: '2026-10-28T15:40:00+08:00',
    updatedBy: 'u-owner',
  },
  {
    id: 'route-fast',
    alias: 'fast-chat',
    description: zh('data.route.fast-chat.description'),
    targets: [
      { providerId: 'bailian', region: 'ap-southeast-1', modelId: 'qwen3.8-flash', weight: 60 },
      { providerId: 'anthropic', region: 'anthropic-global', modelId: 'claude-haiku-4.5', weight: 40 },
    ],
    fallbackChain: [{ providerId: 'google', region: 'google-global', modelId: 'gemini-2.5-flash', weight: 100 }],
    regionPolicy: 'any',
    placementPolicy: 'cloud-first',
    allowedRegions: ['ap-southeast-1', 'anthropic-global', 'google-global'],
    spillover: { enabled: false, threshold: { ...T_LOCAL_FIRST }, target: null },
    retry: { maxAttempts: 3, backoffMs: 200 },
    circuitBreaker: { errorRateThreshold: 0.25, windowSec: 30, cooldownSec: 20 },
    updatedAt: '2026-11-05T10:05:00+08:00',
    updatedBy: 'u-owner',
  },
  {
    id: 'route-coder',
    alias: 'coder',
    description: zh('data.route.coder.description'),
    targets: [{ providerId: 'bailian', region: 'ap-southeast-1', modelId: 'qwen3-coder-plus', weight: 100 }],
    fallbackChain: [{ providerId: 'anthropic', region: 'anthropic-global', modelId: 'claude-sonnet-4.5', weight: 100 }],
    regionPolicy: 'prefer-intl',
    placementPolicy: 'cloud-first',
    allowedRegions: ['ap-southeast-1', 'anthropic-global'],
    spillover: { enabled: false, threshold: { ...T_LOCAL_FIRST }, target: null },
    retry: { maxAttempts: 2, backoffMs: 500 },
    circuitBreaker: { errorRateThreshold: 0.2, windowSec: 60, cooldownSec: 45 },
    updatedAt: '2026-10-30T09:20:00+08:00',
    updatedBy: 'u-owner',
  },
  {
    id: 'route-embed',
    alias: 'embedding',
    description: zh('data.route.embedding.description'),
    targets: [{ providerId: 'bailian', region: 'ap-southeast-1', modelId: 'text-embedding-v4', weight: 100 }],
    fallbackChain: [],
    regionPolicy: 'prefer-intl',
    placementPolicy: 'cloud-first',
    allowedRegions: ['ap-southeast-1'],
    spillover: { enabled: false, threshold: { ...T_EMBED }, target: null },
    retry: { maxAttempts: 3, backoffMs: 300 },
    circuitBreaker: { errorRateThreshold: 0.3, windowSec: 60, cooldownSec: 30 },
    updatedAt: '2026-10-12T11:00:00+08:00',
    updatedBy: 'u-owner',
  },
];

export const PLACEMENT_POLICY_LABELS: Record<ModelRoute['placementPolicy'], string> = {
  'local-first': zh('data.PLACEMENT_POLICY_LABELS.local-first'),
  'local-only': zh('data.PLACEMENT_POLICY_LABELS.local-only'),
  'cloud-first': zh('data.PLACEMENT_POLICY_LABELS.cloud-first'),
  'cost-aware': zh('data.PLACEMENT_POLICY_LABELS.cost-aware'),
};

export const REGION_POLICY_LABELS: Record<ModelRoute['regionPolicy'], string> = {
  'prefer-intl': zh('data.REGION_POLICY_LABELS.prefer-intl'),
  'prefer-cn': zh('data.REGION_POLICY_LABELS.prefer-cn'),
  any: zh('data.REGION_POLICY_LABELS.any'),
  'intl-only': zh('data.REGION_POLICY_LABELS.intl-only'),
};
