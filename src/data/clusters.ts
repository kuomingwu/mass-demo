// 示範資料：我們（平台供應商）自有的 GPU 推論叢集（機房）、節點池、節點、模型部署與事件。
// 叢集是平台層資源（/clusters/{c}），不屬於任何客戶；客戶（租戶）透過我們的 OpenAI 相容 API 使用部署在這些 GPU 上的模型，我們向客戶收費。
// 所有名稱、GPU 數量、指標皆為虛構示範資料；指標欄位命名對齊 DCGM Exporter（DCGM_FI_PROF_GR_ENGINE_ACTIVE 等）。
import { hasKey, zh } from '../i18n/core';
import type { TParams } from '../i18n/types';
import { MODEL_BY_ID, estimateDeploymentVramGb, type ModelInfo, type Quantization } from './models';

/**
 * 叢集狀態機（仿 NVIDIA Run:ai／ACK One 註冊叢集）：
 * waiting（等待加入）→ connected（已連線）；通訊中斷 → disconnected；代理程式／推論服務異常 → service-issues；
 * 缺少 GPU Operator、DCGM 等前置條件 → missing-prereqs。
 */
export type ClusterStatus = 'waiting' | 'connected' | 'disconnected' | 'service-issues' | 'missing-prereqs';

export const CLUSTER_STATUS_LABELS: Record<ClusterStatus, string> = {
  waiting: zh('data.CLUSTER_STATUS_LABELS.waiting'),
  connected: zh('data.CLUSTER_STATUS_LABELS.connected'),
  disconnected: zh('data.CLUSTER_STATUS_LABELS.disconnected'),
  'service-issues': zh('data.CLUSTER_STATUS_LABELS.service-issues'),
  'missing-prereqs': zh('data.CLUSTER_STATUS_LABELS.missing-prereqs'),
};

export type InferenceEngine = 'vLLM' | 'SGLang' | 'TensorRT-LLM';

export interface GpuSpec {
  /** 每張 GPU 的 VRAM（GB） */
  vramGb: number;
  /**
   * 參考吞吐：27B 稠密模型、FP8、單卡、高並行（≥ 128 seqs）時每張 GPU 的總 tok/s（prefill + decode 合計）。
   * 所有 tok/s 換算（部署容量、GPU 時數折算、內部成本、供應商容量）都從這裡經 tokPerSecPerGpu() 推導，不另設常數。
   * 數值取研究筆記區間上緣（27B FP8 on H100 ≈ 2–4k；70B FP8 on H200 ≈ 1.9–3.3k）——待 vllm bench serve 實測後更新。
   */
  refTokPerSec: number;
  /** 是否支援 MIG 切分 */
  mig: boolean;
}

export const GPU_SPECS: Record<string, GpuSpec> = {
  'H100 80GB': { vramGb: 80, refTokPerSec: 4_000, mig: true },
  'H200 141GB': { vramGb: 141, refTokPerSec: 5_500, mig: true },
  'A100 80GB': { vramGb: 80, refTokPerSec: 2_000, mig: true },
  'L40S 48GB': { vramGb: 48, refTokPerSec: 1_100, mig: false },
  'RTX 6000 Ada 48GB': { vramGb: 48, refTokPerSec: 1_000, mig: false },
};

export const GPU_TYPES = Object.keys(GPU_SPECS);

/** 量化對吞吐的影響（記憶體頻寬受限：位元組越少越快；示範係數，待 vllm bench serve 實測） */
export const QUANT_THROUGHPUT_FACTOR: Record<Quantization, number> = { BF16: 0.7, FP8: 1, INT4: 1.15 };
/** 張量平行的擴展效率（通訊開銷）：1 卡 1.0、2 卡 0.9、≥ 4 卡 0.8 */
export function tensorParallelEfficiency(gpusPerReplica: number): number {
  return gpusPerReplica <= 1 ? 1 : gpusPerReplica === 2 ? 0.9 : 0.8;
}

type ThroughputModel = Pick<ModelInfo, 'paramsB' | 'activeParamsB' | 'capabilities'>;

/**
 * 單一吞吐查表：tokPerSecPerGpu(modelId | paramsB | model, gpuType, quant) → 每張 GPU 的 tok/s。
 * - 稠密模型：ref × (27 ÷ 參數量)^0.8（頻寬受限，非完全線性），小模型上限 4×（變成 overhead／compute 受限）。
 * - MoE：以啟用參數量計，再乘 0.6（專家路由／all-to-all 開銷）。
 * - 嵌入／重排序：只有 prefill、沒有逐 token 解碼，吞吐遠高於生成模型：ref × min(16, 27 ÷ 參數量) × 3
 *   （8B 嵌入 on H100 BF16 ≈ 28k tok/s，與 FLOPs 估算一致）。
 *   （避免 min(4, 27/paramsB) 的生成模型上限套到嵌入模型而算出荒謬的負毛利）
 * - 量化：BF16 0.7、FP8 1.0、INT4 1.15。
 * 全部為示範估算，待 vllm bench serve 實測後以實測值覆寫（Deployment.tokPerSec 可由代理程式回報）。
 */
export function tokPerSecPerGpu(model: string | number | ThroughputModel, gpuType: string, quant: Quantization): number {
  const spec = GPU_SPECS[gpuType];
  if (!spec) return 0;
  let paramsB: number;
  let activeB: number;
  let embedding = false;
  if (typeof model === 'number') {
    paramsB = model;
    activeB = model;
  } else {
    const m = typeof model === 'string' ? MODEL_BY_ID[model] : model;
    if (!m || !m.paramsB) return 0;
    paramsB = m.paramsB;
    activeB = m.activeParamsB ?? m.paramsB;
    embedding = m.capabilities.some((c) => c === 'embedding' || c === 'rerank');
  }
  if (paramsB <= 0) return 0;
  const q = QUANT_THROUGHPUT_FACTOR[quant] ?? 1;
  if (embedding) return Math.round(spec.refTokPerSec * Math.min(16, 27 / paramsB) * 3 * q);
  const moe = activeB < paramsB;
  const ratio = Math.min(4, 27 / activeB) ** 0.8;
  return Math.round(spec.refTokPerSec * ratio * (moe ? 0.6 : 1) * q);
}

/** 每副本 tok/s ＝ 每卡 tok/s × 每副本 GPU 數 × 張量平行效率 */
export function tokPerSecPerReplica(model: string | number | ThroughputModel, gpuType: string, quant: Quantization, gpusPerReplica: number): number {
  const g = Math.max(1, gpusPerReplica);
  return Math.round(tokPerSecPerGpu(model, gpuType, quant) * g * tensorParallelEfficiency(g));
}
export const ENGINES: InferenceEngine[] = ['vLLM', 'SGLang', 'TensorRT-LLM'];

/** 專屬部署的 GPU 時數牌價（USD／GPU-hr，示意；可在設定 → 帳務調整） */
export const DEFAULT_GPU_LIST_USD_PER_HOUR: Record<string, number> = {
  'H100 80GB': 3.9,
  'H200 141GB': 4.9,
  'A100 80GB': 2.5,
  'L40S 48GB': 1.4,
  'RTX 6000 Ada 48GB': 1.2,
};

/** 我們自己的 GPU 全成本（TCO：折舊＋電力＋機房＋維運，USD／GPU-hr，示意；研究筆記：自有 H100 全成本約 US$1.7–3.6／GPU-hr；可在設定 → 帳務調整） */
export const DEFAULT_GPU_COST_USD_PER_HOUR: Record<string, number> = {
  'H100 80GB': 2.0,
  'H200 141GB': 2.4,
  'A100 80GB': 1.3,
  'L40S 48GB': 0.6,
  'RTX 6000 Ada 48GB': 0.6,
};

/** 節點池：共用（所有租戶的共用部署）或專屬（保留給某一客戶的專屬部署） */
export type PoolSharing = 'shared' | 'dedicated';

export const SHARING_LABELS: Record<PoolSharing, string> = {
  shared: zh('data.SHARING_LABELS.shared'),
  dedicated: zh('data.SHARING_LABELS.dedicated'),
};

export interface NodePool {
  id: string;
  /** zh-TW 名稱；nameKey／nameParams 存在時 UI 以 keyedText(t, name, nameKey, nameParams) 顯示目前語言 */
  name: string;
  nameKey?: string;
  nameParams?: TParams;
  gpuType: string;
  sharing: PoolSharing;
  /** 專屬節點池保留給哪個租戶 */
  dedicatedTenantId?: string;
}

export interface Cluster {
  id: string;
  name: string;
  /** 機房／位置（我們的；zh-TW） */
  site: string;
  /** site 的字典鍵（data.cluster.<id>.site）；使用者註冊的機房沒有 */
  siteKey?: string;
  /** 模型目錄／路由使用的區域代碼 */
  region: string;
  status: ClusterStatus;
  k8sVersion: string;
  gpuType: string;
  nodeCount: number;
  gpuTotal: number;
  gpuAllocated: number;
  /** DCGM_FI_PROF_GR_ENGINE_ACTIVE 的叢集平均（0–1） */
  gpuUtil: number;
  /** 推論引擎（主要） */
  engine: InferenceEngine;
  agentVersion: string;
  lastHeartbeat: string | null;
  /** 佇列深度（所有部署合計，vllm:num_requests_waiting） */
  queueDepth: number;
  nodePools: NodePool[];
  /** 代理程式加入資訊：由 registerCluster 產生；加入完成後 token 作廢 */
  agentInstallCommand?: string;
  oneTimeToken?: string | null;
  tokenExpiresAt?: string;
  createdAt: string;
  createdBy: string;
}

export type NodeStatus = 'ready' | 'draining' | 'drained' | 'not-ready';

export const NODE_STATUS_LABELS: Record<NodeStatus, string> = {
  ready: zh('data.NODE_STATUS_LABELS.ready'),
  draining: zh('data.NODE_STATUS_LABELS.draining'),
  drained: zh('data.NODE_STATUS_LABELS.drained'),
  'not-ready': zh('data.NODE_STATUS_LABELS.not-ready'),
};

export interface GpuNode {
  id: string;
  clusterId: string;
  /** 所屬節點池 */
  poolId: string;
  name: string;
  gpuType: string;
  gpuCount: number;
  gpuAllocated: number;
  /** 每張 GPU 記憶體（GB） */
  memoryGbPerGpu: number;
  /** 已用顯存（GB，DCGM_FI_DEV_FB_USED 合計） */
  memoryUsedGb: number;
  /** SM 使用率（DCGM_FI_PROF_GR_ENGINE_ACTIVE，0–1） */
  smActive: number;
  /** 閒置時間（分鐘；0 表示忙碌） */
  idleMinutes: number;
  status: NodeStatus;
  /** MIG 切分（唯讀顯示），例如 "7 × 1g.10gb" */
  mig?: string;
  agentVersion: string;
}

export type DeploymentStatus = 'creating' | 'ready' | 'scaled-to-zero' | 'error';

export const DEPLOYMENT_STATUS_LABELS: Record<DeploymentStatus, string> = {
  creating: zh('data.DEPLOYMENT_STATUS_LABELS.creating'),
  ready: zh('data.DEPLOYMENT_STATUS_LABELS.ready'),
  'scaled-to-zero': zh('data.DEPLOYMENT_STATUS_LABELS.scaled-to-zero'),
  error: zh('data.DEPLOYMENT_STATUS_LABELS.error'),
};

export interface Deployment {
  id: string;
  name: string;
  modelId: string;
  /** 部署所在的我們的叢集 */
  clusterId: string;
  /** 共用：服務所有方案允許此模型的租戶，按 token 牌價計費；專屬：只服務一位租戶，按 GPU 時數計費 */
  sharing: PoolSharing;
  dedicatedTenantId?: string;
  engine: InferenceEngine;
  quantization: Quantization;
  /** 每個副本使用的 GPU 數（張量平行） */
  gpusPerReplica: number;
  replicas: number;
  maxNumSeqs: number;
  /** 優先權排程（vLLM --scheduling-policy priority／SGLang --enable-priority-scheduling） */
  priorityScheduling: boolean;
  /** 以租戶／專案 ID 作 cache_salt 隔離前綴快取 */
  cacheSaltByTenant: boolean;
  autoscaling: { minReplicas: number; maxReplicas: number; metric: 'queue-depth' | 'concurrency'; scaleToZero: boolean };
  rollout: { strategy: 'canary' | 'blue-green'; canaryPercent: number };
  status: DeploymentStatus;
  /** 估算所需 VRAM（GB，每副本；權重 + KV cache 預留） */
  vramGb: number;
  /** 吞吐（tok/s，每副本；種子為 tokPerSecPerReplica() 估算，正式環境由代理程式回報實測） */
  tokPerSec: number;
  /** 實測利用率（0–1） */
  utilization: number;
  queueDepth: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  statusMessage?: string;
  /** statusMessage 的字典鍵與插補參數（UI 用 keyedText） */
  statusMessageKey?: string;
  statusMessageParams?: TParams;
  /**
   * 副本數變更歷史（含建立）：專屬部署 GPU 時數依此按分鐘比例計算，而非整個期間 × 目前副本數。
   * 省略時視為自 createdAt 起一直是目前副本數。
   */
  replicaHistory?: { at: string; replicas: number }[];
  /** 節點排空後尚待遷移的副本數（池內無可用 GPU 時） */
  pendingMigrationReplicas?: number;
  /** 專屬部署：建立時已明確允許借用共用節點池（寫入稽核）；擴縮沿用 */
  allowSharedFallback?: boolean;
}

export interface ClusterEvent {
  id: string;
  clusterId: string;
  timestamp: string;
  level: 'info' | 'warning' | 'error';
  /** zh-TW 訊息（測試用；UI 在有 messageKey 時優先顯示翻譯） */
  message: string;
  /** 可翻譯的訊息鍵（src/i18n/dict/<locale>/data.ts 或 server.ts）與插補參數 */
  messageKey?: string;
  params?: Record<string, string | number | boolean | null | undefined>;
  /** 對應稽核 requestId（若為控制台操作） */
  requestId?: string;
}

export const CONTROL_PLANE_HOST = 'https://control.example-maas.local';

/** 叢集 → 模型目錄／路由用的區域代碼 */
export const CLUSTER_REGION: Record<string, string> = {
  'cl-tpe-a': 'tw-tpe-a',
  'cl-hc-b': 'tw-hc-b',
  'cl-tc-c': 'tw-tc-c',
};

export const CLUSTERS: Cluster[] = [
  {
    id: 'cl-tpe-a',
    name: zh('data.cluster.cl-tpe-a.name'),
    site: zh('data.cluster.cl-tpe-a.site'),
    siteKey: 'data.cluster.cl-tpe-a.site',
    region: 'tw-tpe-a',
    status: 'connected',
    k8sVersion: 'v1.32.4',
    gpuType: 'H100 80GB',
    nodeCount: 2,
    gpuTotal: 8,
    gpuAllocated: 7,
    gpuUtil: 0.72,
    engine: 'vLLM',
    agentVersion: '1.8.2',
    lastHeartbeat: '2026-11-08T09:59:40+08:00',
    queueDepth: 6,
    nodePools: [{ id: 'pool-tpe-a-shared', name: zh('data.cluster.pool.sharedName'), nameKey: 'data.cluster.pool.sharedName', gpuType: 'H100 80GB', sharing: 'shared' }],
    oneTimeToken: null,
    createdAt: '2026-01-20T10:00:00+08:00',
    createdBy: 'u-cluster-ops',
  },
  {
    id: 'cl-hc-b',
    name: zh('data.cluster.cl-hc-b.name'),
    site: zh('data.cluster.cl-hc-b.site'),
    siteKey: 'data.cluster.cl-hc-b.site',
    region: 'tw-hc-b',
    status: 'connected',
    k8sVersion: 'v1.32.4',
    gpuType: 'H200 141GB',
    nodeCount: 2,
    gpuTotal: 16,
    gpuAllocated: 16,
    gpuUtil: 0.5,
    engine: 'vLLM',
    agentVersion: '1.8.2',
    lastHeartbeat: '2026-11-08T09:59:52+08:00',
    queueDepth: 2,
    nodePools: [
      { id: 'pool-hc-b-shared', name: zh('data.cluster.pool.sharedName'), nameKey: 'data.cluster.pool.sharedName', gpuType: 'H200 141GB', sharing: 'shared' },
      { id: 'pool-hc-b-union', name: zh('data.cluster.pool.dedicatedName', { tenant: '聯合金融' }), nameKey: 'data.cluster.pool.dedicatedName', nameParams: { tenant: '聯合金融' }, gpuType: 'H200 141GB', sharing: 'dedicated', dedicatedTenantId: 't-union' },
    ],
    oneTimeToken: null,
    createdAt: '2026-06-02T10:00:00+08:00',
    createdBy: 'u-cluster-ops',
  },
  {
    id: 'cl-tc-c',
    name: zh('data.cluster.cl-tc-c.name'),
    site: zh('data.cluster.cl-tc-c.site'),
    siteKey: 'data.cluster.cl-tc-c.site',
    region: 'tw-tc-c',
    status: 'service-issues',
    k8sVersion: 'v1.32.1',
    gpuType: 'L40S 48GB',
    nodeCount: 1,
    gpuTotal: 8,
    gpuAllocated: 0,
    gpuUtil: 0,
    engine: 'vLLM',
    agentVersion: '1.8.1',
    lastHeartbeat: '2026-11-08T09:58:10+08:00',
    queueDepth: 0,
    nodePools: [{ id: 'pool-tc-c-shared', name: zh('data.cluster.pool.sharedName'), nameKey: 'data.cluster.pool.sharedName', gpuType: 'L40S 48GB', sharing: 'shared' }],
    oneTimeToken: null,
    createdAt: '2026-09-10T10:00:00+08:00',
    createdBy: 'u-cluster-ops',
  },
];

export const NODES: GpuNode[] = [
  { id: 'n-tpe-a-01', clusterId: 'cl-tpe-a', poolId: 'pool-tpe-a-shared', name: 'tpe-a-gpu-01', gpuType: 'H100 80GB', gpuCount: 4, gpuAllocated: 4, memoryGbPerGpu: 80, memoryUsedGb: 262, smActive: 0.78, idleMinutes: 0, status: 'ready', agentVersion: '1.8.2' },
  { id: 'n-tpe-a-02', clusterId: 'cl-tpe-a', poolId: 'pool-tpe-a-shared', name: 'tpe-a-gpu-02', gpuType: 'H100 80GB', gpuCount: 4, gpuAllocated: 3, memoryGbPerGpu: 80, memoryUsedGb: 136, smActive: 0.64, idleMinutes: 0, status: 'ready', agentVersion: '1.8.2' },
  { id: 'n-hc-b-01', clusterId: 'cl-hc-b', poolId: 'pool-hc-b-shared', name: 'hc-b-gpu-01', gpuType: 'H200 141GB', gpuCount: 8, gpuAllocated: 8, memoryGbPerGpu: 141, memoryUsedGb: 612, smActive: 0.61, idleMinutes: 0, status: 'ready', agentVersion: '1.8.2' },
  { id: 'n-hc-b-02', clusterId: 'cl-hc-b', poolId: 'pool-hc-b-union', name: 'hc-b-gpu-02', gpuType: 'H200 141GB', gpuCount: 8, gpuAllocated: 8, memoryGbPerGpu: 141, memoryUsedGb: 278, smActive: 0.51, idleMinutes: 0, status: 'ready', mig: zh('data.node.n-hc-b-02.mig'), agentVersion: '1.8.2' },
  { id: 'n-tc-c-01', clusterId: 'cl-tc-c', poolId: 'pool-tc-c-shared', name: 'tc-c-gpu-01', gpuType: 'L40S 48GB', gpuCount: 8, gpuAllocated: 0, memoryGbPerGpu: 48, memoryUsedGb: 0, smActive: 0, idleMinutes: 94, status: 'not-ready', agentVersion: '1.8.1' },
];

type SeedDep = Omit<Deployment, 'vramGb' | 'tokPerSec'>;

/** 種子部署：vramGb 與 tokPerSec 一律由同一套估算函式推導（estimateDeploymentVramGb／tokPerSecPerReplica），不手填常數 */
function seedDep(d: SeedDep): Deployment {
  const m = MODEL_BY_ID[d.modelId];
  const gpuType = CLUSTERS.find((c) => c.id === d.clusterId)?.gpuType ?? 'H100 80GB';
  return {
    ...d,
    vramGb: estimateDeploymentVramGb(m, d.quantization, d.maxNumSeqs).totalGb,
    tokPerSec: tokPerSecPerReplica(m, gpuType, d.quantization, d.gpusPerReplica),
  };
}

/**
 * 部署利用率（DCGM_FI_PROF_GR_ENGINE_ACTIVE 滾動視窗）為用量種子的「供給側上限」：
 * usage.ts 以 tokPerSec × 副本 × 利用率 × 86400 產生每日 tokens，因此 Σ GPU-hr 一定 ≤ 配置 GPU × 小時數。
 */
export const DEPLOYMENTS: Deployment[] = [
  seedDep({
    id: 'dep-qwen27b-shared',
    name: 'tpe-a-qwen3.8-27b-fp8-shared',
    modelId: 'qwen3.8-27b-vllm',
    clusterId: 'cl-tpe-a',
    sharing: 'shared',
    engine: 'vLLM',
    quantization: 'FP8',
    gpusPerReplica: 2,
    replicas: 3,
    maxNumSeqs: 256,
    priorityScheduling: true,
    cacheSaltByTenant: true,
    autoscaling: { minReplicas: 2, maxReplicas: 4, metric: 'queue-depth', scaleToZero: false },
    rollout: { strategy: 'canary', canaryPercent: 10 },
    status: 'ready',
    utilization: 0.88,
    queueDepth: 6,
    createdAt: '2026-02-01T10:00:00+08:00',
    updatedAt: '2026-10-30T15:00:00+08:00',
    createdBy: 'u-cluster-ops',
    replicaHistory: [
      { at: '2026-02-01T10:00:00+08:00', replicas: 2 },
      { at: '2026-10-30T15:00:00+08:00', replicas: 3 },
    ],
  }),
  seedDep({
    id: 'dep-embed-shared',
    name: 'tpe-a-qwen3-embedding-8b-shared',
    modelId: 'qwen3-embedding-8b-vllm',
    clusterId: 'cl-tpe-a',
    sharing: 'shared',
    engine: 'vLLM',
    quantization: 'BF16',
    gpusPerReplica: 1,
    replicas: 1,
    maxNumSeqs: 512,
    priorityScheduling: false,
    cacheSaltByTenant: true,
    autoscaling: { minReplicas: 1, maxReplicas: 2, metric: 'concurrency', scaleToZero: false },
    rollout: { strategy: 'blue-green', canaryPercent: 0 },
    status: 'ready',
    utilization: 0.45,
    queueDepth: 0,
    createdAt: '2026-04-15T10:00:00+08:00',
    updatedAt: '2026-10-01T09:00:00+08:00',
    createdBy: 'u-cluster-ops',
  }),
  seedDep({
    id: 'dep-gptoss-shared',
    name: 'hc-b-gpt-oss-120b-mxfp4-shared',
    modelId: 'gpt-oss-120b-vllm',
    clusterId: 'cl-hc-b',
    sharing: 'shared',
    engine: 'vLLM',
    quantization: 'INT4',
    gpusPerReplica: 2,
    replicas: 2,
    maxNumSeqs: 192,
    priorityScheduling: true,
    cacheSaltByTenant: true,
    autoscaling: { minReplicas: 1, maxReplicas: 3, metric: 'queue-depth', scaleToZero: false },
    rollout: { strategy: 'blue-green', canaryPercent: 0 },
    status: 'ready',
    utilization: 0.62,
    queueDepth: 1,
    createdAt: '2026-06-15T10:00:00+08:00',
    updatedAt: '2026-10-20T09:00:00+08:00',
    createdBy: 'u-cluster-ops',
  }),
  seedDep({
    id: 'dep-llama70b-shared',
    name: 'hc-b-llama-3.3-70b-fp8-shared',
    modelId: 'llama-3.3-70b-vllm',
    clusterId: 'cl-hc-b',
    sharing: 'shared',
    engine: 'vLLM',
    quantization: 'FP8',
    gpusPerReplica: 2,
    replicas: 1,
    maxNumSeqs: 128,
    priorityScheduling: true,
    cacheSaltByTenant: true,
    autoscaling: { minReplicas: 1, maxReplicas: 2, metric: 'queue-depth', scaleToZero: false },
    rollout: { strategy: 'canary', canaryPercent: 10 },
    status: 'ready',
    utilization: 0.52,
    queueDepth: 0,
    createdAt: '2026-07-01T10:00:00+08:00',
    updatedAt: '2026-10-25T09:00:00+08:00',
    createdBy: 'u-cluster-ops',
  }),
  seedDep({
    id: 'dep-taide-shared',
    name: 'hc-b-llama-3.1-taide-lx-8b-bf16-shared',
    modelId: 'taide-lx-8b-vllm',
    clusterId: 'cl-hc-b',
    sharing: 'shared',
    engine: 'vLLM',
    quantization: 'BF16',
    gpusPerReplica: 1,
    replicas: 1,
    maxNumSeqs: 256,
    priorityScheduling: false,
    cacheSaltByTenant: true,
    autoscaling: { minReplicas: 1, maxReplicas: 2, metric: 'concurrency', scaleToZero: false },
    rollout: { strategy: 'blue-green', canaryPercent: 0 },
    status: 'ready',
    utilization: 0.33,
    queueDepth: 0,
    createdAt: '2026-08-10T10:00:00+08:00',
    updatedAt: '2026-10-10T09:00:00+08:00',
    createdBy: 'u-cluster-ops',
  }),
  seedDep({
    id: 'dep-gemma-embed-shared',
    name: 'hc-b-embeddinggemma-300m-shared',
    modelId: 'embeddinggemma-300m-vllm',
    clusterId: 'cl-hc-b',
    sharing: 'shared',
    engine: 'vLLM',
    quantization: 'BF16',
    gpusPerReplica: 1,
    replicas: 1,
    maxNumSeqs: 512,
    priorityScheduling: false,
    cacheSaltByTenant: true,
    autoscaling: { minReplicas: 1, maxReplicas: 1, metric: 'concurrency', scaleToZero: false },
    rollout: { strategy: 'blue-green', canaryPercent: 0 },
    status: 'ready',
    utilization: 0.03,
    queueDepth: 0,
    createdAt: '2026-09-15T10:30:00+08:00',
    updatedAt: '2026-09-15T10:30:00+08:00',
    createdBy: 'u-cluster-ops',
    statusMessage: zh('data.deployment.dep-gemma-embed-shared.statusMessage'),
    statusMessageKey: 'data.deployment.dep-gemma-embed-shared.statusMessage',
  }),
  seedDep({
    id: 'dep-union-assist-dedicated',
    name: 'hc-b-union-maas-assist-27b-dedicated',
    modelId: 'maas-assist-27b',
    clusterId: 'cl-hc-b',
    sharing: 'dedicated',
    dedicatedTenantId: 't-union',
    engine: 'vLLM',
    quantization: 'FP8',
    gpusPerReplica: 2,
    replicas: 2,
    maxNumSeqs: 128,
    priorityScheduling: true,
    cacheSaltByTenant: true,
    autoscaling: { minReplicas: 1, maxReplicas: 3, metric: 'concurrency', scaleToZero: false },
    rollout: { strategy: 'canary', canaryPercent: 20 },
    status: 'ready',
    utilization: 0.44,
    queueDepth: 0,
    createdAt: '2026-09-01T10:00:00+08:00',
    updatedAt: '2026-10-28T09:00:00+08:00',
    createdBy: 'u-cluster-ops',
  }),
  seedDep({
    id: 'dep-union-qwen27b-dedicated',
    name: 'hc-b-union-qwen3.8-27b-risk-dedicated',
    modelId: 'qwen3.8-27b-vllm',
    clusterId: 'cl-hc-b',
    sharing: 'dedicated',
    dedicatedTenantId: 't-union',
    engine: 'vLLM',
    quantization: 'FP8',
    gpusPerReplica: 2,
    replicas: 2,
    maxNumSeqs: 192,
    priorityScheduling: true,
    cacheSaltByTenant: true,
    autoscaling: { minReplicas: 1, maxReplicas: 2, metric: 'queue-depth', scaleToZero: false },
    rollout: { strategy: 'blue-green', canaryPercent: 0 },
    status: 'ready',
    utilization: 0.58,
    queueDepth: 1,
    createdAt: '2026-04-20T10:00:00+08:00',
    updatedAt: '2026-09-28T09:00:00+08:00',
    createdBy: 'u-cluster-ops',
    replicaHistory: [
      { at: '2026-04-20T10:00:00+08:00', replicas: 1 },
      { at: '2026-09-28T09:00:00+08:00', replicas: 2 },
    ],
  }),
  seedDep({
    id: 'dep-coder-c',
    name: 'tc-c-qwen3-coder-30b-a3b-fp8',
    modelId: 'qwen3-coder-30b-a3b-vllm',
    clusterId: 'cl-tc-c',
    sharing: 'shared',
    engine: 'vLLM',
    quantization: 'FP8',
    gpusPerReplica: 1,
    replicas: 0,
    maxNumSeqs: 128,
    priorityScheduling: false,
    cacheSaltByTenant: true,
    autoscaling: { minReplicas: 0, maxReplicas: 2, metric: 'queue-depth', scaleToZero: true },
    rollout: { strategy: 'canary', canaryPercent: 0 },
    status: 'scaled-to-zero',
    utilization: 0,
    queueDepth: 0,
    createdAt: '2026-08-01T10:00:00+08:00',
    updatedAt: '2026-11-06T02:00:00+08:00',
    createdBy: 'u-cluster-ops',
    statusMessage: zh('data.deployment.dep-coder-c.statusMessage'),
    statusMessageKey: 'data.deployment.dep-coder-c.statusMessage',
  }),
];

/** 叢集的即時 GPU 利用率由其就緒部署推導：Σ(副本 × 每副本 GPU × 部署利用率) ÷ 叢集 GPU 總數（含閒置 GPU，因此低於部署利用率） */
export function clusterUtilFromDeployments(cluster: Pick<Cluster, 'id' | 'gpuTotal'>, deployments: Deployment[]): number {
  if (!cluster.gpuTotal) return 0;
  const busy = deployments.filter((d) => d.clusterId === cluster.id && d.status === 'ready').reduce((s, d) => s + d.replicas * d.gpusPerReplica * d.utilization, 0);
  return Math.round(Math.min(1, busy / cluster.gpuTotal) * 1000) / 1000;
}

/** 自建推論層的尖峰總吞吐（tok/s）：所有就緒部署的 tokPerSec × 副本（供應商頁容量摘要用） */
export function fleetPeakTokPerSec(deployments: Deployment[] = DEPLOYMENTS): number {
  return deployments.filter((d) => d.status === 'ready').reduce((s, d) => s + d.tokPerSec * d.replicas, 0);
}

export const CLUSTER_EVENTS: ClusterEvent[] = [
  { id: 'ev-1', clusterId: 'cl-tpe-a', timestamp: '2026-11-08T09:59:40+08:00', level: 'info', message: zh('data.cluster.event.ev-1'), messageKey: 'data.cluster.event.ev-1' },
  { id: 'ev-2', clusterId: 'cl-tpe-a', timestamp: '2026-11-08T08:12:00+08:00', level: 'warning', message: zh('data.cluster.event.ev-2'), messageKey: 'data.cluster.event.ev-2' },
  { id: 'ev-3', clusterId: 'cl-tpe-a', timestamp: '2026-11-06T02:00:00+08:00', level: 'info', message: zh('data.cluster.event.ev-3'), messageKey: 'data.cluster.event.ev-3' },
  { id: 'ev-4', clusterId: 'cl-hc-b', timestamp: '2026-11-08T09:59:52+08:00', level: 'info', message: zh('data.cluster.event.ev-4'), messageKey: 'data.cluster.event.ev-4' },
  { id: 'ev-5', clusterId: 'cl-hc-b', timestamp: '2026-10-28T09:00:00+08:00', level: 'info', message: zh('data.cluster.event.ev-5'), messageKey: 'data.cluster.event.ev-5' },
  { id: 'ev-6', clusterId: 'cl-tc-c', timestamp: '2026-11-08T09:58:10+08:00', level: 'error', message: zh('data.cluster.event.ev-6'), messageKey: 'data.cluster.event.ev-6' },
  { id: 'ev-7', clusterId: 'cl-tc-c', timestamp: '2026-11-06T02:00:00+08:00', level: 'info', message: zh('data.cluster.event.ev-7'), messageKey: 'data.cluster.event.ev-7' },
  { id: 'ev-8', clusterId: 'cl-hc-b', timestamp: '2026-11-08T09:40:00+08:00', level: 'info', message: zh('data.cluster.event.ev-8'), messageKey: 'data.cluster.event.ev-8' },
];

export const DEPLOYMENT_BY_ID: Record<string, Deployment> = Object.fromEntries(DEPLOYMENTS.map((d) => [d.id, d]));

/** 以模型 ID 找到服務它的部署 */
export function deploymentsForModel(modelId: string, list: Deployment[] = DEPLOYMENTS): Deployment[] {
  return list.filter((d) => d.modelId === modelId);
}

export const DEFAULT_MAX_NUM_SEQS = 128;

export interface VramFitResult {
  ok: boolean;
  /** 不適配的原因代碼：INSUFFICIENT_VRAM／QUANT_NOT_SUPPORTED／NOT_DEPLOYABLE／UNKNOWN_GPU */
  code?: 'INSUFFICIENT_VRAM' | 'QUANT_NOT_SUPPORTED' | 'NOT_DEPLOYABLE' | 'UNKNOWN_GPU';
  requiredGb: number;
  weightsGb: number;
  kvGb: number;
  availableGb: number;
  /** zh-TW 訊息（伺服器 message 用）；UI 以 keyedText(t, message, messageKey, params) 顯示目前語言 */
  message: string;
  messageKey: string;
  params: TParams;
}

/**
 * VRAM 適配檢查：所需 VRAM ＝ 權重（參數量 × 量化位元組 × 1.15）+ KV cache 預留
 * （kvBytesPerToken × KV dtype × (max_model_len + (max_num_seqs − 1) × 1k)）是否 ≤ 每副本 GPU 數 × 單卡 VRAM。
 * 例：27B BF16、131k、128 seqs ≈ 62 + 66 = 128 GB → 1 × H100 80GB 放不下（需 FP8 或 2 卡）；27B FP8 128 seqs ≈ 31 + 33 = 64 GB → 1 × H100 可。
 * gpt-oss-120b 只有原生 MXFP4 權重，其他量化回 QUANT_NOT_SUPPORTED。
 */
/** 模型顯示名稱參數：有 data.model.<id>.displayName 鍵時以 '@鍵' 傳遞（以目前語言解析），否則用原名 */
function modelNameParam(m: Pick<ModelInfo, 'id' | 'displayName'>): string {
  const k = `data.model.${m.id}.displayName`;
  return hasKey('zh-TW', k) ? `@${k}` : m.displayName;
}

function fitMsg(key: string, params: TParams): { message: string; messageKey: string; params: TParams } {
  const messageKey = `data.cluster.vramFit.${key}`;
  return { message: zh(messageKey, params), messageKey, params };
}

export function vramFit(modelId: string, quant: Quantization, gpuType: string, gpusPerReplica: number, maxNumSeqs: number = DEFAULT_MAX_NUM_SEQS, maxModelLen?: number): VramFitResult {
  const m = MODEL_BY_ID[modelId];
  const spec = GPU_SPECS[gpuType];
  if (!m || !m.paramsB || !m.deployable) return { ok: false, code: 'NOT_DEPLOYABLE', requiredGb: 0, weightsGb: 0, kvGb: 0, availableGb: 0, ...fitMsg('notDeployable', { modelId }) };
  if (!spec) return { ok: false, code: 'UNKNOWN_GPU', requiredGb: 0, weightsGb: 0, kvGb: 0, availableGb: 0, ...fitMsg('unknownGpu', { gpuType }) };
  const availableGb = spec.vramGb * Math.max(1, gpusPerReplica);
  if (m.allowedQuantizations && !m.allowedQuantizations.includes(quant)) {
    return { ok: false, code: 'QUANT_NOT_SUPPORTED', requiredGb: 0, weightsGb: 0, kvGb: 0, availableGb, ...fitMsg('quantNotSupported', { model: modelNameParam(m), allowed: m.allowedQuantizations.join('／'), quant }) };
  }
  const ctx = maxModelLen ?? m.maxModelLen ?? m.contextLength;
  const est = estimateDeploymentVramGb(m, quant, maxNumSeqs, ctx);
  const ok = est.totalGb <= availableGb;
  return {
    ok,
    code: ok ? undefined : 'INSUFFICIENT_VRAM',
    requiredGb: est.totalGb,
    weightsGb: est.weightsGb,
    kvGb: est.kvGb,
    availableGb,
    ...fitMsg(ok ? 'ok' : 'insufficient', { model: modelNameParam(m), quant, total: est.totalGb, weights: est.weightsGb, kv: est.kvGb, seqs: maxNumSeqs, ctx: ctx.toLocaleString(), available: availableGb, gpus: gpusPerReplica, gpuType }),
  };
}

/** 達到目標毛利所需的利用率：u* ＝ 100% 利用率的內部成本 ÷ (混合牌價 × (1 − 目標毛利))；> 1 表示以此牌價無法達標 */
export function utilizationForTargetMargin(floorUsdPerMTok: number, listBlendedUsdPerMTok: number, targetMargin = 0.4): number | null {
  if (listBlendedUsdPerMTok <= 0 || floorUsdPerMTok <= 0) return null;
  return Math.round((floorUsdPerMTok / (listBlendedUsdPerMTok * (1 - targetMargin))) * 1000) / 1000;
}

/**
 * 我們的內部推論成本（USD／百萬 tokens）：GPU 時價（TCO）× 每副本 GPU 數 ÷ (tok/s × 利用率 × 3600) × 1e6
 * （OpenCost 1.121 的 allocation-based 公式；利用率來自 DCGM_FI_PROF_GR_ENGINE_ACTIVE 滾動視窗）
 * 用於平台財務的「成本 vs 定價 vs 毛利」檢視，不是向客戶收費的依據（向客戶收的是 token 牌價或專屬 GPU 時數）。
 */
export function internalUnitPrice(gpuHourlyUsd: number, gpusPerReplica: number, tokPerSec: number, utilization: number): number {
  const u = Math.max(0.05, Math.min(1, utilization));
  if (tokPerSec <= 0) return 0;
  return ((gpuHourlyUsd * gpusPerReplica) / (tokPerSec * u * 3600)) * 1e6;
}

/** 混合牌價（USD／百萬 tokens）：以 70% 輸入 + 30% 輸出加權，供毛利比較用；嵌入模型（無輸出）取輸入牌價 */
export function blendedListPrice(priceInput: number, priceOutput: number): number {
  if (priceOutput <= 0) return priceInput;
  return priceInput * 0.7 + priceOutput * 0.3;
}

/** 毛利率（0–1）：(牌價 − 內部成本) ÷ 牌價 */
export function grossMargin(listUsdPerMTok: number, internalUsdPerMTok: number): number {
  if (listUsdPerMTok <= 0) return 0;
  return (listUsdPerMTok - internalUsdPerMTok) / listUsdPerMTok;
}
