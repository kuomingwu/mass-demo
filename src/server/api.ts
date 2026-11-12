// 模擬後端 API（控制面）：每個函式皆於「伺服器端」進行授權檢查並寫入稽核紀錄
// UI 只能透過此模組存取資料；UI 的按鈕隱藏／停用僅為可用性考量，不構成安全邊界。
// 情境：我們（平台供應商）擁有 GPU 機房；客戶（租戶）透過我們的 OpenAI 相容 API 使用部署在我們 GPU 上的模型，我們向客戶收費；
// 公有雲模型 API（阿里雲百煉、OpenAI、Anthropic、Google）只作代理／溢出。
import type { Action, Decision, Principal, RoleAssignment, RoleId } from '../auth/types';
import { ALL_ACTIONS } from '../auth/types';
import { ROLES, VENDOR_ROLES } from '../auth/roles';
import { can, canAnywhere, delegationScopes, highestRank, isWithinDelegation } from '../auth/policy';
import { clusterScope, isAncestorOrSelf, isValidScope, normalizeScope, projectScope, tenantIdOfScope, tenantScope, PLATFORM_SCOPE } from '../auth/scope';
import { AuditStore, newRequestId, type AuditEvent } from './audit';
import { API_KEYS, ASSIGNMENTS, GROUPS, PROJECTS, SERVICE_PRINCIPALS, TENANTS, USERS, PUBLIC_SECTOR_NOTE, PLATFORM_NOTE, type ApiKey, type DataClass, type Project, type Tenant, type TenantPlan, type TierPolicy } from './seed';
import {
  DEFAULT_CACHE_READ_MULTIPLIER,
  DEFAULT_CACHE_WRITE_MULTIPLIER,
  DEFAULT_CLOUD_MARKUP_PCT,
  DEFAULT_NEGOTIATED_DISCOUNT_PCT,
  DEFAULT_PROXY_DISCOUNT_PCT,
  DEFAULT_RETENTION,
  LOW_BALANCE_DEFAULT_USD,
  TOPUP_MAX_USD,
  TOPUP_MIN_USD,
  customerPriceFactor,
  nextTier,
  proxyKindOf,
  tierForSpend,
  vendorCostFactor,
  type BillingMode,
  type ProxyKind,
  type RateLimitTier,
  type RetentionPolicy,
} from '../data/commercial';
import type { ProviderId, Quantization } from '../data/models';
import { MODELS, MODEL_BY_ID, PLATFORM_BASE_URL, UNIT_TYPE_LABELS, isMediaModality, isQwen3x, isLocalModel, originOfModel, type ModelInfo } from '../data/models';
import { CN_REGIONS, PROVIDERS, ROUTES, type ModelRoute, type ProviderInfo, type RouteTarget, type SpilloverThreshold } from '../data/providers';
import {
  CLUSTERS,
  CLUSTER_EVENTS,
  CLUSTER_REGION,
  CONTROL_PLANE_HOST,
  DEFAULT_GPU_COST_USD_PER_HOUR,
  DEFAULT_GPU_LIST_USD_PER_HOUR,
  DEPLOYMENTS,
  GPU_SPECS,
  NODES,
  blendedListPrice,
  clusterUtilFromDeployments,
  grossMargin,
  internalUnitPrice,
  tokPerSecPerGpu,
  tokPerSecPerReplica,
  utilizationForTargetMargin,
  vramFit,
  type Cluster,
  type ClusterEvent,
  type Deployment,
  type GpuNode,
  type InferenceEngine,
  type NodePool,
  type PoolSharing,
} from '../data/clusters';
import { generateHourly, generateUsage, type HourlyPoint, type UsageRecord, type UsageTier } from './usage';
import { translate, zh } from '../i18n/core';
import type { Locale, TParams } from '../i18n/types';

/**
 * 可翻譯文字：字典鍵（src/i18n/dict/<locale>/server.ts）+ 插補參數。
 * 伺服器的 zh-TW 文字一律由 zh(key, params) 產生；UI 以 keyedText／apiMessage 依目前語言重新翻譯。
 */
export interface KeyedText {
  key: string;
  params?: TParams;
}
/** 建立 KeyedText */
const kt = (key: string, params?: TParams): KeyedText => (params ? { key, params } : { key });
/** 稽核原因三欄位：reason（zh-TW）、reasonKey、reasonParams */
const rsn = (key: string, params?: TParams) => ({ reason: zh(key, params), reasonKey: key, reasonParams: params });
/** 一組 zh-TW 文字與其鍵（warnings／blockers 等陣列用） */
class KeyedList {
  readonly texts: string[] = [];
  readonly keys: KeyedText[] = [];
  push(key: string, params?: TParams) {
    this.texts.push(zh(key, params));
    this.keys.push(kt(key, params));
  }
  get length() {
    return this.texts.length;
  }
}

export interface Session {
  userId: string | null;
}

export type ApiError = {
  ok: false;
  status: 400 | 401 | 402 | 403 | 404 | 409 | 429 | 503;
  code: string;
  /** zh-TW 訊息（測試斷言用；與 UI 在 zh-TW 下的顯示一致） */
  message: string;
  /** 可翻譯的訊息鍵（src/i18n/dict/<locale>/server.ts）；UI 以 t(messageKey, params) 顯示，缺少時退回 message */
  messageKey?: string;
  /** messageKey 的插補參數（'@key' 形式的值為巢狀字典鍵，例如枚舉標籤） */
  params?: Record<string, string | number | boolean | null | undefined>;
  requestId: string;
  /** 429／503 時的建議重試秒數（Retry-After） */
  retryAfterSec?: number;
  /** 伴隨錯誤回傳的回應標頭（例如 x-maas-served-by） */
  headers?: Record<string, string>;
};
export type ApiResult<T> = { ok: true; data: T; requestId: string } | ApiError;

/** 模擬網路故障（由設定頁「模擬錯誤」切換觸發） */
export class NetworkError extends Error {
  /** 可翻譯的訊息鍵（UI：t(err.messageKey)） */
  readonly messageKey = 'server.err.NETWORK';
  constructor() {
    super(zh('server.err.NETWORK'));
    this.name = 'NetworkError';
  }
}

export interface ServerOptions {
  /** 模擬延遲（ms 範圍）；測試可設為 [0,0] */
  latency: [number, number];
  forceError: boolean;
  /** 模擬新機房代理程式加入控制面所需時間（ms；≤ 0 表示立即，供測試） */
  agentConnectMs: number;
  /** 模擬部署由「建立中」轉為「就緒」所需時間（ms；≤ 0 表示立即） */
  deploymentReadyMs: number;
  /** 模擬節點排空所需時間（ms） */
  drainMs: number;
  /** 模擬自建容量耗盡：自建部署佇列超過門檻 → 溢出或 429 */
  simulateLocalExhausted: boolean;
  /** 模擬叢集中斷：台北機房 A（cl-tpe-a）代理程式失聯 */
  simulateClusterOutage: boolean;
}

/** 定價與帳務參數（平台財務可調，寫入稽核） */
export interface BillingSettings {
  /** 自建模型 token 牌價（USD／百萬 tokens；輸入／輸出） */
  tokenPrices: Record<string, { input: number; output: number }>;
  /** 快取讀取（命中前綴快取）的輸入 tokens 計價倍率（× 輸入牌價；示意 0.1） */
  cacheReadMultiplier: number;
  /** 快取寫入的輸入 tokens 計價倍率（× 輸入牌價；示意 1.25） */
  cacheWriteMultiplier: number;
  /** 專屬部署牌價（USD／GPU-hr，依 GPU 型號） */
  gpuListUsdPerHour: Record<string, number>;
  /** 我們的 GPU 全成本 TCO（USD／GPU-hr，依 GPU 型號；只用於毛利檢視） */
  gpuCostUsdPerHour: Record<string, number>;
  /** 代理開放模型（阿里雲百煉 Qwen 等）加價 %（加在供應商牌價之上，示意 15%） */
  cloudMarkupPct: number;
  /** 代理閉源／夥伴模型（GPT、Claude、Gemini、合作夥伴 API）向客戶的代理折扣 %（供應商牌價 × (1 − %)，示意 10%；模型可個別覆寫） */
  proxyDiscountPct: number;
  /** 我們與閉源供應商的議價折扣 %（我們的成本 = 供應商牌價 × (1 − %)，示意 15%）；代理毛利 = 代理折扣與議價折扣之差 */
  negotiatedDiscountPct: number;
  /** 匯率（TWD／USD，對帳單換算備註用） */
  twdPerUsd: number;
}

export function defaultBillingSettings(): BillingSettings {
  return {
    tokenPrices: Object.fromEntries(MODELS.filter((m) => isLocalModel(m) && m.deployable).map((m) => [m.id, { input: m.priceInput, output: m.priceOutput }])),
    cacheReadMultiplier: DEFAULT_CACHE_READ_MULTIPLIER,
    cacheWriteMultiplier: DEFAULT_CACHE_WRITE_MULTIPLIER,
    gpuListUsdPerHour: { ...DEFAULT_GPU_LIST_USD_PER_HOUR },
    gpuCostUsdPerHour: { ...DEFAULT_GPU_COST_USD_PER_HOUR },
    cloudMarkupPct: DEFAULT_CLOUD_MARKUP_PCT,
    proxyDiscountPct: DEFAULT_PROXY_DISCOUNT_PCT,
    negotiatedDiscountPct: DEFAULT_NEGOTIATED_DISCOUNT_PCT,
    twdPerUsd: 32.5,
  };
}

export interface AssignmentView extends RoleAssignment {
  principalName: string;
  principalType: Principal['type'];
  roleName: string;
  inherited: boolean;
  createdByName: string;
}

export interface EffectiveAccess {
  principal: Principal;
  scope: string;
  decisions: { action: Action; decision: Decision }[];
}

export interface CreateAssignmentInput {
  principalId: string;
  roleId: RoleId;
  scope: string;
  justification?: string;
  expiresAt?: string;
}

export interface CreateAssignmentResult {
  assignment: RoleAssignment;
  outcome: 'active' | 'pending';
}

export interface KeyView extends ApiKey {
  projectName: string;
  tenantName: string;
}

export const KEY_MAX_EXPIRY_DAYS = 90;
export const EPHEMERAL_MAX_MINUTES = 60;
/** 示範的「本月」（用量種子到 2026-11-08） */
export const CURRENT_MONTH = '2026-11';

/** 一般金鑰最晚到期時刻：今天（本地日曆）+ 90 天的當日結束（23:59:59.999） */
export function maxKeyExpiryMs(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + KEY_MAX_EXPIRY_DAYS + 1);
  return d.getTime() - 1;
}

export interface CreateKeyInput {
  tenantId: string;
  projectId: string;
  name: string;
  allowedModels: string[];
  tierRestriction?: TierPolicy;
  rpmLimit: number;
  tpmLimit: number;
  maxParallelRequests?: number;
  monthlyBudgetUsd: number;
  budgetDuration?: ApiKey['budgetDuration'];
  /** 臨時金鑰（CI）：伺服器強制到期 ≤ 1 小時 */
  ephemeral?: boolean;
  /** 到期時間；一般金鑰必填且 ≤ 90 天 */
  expiresAt: string | null;
  autoRotate?: ApiKey['autoRotate'];
}

export interface PlaygroundInput {
  modelId: string;
  tenantId: string;
  projectId: string;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  temperature: number;
  maxTokens: number;
  enableThinking: boolean;
}

export interface PlaygroundResult {
  /** zh-TW 模擬回覆的串流切片（計量用） */
  tokens: string[];
  /** 模擬回覆的可翻譯句子（依序串接即全文）；UI：tokenizeStream(answerKeys.map((k) => t(k.key, k.params)).join('')) */
  answerKeys?: KeyedText[];
  ttftMs: number;
  inputTokens: number;
  outputTokens: number;
  /** 向客戶收費的估算（自建＝我們的 token 牌價；專屬部署＝0（含於 GPU 時數）；雲端＝供應商牌價 + 加價） */
  estimatedCostUsd: number;
  billingBasis: 'token' | 'dedicated' | 'cloud';
  /** 實際服務此請求的模型（溢出時為雲端模型） */
  model: ModelInfo;
  /** 使用者請求的模型 */
  requestedModel: ModelInfo;
  servedBy: 'local' | 'cloud';
  tier: UsageTier;
  deploymentId: string | null;
  spilloverFrom: string | null;
  /** 回應標頭（x-maas-*） */
  headers: Record<string, string>;
  curl: string;
  /** 非文字模態（圖像／影片／語音）的模擬回應卡；文字模型為 undefined */
  media?: PlaygroundMedia;
}

/** 非文字模態的模擬回應（示範：不產生真實媒體，只回報單位用量與計價） */
export interface PlaygroundMedia {
  kind: 'image' | 'video' | 'audio';
  /** 端點（OpenAI 相容） */
  endpoint: string;
  /** 用量單位數（張／秒／分鐘）與單位標籤 */
  units: number;
  unitLabel: string;
  /** 向客戶收費的單價（含加價） */
  unitPriceUsd: number;
  /** 模擬產物描述（例如 1024×1024 PNG、5 秒 720p MP4、23 秒 MP3）；zh-TW，UI 以 keyedText(t, artifact, artifactKey, artifactParams) 顯示 */
  artifact: string;
  artifactKey?: string;
  artifactParams?: TParams;
  /** 模擬產物的文字替代說明；zh-TW，UI 以 keyedText(t, altText, altTextKey, altTextParams) 顯示 */
  altText: string;
  altTextKey?: string;
  altTextParams?: TParams;
}

/** 串流切片：每個 CJK 字一片、其他連續字元一片（與伺服器計量相同的切法；UI 可用來串流翻譯後的回覆） */
export function tokenizeStream(text: string): string[] {
  return text.match(/[\u4e00-\u9fff]|[^\u4e00-\u9fff]+?(?=[\u4e00-\u9fff]|$)/g) ?? [text];
}

/** 模型中心（MaaS 入口）的模型卡：伺服器依租戶政策過濾後回傳 */
export interface HubModelView extends ModelInfo {
  /** 在此租戶方案允許清單內（平台角色一律 true；空清單＝不限） */
  allowedByPlan: boolean;
  /** 租戶為僅自建（公部門／未簽跨境同意）時，雲端代理模型需合約變更才可開通 */
  tierBlocked: boolean;
}

export interface HubCatalog {
  models: HubModelView[];
  /** 伺服器依租戶 excludeOrigins 排除（不回傳）的模型數與來源地 */
  excluded: { count: number; origins: string[] };
  tenantId: string | null;
  tenantName: string | null;
  /** 租戶為僅自建 */
  localOnly: boolean;
}

export interface UsageQuery {
  tenantId?: string;
  projectId?: string;
  modelId?: string;
  from?: string;
  to?: string;
  tier?: UsageTier;
}

export interface AuditQuery {
  scope?: string;
  decision?: 'allow' | 'deny';
  actorId?: string;
  action?: string;
  text?: string;
}

export interface ConnectionTestResult {
  latencyMs: number;
  /** served=true 表示節點／地域目前已提供；false 表示可部署的開放權重模型（自建 GPU 專用） */
  models: { id: string; displayName: string; served: boolean }[];
  /** zh-TW 警示（UI 在有 warningKeys 時以 keyedText 翻譯） */
  warnings: string[];
  warningKeys?: KeyedText[];
  /** 自建 GPU 節點探測結果 */
  node?: { nodeName: string; gpu: string; vram: string; engine: string; utilization: number; queueDepth: number; kvCacheHitRate: number };
}

export interface LocalNodeMeta {
  nodeName: string;
  gpuType: string;
  gpuCount: number;
  engine: string;
  /** 節點所屬叢集（由叢集詳情「新增節點」帶入） */
  clusterId?: string;
}

export interface NodePoolView extends NodePool {
  dedicatedTenantName?: string;
  nodeCount: number;
  gpuTotal: number;
  gpuAllocated: number;
}

export interface ClusterView extends Cluster {
  pools: NodePoolView[];
}

export interface ClusterSummary {
  id: string;
  name: string;
  site: string;
  status: Cluster['status'];
  gpuType: string;
  gpuUtil: number;
  queueDepth: number;
  gpuAllocated: number;
  gpuTotal: number;
}

/** 供應商（我們）的總覽指標 */
export interface VendorKpis {
  /** 已連線機房的加權 GPU 利用率（服務異常／中斷的機房不計入分母） */
  gpuUtilization: number;
  gpuTotal: number;
  gpuAllocated: number;
  /** 需平台範圍 billing.read；沒有（例如平台營運）時為 null → UI 顯示「無權限」 */
  monthRevenueUsd: number | null;
  /** 需平台範圍 billing.read；沒有時為 null */
  grossMarginPct: number | null;
  spilloverPct: number;
  activeTenants: number;
  clustersHealthy: number;
  clustersTotal: number;
  /** 本週（最近 7 天）tokens：自建 vs 代理（含溢出） */
  weekTokens: { local: number; proxied: number };
  /** 本月營收拆分（需平台範圍 billing.read；否則 null）：自建 token／代理模型／專屬 GPU 時數／儲值預收（本月入帳、尚未消耗的預付） */
  revenueSplit: { tokenUsd: number; proxiedUsd: number; dedicatedUsd: number; prepaidTopupsUsd: number } | null;
  /** 試用漏斗：申請 → 核准 → 付費轉換（試用租戶已儲值或轉月結） */
  trialFunnel: { submitted: number; approved: number; converted: number };
  /** SLA 達成（示意：本月請求成功率） */
  slaAttainmentPct: number;
}

/** 客戶的總覽指標（自己的用量與預算） */
export interface CustomerKpis {
  requestsToday: number;
  tokensToday: number;
  monthSpendUsd: number;
  budgetUsd: number;
  budgetPct: number;
  errorRate: number;
  avgTtftMs: number;
}

export interface OverviewData {
  /** 主體屬於我們（平台範圍）還是客戶 */
  audience: 'vendor' | 'customer';
  vendor: VendorKpis | null;
  customer: CustomerKpis;
  tiers: { localRequests: number; cloudRequests: number; spilloverRequests: number; localTokens: number; cloudTokens: number; localRevenueUsd: number; cloudRevenueUsd: number; localGpuHours: number };
  providers: ProviderInfo[];
  clusters: ClusterSummary[];
  /** 只有平台範圍具 billing.read 的主體（我們的擁有者／財務）會拿到 */
  revenue: RevenueView | null;
  hourly: HourlyPoint[];
  recentAudit: AuditEvent[];
}

export interface RegisterClusterInput {
  name: string;
  site: string;
  k8sVersion: string;
  gpuType: string;
  /** 預期節點數與每節點 GPU 數（代理程式加入後以實際回報為準；示範用來產生節點） */
  nodeCount: number;
  gpusPerNode: number;
  engine: InferenceEngine;
  /** 若整座機房保留給某客戶：建立專屬節點池 */
  dedicatedTenantId?: string;
}

export interface CreateDeploymentInput {
  name: string;
  modelId: string;
  clusterId: string;
  sharing: PoolSharing;
  dedicatedTenantId?: string;
  /** 專屬部署：專屬節點池 GPU 不足時是否允許借用共用節點池（預設 false → 409 DEDICATED_POOL_EXHAUSTED；true 會寫入稽核） */
  allowSharedFallback?: boolean;
  engine: InferenceEngine;
  quantization: Quantization;
  gpusPerReplica: number;
  replicas: number;
  maxNumSeqs: number;
  priorityScheduling: boolean;
  cacheSaltByTenant: boolean;
  autoscaling: Deployment['autoscaling'];
  rollout: Deployment['rollout'];
}

/** 排空後的副本處置摘要 */
interface DrainSummary {
  migrated: number;
  pending: { name: string; count: number }[];
}

/**
 * 巢狀可翻譯片段（例如含各自原因的清單）：伺服器以三種語言預先展開，
 * zh-TW 範本引用 {name}、en 範本引用 {name_en}、ja 範本引用 {name_ja}。
 */
function nested(name: string, render: (loc: Locale) => string): TParams {
  return { [name]: render('zh-TW'), [`${name}_en`]: render('en'), [`${name}_ja`]: render('ja') };
}

/** 帶錯誤碼前綴的稽核原因：server.audit.coded.<訊息鍵>（各語言範本＝「{code}：」+ 訊息範本） */
function codedRsn(code: string, msg: KeyedText) {
  const key = `server.audit.coded.${msg.key}`;
  const params: TParams = { ...msg.params, code };
  return { reason: `${code}：${zh(msg.key, msg.params)}`, reasonKey: key, reasonParams: params };
}

/** 租戶資料分級片段：公部門／資料分級 */
function classFrag(t: { dataClass: DataClass }): string {
  return t.dataClass === 'public-sector' ? '@server.frag.publicSector' : '@server.frag.dataClassification';
}

/** 公部門租戶的法規依據句（插補片段；其他租戶為空字串） */
function basisFrag(t: { dataClass: DataClass }): string {
  return t.dataClass === 'public-sector' ? '@server.frag.basis' : '';
}

export interface DeploymentView extends Deployment {
  modelName: string;
  clusterName: string;
  dedicatedTenantName?: string;
}

export interface CreateTenantInput {
  name: string;
  plan: TenantPlan;
  dataClass: DataClass;
  /** 省略時：有跨境同意 → both；無 → local。選 cloud／both 而未附跨境同意 → 400 CROSS_BORDER_CONSENT_REQUIRED */
  allowedTiers?: TierPolicy;
  quotas: { rpm: number; tpm: number; monthlyBudgetUsd: number };
  costCenter: string;
  billingContact: { name: string; email: string };
  allowedModels?: string[];
  commitment?: { monthlyUsd: number; discountPct: number };
  /** 跨境資料傳輸同意：允許溢出／代理到的雲端區域（例如 ['ap-southeast-1']）、簽署時間與簽署人 */
  crossBorderConsent?: { regions: string[]; signedAt?: string; by?: string };
  /** 計費模式；省略時隨用隨付 → 預付儲值、承諾用量／專屬 → 月結 */
  billingMode?: BillingMode;
  /** 預付租戶的初始儲值（USD） */
  initialCreditUsd?: number;
  /** 資料留存；省略時公部門零留存、其餘 30 天 */
  retention?: RetentionPolicy;
}

/** 租戶帳戶（試用與方案頁、租戶詳情、標頭餘額）：計費模式、預付餘額、限流層級、留存政策 */
export interface TenantAccount {
  tenantId: string;
  tenantName: string;
  plan: TenantPlan;
  billingMode: BillingMode;
  retention: RetentionPolicy;
  /** 預付租戶才有 */
  credits: {
    /** 總帳餘額（儲值入帳） */
    balanceUsd: number;
    /** 本月至今已扣抵（＝本月對帳單合計） */
    monthSpendUsd: number;
    /** 可用餘額 = 總帳餘額 − 本月至今扣抵 */
    availableUsd: number;
    lowBalance: boolean;
    lowBalanceThresholdUsd: number;
    autoReload?: { thresholdUsd: number; amountUsd: number };
    trial?: { grantedUsd: number; expiresAt: string; expired: boolean };
    /** 本月儲值入帳 */
    monthTopupsUsd: number;
  } | null;
  tier: { current: RateLimitTier; next: RateLimitTier | null; cumulativeSpendUsd: number; toNextUsd: number | null; contract: boolean };
  /** 月結租戶：本月至今帳單 */
  monthSpendUsd: number;
  commitment?: Tenant['commitment'];
}

export interface TopUpRecord {
  id: string;
  tenantId: string;
  amountUsd: number;
  at: string;
  by: string;
  kind: 'topup' | 'trial-grant' | 'auto-reload';
}

// ---------- 申請測試（Testing Questionnaire，Inferel 式） ----------
export type TrialScenario = 'text' | 'multimodal' | 'video-audio' | 'tools' | 'function-calling' | 'mcp';
export type TrialUseCase = 'customer-service' | 'rnd' | 'content' | 'agent-workflow' | 'other';
export type TrialRouting = 'cost' | 'latency';
export type TrialInvoice = 'twd-einvoice' | 'usd-invoice';

export const TRIAL_SCENARIO_LABELS: Record<TrialScenario, string> = {
  text: zh('data.TRIAL_SCENARIO_LABELS.text'),
  multimodal: zh('data.TRIAL_SCENARIO_LABELS.multimodal'),
  'video-audio': zh('data.TRIAL_SCENARIO_LABELS.video-audio'),
  tools: zh('data.TRIAL_SCENARIO_LABELS.tools'),
  'function-calling': 'Function Calling',
  mcp: 'MCP',
};
export const TRIAL_USE_CASE_LABELS: Record<TrialUseCase, string> = {
  'customer-service': zh('data.TRIAL_USE_CASE_LABELS.customer-service'),
  rnd: zh('data.TRIAL_USE_CASE_LABELS.rnd'),
  content: zh('data.TRIAL_USE_CASE_LABELS.content'),
  'agent-workflow': zh('data.TRIAL_USE_CASE_LABELS.agent-workflow'),
  other: zh('data.TRIAL_USE_CASE_LABELS.other'),
};
export const TRIAL_ROUTING_LABELS: Record<TrialRouting, string> = { cost: zh('data.TRIAL_ROUTING_LABELS.cost'), latency: zh('data.TRIAL_ROUTING_LABELS.latency') };
export const TRIAL_INVOICE_LABELS: Record<TrialInvoice, string> = { 'twd-einvoice': zh('data.TRIAL_INVOICE_LABELS.twd-einvoice'), 'usd-invoice': 'USD invoice' };

/** 測試條件（示意） */
export const TRIAL_TERMS = { freeCreditUsd: 20, periodBusinessDays: 3, extendNoticeDays: 3 };

export interface TrialModelSpec {
  modelId: string;
  /** 預期 RPM／TPM */
  rpm: number;
  tpm: number;
  /** 要求 TTFT（毫秒以下） */
  ttftMs: number;
  /** 承諾快取命中率（%） */
  cacheHitPct: number;
}

export interface TrialRequestInput {
  // S1 測試條件
  accountName: string;
  ipAllowlist: boolean;
  // S2 要測的模型
  models: TrialModelSpec[];
  // S3 情境
  scenarios: TrialScenario[];
  useCase: TrialUseCase;
  useCaseOther?: string;
  routing: TrialRouting;
  monthlyInputTokens: number;
  monthlyOutputTokens: number;
  peakConcurrency: number;
  // S3b 台灣在地需求
  dataResidencyTw: boolean;
  publicSector: boolean;
  invoice: TrialInvoice;
  // S4 其他需求
  otherNeeds: string;
  // S5 聯絡資訊
  company: string;
  companyShort: string;
  contactName: string;
  email: string;
  phone: string;
}

export type TrialStatus = 'pending' | 'approved' | 'rejected';
export const TRIAL_STATUS_LABELS: Record<TrialStatus, string> = { pending: zh('data.TRIAL_STATUS_LABELS.pending'), approved: zh('data.TRIAL_STATUS_LABELS.approved'), rejected: zh('data.TRIAL_STATUS_LABELS.rejected') };

export interface TrialRequest extends TrialRequestInput {
  id: string;
  status: TrialStatus;
  submittedAt: string;
  freeCreditUsd: number;
  /** 審核 */
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
  /** 核准後建立的試用租戶與到期日（+3 個工作天） */
  tenantId?: string;
  defaultProjectId?: string;
  trialEndsAt?: string;
}

export interface TrialApproveResult {
  request: TrialRequest;
  tenant: Tenant;
  /** 核准時被排除的模型（僅自建／來源地排除）與原因 */
  droppedModels: { modelId: string; reason: string; reasonKey?: string; reasonParams?: Record<string, string | number | boolean | null | undefined> }[];
  /** 給客戶的下一步 */
  /** zh-TW 下一步說明（UI 在有 nextStepKeys 時優先顯示翻譯） */
  nextSteps: string[];
  nextStepKeys?: { key: string; params?: Record<string, string | number | boolean | null | undefined> }[];
}

/** 公開表單的簡易速率限制（示意）：同一 Email 最多 3 筆待審；每分鐘最多 20 筆 */
export const TRIAL_RATE_LIMIT = { pendingPerEmail: 3, perMinute: 20 };

/** +N 個工作天（跳過週六日；示範不含國定假日） */
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    const w = d.getDay();
    if (w !== 0 && w !== 6) left -= 1;
  }
  return d;
}

/** 平台財務：每個部署的內部成本 vs 牌價 vs 毛利 */
export interface UnitPriceRow {
  deploymentId: string;
  deploymentName: string;
  modelId: string;
  modelName: string;
  clusterName: string;
  gpuType: string;
  sharing: PoolSharing;
  dedicatedTenantId?: string;
  dedicatedTenantName?: string;
  gpusPerReplica: number;
  replicas: number;
  costUsdPerGpuHour: number;
  listUsdPerGpuHour: number;
  tokPerSec: number;
  utilization: number;
  /** 內部成本 USD／百萬 tokens（allocation-based） */
  internalUsdPerMTok: number;
  /** 100% 利用率時的成本下限 */
  floorUsdPerMTok: number;
  listInputUsdPerMTok: number;
  listOutputUsdPerMTok: number;
  /** 混合牌價（70% 輸入 + 30% 輸出） */
  listBlendedUsdPerMTok: number;
  /** token 牌價毛利率（共用部署）；專屬部署、0 副本、利用率或 tok/s 為 0 時為 null（n/a） */
  tokenMarginPct: number | null;
  /** GPU 時數毛利率（專屬部署）：(牌價 − TCO) ÷ 牌價 */
  gpuHourMarginPct: number;
  /** 達到 targetMarginPct 毛利所需的利用率（u* ＝ 100% 利用率成本 ÷ (混合牌價 × 0.6)）；> 1 表示以此牌價無法達標；專屬／n/a 為 null */
  utilizationForTargetMargin: number | null;
  targetMarginPct: number;
  /** 市場參考價（USD／百萬 tokens；示意，含擷取日） */
  marketRefUsd?: { input: number; output: number; source: string };
  /** 可比的雲端模型與牌價（含加價） */
  cloudComparables: { modelId: string; displayName: string; priceInput: number; priceOutput: number; withMarkup: number }[];
}

export const TARGET_MARGIN_PCT = 40;

/** 我們向某客戶開立的月對帳單 */
export interface BillingStatement {
  tenantId: string;
  tenantName: string;
  costCenter: string;
  billingContact: Tenant['billingContact'];
  plan: TenantPlan;
  dataClass: DataClass;
  allowedTiers: TierPolicy;
  month: string;
  /** 本月已過天數 */
  daysInPeriod: number;
  billingMode: BillingMode;
  retention: RetentionPolicy;
  rates: { cloudMarkupPct: number; proxyDiscountPct: number; cacheReadMultiplier: number; cacheWriteMultiplier: number; twdPerUsd: number };
  charges: {
    /** (a) 自建模型 token 費（共用部署，我們的牌價；快取讀取 × 0.1、快取寫入 × 1.25） */
    localTokens: { tokens: number; cachedTokens: number; cacheWriteTokens: number; usd: number; byModel: { modelId: string; modelName: string; /** 服務此列 tokens 的部署（同一模型可能同時有共用列與專屬列） */ deploymentId: string; deploymentName: string; tokens: number; cachedTokens: number; cacheWriteTokens: number; inputUsdPerMTok: number; outputUsdPerMTok: number; usd: number; basis: 'token' | 'dedicated' }[] };
    /** (b) 專屬部署費：GPU 時數（依 createdAt／副本歷史在本期內按分鐘比例）× 單價 */
    dedicated: { gpuHours: number; usd: number; items: { deploymentId: string; deploymentName: string; modelId: string; modelName: string; clusterName: string; gpuType: string; gpus: number; hours: number; unitUsd: number; usd: number }[] };
    /** (c) 代理模型：開放模型（百煉）供應商牌價 + 加價 %；閉源／夥伴模型供應商牌價 × (1 − 代理折扣 %)。listUsd ＝ 供應商牌價、usd ＝ 向客戶、costUsd ＝ 我們的成本 */
    cloud: { listUsd: number; markupUsd: number; discountUsd: number; usd: number; costUsd: number; requests: number; tokens: number; spilloverRequests: number; byModel: { modelId: string; modelName: string; kind: ProxyKind; tokens: number; listUsd: number; usd: number; costUsd: number }[] };
    subtotalUsd: number;
    /** (d) 承諾用量方案：月承諾額（按天數比例）、折扣、超額與最低消費補足 */
    commitment: { monthlyUsd: number; proratedUsd: number; discountPct: number; discountUsd: number; overageUsd: number; shortfallUsd: number } | null;
    totalUsd: number;
    totalTwd: number;
  };
  local: { requests: number; tokens: number; gpuHours: number };
  spillover: { requests: number; tokens: number };
  cloud: { requests: number; tokens: number };
  totalUsd: number;
  budget: { monthlyBudgetUsd: number; spentUsd: number; pct: number; alert: 'ok' | 'warning' | 'critical' };
  /** 預付租戶：本月扣抵後的餘額 */
  credits: { balanceUsd: number; deductedUsd: number; availableUsd: number; lowBalance: boolean } | null;
  projects: { projectId: string; projectName: string; localTokens: number; localTokenUsd: number; cloudUsd: number; spilloverUsd: number; totalUsd: number }[];
}

/** 平台營收與毛利檢視（我們的擁有者／財務） */
export interface RevenueView {
  month: string;
  daysInPeriod: number;
  totalRevenueUsd: number;
  tokenRevenueUsd: number;
  dedicatedRevenueUsd: number;
  cloudRevenueUsd: number;
  /** 承諾方案的折扣與最低消費補足淨額（負＝折扣） */
  commitmentAdjustmentUsd: number;
  /** 我們付給代理供應商的成本（開放模型 ＝ 牌價；閉源 ＝ 牌價 × (1 − 議價折扣)） */
  cloudListCostUsd: number;
  /** 代理模型的供應商牌價總額（未折扣） */
  cloudVendorListUsd: number;
  /** 本月儲值入帳（預付預收；尚未消耗的部分為遞延收入） */
  prepaidTopupsUsd: number;
  /** 代理開放模型（百煉）：牌價 → +加價 */
  proxiedOpen: { listUsd: number; revenueUsd: number; costUsd: number; marginPct: number };
  /** 代理閉源／夥伴模型：牌價 → −代理折扣（向客戶）；成本 ＝ 牌價 × (1 − 議價折扣) */
  proxiedClosed: { listUsd: number; revenueUsd: number; costUsd: number; marginPct: number };
  /** 我們自己 GPU 的 TCO（所有機房的 GPU × 時價 × 24 × 天數） */
  gpuCostUsd: number;
  grossProfitUsd: number;
  grossMarginPct: number;
  fleet: { gpuTotal: number; gpuAllocated: number; utilization: number; gpuHours: number; byGpuType: { gpuType: string; gpus: number; hours: number; costUsdPerHour: number; costUsd: number; listUsdPerHour: number }[] };
  /** 所有代理模型合計：listUsd ＝ 供應商牌價、markupUsd ＝ 營收 − 成本、marginPct ＝ (營收 − 成本) ÷ 營收 */
  cloud: { listUsd: number; markupUsd: number; marginPct: number };
  byTenant: { tenantId: string; tenantName: string; costCenter: string; plan: TenantPlan; revenueUsd: number; tokenUsd: number; dedicatedUsd: number; cloudUsd: number; commitmentAdjustmentUsd: number }[];
  /** marginPct：僅專屬部署服務的模型（不收 token 費）為 null */
  byModel: { modelId: string; modelName: string; tokens: number; revenueUsd: number; internalUsdPerMTok: number; listUsdPerMTok: number; marginPct: number | null }[];
}

/** 期間 [from, to) 與 [start, ∞) 的重疊小時數（按分鐘） */
export function overlapHours(startIso: string, periodStart: Date, periodEnd: Date): number {
  const s = Math.max(new Date(startIso).getTime(), periodStart.getTime());
  const e = periodEnd.getTime();
  if (!(e > s)) return 0;
  return Math.round(((e - s) / 60_000) / 60 * 100) / 100;
}

/**
 * 專屬部署在期間內的 GPU 時數：依副本歷史（含建立）逐段積分 副本 × 每副本 GPU × 小時（按分鐘），
 * 不是「整個期間 × 目前副本數」。省略 replicaHistory 時視為自 createdAt 起為目前副本數。
 */
export function dedicatedGpuHours(d: Pick<Deployment, 'createdAt' | 'replicas' | 'gpusPerReplica' | 'replicaHistory'>, periodStart: Date, periodEnd: Date): number {
  const history = (d.replicaHistory && d.replicaHistory.length > 0 ? [...d.replicaHistory] : [{ at: d.createdAt, replicas: d.replicas }]).sort((a, b) => a.at.localeCompare(b.at));
  let hours = 0;
  for (let i = 0; i < history.length; i++) {
    const segStart = Math.max(new Date(history[i].at).getTime(), periodStart.getTime());
    const segEnd = Math.min(i + 1 < history.length ? new Date(history[i + 1].at).getTime() : Infinity, periodEnd.getTime());
    if (segEnd > segStart) hours += ((segEnd - segStart) / 3_600_000) * history[i].replicas * d.gpusPerReplica;
  }
  return Math.round(hours * 100) / 100;
}

/** 自建模型 → 可比的雲端模型（用於定價比較） */
const CLOUD_COMPARABLES: Record<string, string[]> = {
  'qwen3.8-27b-vllm': ['qwen3.8-27b', 'qwen3.7-plus'],
  'maas-assist-27b': ['qwen3.7-plus'],
  'gpt-oss-120b-vllm': ['gpt-5-mini', 'qwen3.7-plus'],
  'llama-3.3-70b-vllm': ['qwen3.7-plus', 'gemini-2.5-flash'],
  'taide-lx-8b-vllm': ['qwen3.8-flash'],
  'qwen3-embedding-8b-vllm': ['text-embedding-v4'],
  'embeddinggemma-300m-vllm': ['text-embedding-v4'],
  'qwen3-coder-30b-a3b-vllm': ['qwen3-coder-plus'],
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function tenantIsLocalOnly(t: Tenant): boolean {
  return t.dataClass === 'public-sector' || t.allowedTiers === 'local';
}

function rnd4() {
  return Math.random().toString(16).slice(2, 6);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export class MockServer {
  readonly audit = new AuditStore();
  options: ServerOptions = {
    latency: [200, 600],
    forceError: false,
    agentConnectMs: 2000,
    deploymentReadyMs: 2500,
    drainMs: 1500,
    simulateLocalExhausted: false,
    simulateClusterOutage: false,
  };
  /** 定價與帳務參數（可由平台財務調整） */
  billing: BillingSettings = defaultBillingSettings();
  private assignments: RoleAssignment[] = ASSIGNMENTS.map((a) => ({ ...a }));
  private tenants: Tenant[] = TENANTS.map((t) => ({ ...t, quotas: { ...t.quotas }, allowedModels: [...t.allowedModels], excludeOrigins: [...t.excludeOrigins], commitment: t.commitment ? { ...t.commitment } : undefined, credits: t.credits ? { ...t.credits, autoReload: t.credits.autoReload ? { ...t.credits.autoReload } : undefined, trial: t.credits.trial ? { ...t.credits.trial } : undefined } : undefined }));
  /** 預付儲值入帳紀錄（本月「儲值預收」KPI 與試用轉換判定用） */
  private topups: TopUpRecord[] = [
    { id: 'tu-1', tenantId: 't-gov', amountUsd: 2000, at: '2026-11-03T09:00:00+08:00', by: 'system', kind: 'auto-reload' },
    { id: 'tu-2', tenantId: 't-acme-trial', amountUsd: 20, at: '2026-11-06T10:00:00+08:00', by: 'u-owner', kind: 'trial-grant' },
  ];
  private keys: ApiKey[] = API_KEYS.map((k) => ({ ...k }));
  private projects: Project[] = PROJECTS.map((p) => ({ ...p }));
  private routes: ModelRoute[] = ROUTES.map((r) => ({ ...r, spillover: { ...r.spillover, threshold: { ...r.spillover.threshold } } }));
  private providers: ProviderInfo[] = PROVIDERS.map((p) => ({ ...p, endpoints: p.endpoints.map((e) => ({ ...e })), capacity: p.capacity ? { ...p.capacity, models: [...p.capacity.models] } : undefined }));
  private clusters: Cluster[] = CLUSTERS.map((c) => ({ ...c, nodePools: c.nodePools.map((p) => ({ ...p })) }));
  private nodes: GpuNode[] = NODES.map((n) => ({ ...n }));
  private deployments: Deployment[] = DEPLOYMENTS.map((d) => ({ ...d, autoscaling: { ...d.autoscaling }, rollout: { ...d.rollout } }));
  private events: ClusterEvent[] = CLUSTER_EVENTS.map((e) => ({ ...e }));
  private principals: Principal[] = [...USERS, ...GROUPS, ...SERVICE_PRINCIPALS];
  private usage: UsageRecord[] = generateUsage();
  private hourly: HourlyPoint[] = generateHourly();
  private idSeq = 100;

  constructor(options?: Partial<ServerOptions>) {
    this.options = { ...this.options, ...options };
    this.seedAudit();
    this.seedTrials();
  }

  /** 種子試用申請：一筆已核准（對應種子試用租戶 t-acme-trial）、一筆待審（公部門） */
  private seedTrials() {
    this.trials = [
      {
        id: 'trial-acme-eval-seed',
        accountName: 'acme-eval',
        ipAllowlist: false,
        models: [
          { modelId: 'qwen3.8-27b-vllm', rpm: 60, tpm: 100_000, ttftMs: 800, cacheHitPct: 30 },
          { modelId: 'gpt-oss-120b-vllm', rpm: 30, tpm: 60_000, ttftMs: 1000, cacheHitPct: 10 },
          { modelId: 'gpt-5.1', rpm: 10, tpm: 20_000, ttftMs: 1500, cacheHitPct: 0 },
        ],
        scenarios: ['text', 'tools'],
        useCase: 'customer-service',
        routing: 'cost',
        monthlyInputTokens: 50_000_000,
        monthlyOutputTokens: 10_000_000,
        peakConcurrency: 20,
        dataResidencyTw: true,
        publicSector: false,
        invoice: 'twd-einvoice',
        otherNeeds: zh('server.seedTrial.trial-acme-eval-seed.otherNeeds'),
        company: zh('server.seedTrial.trial-acme-eval-seed.company'),
        companyShort: 'ACME',
        contactName: '林小測',
        email: 'eval@acme.example',
        phone: '02-1234-5678',
        status: 'approved',
        submittedAt: '2026-11-05T14:20:00+08:00',
        freeCreditUsd: TRIAL_TERMS.freeCreditUsd,
        reviewedAt: '2026-11-06T10:00:00+08:00',
        reviewedBy: 'u-owner',
        reviewNote: zh('server.seedTrial.trial-acme-eval-seed.reviewNote'),
        tenantId: 't-acme-trial',
        defaultProjectId: 'p-acme-trial-default',
        trialEndsAt: '2026-11-12T00:00:00+08:00',
      },
      {
        id: 'trial-lib-eval-seed',
        accountName: 'citylib-eval',
        ipAllowlist: true,
        models: [
          { modelId: 'gpt-oss-120b-vllm', rpm: 30, tpm: 50_000, ttftMs: 1000, cacheHitPct: 10 },
          { modelId: 'embeddinggemma-300m-vllm', rpm: 120, tpm: 200_000, ttftMs: 300, cacheHitPct: 0 },
        ],
        scenarios: ['text'],
        useCase: 'customer-service',
        routing: 'latency',
        monthlyInputTokens: 8_000_000,
        monthlyOutputTokens: 2_000_000,
        peakConcurrency: 8,
        dataResidencyTw: true,
        publicSector: true,
        invoice: 'twd-einvoice',
        otherNeeds: zh('server.seedTrial.trial-lib-eval-seed.otherNeeds'),
        company: '示範市立圖書館',
        companyShort: zh('server.seedTrial.trial-lib-eval-seed.companyShort'),
        contactName: zh('server.seedTrial.trial-lib-eval-seed.contactName'),
        email: 'lib@gov.example',
        phone: '',
        status: 'pending',
        submittedAt: '2026-11-08T09:10:00+08:00',
        freeCreditUsd: TRIAL_TERMS.freeCreditUsd,
      },
    ];
  }

  // ---------- 內部工具 ----------
  private ctx() {
    return { assignments: this.assignments };
  }

  private async simulate() {
    const [lo, hi] = this.options.latency;
    if (hi > 0) await sleep(lo + Math.random() * (hi - lo));
    if (this.options.forceError) throw new NetworkError();
  }

  private nextId(prefix: string) {
    this.idSeq += 1;
    return `${prefix}-${this.idSeq}`;
  }

  private principalById(id: string): Principal | undefined {
    return this.principals.find((p) => p.id === id);
  }

  private nameOf(id: string): string {
    return this.principalById(id)?.displayName ?? id;
  }

  private tenantById(id: string): Tenant | undefined {
    return this.tenants.find((t) => t.id === id);
  }

  private tenantName(id: string | undefined): string | undefined {
    return id ? this.tenantById(id)?.name ?? id : undefined;
  }

  /** 驗證身分：由可信種子解析使用者與群組成員資格；API 金鑰的服務主體（sp-*）也可作為工作階段主體（資料面以金鑰雜湊驗證） */
  authenticate(session: Session): Principal | null {
    if (!session.userId) return null;
    const u = USERS.find((x) => x.id === session.userId) ?? this.principals.find((x) => x.id === session.userId && x.type === 'servicePrincipal');
    return u ? { ...u, groupIds: [...u.groupIds] } : null;
  }

  /** 授權：集中式政策評估 */
  authorize(principal: Principal, action: Action, scope: string): Decision {
    return can(principal, action, scope, this.ctx());
  }

  /** 錯誤結果：message 為 zh(messageKey, params)（與改版前逐字相同），UI 以 apiMessage(t, err) 依語言顯示 */
  private err(status: ApiError['status'], code: string, msg: KeyedText, requestId: string, extra?: Pick<ApiError, 'retryAfterSec' | 'headers'>): ApiError {
    return { ok: false, status, code, message: zh(msg.key, msg.params), messageKey: msg.key, params: msg.params, requestId, ...extra };
  }

  private log(e: Omit<AuditEvent, 'id' | 'timestamp' | 'actorName' | 'principalName' | 'tenantId'> & { tenantId?: string | null }) {
    return this.audit.append({
      ...e,
      tenantId: e.tenantId === undefined ? tenantIdOfScope(e.scope) : e.tenantId,
      actorName: this.nameOf(e.actorId),
      principalName: this.nameOf(e.principalId),
    });
  }

  /**
   * 統一的授權守門：驗證身分 → 授權 → 拒絕時寫稽核。
   * 回傳 principal 與 requestId 供後續使用。
   */
  private async guard(
    session: Session,
    action: Action,
    scope: string,
    opts?: { skipLatency?: boolean; resourceType?: string; resourceId?: string },
  ): Promise<{ ok: true; principal: Principal; requestId: string; decision: Decision } | ApiError> {
    const requestId = newRequestId();
    if (!opts?.skipLatency) await this.simulate();
    const principal = this.authenticate(session);
    if (!principal) {
      this.log({ actorId: session.userId ?? 'anonymous', principalId: session.userId ?? 'anonymous', action, scope, decision: 'deny', requestId, ...rsn('server.audit.unauthenticated') });
      return this.err(401, 'UNAUTHENTICATED', kt('server.err.UNAUTHENTICATED.expired'), requestId);
    }
    const decision = this.authorize(principal, action, scope);
    if (!decision.allowed) {
      this.log({
        actorId: principal.id,
        principalId: principal.id,
        action,
        scope,
        decision: 'deny',
        requestId,
        reason: decision.reason,
        reasonKey: decision.reasonKey,
        reasonParams: decision.reasonParams,
        resourceType: opts?.resourceType,
        resourceId: opts?.resourceId,
      });
      return this.err(403, 'FORBIDDEN', this.forbiddenMsg(action, normalizeScope(scope), decision), requestId);
    }
    return { ok: true, principal, requestId, decision };
  }

  /** 針對「任一範圍」的讀取類清單 API：至少在某範圍具備該動作才可呼叫 */
  private async guardAnywhere(session: Session, action: Action) {
    const requestId = newRequestId();
    await this.simulate();
    const principal = this.authenticate(session);
    if (!principal) return this.err(401, 'UNAUTHENTICATED', kt('server.err.UNAUTHENTICATED.expired'), requestId);
    if (!canAnywhere(principal, action, this.ctx())) {
      this.log({ actorId: principal.id, principalId: principal.id, action, scope: PLATFORM_SCOPE, decision: 'deny', requestId, ...rsn('server.audit.denyAnywhere', { action }) });
      return this.err(403, 'FORBIDDEN', kt('server.err.FORBIDDEN.anywhere', { action }), requestId);
    }
    return { ok: true as const, principal, requestId };
  }

  /**
   * FORBIDDEN 訊息：「您沒有執行…的權限（範圍 …）。」+ 政策拒絕原因。
   * 原因有鍵時以 server.err.FORBIDDEN.<原因鍵末段> 組成完整句（含原因的參數，前綴 r_），讓各語言可完整翻譯。
   */
  private forbiddenMsg(action: string, scope: string, decision: Decision): KeyedText {
    const slug = decision.reasonKey?.startsWith('server.policy.') ? decision.reasonKey.slice('server.policy.'.length) : undefined;
    if (slug) {
      const params: TParams = { action, scope };
      for (const [k, v] of Object.entries(decision.reasonParams ?? {})) params[`r_${k}`] = v;
      return kt(`server.err.FORBIDDEN.${slug}`, params);
    }
    return kt('server.err.FORBIDDEN', { action, scope, reason: decision.reason });
  }

  private seedAudit() {
    const base = new Date('2026-11-08T08:00:00+08:00').getTime();
    // 第 7 欄為稽核原因的字典鍵（server.audit.seed.*）
    const items: Array<[number, string, string, string, string, 'allow' | 'deny', string?]> = [
      [0, 'u-admin-star', 'u-op-star', 'iam.assign', '/tenants/t-star/projects/p-doc-rag', 'allow'],
      [6, 'u-cluster-ops', 'u-cluster-ops', 'deployment.manage', '/clusters/cl-tpe-a', 'allow', 'server.audit.seed.scaleShared'],
      [12, 'u-op-star', 'u-op-star', 'key.create', '/tenants/t-star/projects/p-cs-bot', 'allow'],
      [18, 'u-finance', 'u-finance', 'billing.configure', '/', 'allow', 'server.audit.seed.h200Price'],
      [25, 'u-viewer-star', 'u-viewer-star', 'key.create', '/tenants/t-star/projects/p-cs-bot', 'deny', 'server.audit.seed.viewerKeyCreate'],
      [31, 'u-admin-star', 'u-admin-star', 'deployment.manage', '/clusters/cl-tpe-a', 'deny', 'server.audit.seed.adminDeploy'],
      [40, 'u-iam-star', 'u-op-star', 'iam.assign', '/tenants/t-star', 'allow', 'server.audit.seed.privilegedPending'],
      [48, 'u-owner', 'u-owner', 'tenant.create', '/tenants/t-gov', 'allow', 'server.audit.seed.govTenant'],
      [55, 'u-op-union', 'u-op-union', 'model.route.update', '/', 'deny', 'server.audit.seed.routeUpdate'],
      [62, 'u-cluster-ops', 'u-cluster-ops', 'cluster.operate', '/clusters/cl-tpe-a', 'allow', 'server.audit.seed.drainNode'],
      [70, 'u-billing-union', 'u-billing-union', 'billing.export', '/tenants/t-union', 'allow'],
      [85, 'u-billing-union', 'u-billing-union', 'key.read', '/tenants/t-union/projects/p-risk', 'deny', 'server.audit.seed.billingKeyRead'],
      [90, 'u-admin-star', 'u-admin-star', 'cluster.read', '/', 'deny', 'server.audit.seed.clusterRead'],
      [95, 'u-audit-union', 'u-audit-union', 'audit.export', '/tenants/t-union', 'allow'],
      [100, 'u-admin-gov', 'u-admin-gov', 'key.create', '/tenants/t-gov/projects/p-gov-qa', 'deny', 'server.audit.seed.govQwen'],
    ];
    for (const [min, actor, principal, action, scope, decision, reasonKey] of items) {
      this.log({ actorId: actor, principalId: principal, action, scope, decision, requestId: newRequestId(), ...(reasonKey ? rsn(reasonKey) : {}), timestamp: new Date(base + min * 60_000).toISOString() } as never);
    }
  }

  // ---------- 主體與範圍 ----------
  /** 主體清單：租戶範圍只回該租戶自己的主體（不揭露其他租戶或我們的員工）；平台範圍（我們）看全部 */
  async listPrincipals(session: Session, scope: string): Promise<ApiResult<Principal[]>> {
    const g = await this.guard(session, 'iam.read', scope);
    if (!g.ok) return g;
    const tenant = tenantIdOfScope(scope) ?? g.principal.tenantId;
    const data = this.principals.filter((p) => (tenant ? p.tenantId === tenant : true));
    return { ok: true, data, requestId: g.requestId };
  }

  async getMe(session: Session): Promise<ApiResult<{ principal: Principal; delegation: string[]; assignments: RoleAssignment[] }>> {
    const requestId = newRequestId();
    const principal = this.authenticate(session);
    if (!principal) return this.err(401, 'UNAUTHENTICATED', kt('server.err.UNAUTHENTICATED'), requestId);
    const ids = new Set([principal.id, ...principal.groupIds]);
    return {
      ok: true,
      requestId,
      data: {
        principal,
        delegation: delegationScopes(principal, this.ctx()),
        assignments: this.assignments.filter((a) => ids.has(a.principalId) && a.status === 'active'),
      },
    };
  }

  /** 供 UI 作可用性判斷（非安全邊界）：同步、不寫稽核 */
  canUi(session: Session, action: Action, scope: string): boolean {
    const p = this.authenticate(session);
    return !!p && this.authorize(p, action, scope).allowed;
  }
  canUiAnywhere(session: Session, action: Action): boolean {
    const p = this.authenticate(session);
    return !!p && canAnywhere(p, action, this.ctx());
  }

  // ---------- 模型 ----------
  async listModels(session: Session): Promise<ApiResult<ModelInfo[]>> {
    const g = await this.guardAnywhere(session, 'model.read');
    if (!g.ok) return g;
    return { ok: true, data: MODELS, requestId: g.requestId };
  }

  /**
   * 模型中心（客戶入口）目錄：伺服器端依租戶政策過濾——排除來源地（含基底模型連帶）的模型不回傳；
   * 標示是否在方案允許清單內與僅自建租戶的雲端模型（需合約變更）。平台角色看到完整目錄。
   */
  async listHubModels(session: Session): Promise<ApiResult<HubCatalog>> {
    const g = await this.guardAnywhere(session, 'model.read');
    if (!g.ok) return g;
    const tenant = g.principal.tenantId ? this.tenantById(g.principal.tenantId) : undefined;
    const excludedOrigins = (tenant?.excludeOrigins ?? []) as string[];
    const localOnly = !!tenant && tenantIsLocalOnly(tenant);
    const originsSeen = new Set<string>();
    const models: HubModelView[] = [];
    for (const m of MODELS) {
      if (m.status === 'deprecated') continue;
      const origin = originOfModel(m, MODEL_BY_ID);
      if (origin && excludedOrigins.includes(origin)) {
        originsSeen.add(origin);
        continue;
      }
      models.push({
        ...m,
        allowedByPlan: !tenant || this.modelAllowedForTenant(tenant, m.id),
        tierBlocked: localOnly && !isLocalModel(m),
      });
    }
    const excludedCount = MODELS.filter((m) => m.status !== 'deprecated').length - models.length;
    return { ok: true, data: { models, excluded: { count: excludedCount, origins: [...originsSeen] }, tenantId: tenant?.id ?? null, tenantName: tenant?.name ?? null, localOnly }, requestId: g.requestId };
  }

  /** 模型／別名是否在租戶方案允許清單內（空清單＝不限） */
  modelAllowedForTenant(tenant: Tenant, id: string): boolean {
    if (tenant.allowedModels.length === 0) return true;
    if (tenant.allowedModels.includes(id)) return true;
    // 以別名允許 → 別名目標的模型也允許
    return this.routes.some((r) => tenant.allowedModels.includes(r.alias) && [...r.targets, ...r.fallbackChain, ...(r.spillover.target ? [r.spillover.target] : [])].some((t) => t.modelId === id));
  }

  /**
   * 專案是否可使用某別名：以該專案有效金鑰的允許清單判定（有金鑰列出此別名）；
   * 專案沒有任何有效金鑰時（例如剛建立）退回租戶層允許清單。
   */
  private projectMayUseAlias(project: Project, alias: string): boolean {
    // 已撤銷的金鑰不算；過期的仍代表專案設定過的意圖（到期待輪替）。沒有任何金鑰列出此別名 → 不對應
    return this.keys.some((k) => k.projectId === project.id && k.status !== 'revoked' && k.allowedModels.includes(alias));
  }

  /** 模型／別名是否包含租戶排除的來源地（例如公部門排除中國來源） */
  private excludedOriginOf(tenant: Tenant, id: string): string | null {
    if (tenant.excludeOrigins.length === 0) return null;
    const route = this.routes.find((r) => r.alias === id);
    const modelIds = route ? [...route.targets, ...route.fallbackChain, ...(route.spillover.target ? [route.spillover.target] : [])].map((t) => t.modelId) : [id];
    for (const mid of modelIds) {
      const m = MODEL_BY_ID[mid];
      const origin = m?.origin ?? (m && m.providerId === 'bailian' ? 'cn' : undefined);
      if (origin && (tenant.excludeOrigins as string[]).includes(origin)) return origin;
    }
    return null;
  }

  // ---------- 代理供應商（雲端／夥伴） ----------
  async listProviders(session: Session): Promise<ApiResult<ProviderInfo[]>> {
    const g = await this.guardAnywhere(session, 'provider.read');
    if (!g.ok) return g;
    return { ok: true, data: this.providers, requestId: g.requestId };
  }

  /**
   * 測試供應商連線（示範）：以金鑰呼叫該地域 /models。金鑰不落地、不寫入稽核。
   * 自建 GPU 節點（providerId 'vllm'）則需要 cluster.register（新增節點到我們的叢集）。
   */
  async testProviderConnection(
    session: Session,
    input: { providerId: ProviderId; region: string; baseUrl: string; apiKey: string; meta?: LocalNodeMeta },
  ): Promise<ApiResult<ConnectionTestResult>> {
    const action: Action = input.providerId === 'vllm' ? 'cluster.register' : 'provider.configure';
    const targetCluster = input.meta?.clusterId ? this.clusters.find((c) => c.id === input.meta?.clusterId) : undefined;
    const scope = targetCluster ? clusterScope(targetCluster.id) : PLATFORM_SCOPE;
    const g = await this.guard(session, action, scope, { resourceType: 'provider', resourceId: `${input.providerId}:${input.region}` });
    if (!g.ok) return g;
    const warnings = new KeyedList();
    const key = (input.apiKey ?? '').trim();
    const needsKey = input.providerId !== 'vllm';
    if (needsKey && key.length < 8) return this.err(400, 'INVALID_ARGUMENT', kt('server.err.INVALID_ARGUMENT.apiKeyRequired'), g.requestId);
    if (input.providerId === 'bailian') {
      if (key.startsWith('sk-sp-')) return this.err(401, 'invalid_api_key', kt('server.err.invalid_api_key.codingPlan'), g.requestId);
      if (!key.startsWith('sk-')) return this.err(401, 'invalid_api_key', kt('server.err.invalid_api_key.bailianRegion'), g.requestId);
      if (!input.baseUrl.includes('maas.aliyuncs.com')) warnings.push('server.warn.connect.legacyDomain');
      if (input.baseUrl.includes('{WorkspaceId}')) warnings.push('server.warn.connect.workspacePlaceholder');
      if (input.region === 'cn-beijing') warnings.push('server.warn.connect.cnBeijing');
    } else if (needsKey && !key.startsWith('sk-') && !key.startsWith('AIza')) {
      return this.err(401, 'invalid_api_key', kt('server.err.invalid_api_key.format'), g.requestId);
    }
    if (!/^https:\/\//.test(input.baseUrl)) return this.err(400, 'INVALID_ARGUMENT', kt('server.err.INVALID_ARGUMENT.https'), g.requestId);
    let models: ConnectionTestResult['models'];
    let node: ConnectionTestResult['node'];
    if (input.providerId === 'vllm') {
      // 我們的 GPU 節點：探測 /models（已服務）＋ 列出可部署的開放權重模型
      if (!/\.internal\.|\.local\b|^https:\/\/10\.|^https:\/\/192\.168\./.test(input.baseUrl)) warnings.push('server.warn.connect.notInternal');
      const served = MODELS.filter((mdl) => mdl.providerId === 'vllm' && mdl.regions.includes(input.region));
      const deployable = MODELS.filter((mdl) => mdl.providerId === 'vllm' && mdl.deployable && !mdl.regions.includes(input.region));
      models = [...served.map((mdl) => ({ id: mdl.id, displayName: mdl.displayName, served: true })), ...deployable.map((mdl) => ({ id: mdl.id, displayName: mdl.displayName, served: false }))];
      const meta = input.meta ?? { nodeName: zh('server.const.newNodeName'), gpuType: 'H100 80GB', gpuCount: 4, engine: 'vLLM' };
      const vramPer = GPU_SPECS[meta.gpuType]?.vramGb ?? 24;
      node = { nodeName: meta.nodeName, gpu: `${meta.gpuCount} × ${meta.gpuType}`, vram: `${vramPer * meta.gpuCount} GB（${vramPer} GB × ${meta.gpuCount}）`, engine: meta.engine, utilization: served.length ? 0.35 + Math.random() * 0.3 : 0.02, queueDepth: served.length ? Math.round(Math.random() * 4) : 0, kvCacheHitRate: served.length ? 0.4 + Math.random() * 0.3 : 0 };
      if (meta.gpuCount * vramPer < 64) warnings.push('server.warn.connect.lowVram');
      if (served.length === 0) warnings.push('server.warn.connect.noModels');
      if (meta.clusterId) {
        const cl = this.clusters.find((c) => c.id === meta.clusterId);
        if (cl && cl.gpuType !== meta.gpuType) warnings.push('server.warn.connect.mixedGpu', { cluster: cl.name, clusterGpu: cl.gpuType, gpu: meta.gpuType });
      }
    } else {
      models = MODELS.filter((mdl) => mdl.providerId === input.providerId && (input.providerId !== 'bailian' || mdl.regions.length === 0 || mdl.regions.includes(input.region))).map((mdl) => ({ id: mdl.id, displayName: mdl.displayName, served: true }));
      if (models.length === 0) warnings.push('server.warn.connect.noRegionModels');
    }
    const existing = this.providers.find((x) => x.id === input.providerId)?.endpoints.find((e) => e.region === input.region);
    const latencyMs = input.providerId === 'vllm' ? 120 + Math.round(Math.random() * 80) : existing ? existing.latencyMs + Math.round(Math.random() * 60 - 30) : 260 + Math.round(Math.random() * 300);
    this.log({ actorId: g.principal.id, principalId: g.principal.id, action, scope, decision: 'allow', requestId: g.requestId, resourceType: 'provider', resourceId: `${input.providerId}:${input.region}`, ...rsn(input.providerId === 'vllm' ? 'server.audit.probeNode' : 'server.audit.testConnection') });
    return { ok: true, data: { latencyMs, models, warnings: warnings.texts, warningKeys: warnings.keys, node }, requestId: g.requestId };
  }

  /** 建立／更新供應商地域端點（示範）：金鑰僅以 KMS 參考儲存。自建 GPU 節點會註冊到指定叢集的共用節點池。 */
  async connectProvider(
    session: Session,
    input: { providerId: ProviderId; region: string; regionLabel: string; baseUrl: string; rpmLimit: number; tpmLimit: number; enabledModels: string[]; note?: string; meta?: LocalNodeMeta },
  ): Promise<ApiResult<ProviderInfo>> {
    const action: Action = input.providerId === 'vllm' ? 'cluster.register' : 'provider.configure';
    const targetCluster = input.meta?.clusterId ? this.clusters.find((c) => c.id === input.meta?.clusterId) : undefined;
    const scope = targetCluster ? clusterScope(targetCluster.id) : PLATFORM_SCOPE;
    const g = await this.guard(session, action, scope, { resourceType: 'provider', resourceId: `${input.providerId}:${input.region}` });
    if (!g.ok) return g;
    const p = this.providers.find((x) => x.id === input.providerId);
    if (!p) return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.provider', { id: input.providerId }), g.requestId);
    if (!/^https:\/\//.test(input.baseUrl)) return this.err(400, 'INVALID_ARGUMENT', kt('server.err.INVALID_ARGUMENT.https'), g.requestId);
    if (input.enabledModels.length === 0) return this.err(400, 'INVALID_ARGUMENT', kt('server.err.INVALID_ARGUMENT.enableModel'), g.requestId);
    const before = JSON.parse(JSON.stringify(p));
    const keyRef = input.providerId === 'vllm' ? `mtls://maas-demo/${input.region}` : `kms://maas-demo/${input.providerId}/${input.region}`;
    const existing = p.endpoints.find((e) => e.region === input.region);
    if (existing) {
      existing.baseUrl = input.baseUrl;
      existing.keyRef = keyRef;
      existing.rpmLimit = input.rpmLimit;
      existing.tpmLimit = input.tpmLimit;
      existing.health = 'healthy';
      existing.note = input.note;
      existing.legacy = false;
    } else {
      p.endpoints.push({ region: input.region, regionLabel: input.regionLabel, baseUrl: input.baseUrl, note: input.note, keyRef, rpmLimit: input.rpmLimit, tpmLimit: input.tpmLimit, latencyMs: 350, health: 'healthy' });
    }
    p.enabled = true;
    if (p.health === 'down') p.health = 'healthy';
    if (input.providerId === 'vllm') {
      // 我們的 GPU 節點：更新自建推論層容量、把部署的模型標記到此節點
      const meta = input.meta ?? { nodeName: input.regionLabel, gpuType: 'H100 80GB', gpuCount: 4, engine: 'vLLM' };
      const cap = p.capacity ?? { gpus: '', nodes: 0, servingEngine: meta.engine, utilization: 0.5, queueDepth: 0, kvCacheHitRate: 0.5, tokensPerSec: 0, models: [] };
      if (!existing) {
        cap.nodes += 1;
        cap.gpus = cap.gpus ? zh('server.const.capacityAppend', { prev: cap.gpus, count: meta.gpuCount, gpu: meta.gpuType }) : zh('server.const.capacityNode', { count: meta.gpuCount, gpu: meta.gpuType });
        // 與部署／用量同一套吞吐估算：以 27B FP8 參考模型計每卡 tok/s
        cap.tokensPerSec += meta.gpuCount * tokPerSecPerGpu('qwen3.8-27b-vllm', meta.gpuType, 'FP8');
      }
      for (const id of input.enabledModels) {
        const base = id.replace(/-vllm$/, '');
        if (!cap.models.includes(base)) cap.models.push(base);
        const mdl = MODELS.find((x) => x.id === id);
        if (mdl && !mdl.regions.includes(input.region)) mdl.regions.push(input.region);
        if (mdl && mdl.status === 'preview') mdl.status = 'ga';
      }
      p.capacity = cap;
      // 註冊到叢集（共用節點池）
      const cluster = meta.clusterId ? this.clusters.find((c) => c.id === meta.clusterId) : undefined;
      if (cluster && !existing) {
        let pool = cluster.nodePools.find((x) => x.sharing === 'shared');
        if (!pool) {
          pool = { id: `${cluster.id}-shared`, name: zh('data.cluster.pool.sharedName'), nameKey: 'data.cluster.pool.sharedName', gpuType: meta.gpuType, sharing: 'shared' };
          cluster.nodePools.push(pool);
        }
        this.nodes.push({
          id: this.nextId('n'),
          clusterId: cluster.id,
          poolId: pool.id,
          name: meta.nodeName.replace(/\s+/g, '-').toLowerCase(),
          gpuType: meta.gpuType,
          gpuCount: meta.gpuCount,
          gpuAllocated: 0,
          memoryGbPerGpu: GPU_SPECS[meta.gpuType]?.vramGb ?? 24,
          memoryUsedGb: 0,
          smActive: 0,
          idleMinutes: 0,
          status: 'ready',
          agentVersion: cluster.agentVersion,
        });
        cluster.nodeCount += 1;
        cluster.gpuTotal += meta.gpuCount;
        this.pushEvent(cluster.id, 'info', kt('server.event.nodeJoined', { node: meta.nodeName, count: meta.gpuCount, gpu: meta.gpuType, engine: meta.engine }), g.requestId);
      }
    }
    this.log({
      actorId: g.principal.id,
      principalId: g.principal.id,
      action,
      scope,
      decision: 'allow',
      requestId: g.requestId,
      before,
      after: JSON.parse(JSON.stringify(p)),
      resourceType: 'provider',
      resourceId: `${input.providerId}:${input.region}`,
      ...(input.providerId === 'vllm'
        ? input.meta?.clusterId
          ? rsn('server.audit.registerNodeToCluster', { cluster: input.meta.clusterId, models: input.enabledModels.join(', ') })
          : rsn('server.audit.registerNode', { models: input.enabledModels.join(', ') })
        : rsn('server.audit.connectCloud', { models: input.enabledModels.join(', ') })),
    });
    return { ok: true, data: p, requestId: g.requestId };
  }

  async updateProvider(
    session: Session,
    providerId: string,
    patch: { enabled?: boolean; endpoints?: { region: string; rpmLimit: number; tpmLimit: number }[] },
  ): Promise<ApiResult<ProviderInfo>> {
    const g = await this.guard(session, 'provider.configure', PLATFORM_SCOPE, { resourceType: 'provider', resourceId: providerId });
    if (!g.ok) return g;
    const p = this.providers.find((x) => x.id === providerId);
    if (!p) return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.provider', { id: providerId }), g.requestId);
    const before = JSON.parse(JSON.stringify(p));
    if (patch.enabled !== undefined) p.enabled = patch.enabled;
    if (patch.endpoints) {
      for (const e of patch.endpoints) {
        const ep = p.endpoints.find((x) => x.region === e.region);
        if (ep) {
          ep.rpmLimit = e.rpmLimit;
          ep.tpmLimit = e.tpmLimit;
        }
      }
    }
    this.log({ actorId: g.principal.id, principalId: g.principal.id, action: 'provider.configure', scope: PLATFORM_SCOPE, decision: 'allow', requestId: g.requestId, before, after: JSON.parse(JSON.stringify(p)), resourceType: 'provider', resourceId: providerId });
    return { ok: true, data: p, requestId: g.requestId };
  }

  // ---------- 推論叢集（我們的 GPU 機房；平台層資源 /clusters/{c}） ----------
  private pushEvent(clusterId: string, level: ClusterEvent['level'], msg: KeyedText, requestId?: string) {
    this.events.push({ id: this.nextId('ev'), clusterId, timestamp: new Date().toISOString(), level, message: zh(msg.key, msg.params), messageKey: msg.key, params: msg.params, requestId });
  }

  private poolViews(c: Cluster): NodePoolView[] {
    return c.nodePools.map((p) => {
      const ns = this.nodes.filter((n) => n.clusterId === c.id && n.poolId === p.id);
      return { ...p, dedicatedTenantName: this.tenantName(p.dedicatedTenantId), nodeCount: ns.length, gpuTotal: ns.reduce((s, n) => s + n.gpuCount, 0), gpuAllocated: ns.reduce((s, n) => s + n.gpuAllocated, 0) };
    });
  }

  /** 叢集的對外檢視：GPU 利用率由就緒部署推導（與用量種子一致），再套用「模擬叢集中斷／容量耗盡」與節點池容量 */
  private clusterView(c: Cluster): ClusterView {
    const pools = this.poolViews(c);
    const gpuUtil = c.status === 'connected' ? clusterUtilFromDeployments(c, this.deployments) : c.gpuUtil;
    if (this.options.simulateClusterOutage && c.id === 'cl-tpe-a' && c.status === 'connected') {
      return { ...c, status: 'disconnected', gpuUtil: 0, queueDepth: 0, lastHeartbeat: '2026-11-08T09:48:00+08:00', pools };
    }
    if (this.options.simulateLocalExhausted && c.status === 'connected') {
      return { ...c, gpuUtil: Math.max(gpuUtil, 0.97), queueDepth: Math.max(c.queueDepth, 24), pools };
    }
    return { ...c, gpuUtil, pools };
  }

  private deploymentView(d: Deployment): DeploymentView {
    let view = d;
    if (this.options.simulateClusterOutage && d.clusterId === 'cl-tpe-a' && d.status === 'ready') view = { ...d, status: 'error', statusMessage: zh('server.status.clusterOutage'), statusMessageKey: 'server.status.clusterOutage', statusMessageParams: undefined };
    else if (this.options.simulateLocalExhausted && d.status === 'ready') view = { ...d, queueDepth: Math.max(d.queueDepth, 24), utilization: 0.97 };
    return { ...view, modelName: MODEL_BY_ID[d.modelId]?.displayName ?? d.modelId, clusterName: this.clusters.find((c) => c.id === d.clusterId)?.name ?? d.clusterId, dedicatedTenantName: this.tenantName(d.dedicatedTenantId) };
  }

  /** 叢集清單：集合類 API，過濾為主體在叢集範圍（/clusters/{c}）具 cluster.read 者；客戶角色沒有此動作 → 403 */
  async listClusters(session: Session): Promise<ApiResult<ClusterView[]>> {
    const g = await this.guardAnywhere(session, 'cluster.read');
    if (!g.ok) return g;
    const data = this.clusters.filter((c) => this.authorize(g.principal, 'cluster.read', clusterScope(c.id)).allowed).map((c) => this.clusterView(c));
    return { ok: true, data, requestId: g.requestId };
  }

  /** 叢集層資源的守門：找不到回 404，其餘在叢集範圍檢查動作 */
  private async guardCluster(session: Session, clusterId: string, action: Action, opts?: { resourceType?: string; resourceId?: string }) {
    const c = this.clusters.find((x) => x.id === clusterId);
    if (!c) {
      await this.simulate();
      return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.cluster', { id: clusterId }), newRequestId());
    }
    const g = await this.guard(session, action, clusterScope(c.id), { resourceType: opts?.resourceType ?? 'cluster', resourceId: opts?.resourceId ?? c.id });
    if (!g.ok) return g;
    return { ...g, cluster: c };
  }

  async getCluster(session: Session, clusterId: string): Promise<ApiResult<ClusterView>> {
    const g = await this.guardCluster(session, clusterId, 'cluster.read');
    if (!g.ok) return g;
    return { ok: true, data: this.clusterView(g.cluster), requestId: g.requestId };
  }

  async listNodes(session: Session, clusterId: string): Promise<ApiResult<GpuNode[]>> {
    const g = await this.guardCluster(session, clusterId, 'cluster.read');
    if (!g.ok) return g;
    const outage = this.options.simulateClusterOutage && clusterId === 'cl-tpe-a';
    const data = this.nodes.filter((n) => n.clusterId === clusterId).map((n) => (outage ? { ...n, status: 'not-ready' as const, smActive: 0 } : n));
    return { ok: true, data, requestId: g.requestId };
  }

  async listClusterEvents(session: Session, clusterId: string): Promise<ApiResult<ClusterEvent[]>> {
    const g = await this.guardCluster(session, clusterId, 'cluster.read');
    if (!g.ok) return g;
    const data = [...this.events.filter((e) => e.clusterId === clusterId)].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return { ok: true, data, requestId: g.requestId };
  }

  /** 節點池（共用／專屬）與容量 */
  async listNodePools(session: Session, clusterId: string): Promise<ApiResult<NodePoolView[]>> {
    const g = await this.guardCluster(session, clusterId, 'cluster.read');
    if (!g.ok) return g;
    return { ok: true, data: this.poolViews(g.cluster), requestId: g.requestId };
  }

  /**
   * 註冊叢集（我們的新機房加入控制面）：建立「等待加入」的叢集物件並產生加入指令與一次性 token。
   * 機房內的代理程式主動連回控制面；加入後回報節點與 GPU（DCGM）。平台層資源，需平台範圍 cluster.register。
   */
  async registerCluster(session: Session, input: RegisterClusterInput): Promise<ApiResult<ClusterView>> {
    const g = await this.guard(session, 'cluster.register', PLATFORM_SCOPE, { resourceType: 'cluster' });
    if (!g.ok) return g;
    if (!input.name.trim()) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.clusterName'), g.requestId);
    if (this.clusters.some((c) => c.name === input.name.trim())) return this.err(409, 'CONFLICT', kt('server.err.CONFLICT.clusterName', { name: input.name }), g.requestId);
    if (!GPU_SPECS[input.gpuType]) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.gpuType', { gpu: input.gpuType }), g.requestId);
    if (!/^v?1\.(3[2-9]|[4-9]\d)\./.test(input.k8sVersion)) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.k8sVersion'), g.requestId);
    const dedicatedTenant = input.dedicatedTenantId ? this.tenantById(input.dedicatedTenantId) : undefined;
    if (input.dedicatedTenantId && !dedicatedTenant) return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.tenant', { id: input.dedicatedTenantId }), g.requestId);
    const id = `cl-${input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || rnd4()}-${rnd4()}`;
    const token = `mcp-${rnd4()}${rnd4()}-${rnd4()}${rnd4()}`;
    const now = new Date();
    const pool: NodePool = dedicatedTenant
      ? { id: `${id}-dedicated`, name: zh('data.cluster.pool.dedicatedName', { tenant: dedicatedTenant.name }), nameKey: 'data.cluster.pool.dedicatedName', nameParams: { tenant: dedicatedTenant.name }, gpuType: input.gpuType, sharing: 'dedicated', dedicatedTenantId: dedicatedTenant.id }
      : { id: `${id}-shared`, name: zh('data.cluster.pool.sharedName'), nameKey: 'data.cluster.pool.sharedName', gpuType: input.gpuType, sharing: 'shared' };
    const cluster: Cluster = {
      id,
      name: input.name.trim(),
      site: input.site.trim() || zh('server.const.siteUnspecified'),
      region: `tw-${id.replace(/^cl-/, '')}`,
      status: 'waiting',
      k8sVersion: input.k8sVersion,
      gpuType: input.gpuType,
      nodeCount: 0,
      gpuTotal: 0,
      gpuAllocated: 0,
      gpuUtil: 0,
      engine: input.engine,
      agentVersion: '—',
      lastHeartbeat: null,
      queueDepth: 0,
      nodePools: [pool],
      // 一次性 token 以檔案方式交付（不出現在指令列／shell 歷史）：UI 另提供 token 讓操作者存成 join-token.txt
      agentInstallCommand: `kubectl apply -f ${CONTROL_PLANE_HOST}/agent/${id}.yaml\n# ${zh('server.const.agentJoinTokenComment')}\nkubectl -n maas-agent create secret generic join-token --from-file=token=./join-token.txt\nshred -u ./join-token.txt`,
      oneTimeToken: token,
      tokenExpiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      createdAt: now.toISOString(),
      createdBy: g.principal.id,
    };
    this.clusters.push(cluster);
    CLUSTER_REGION[id] = cluster.region;
    this.pushEvent(id, 'info', kt('server.event.clusterRegistered'), g.requestId);
    const regParams = { name: cluster.name, gpu: input.gpuType, nodes: input.nodeCount, gpus: input.gpusPerNode };
    this.log({ actorId: g.principal.id, principalId: g.principal.id, action: 'cluster.register', scope: clusterScope(id), decision: 'allow', requestId: g.requestId, before: null, after: { ...cluster, oneTimeToken: '••••' }, resourceType: 'cluster', resourceId: id, ...(dedicatedTenant ? rsn('server.audit.registerCluster.dedicated', { ...regParams, tenant: dedicatedTenant.name }) : rsn('server.audit.registerCluster.shared', regParams)) });
    const connect = () => this.agentConnected(id, input.nodeCount, input.gpusPerNode);
    if (this.options.agentConnectMs <= 0) connect();
    else setTimeout(connect, this.options.agentConnectMs);
    return { ok: true, data: this.clusterView(cluster), requestId: g.requestId };
  }

  /** 模擬代理程式加入：狀態 等待加入 → 已連線，並以代理程式回報的節點資料建立節點 */
  private agentConnected(clusterId: string, nodeCount: number, gpusPerNode: number) {
    const c = this.clusters.find((x) => x.id === clusterId);
    if (!c || c.status !== 'waiting') return;
    const n = Math.max(1, nodeCount);
    const per = Math.max(1, gpusPerNode);
    const poolId = c.nodePools[0]?.id ?? `${c.id}-shared`;
    for (let i = 0; i < n; i++) {
      this.nodes.push({
        id: this.nextId('n'),
        clusterId,
        poolId,
        name: `${clusterId.replace(/^cl-/, '')}-gpu-${String(i + 1).padStart(2, '0')}`,
        gpuType: c.gpuType,
        gpuCount: per,
        gpuAllocated: 0,
        memoryGbPerGpu: GPU_SPECS[c.gpuType]?.vramGb ?? 24,
        memoryUsedGb: 0,
        smActive: 0,
        idleMinutes: 0,
        status: 'ready',
        agentVersion: '1.8.2',
      });
    }
    c.status = 'connected';
    c.nodeCount = n;
    c.gpuTotal = n * per;
    c.agentVersion = '1.8.2';
    c.lastHeartbeat = new Date().toISOString();
    c.oneTimeToken = null; // 一次性 token 用畢作廢
    this.pushEvent(clusterId, 'info', kt('server.event.agentConnected', { nodes: n, per, gpu: c.gpuType }));
  }

  async drainNode(session: Session, nodeId: string): Promise<ApiResult<GpuNode>> {
    return this.operateNode(session, nodeId, 'drain');
  }
  async uncordonNode(session: Session, nodeId: string): Promise<ApiResult<GpuNode>> {
    return this.operateNode(session, nodeId, 'uncordon');
  }

  private async operateNode(session: Session, nodeId: string, verb: 'drain' | 'uncordon'): Promise<ApiResult<GpuNode>> {
    const n = this.nodes.find((x) => x.id === nodeId);
    if (!n) {
      await this.simulate();
      return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.node', { id: nodeId }), newRequestId());
    }
    const g = await this.guardCluster(session, n.clusterId, 'cluster.operate', { resourceType: 'node', resourceId: nodeId });
    if (!g.ok) return g;
    const before = { ...n };
    if (verb === 'drain') {
      if (n.status === 'draining' || n.status === 'drained') return this.err(409, 'CONFLICT', kt('server.err.CONFLICT.nodeDraining'), g.requestId);
      n.status = 'draining';
      const finish = () => {
        if (n.status !== 'draining') return;
        const released = n.gpuAllocated;
        n.status = 'drained';
        n.gpuAllocated = 0;
        n.memoryUsedGb = 0;
        n.smActive = 0;
        const summary = this.reconcileAfterDrain(n, released);
        this.pushEvent(n.clusterId, 'info', this.drainDoneMsg(n.name, released, summary));
      };
      if (this.options.drainMs <= 0) finish();
      else setTimeout(finish, this.options.drainMs);
      this.pushEvent(n.clusterId, 'warning', kt('server.event.drainStarted', { node: n.name }), g.requestId);
    } else {
      if (n.status === 'ready') return this.err(409, 'CONFLICT', kt('server.err.CONFLICT.nodeReady'), g.requestId);
      if (n.status === 'draining') return this.err(409, 'CONFLICT', kt('server.err.CONFLICT.nodeDrainInProgress'), g.requestId);
      n.status = 'ready';
      n.idleMinutes = 0;
      this.pushEvent(n.clusterId, 'info', kt('server.event.nodeResumed', { node: n.name }), g.requestId);
    }
    this.log({ actorId: g.principal.id, principalId: g.principal.id, action: 'cluster.operate', scope: clusterScope(g.cluster.id), decision: 'allow', requestId: g.requestId, before, after: { ...n }, resourceType: 'node', resourceId: nodeId, ...rsn(verb === 'drain' ? 'server.audit.drainNode' : 'server.audit.resumeNode', { node: n.name }) });
    return { ok: true, data: { ...n }, requestId: g.requestId };
  }

  /**
   * 排空後讓 cluster.gpuAllocated 與部署副本數保持一致：
   * 先嘗試把釋出的 GPU 遷移到同一節點池其他就緒節點；池內無可用 GPU 的部分，依部署（大者優先）減少副本並標示「待遷移」。
   */
  /** 排空完成事件：依摘要（遷移數、待遷移部署）選擇完整句的鍵，讓各語言可完整翻譯 */
  private drainDoneMsg(node: string, released: number, s: DrainSummary): KeyedText {
    const base = { node, released };
    if (s.migrated === 0 && s.pending.length === 0) return kt('server.event.drainDone.none', base);
    if (s.pending.length === 0) return kt('server.event.drainDone.migrated', { ...base, migrated: s.migrated });
    if (s.pending.length === 1) {
      const p = { ...base, deployment: s.pending[0].name, count: s.pending[0].count };
      return s.migrated > 0 ? kt('server.event.drainDone.migratedPending', { ...p, migrated: s.migrated }) : kt('server.event.drainDone.pending', p);
    }
    // 多個待遷移部署：摘要以 zh-TW 組成（少見情況）
    const notes = [...(s.migrated > 0 ? [zh('server.event.drainNote.migrated', { migrated: s.migrated })] : []), ...s.pending.map((p) => zh('server.event.drainNote.pending', { deployment: p.name, count: p.count }))];
    return kt('server.event.drainDone', { ...base, summary: notes.join('；') });
  }

  private reconcileAfterDrain(n: GpuNode, released: number): DrainSummary {
    const cluster = this.clusters.find((c) => c.id === n.clusterId);
    if (!cluster || released <= 0) return { migrated: 0, pending: [] };
    cluster.gpuAllocated = Math.max(0, cluster.gpuAllocated - released);
    const pool = cluster.nodePools.find((p) => p.id === n.poolId);
    const others = this.nodes.filter((x) => x.clusterId === cluster.id && x.poolId === n.poolId && x.id !== n.id && x.status === 'ready');
    let remain = released;
    let migrated = 0;
    for (const o of others) {
      if (remain <= 0) break;
      const take = Math.min(remain, o.gpuCount - o.gpuAllocated);
      if (take > 0) {
        o.gpuAllocated += take;
        o.memoryUsedGb += Math.round(take * o.memoryGbPerGpu * 0.6);
        remain -= take;
        migrated += take;
      }
    }
    cluster.gpuAllocated += migrated;
    const pending: DrainSummary['pending'] = [];
    if (remain > 0) {
      // 池內無可用 GPU：縮減此池部署的副本，標示待遷移。每次挑「每副本 GPU 數 ≤ 剩餘」中最大的；都放不進時挑最小的並把多釋出的 GPU 也從節點收回
      const deps = this.deployments.filter((d) => d.clusterId === cluster.id && d.status === 'ready' && d.replicas > 0 && (pool?.sharing === 'dedicated' ? d.sharing === 'dedicated' && d.dedicatedTenantId === pool.dedicatedTenantId : d.sharing === 'shared'));
      const touched = new Set<Deployment>();
      while (remain > 0) {
        const candidates = deps.filter((d) => d.replicas > 0);
        if (candidates.length === 0) break;
        const fitting = candidates.filter((d) => d.gpusPerReplica <= remain).sort((a, b) => b.gpusPerReplica - a.gpusPerReplica);
        const d = fitting[0] ?? [...candidates].sort((a, b) => a.gpusPerReplica - b.gpusPerReplica)[0];
        d.replicas -= 1;
        d.pendingMigrationReplicas = (d.pendingMigrationReplicas ?? 0) + 1;
        remain -= d.gpusPerReplica;
        (d.replicaHistory ??= [{ at: d.createdAt, replicas: d.replicas + 1 }]).push({ at: new Date().toISOString(), replicas: d.replicas });
        touched.add(d);
      }
      if (remain < 0) {
        // 多釋出的 GPU（副本無法切半）：從池內其他節點收回，使 節點 Σ ＝ 叢集 ＝ 部署 Σ
        let surplus = -remain;
        cluster.gpuAllocated = Math.max(0, cluster.gpuAllocated - surplus);
        for (const o of others) {
          if (surplus <= 0) break;
          const give = Math.min(surplus, o.gpuAllocated);
          o.gpuAllocated -= give;
          o.memoryUsedGb = Math.max(0, o.memoryUsedGb - Math.round(give * o.memoryGbPerGpu * 0.6));
          surplus -= give;
        }
      }
      for (const d of touched) {
        d.status = d.replicas === 0 ? 'error' : 'ready';
        d.statusMessageKey = 'server.status.pendingMigration';
        d.statusMessageParams = { node: n.name, count: d.pendingMigrationReplicas };
        d.statusMessage = zh(d.statusMessageKey, d.statusMessageParams);
        d.updatedAt = new Date().toISOString();
        pending.push({ name: d.name, count: d.pendingMigrationReplicas ?? 0 });
      }
    }
    return { migrated, pending };
  }

  // ---------- 模型部署（共用／專屬） ----------
  /** 部署是否與某租戶相關：共用部署且方案允許此模型，或專屬於該租戶 */
  private deploymentServesTenant(d: Deployment, tenant: Tenant): boolean {
    if (d.sharing === 'dedicated') return d.dedicatedTenantId === tenant.id;
    return this.modelAllowedForTenant(tenant, d.modelId) && !this.excludedOriginOf(tenant, d.modelId);
  }

  /** 部署清單：供應商（平台範圍 deployment.read）看全部；客戶只看服務自己的（共用且方案允許的模型，或專屬於自己） */
  async listDeployments(session: Session, filter?: { clusterId?: string; modelId?: string }): Promise<ApiResult<DeploymentView[]>> {
    const g = await this.guardAnywhere(session, 'deployment.read');
    if (!g.ok) return g;
    const tenant = g.principal.tenantId ? this.tenantById(g.principal.tenantId) : undefined;
    const data = this.deployments
      .filter((d) => (!filter?.clusterId || d.clusterId === filter.clusterId) && (!filter?.modelId || d.modelId === filter.modelId))
      .filter((d) => {
        if (this.authorize(g.principal, 'deployment.read', clusterScope(d.clusterId)).allowed) return true;
        if (!tenant) return false;
        return this.authorize(g.principal, 'deployment.read', tenantScope(tenant.id)).allowed && this.deploymentServesTenant(d, tenant);
      })
      .map((d) => this.deploymentView(d));
    return { ok: true, data, requestId: g.requestId };
  }

  /**
   * 可供某類部署使用的節點：
   * - 共用：只用共用節點池
   * - 專屬：只用該租戶的專屬節點池；只有明確 allowSharedFallback（寫入稽核）才可借用共用節點池
   */
  private eligibleNodes(cluster: Cluster, sharing: PoolSharing, tenantId?: string, allowSharedFallback = false): GpuNode[] {
    const dedicatedPools = cluster.nodePools.filter((p) => p.sharing === 'dedicated' && p.dedicatedTenantId === tenantId).map((p) => p.id);
    const sharedPools = cluster.nodePools.filter((p) => p.sharing === 'shared').map((p) => p.id);
    const order = sharing === 'dedicated' ? [...dedicatedPools, ...(allowSharedFallback ? sharedPools : [])] : sharedPools;
    const ready = this.nodes.filter((n) => n.clusterId === cluster.id && n.status === 'ready');
    return order.flatMap((pid) => ready.filter((n) => n.poolId === pid));
  }

  private freeGpusFor(cluster: Cluster, sharing: PoolSharing, tenantId?: string, allowSharedFallback = false): number {
    return this.eligibleNodes(cluster, sharing, tenantId, allowSharedFallback).reduce((s, n) => s + (n.gpuCount - n.gpuAllocated), 0);
  }

  async createDeployment(session: Session, input: CreateDeploymentInput): Promise<ApiResult<DeploymentView>> {
    const g = await this.guardCluster(session, input.clusterId, 'deployment.manage', { resourceType: 'deployment', resourceId: input.clusterId });
    if (!g.ok) return g;
    const cluster = g.cluster;
    const depScope = clusterScope(cluster.id);
    const deny = (code: string, msg: KeyedText, status: ApiError['status'] = 400) => {
      this.log({ actorId: g.principal.id, principalId: g.principal.id, action: 'deployment.manage', scope: depScope, decision: 'deny', requestId: g.requestId, ...codedRsn(code, msg), resourceType: 'deployment' });
      return this.err(status, code, msg, g.requestId);
    };
    if (this.clusterView(cluster).status !== 'connected') return this.err(409, 'CLUSTER_NOT_CONNECTED', kt('server.err.CLUSTER_NOT_CONNECTED.deploy', { cluster: cluster.name, status: this.clusterView(cluster).status }), g.requestId);
    const model = MODEL_BY_ID[input.modelId];
    if (!model || !isLocalModel(model) || !model.deployable) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.notDeployable'), g.requestId);
    if (!input.name.trim()) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.deploymentName'), g.requestId);
    if (this.deployments.some((d) => d.name === input.name.trim())) return this.err(409, 'CONFLICT', kt('server.err.CONFLICT.deploymentName', { name: input.name }), g.requestId);
    let dedicatedTenant: Tenant | undefined;
    if (input.sharing === 'dedicated') {
      if (!input.dedicatedTenantId) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.dedicatedTenant'), g.requestId);
      dedicatedTenant = this.tenantById(input.dedicatedTenantId);
      if (!dedicatedTenant) return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.tenant', { id: input.dedicatedTenantId }), g.requestId);
      const origin = this.excludedOriginOf(dedicatedTenant, model.id);
      if (origin) {
        const p = { tenant: dedicatedTenant.name, origin, model: model.displayName, basis: basisFrag(dedicatedTenant) };
        return deny('MODEL_NOT_ALLOWED', model.baseModel ? kt('server.err.MODEL_NOT_ALLOWED.dedicatedOriginBase', { ...p, base: model.baseModel }) : kt('server.err.MODEL_NOT_ALLOWED.dedicatedOrigin', p));
      }
    }
    const fit = vramFit(input.modelId, input.quantization, cluster.gpuType, Math.max(1, input.gpusPerReplica), input.maxNumSeqs, model.maxModelLen);
    if (!fit.ok) return deny(fit.code ?? 'INSUFFICIENT_VRAM', kt(fit.messageKey, fit.params));
    const need = Math.max(0, input.replicas) * Math.max(1, input.gpusPerReplica);
    const allowFallback = input.sharing === 'dedicated' && !!input.allowSharedFallback;
    if (input.sharing === 'dedicated' && !allowFallback) {
      const dedicatedFree = this.freeGpusFor(cluster, 'dedicated', dedicatedTenant?.id, false);
      if (need > dedicatedFree) {
        const msg = kt('server.err.DEDICATED_POOL_EXHAUSTED.create', { tenant: String(dedicatedTenant?.name), cluster: cluster.name, free: dedicatedFree, replicas: input.replicas, per: input.gpusPerReplica, need });
        this.log({ actorId: g.principal.id, principalId: g.principal.id, action: 'deployment.manage', scope: depScope, decision: 'deny', requestId: g.requestId, ...codedRsn('DEDICATED_POOL_EXHAUSTED', msg), resourceType: 'deployment' });
        return this.err(409, 'DEDICATED_POOL_EXHAUSTED', msg, g.requestId);
      }
    }
    const free = this.freeGpusFor(cluster, input.sharing, dedicatedTenant?.id, allowFallback);
    if (need > free) {
      const p = { free, replicas: input.replicas, per: input.gpusPerReplica, need };
      const variant = input.sharing === 'dedicated' ? (allowFallback ? 'dedicatedFallback' : 'dedicated') : 'shared';
      return this.err(400, 'INSUFFICIENT_GPUS', kt(`server.err.INSUFFICIENT_GPUS.create.${variant}`, input.sharing === 'dedicated' ? { ...p, tenant: String(dedicatedTenant?.name) } : p), g.requestId);
    }
    if (input.autoscaling.minReplicas > input.autoscaling.maxReplicas) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.minMaxReplicas'), g.requestId);
    const now = new Date().toISOString();
    const dep: Deployment = {
      id: this.nextId('dep'),
      name: input.name.trim(),
      modelId: input.modelId,
      clusterId: cluster.id,
      sharing: input.sharing,
      dedicatedTenantId: dedicatedTenant?.id,
      engine: input.engine,
      quantization: input.quantization,
      gpusPerReplica: Math.max(1, input.gpusPerReplica),
      replicas: Math.max(0, input.replicas),
      maxNumSeqs: input.maxNumSeqs,
      priorityScheduling: input.priorityScheduling,
      cacheSaltByTenant: input.cacheSaltByTenant,
      autoscaling: { ...input.autoscaling },
      rollout: { ...input.rollout },
      status: 'creating',
      vramGb: fit.requiredGb,
      // 與種子部署、用量 GPU 時數、供應商容量同一套估算（待 vllm bench serve 實測後由代理程式回報覆寫）
      tokPerSec: tokPerSecPerReplica(model, cluster.gpuType, input.quantization, Math.max(1, input.gpusPerReplica)),
      utilization: 0,
      queueDepth: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: g.principal.id,
      statusMessage: zh('server.status.creating'),
      statusMessageKey: 'server.status.creating',
      replicaHistory: [{ at: now, replicas: Math.max(0, input.replicas) }],
      allowSharedFallback: allowFallback || undefined,
    };
    this.deployments.push(dep);
    cluster.gpuAllocated += need;
    this.allocateNodes(cluster, need, dep.vramGb, dep.sharing, dep.dedicatedTenantId, allowFallback);
    const gpuList = this.billing.gpuListUsdPerHour[cluster.gpuType] ?? 0;
    const evParams = { name: dep.name, model: model.displayName, engine: dep.engine, quant: dep.quantization, replicas: dep.replicas, per: dep.gpusPerReplica, vram: dep.vramGb, weights: fit.weightsGb, kv: fit.kvGb, fallback: allowFallback ? '@server.frag.fallbackAllowed' : '' };
    this.pushEvent(cluster.id, 'info', dep.sharing === 'dedicated' ? kt('server.event.deploymentCreated.dedicated', { ...evParams, tenant: String(dedicatedTenant?.name) }) : kt('server.event.deploymentCreated.shared', evParams), g.requestId);
    this.log({ actorId: g.principal.id, principalId: g.principal.id, action: 'deployment.manage', scope: depScope, decision: 'allow', requestId: g.requestId, before: null, after: { ...dep }, resourceType: 'deployment', resourceId: dep.id, ...(dep.sharing === 'dedicated' ? rsn('server.audit.createDedicated', { name: dep.name, tenant: String(dedicatedTenant?.name), need, price: gpuList, fallback: allowFallback ? '@server.frag.auditFallback' : '' }) : rsn('server.audit.createShared', { name: dep.name })) });
    const ready = () => {
      if (dep.status !== 'creating') return;
      dep.status = dep.replicas === 0 ? 'scaled-to-zero' : 'ready';
      dep.utilization = dep.replicas === 0 ? 0 : 0.35;
      dep.statusMessage = undefined;
      dep.statusMessageKey = undefined;
      dep.statusMessageParams = undefined;
      dep.updatedAt = new Date().toISOString();
      const region = CLUSTER_REGION[cluster.id] ?? cluster.region;
      if (!model.regions.includes(region)) model.regions.push(region);
      if (model.status === 'preview') model.status = 'ga';
      this.pushEvent(cluster.id, 'info', kt('server.event.deploymentReady', { name: dep.name, replicas: dep.replicas }));
    };
    if (this.options.deploymentReadyMs <= 0) ready();
    else setTimeout(ready, this.options.deploymentReadyMs);
    return { ok: true, data: this.deploymentView(dep), requestId: g.requestId };
  }

  /** 依節點可用 GPU 數分配（示範：只更新節點的已分配數與顯存） */
  private allocateNodes(cluster: Cluster, gpus: number, vramPerReplicaGb: number, sharing: PoolSharing, tenantId?: string, allowSharedFallback = false) {
    let remain = gpus;
    for (const n of this.eligibleNodes(cluster, sharing, tenantId, allowSharedFallback)) {
      if (remain <= 0) break;
      const take = Math.min(remain, n.gpuCount - n.gpuAllocated);
      if (take > 0) {
        n.gpuAllocated += take;
        n.memoryUsedGb += Math.min(take * n.memoryGbPerGpu, Math.round((vramPerReplicaGb / Math.max(1, gpus)) * take));
        remain -= take;
      }
    }
  }

  async scaleDeployment(session: Session, deploymentId: string, replicas: number): Promise<ApiResult<DeploymentView>> {
    const dep = this.deployments.find((d) => d.id === deploymentId);
    if (!dep) {
      await this.simulate();
      return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.deployment', { id: deploymentId }), newRequestId());
    }
    const g = await this.guardCluster(session, dep.clusterId, 'deployment.manage', { resourceType: 'deployment', resourceId: deploymentId });
    if (!g.ok) return g;
    const cluster = g.cluster;
    const clusterStatus = this.clusterView(cluster).status;
    if (clusterStatus !== 'connected') return this.err(409, 'CLUSTER_NOT_CONNECTED', kt('server.err.CLUSTER_NOT_CONNECTED.scale', { cluster: cluster.name, status: clusterStatus }), g.requestId);
    if (!Number.isInteger(replicas) || replicas < 0) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.replicasInteger'), g.requestId);
    if (replicas === 0 && !dep.autoscaling.scaleToZero) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.scaleToZeroDisabled'), g.requestId);
    if (replicas > 0 && replicas < dep.autoscaling.minReplicas) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.belowMinReplicas', { min: dep.autoscaling.minReplicas }), g.requestId);
    if (replicas > dep.autoscaling.maxReplicas) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.aboveMaxReplicas', { max: dep.autoscaling.maxReplicas }), g.requestId);
    const delta = (replicas - dep.replicas) * dep.gpusPerReplica;
    const fallback = !!dep.allowSharedFallback;
    const free = this.freeGpusFor(cluster, dep.sharing, dep.dedicatedTenantId, fallback);
    if (delta > free) {
      if (dep.sharing === 'dedicated' && !fallback) return this.err(409, 'DEDICATED_POOL_EXHAUSTED', kt('server.err.DEDICATED_POOL_EXHAUSTED.scale', { tenant: String(this.tenantName(dep.dedicatedTenantId)), free, delta }), g.requestId);
      return this.err(400, 'INSUFFICIENT_GPUS', kt(dep.sharing === 'dedicated' ? 'server.err.INSUFFICIENT_GPUS.scale.dedicatedFallback' : 'server.err.INSUFFICIENT_GPUS.scale.shared', { free, delta }), g.requestId);
    }
    const before = { ...dep };
    dep.replicas = replicas;
    cluster.gpuAllocated += delta;
    if (delta > 0) this.allocateNodes(cluster, delta, dep.vramGb, dep.sharing, dep.dedicatedTenantId, fallback);
    else this.releaseNodes(cluster, -delta, dep.sharing, dep.dedicatedTenantId);
    dep.status = replicas === 0 ? 'scaled-to-zero' : 'ready';
    dep.utilization = replicas === 0 ? 0 : Math.min(0.95, Math.max(0.2, dep.utilization || 0.4));
    dep.updatedAt = new Date().toISOString();
    (dep.replicaHistory ??= [{ at: dep.createdAt, replicas: before.replicas }]).push({ at: dep.updatedAt, replicas });
    if (dep.pendingMigrationReplicas) {
      dep.pendingMigrationReplicas = undefined;
      dep.statusMessage = undefined;
      dep.statusMessageKey = undefined;
      dep.statusMessageParams = undefined;
    }
    this.pushEvent(cluster.id, 'info', kt('server.event.deploymentScaled', { name: dep.name, from: before.replicas, to: replicas }), g.requestId);
    this.log({ actorId: g.principal.id, principalId: g.principal.id, action: 'deployment.manage', scope: clusterScope(cluster.id), decision: 'allow', requestId: g.requestId, before, after: { ...dep }, resourceType: 'deployment', resourceId: dep.id, ...rsn('server.audit.scaleDeployment', { name: dep.name, from: before.replicas, to: replicas }) });
    return { ok: true, data: this.deploymentView(dep), requestId: g.requestId };
  }

  private releaseNodes(cluster: Cluster, gpus: number, sharing: PoolSharing, tenantId?: string) {
    let remain = gpus;
    // 釋放時允許從共用節點池收回（專屬部署可能曾以 allowSharedFallback 借用）
    const pool = this.eligibleNodes(cluster, sharing, tenantId, true);
    const candidates = pool.length ? pool : this.nodes.filter((x) => x.clusterId === cluster.id);
    for (const n of [...candidates].reverse()) {
      if (remain <= 0) break;
      const give = Math.min(remain, n.gpuAllocated);
      n.gpuAllocated -= give;
      n.memoryUsedGb = Math.max(0, n.memoryUsedGb - give * Math.round(n.memoryGbPerGpu * 0.8));
      remain -= give;
    }
  }

  async deleteDeployment(session: Session, deploymentId: string): Promise<ApiResult<{ id: string }>> {
    const idx = this.deployments.findIndex((d) => d.id === deploymentId);
    if (idx < 0) {
      await this.simulate();
      return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.deployment', { id: deploymentId }), newRequestId());
    }
    const dep = this.deployments[idx];
    const g = await this.guardCluster(session, dep.clusterId, 'deployment.manage', { resourceType: 'deployment', resourceId: deploymentId });
    if (!g.ok) return g;
    const routesUsing = this.routes.filter((r) => [...r.targets, ...r.fallbackChain].some((t) => t.modelId === dep.modelId) && this.deployments.filter((d) => d.modelId === dep.modelId && d.id !== dep.id && d.status === 'ready').length === 0);
    if (routesUsing.length > 0) return this.err(409, 'DEPLOYMENT_IN_USE', kt('server.err.DEPLOYMENT_IN_USE', { model: dep.modelId, routes: routesUsing.map((r) => r.alias).join('、') }), g.requestId);
    const cluster = this.clusters.find((c) => c.id === dep.clusterId);
    if (cluster) {
      cluster.gpuAllocated = Math.max(0, cluster.gpuAllocated - dep.replicas * dep.gpusPerReplica);
      this.releaseNodes(cluster, dep.replicas * dep.gpusPerReplica, dep.sharing, dep.dedicatedTenantId);
    }
    this.deployments.splice(idx, 1);
    this.pushEvent(dep.clusterId, 'warning', kt('server.event.deploymentDeleted', { name: dep.name, gpus: dep.replicas * dep.gpusPerReplica }), g.requestId);
    this.log({ actorId: g.principal.id, principalId: g.principal.id, action: 'deployment.manage', scope: clusterScope(g.cluster.id), decision: 'allow', requestId: g.requestId, before: dep, after: null, resourceType: 'deployment', resourceId: dep.id, ...rsn('server.audit.deleteDeployment', { name: dep.name }) });
    return { ok: true, data: { id: deploymentId }, requestId: g.requestId };
  }

  // ---------- 路由與溢出 ----------
  async listRoutes(session: Session): Promise<ApiResult<ModelRoute[]>> {
    const g = await this.guardAnywhere(session, 'model.read');
    if (!g.ok) return g;
    return { ok: true, data: this.routes, requestId: g.requestId };
  }

  /** 溢出門檻正規化：缺 kvCacheUsage 的舊格式（只有 gpuUtil）以預設 0.85 補上；範圍檢查 */
  private normalizeThreshold(t: SpilloverThreshold): SpilloverThreshold | KeyedText {
    const kv = t.kvCacheUsage ?? 0.85;
    if (!(t.queueDepth >= 1 && t.queueDepth <= 64)) return kt('server.err.VALIDATION.queueThreshold');
    if (!(kv >= 0.5 && kv <= 0.99)) return kt('server.err.VALIDATION.kvThreshold');
    return { queueDepth: Math.round(t.queueDepth), kvCacheUsage: Math.round(kv * 100) / 100 };
  }

  async updateRouting(session: Session, routeId: string, patch: Partial<Pick<ModelRoute, 'targets' | 'fallbackChain' | 'regionPolicy' | 'placementPolicy' | 'allowedRegions' | 'overflow' | 'spillover' | 'retry' | 'circuitBreaker'>>): Promise<ApiResult<ModelRoute>> {
    // 路由屬平台層資源（PLATFORM_ONLY_ACTIONS）：只有我們的平台擁有者能更新；客戶角色一律 403
    const g = await this.guard(session, 'model.route.update', PLATFORM_SCOPE, { resourceType: 'route', resourceId: routeId });
    if (!g.ok) return g;
    const r = this.routes.find((x) => x.id === routeId);
    if (!r) return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.route', { id: routeId }), g.requestId);
    const targets = patch.targets ?? r.targets;
    const fallback = patch.fallbackChain ?? r.fallbackChain;
    const totalWeight = targets.reduce((s, t) => s + t.weight, 0);
    if (totalWeight !== 100) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.weightSum', { total: totalWeight }), g.requestId);
    const placement = patch.placementPolicy ?? r.placementPolicy;
    const regionPolicy = patch.regionPolicy ?? r.regionPolicy;
    const allowedRegions = patch.allowedRegions ?? r.allowedRegions;
    const spillIn = patch.spillover ?? r.spillover;
    const threshold = this.normalizeThreshold(spillIn.threshold);
    if ('key' in threshold) return this.err(400, 'VALIDATION', threshold, g.requestId);
    const spill = { ...spillIn, threshold };
    if (placement === 'local-only' && spill.enabled) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.localOnlySpill'), g.requestId);
    if (spill.enabled && (!spill.target || isLocalModel({ providerId: spill.target.providerId }))) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.spillTarget'), g.requestId);
    // 自建優先：主要目標只能是自建（雲端只能經由 spillover）；僅自建：主要目標與備援鏈都只能是自建
    if ((placement === 'local-first' || placement === 'local-only') && targets.some((t) => !isLocalModel({ providerId: t.providerId }))) return this.err(400, 'VALIDATION', kt(placement === 'local-first' ? 'server.err.VALIDATION.primaryLocal.localFirst' : 'server.err.VALIDATION.primaryLocal.localOnly'), g.requestId);
    if (placement === 'local-only' && fallback.some((t) => !isLocalModel({ providerId: t.providerId }))) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.fallbackLocal'), g.requestId);
    // 區域白名單：所有目標都必須在 allowedRegions 內；prefer-intl／intl-only 不可含中國站
    const all: RouteTarget[] = [...targets, ...fallback, ...(spill.target ? [spill.target] : [])];
    if (!allowedRegions || allowedRegions.length === 0) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.allowedRegionsEmpty'), g.requestId);
    const outside = all.filter((t) => !allowedRegions.includes(t.region)).map((t) => t.region);
    if (outside.length) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.regionOutside', { regions: Array.from(new Set(outside)).join('、'), allowed: allowedRegions.join('、') }), g.requestId);
    if ((regionPolicy === 'prefer-intl' || regionPolicy === 'intl-only') && [...allowedRegions, ...all.map((t) => t.region)].some((x) => CN_REGIONS.includes(x))) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.regionPolicyCn', { policy: regionPolicy, regions: CN_REGIONS.join('、') }), g.requestId);
    const before = JSON.parse(JSON.stringify(r));
    Object.assign(r, patch, { spillover: spill, allowedRegions, updatedAt: new Date().toISOString(), updatedBy: g.principal.id });
    if (patch.spillover) r.overflow = { ...spill.threshold };
    this.log({ actorId: g.principal.id, principalId: g.principal.id, action: 'model.route.update', scope: PLATFORM_SCOPE, decision: 'allow', requestId: g.requestId, before, after: JSON.parse(JSON.stringify(r)), resourceType: 'route', resourceId: routeId });
    return { ok: true, data: r, requestId: g.requestId };
  }

  // ---------- 租戶（客戶）與專案 ----------
  async listTenants(session: Session): Promise<ApiResult<Tenant[]>> {
    const requestId = newRequestId();
    await this.simulate();
    const principal = this.authenticate(session);
    if (!principal) return this.err(401, 'UNAUTHENTICATED', kt('server.err.UNAUTHENTICATED'), requestId);
    const data = this.tenants.filter((t) => this.authorize(principal, 'tenant.read', tenantScope(t.id)).allowed);
    return { ok: true, data, requestId };
  }

  async getTenant(session: Session, tenantId: string): Promise<ApiResult<Tenant>> {
    const g = await this.guard(session, 'tenant.read', tenantScope(tenantId), { resourceType: 'tenant', resourceId: tenantId });
    if (!g.ok) return g;
    const t = this.tenantById(tenantId);
    if (!t) return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.tenant', { id: tenantId }), g.requestId);
    return { ok: true, data: t, requestId: g.requestId };
  }

  /** 新增租戶（客戶上線）：平台範圍 tenant.create；公部門強制僅自建並排除中國來源；同時建立預設專案；寫入稽核 */
  async createTenant(session: Session, input: CreateTenantInput): Promise<ApiResult<Tenant>> {
    const g = await this.guard(session, 'tenant.create', PLATFORM_SCOPE, { resourceType: 'tenant' });
    if (!g.ok) return g;
    return this.createTenantWith(g, input);
  }

  /** 新增租戶的驗證與建立（已通過授權）；createTenant 與試用申請核准共用 */
  private createTenantWith(g: { principal: Principal; requestId: string }, input: CreateTenantInput): ApiResult<Tenant> {
    const name = input.name.trim();
    if (!name) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.tenantName'), g.requestId);
    if (this.tenants.some((t) => t.name === name)) return this.err(409, 'CONFLICT', kt('server.err.CONFLICT.tenantName', { name }), g.requestId);
    if (!['payg', 'committed', 'dedicated'].includes(input.plan)) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.unknownPlan'), g.requestId);
    if (!(input.quotas.rpm > 0 && input.quotas.tpm > 0)) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.quotaPositive'), g.requestId);
    if (input.quotas.monthlyBudgetUsd < 0) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.budgetNegative'), g.requestId);
    if (!input.costCenter.trim()) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.costCenter'), g.requestId);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.billingContact.email)) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.billingEmail'), g.requestId);
    let commitment: Tenant['commitment'];
    if (input.plan === 'committed') {
      if (!input.commitment || input.commitment.monthlyUsd <= 0) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.commitmentAmount'), g.requestId);
      if (input.commitment.discountPct < 0 || input.commitment.discountPct > 50) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.discountRange'), g.requestId);
      commitment = { ...input.commitment };
    }
    const publicSector = input.dataClass === 'public-sector';
    // 跨境同意：公部門一律沒有（僅自建）；其他租戶要用雲端代理／溢出必須先簽署，且區域必須是已連接的雲端供應商區域
    let consent: Tenant['crossBorderConsent'];
    if (input.crossBorderConsent && !publicSector) {
      const regions = Array.from(new Set(input.crossBorderConsent.regions.map((x) => x.trim()).filter(Boolean)));
      if (regions.length === 0) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.consentRegionsEmpty'), g.requestId);
      const cloudRegions = new Set(this.providers.filter((p) => !p.local).flatMap((p) => p.endpoints.map((e) => e.region)));
      const unknown = regions.filter((x) => !cloudRegions.has(x));
      if (unknown.length) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.consentUnknownRegion', { regions: unknown.join('、') }), g.requestId);
      consent = { regions, signedAt: input.crossBorderConsent.signedAt ?? new Date().toISOString(), by: input.crossBorderConsent.by?.trim() || input.billingContact.name.trim() };
    }
    const allowedTiers: TierPolicy = publicSector ? 'local' : input.allowedTiers ?? (consent ? 'both' : 'local');
    const billingMode: BillingMode = input.billingMode ?? (input.plan === 'payg' ? 'prepaid' : 'postpaid');
    if (input.initialCreditUsd !== undefined && !(Number.isFinite(input.initialCreditUsd) && input.initialCreditUsd >= 0)) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.initialCreditNegative'), g.requestId);
    if (billingMode === 'postpaid' && input.initialCreditUsd) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.postpaidCredit'), g.requestId);
    if (!publicSector && allowedTiers !== 'local' && !consent) {
      return this.err(400, 'CROSS_BORDER_CONSENT_REQUIRED', kt('server.err.CROSS_BORDER_CONSENT_REQUIRED.tenant', { tiers: allowedTiers }), g.requestId);
    }
    const id = `t-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || rnd4()}-${rnd4()}`;
    const now = new Date().toISOString();
    const tenant: Tenant = {
      id,
      name,
      plan: input.plan,
      status: 'active',
      quotas: { ...input.quotas },
      costCenter: input.costCenter.trim(),
      billingContact: { name: input.billingContact.name.trim(), email: input.billingContact.email.trim() },
      dataClass: input.dataClass,
      allowedTiers,
      allowedModels: input.allowedModels ?? [],
      excludeOrigins: publicSector ? ['cn'] : [],
      commitment,
      billingMode,
      credits: billingMode === 'prepaid' ? { balanceUsd: r2(input.initialCreditUsd ?? 0) } : undefined,
      retention: input.retention ?? (publicSector ? 'zero' : DEFAULT_RETENTION),
      policyNote: publicSector ? PUBLIC_SECTOR_NOTE : undefined,
      crossBorderConsent: consent,
      createdAt: now,
    };
    // 允許清單：必須是目錄中的模型或別名；僅自建租戶不可列入雲端層級；排除來源地的模型不可列入
    for (const mid of tenant.allowedModels) {
      if (!MODEL_BY_ID[mid] && !this.routes.some((r) => r.alias === mid)) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.allowlistUnknown', { model: mid }), g.requestId);
      if (tenantIsLocalOnly(tenant) && this.modelOrAliasTier(mid) !== 'local') return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.allowlistCloud', { model: mid }), g.requestId);
      const origin = this.excludedOriginOf(tenant, mid);
      if (origin) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.allowlistOrigin', { model: mid, origin }), g.requestId);
    }
    this.tenants.push(tenant);
    if (tenant.credits && tenant.credits.balanceUsd > 0) this.topups.push({ id: this.nextId('tu'), tenantId: id, amountUsd: tenant.credits.balanceUsd, at: now, by: g.principal.id, kind: 'topup' });
    const project: Project = { id: `p-${id.replace(/^t-/, '')}-default`, tenantId: id, name: zh('server.const.defaultProjectName'), description: zh('server.const.defaultProjectDescription'), status: 'active', quotas: { rpm: Math.min(input.quotas.rpm, 600), tpm: Math.min(input.quotas.tpm, 1_000_000), monthlyBudgetUsd: input.quotas.monthlyBudgetUsd }, monthSpendUsd: 0, createdAt: now };
    this.projects.push(project);
    this.log({ actorId: g.principal.id, principalId: g.principal.id, action: 'tenant.create', scope: tenantScope(id), decision: 'allow', requestId: g.requestId, before: null, after: { tenant, defaultProject: project.id }, resourceType: 'tenant', resourceId: id, ...(() => {
      const p = { name, plan: input.plan, billingMode, tiers: allowedTiers, retention: tenant.retention, publicSector: publicSector ? '@server.frag.publicSectorTenant' : '' };
      return consent ? rsn('server.audit.tenantCreated.consent', { ...p, regions: consent.regions.join('、') }) : rsn('server.audit.tenantCreated.noConsent', p);
    })() });
    return { ok: true, data: tenant, requestId: g.requestId };
  }

  // ---------- 申請測試（公開表單 → 平台審核 → 建立試用租戶） ----------
  private trials: TrialRequest[] = [];
  private trialSubmitTimes: number[] = [];

  /**
   * 公開表單送出：不需登入（訪客），但有速率限制並寫入稽核（actor = public）；狀態 pending。
   * 伺服器端驗證所有欄位；不會建立任何租戶或金鑰。
   */
  async submitTrialRequest(input: TrialRequestInput): Promise<ApiResult<TrialRequest>> {
    const requestId = newRequestId();
    await this.simulate();
    const now = Date.now();
    this.trialSubmitTimes = this.trialSubmitTimes.filter((t) => now - t < 60_000);
    if (this.trialSubmitTimes.length >= TRIAL_RATE_LIMIT.perMinute) return this.err(429, 'rate_limit_error', kt('server.err.rate_limit_error.trialTooFrequent'), requestId, { retryAfterSec: 60 });
    const bad = (slug: string, params?: TParams) => this.err(400, 'VALIDATION', kt(`server.err.VALIDATION.trial.${slug}`, params), requestId);
    const accountName = (input.accountName ?? '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{2,31}$/.test(accountName)) return bad('accountName');
    if (!Array.isArray(input.models) || input.models.length === 0) return bad('modelsRequired');
    for (const m of input.models) {
      if (!MODEL_BY_ID[m.modelId]) return bad('unknownModel', { model: m.modelId });
      if (!(m.rpm >= 0 && m.tpm >= 0 && m.ttftMs >= 0 && m.cacheHitPct >= 0 && m.cacheHitPct <= 100)) return bad('modelSpec', { model: m.modelId });
    }
    if (!Array.isArray(input.scenarios) || input.scenarios.length === 0) return bad('scenarios');
    if (!(input.monthlyInputTokens >= 0 && input.monthlyOutputTokens >= 0 && input.peakConcurrency >= 0)) return bad('volume');
    if (input.useCase === 'other' && !(input.useCaseOther ?? '').trim()) return bad('useCaseOther');
    const contactName = (input.contactName ?? '').trim();
    const email = (input.email ?? '').trim();
    if (!contactName) return bad('contactName');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad('email');
    if (!(input.company ?? '').trim()) return bad('company');
    if (this.trials.filter((t) => t.status === 'pending' && t.email.toLowerCase() === email.toLowerCase()).length >= TRIAL_RATE_LIMIT.pendingPerEmail) return this.err(429, 'rate_limit_error', kt('server.err.rate_limit_error.trialPerEmail', { max: TRIAL_RATE_LIMIT.pendingPerEmail }), requestId, { retryAfterSec: 3600 });
    if (this.trials.some((t) => t.status === 'pending' && t.accountName === accountName)) return this.err(409, 'CONFLICT', kt('server.err.CONFLICT.trialAccountPending', { account: accountName }), requestId);
    this.trialSubmitTimes.push(now);
    const req: TrialRequest = {
      ...input,
      accountName,
      contactName,
      email,
      company: input.company.trim(),
      companyShort: (input.companyShort ?? '').trim(),
      phone: (input.phone ?? '').trim(),
      otherNeeds: (input.otherNeeds ?? '').trim(),
      useCaseOther: (input.useCaseOther ?? '').trim() || undefined,
      // 公部門一律資料留台
      dataResidencyTw: input.dataResidencyTw || input.publicSector,
      models: input.models.map((m) => ({ ...m })),
      scenarios: [...new Set(input.scenarios)],
      id: `trial-${accountName}-${rnd4()}`,
      status: 'pending',
      submittedAt: new Date().toISOString(),
      freeCreditUsd: TRIAL_TERMS.freeCreditUsd,
    };
    this.trials.unshift(req);
    this.log({ actorId: 'public', principalId: 'public', action: 'trial.submit', scope: PLATFORM_SCOPE, decision: 'allow', requestId, after: { id: req.id, accountName, company: req.company, models: req.models.map((m) => m.modelId), publicSector: req.publicSector, dataResidencyTw: req.dataResidencyTw }, resourceType: 'trialRequest', resourceId: req.id, ...rsn('server.audit.trialSubmitted', { company: req.company }) });
    return { ok: true, data: req, requestId };
  }

  /** 試用申請佇列：平台角色（trial.review）才可檢視；客戶角色 403 */
  async listTrialRequests(session: Session): Promise<ApiResult<TrialRequest[]>> {
    const g = await this.guard(session, 'trial.review', PLATFORM_SCOPE, { resourceType: 'trialRequest' });
    if (!g.ok) return g;
    return { ok: true, data: this.trials.map((t) => ({ ...t })), requestId: g.requestId };
  }

  /**
   * 核准並建立試用租戶：plan payg、每月預算 = 免費額度、資料留台／公部門 → 僅自建（公部門另排除中國來源）、
   * 試用到期 = 核准日 + 3 個工作天；允許清單 = 申請的模型（過濾掉僅自建租戶不可用的雲端模型與排除來源）。
   */
  async approveTrialRequest(session: Session, id: string, note?: string): Promise<ApiResult<TrialApproveResult>> {
    const g = await this.guard(session, 'trial.review', PLATFORM_SCOPE, { resourceType: 'trialRequest', resourceId: id });
    if (!g.ok) return g;
    const req = this.trials.find((t) => t.id === id);
    if (!req) return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.trial', { id: id }), g.requestId);
    if (req.status !== 'pending') return this.err(409, 'CONFLICT', kt('server.err.CONFLICT.trialProcessed', { status: `@data.TRIAL_STATUS_LABELS.${req.status}` }), g.requestId);
    const publicSector = req.publicSector;
    const localOnly = publicSector || req.dataResidencyTw;
    const dropped: TrialApproveResult['droppedModels'] = [];
    const allowed: string[] = [];
    for (const m of req.models) {
      const model = MODEL_BY_ID[m.modelId];
      const drop = (slug: string) => dropped.push({ modelId: m.modelId, reason: zh(`server.trial.dropped.${slug}`), reasonKey: `server.trial.dropped.${slug}` });
      if (!model) {
        drop('notInCatalog');
        continue;
      }
      const origin = originOfModel(model, MODEL_BY_ID);
      if (publicSector && origin === 'cn') {
        drop('publicSectorCn');
        continue;
      }
      if (localOnly && !isLocalModel(model)) {
        drop('localOnly');
        continue;
      }
      if (!allowed.includes(m.modelId)) allowed.push(m.modelId);
    }
    const rpm = Math.max(60, ...req.models.map((m) => m.rpm || 0));
    const tpm = Math.max(10_000, ...req.models.map((m) => m.tpm || 0));
    const name = zh('server.const.trialTenantName', { company: req.companyShort || req.company, account: req.accountName });
    const created = this.createTenantWith(g, {
      name,
      plan: 'payg',
      dataClass: publicSector ? 'public-sector' : req.dataResidencyTw ? 'sensitive' : 'general',
      allowedTiers: 'local',
      quotas: { rpm, tpm, monthlyBudgetUsd: req.freeCreditUsd },
      costCenter: `TRIAL-${req.accountName}`,
      billingContact: { name: req.contactName, email: req.email },
      allowedModels: allowed,
      billingMode: 'prepaid',
      retention: publicSector ? 'zero' : DEFAULT_RETENTION,
    });
    if (!created.ok) return created;
    const tenant = created.data;
    const trialEndsAt = addBusinessDays(new Date(), TRIAL_TERMS.periodBusinessDays).toISOString();
    // 免費額度以「試用贈送」入帳（預付餘額），到期後由平台財務決定轉正式或停用
    tenant.credits = { balanceUsd: req.freeCreditUsd, trial: { grantedUsd: req.freeCreditUsd, expiresAt: trialEndsAt } };
    this.topups.push({ id: this.nextId('tu'), tenantId: tenant.id, amountUsd: req.freeCreditUsd, at: new Date().toISOString(), by: g.principal.id, kind: 'trial-grant' });
    const project = this.projects.find((p) => p.tenantId === tenant.id);
    const before = { ...req };
    req.status = 'approved';
    req.reviewedAt = new Date().toISOString();
    req.reviewedBy = g.principal.id;
    req.reviewNote = note?.trim() || undefined;
    req.tenantId = tenant.id;
    req.defaultProjectId = project?.id;
    req.trialEndsAt = trialEndsAt;
    this.log({ actorId: g.principal.id, principalId: g.principal.id, action: 'trial.review', scope: tenantScope(tenant.id), decision: 'allow', requestId: g.requestId, before, after: { ...req }, resourceType: 'trialRequest', resourceId: req.id, ...rsn('server.audit.trialApproved', { tenant: tenant.id, credit: req.freeCreditUsd, until: req.trialEndsAt.slice(0, 10) }) });
    const steps = new KeyedList();
    steps.push('server.trial.next.created', { tenant: tenant.id, credit: req.freeCreditUsd, tier: tenant.allowedTiers === 'local' ? '@server.frag.localOnlyGpu' : '@server.frag.canSpill', retention: tenant.retention, until: req.trialEndsAt.slice(0, 10), days: TRIAL_TERMS.periodBusinessDays, notice: TRIAL_TERMS.extendNoticeDays });
    steps.push('server.trial.next.assignAdmin', { tenant: tenant.id, contact: req.contactName, email: req.email });
    steps.push('server.trial.next.createKey', { project: project?.id ?? '@server.const.defaultProjectName', ip: req.ipAllowlist ? '@server.frag.ipAllowlist' : '' });
    if (dropped.length) {
      // 清單含各模型的原因（巢狀可翻譯片段）：以各語言預先展開
      steps.push('server.trial.next.dropped', nested('list', (loc) => dropped.map((d) => translate(loc, 'server.trial.droppedItem', { model: d.modelId, reason: d.reasonKey ? translate(loc, d.reasonKey) : d.reason })).join(translate(loc, 'server.sep.list'))));
    }
    return { ok: true, data: { request: { ...req }, tenant, droppedModels: dropped, nextSteps: steps.texts, nextStepKeys: steps.keys }, requestId: g.requestId };
  }

  async rejectTrialRequest(session: Session, id: string, reason: string): Promise<ApiResult<TrialRequest>> {
    const g = await this.guard(session, 'trial.review', PLATFORM_SCOPE, { resourceType: 'trialRequest', resourceId: id });
    if (!g.ok) return g;
    const req = this.trials.find((t) => t.id === id);
    if (!req) return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.trial', { id: id }), g.requestId);
    if (req.status !== 'pending') return this.err(409, 'CONFLICT', kt('server.err.CONFLICT.trialProcessed', { status: `@data.TRIAL_STATUS_LABELS.${req.status}` }), g.requestId);
    if (!reason.trim()) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.rejectReason'), g.requestId);
    const before = { ...req };
    req.status = 'rejected';
    req.reviewedAt = new Date().toISOString();
    req.reviewedBy = g.principal.id;
    req.reviewNote = reason.trim();
    this.log({ actorId: g.principal.id, principalId: g.principal.id, action: 'trial.review', scope: PLATFORM_SCOPE, decision: 'allow', requestId: g.requestId, before, after: { ...req }, resourceType: 'trialRequest', resourceId: req.id, ...rsn('server.audit.trialRejected', { note: req.reviewNote }) });
    return { ok: true, data: { ...req }, requestId: g.requestId };
  }

  /** 專案清單：monthSpendUsd 由本月（2026-11）對帳單的專案列即時計算（token 費 + 雲端 + 溢出；專屬 GPU 時數計在租戶層），不用種子靜態值 */
  async listProjects(session: Session, tenantId?: string): Promise<ApiResult<Project[]>> {
    const requestId = newRequestId();
    await this.simulate();
    const principal = this.authenticate(session);
    if (!principal) return this.err(401, 'UNAUTHENTICATED', kt('server.err.UNAUTHENTICATED'), requestId);
    const visible = this.projects.filter((p) => (!tenantId || p.tenantId === tenantId) && this.authorize(principal, 'project.read', projectScope(p.tenantId, p.id)).allowed);
    const spendByProject = new Map<string, number>();
    for (const tid of new Set(visible.map((p) => p.tenantId))) {
      const tenant = this.tenantById(tid);
      if (!tenant) continue;
      const st = this.computeStatement(tenant, CURRENT_MONTH, this.usage.filter((u) => u.tenantId === tid && u.date.startsWith(CURRENT_MONTH)));
      for (const row of st.projects) spendByProject.set(row.projectId, row.totalUsd);
    }
    const data = visible.map((p) => ({ ...p, monthSpendUsd: spendByProject.get(p.id) ?? 0 }));
    return { ok: true, data, requestId };
  }

  async deleteProject(session: Session, tenantId: string, projectId: string): Promise<ApiResult<{ id: string }>> {
    const scope = projectScope(tenantId, projectId);
    const g = await this.guard(session, 'project.delete', scope, { resourceType: 'project', resourceId: projectId });
    if (!g.ok) return g;
    const idx = this.projects.findIndex((p) => p.id === projectId && p.tenantId === tenantId);
    if (idx < 0) return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.project', { id: projectId }), g.requestId);
    const [removed] = this.projects.splice(idx, 1);
    this.log({ actorId: g.principal.id, principalId: g.principal.id, action: 'project.delete', scope, decision: 'allow', requestId: g.requestId, before: removed, after: null, resourceType: 'project', resourceId: projectId });
    return { ok: true, data: { id: projectId }, requestId: g.requestId };
  }

  // ---------- API 金鑰 ----------
  private keyView(k: ApiKey): KeyView {
    return {
      ...k,
      projectName: this.projects.find((p) => p.id === k.projectId)?.name ?? k.projectId,
      tenantName: this.tenantById(k.tenantId)?.name ?? k.tenantId,
    };
  }

  async listKeys(session: Session, filter?: { tenantId?: string; projectId?: string }): Promise<ApiResult<KeyView[]>> {
    const requestId = newRequestId();
    await this.simulate();
    const principal = this.authenticate(session);
    if (!principal) return this.err(401, 'UNAUTHENTICATED', kt('server.err.UNAUTHENTICATED'), requestId);
    const data = this.keys
      .filter((k) => (!filter?.tenantId || k.tenantId === filter.tenantId) && (!filter?.projectId || k.projectId === filter.projectId))
      .filter((k) => this.authorize(principal, 'key.read', `${projectScope(k.tenantId, k.projectId)}/keys/${k.id}`).allowed)
      .map((k) => this.keyView(k));
    return { ok: true, data, requestId };
  }

  /** 模型或別名可用的層級：local／cloud／both */
  modelOrAliasTier(id: string): TierPolicy {
    const route = this.routes.find((r) => r.alias === id);
    if (route) {
      const all: RouteTarget[] = [...route.targets, ...route.fallbackChain, ...(route.spillover.enabled && route.spillover.target ? [route.spillover.target] : [])];
      const hasLocal = all.some((t) => isLocalModel({ providerId: t.providerId }));
      const hasCloud = all.some((t) => !isLocalModel({ providerId: t.providerId }));
      if (route.placementPolicy === 'local-only') return 'local';
      return hasLocal && hasCloud ? 'both' : hasCloud ? 'cloud' : 'local';
    }
    const m = MODEL_BY_ID[id];
    if (!m) return 'both';
    return isLocalModel(m) ? 'local' : 'cloud';
  }

  async createKey(session: Session, input: CreateKeyInput): Promise<ApiResult<{ key: KeyView; plaintext: string }>> {
    const scope = projectScope(input.tenantId, input.projectId);
    const g = await this.guard(session, 'key.create', scope, { resourceType: 'apiKey' });
    if (!g.ok) return g;
    const deny = (code: string, msg: KeyedText) => {
      this.log({ actorId: g.principal.id, principalId: g.principal.id, action: 'key.create', scope, decision: 'deny', requestId: g.requestId, ...codedRsn(code, msg), resourceType: 'apiKey' });
      return this.err(400, code, msg, g.requestId);
    };
    if (!input.name.trim()) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.keyName'), g.requestId);
    if (!(input.rpmLimit > 0 && input.tpmLimit > 0)) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.keyLimits'), g.requestId);
    if (!(input.monthlyBudgetUsd >= 0)) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.keyBudget'), g.requestId);
    if (input.maxParallelRequests !== undefined && !(input.maxParallelRequests >= 1)) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.maxParallel'), g.requestId);
    const tenant = this.tenantById(input.tenantId);
    if (!tenant || !this.projects.some((p) => p.id === input.projectId && p.tenantId === input.tenantId)) {
      return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.projectUnspecified'), g.requestId);
    }
    if (input.allowedModels.length === 0) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.keyAllowedModels'), g.requestId);

    // 層級限制：租戶允許層級 ⊇ 金鑰層級限制 ⊇ 允許清單中每個模型／別名的層級
    const localOnly = tenantIsLocalOnly(tenant);
    const tier: TierPolicy = input.tierRestriction ?? (localOnly ? 'local' : tenant.allowedTiers);
    if (localOnly && tier !== 'local') return deny('TIER_NOT_ALLOWED', kt('server.err.TIER_NOT_ALLOWED.keyLocalOnly', { tenant: tenant.name, cls: classFrag(tenant) }));
    if (tenant.allowedTiers !== 'both' && tier !== tenant.allowedTiers) return deny('TIER_NOT_ALLOWED', kt('server.err.TIER_NOT_ALLOWED.keyWiden', { allowed: tenant.allowedTiers, tier }));
    for (const id of input.allowedModels) {
      const t = this.modelOrAliasTier(id);
      if (tier === 'local' && t !== 'local') {
        // 僅自建金鑰可選「自建優先」別名（主要目標全為自建、雲端只在溢出）：此金鑰的請求釘在自建目標，容量耗盡回 429 不溢出
        // （僅自建「租戶」不適用：公部門／敏感租戶連溢出目標都不得存在於允許清單）
        const route = this.routes.find((r) => r.alias === id);
        const localFirstAlias = !localOnly && !!route && route.placementPolicy === 'local-first' && route.targets.every((x) => isLocalModel({ providerId: x.providerId }));
        if (!localFirstAlias) {
          const m = MODEL_BY_ID[id];
          const isQwenCloud = m ? isQwen3x(m.id) || m.family === 'Qwen' : /qwen/.test(id);
          const ps = tenant.dataClass === 'public-sector' ? (isQwenCloud ? '@server.frag.keyPublicSectorQwen' : '@server.frag.keyPublicSector') : '';
          return deny('TIER_NOT_ALLOWED', kt('server.err.TIER_NOT_ALLOWED.keyProxied', { model: id, tier: t, publicSector: ps }));
        }
      }
      if (tier === 'cloud' && t === 'local') return deny('TIER_NOT_ALLOWED', kt('server.err.TIER_NOT_ALLOWED.keyCloudOnly', { model: id }));
      if (!this.modelAllowedForTenant(tenant, id)) return deny('MODEL_NOT_ALLOWED', kt('server.err.MODEL_NOT_ALLOWED.keyPlan', { model: id, tenant: tenant.name }));
      const origin = this.excludedOriginOf(tenant, id);
      if (origin) return deny('MODEL_NOT_ALLOWED', kt('server.err.MODEL_NOT_ALLOWED.keyOrigin', { model: id, origin, tenant: tenant.name, basis: basisFrag(tenant) }));
    }

    // 到期：臨時金鑰 ≤ 1 小時；一般金鑰必填且 ≤ 90 天（以日曆日比較：第 90 天當天結束前都算有效，UI 預設「今天 + 90 天」可通過）
    const now = Date.now();
    const ephemeral = !!input.ephemeral;
    if (!input.expiresAt) {
      if (!ephemeral) return deny('KEY_EXPIRY_REQUIRED', kt('server.err.KEY_EXPIRY_REQUIRED', { days: KEY_MAX_EXPIRY_DAYS, minutes: EPHEMERAL_MAX_MINUTES }));
    }
    const expiresMs = input.expiresAt ? new Date(input.expiresAt).getTime() : now + EPHEMERAL_MAX_MINUTES * 60_000;
    if (Number.isNaN(expiresMs) || expiresMs <= now) return deny('VALIDATION', kt('server.err.VALIDATION.expiryPast'));
    if (ephemeral && expiresMs - now > EPHEMERAL_MAX_MINUTES * 60_000 + 1000) return deny('EPHEMERAL_TOO_LONG', kt('server.err.EPHEMERAL_TOO_LONG', { minutes: EPHEMERAL_MAX_MINUTES }));
    if (!ephemeral && expiresMs > maxKeyExpiryMs(now)) return deny('KEY_EXPIRY_TOO_LONG', kt('server.err.KEY_EXPIRY_TOO_LONG', { days: KEY_MAX_EXPIRY_DAYS }));

    const id = this.nextId('k');
    const rnd = () => Math.random().toString(16).slice(2, 10);
    const prefix = `sk-maas-${rnd().slice(0, 4)}`;
    const tail = rnd();
    const plaintext = `${prefix}${rnd()}${rnd()}${tail}`; // 僅示範；正式環境由 KMS 產生並雜湊儲存
    const spId = `sp-${id}`;
    const key: ApiKey = {
      id,
      tenantId: input.tenantId,
      projectId: input.projectId,
      name: input.name.trim(),
      prefix,
      hint: `${prefix}…${tail.slice(-4)}`,
      hash: `sha256:${rnd().slice(0, 4)}…${rnd().slice(0, 4)}`,
      servicePrincipalId: spId,
      allowedModels: input.allowedModels,
      tierRestriction: tier,
      rpmLimit: input.rpmLimit,
      tpmLimit: input.tpmLimit,
      maxParallelRequests: input.maxParallelRequests ?? 8,
      monthlyBudgetUsd: input.monthlyBudgetUsd,
      budgetDuration: input.budgetDuration ?? '30d',
      ephemeral,
      expiresAt: new Date(expiresMs).toISOString(),
      autoRotate: input.autoRotate ?? { enabled: false, intervalDays: 90, gracePeriodHours: 48 },
      status: 'active',
      lastUsedAt: null,
      createdAt: new Date().toISOString(),
      createdBy: g.principal.id,
    };
    this.keys.push(key);
    this.principals.push({ id: spId, type: 'servicePrincipal', displayName: zh('server.const.keyPrincipalName', { name: key.name }), tenantId: key.tenantId, groupIds: [] });
    // 最小權限：金鑰服務主體只拿 inference-caller（呼叫推論 + 讀目錄），不可建立／撤銷金鑰或更新路由
    this.assignments.push({ id: this.nextId('ra'), principalId: spId, roleId: 'inference-caller', scope, tenantId: key.tenantId, status: 'active', createdAt: key.createdAt, createdBy: g.principal.id, expiresAt: key.expiresAt ?? undefined });
    this.log({ actorId: g.principal.id, principalId: spId, action: 'key.create', scope, decision: 'allow', requestId: g.requestId, before: null, after: { ...key }, resourceType: 'apiKey', resourceId: id, ...(ephemeral ? rsn('server.audit.createEphemeralKey') : rsn('server.audit.createKey', { tier })) });
    return { ok: true, data: { key: this.keyView(key), plaintext }, requestId: g.requestId };
  }

  async revokeKey(session: Session, keyId: string): Promise<ApiResult<KeyView>> {
    const requestId0 = newRequestId();
    const k = this.keys.find((x) => x.id === keyId);
    if (!k) {
      await this.simulate();
      return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.key', { id: keyId }), requestId0);
    }
    const scope = `${projectScope(k.tenantId, k.projectId)}/keys/${k.id}`;
    const g = await this.guard(session, 'key.revoke', scope, { resourceType: 'apiKey', resourceId: keyId });
    if (!g.ok) return g;
    if (k.status === 'revoked') return this.err(409, 'CONFLICT', kt('server.err.CONFLICT.keyRevoked'), g.requestId);
    const before = { ...k };
    k.status = 'revoked';
    // 撤銷金鑰同時使其服務主體的指派失效
    this.assignments.filter((a) => a.principalId === k.servicePrincipalId).forEach((a) => (a.status = 'expired'));
    this.log({ actorId: g.principal.id, principalId: k.servicePrincipalId, action: 'key.revoke', scope, decision: 'allow', requestId: g.requestId, before, after: { ...k }, resourceType: 'apiKey', resourceId: keyId });
    return { ok: true, data: this.keyView(k), requestId: g.requestId };
  }

  // ---------- Playground（經路由層：自建優先／溢出／僅自建） ----------
  /** 自建容量是否耗盡（示範開關：模擬容量耗盡或叢集中斷） */
  private localExhausted(clusterId: string): boolean {
    if (this.options.simulateLocalExhausted) return true;
    if (this.options.simulateClusterOutage && clusterId === 'cl-tpe-a') return true;
    return false;
  }

  /**
   * 自建模型的 token 收費（我們的牌價）：(輸入 − 快取讀取 − 快取寫入) × 輸入牌價 + 快取讀取 × 輸入牌價 × 讀取倍率（0.1）
   * + 快取寫入 × 輸入牌價 × 寫入倍率（1.25）+ 輸出 × 輸出牌價，÷ 1e6。快取讀取與寫入皆為輸入 tokens 的一部分，合計不超過輸入。
   */
  tokenCharge(modelId: string, inputTokens: number, cachedInputTokens: number, outputTokens: number, cacheWriteTokens = 0): number {
    const p = this.billing.tokenPrices[modelId] ?? { input: MODEL_BY_ID[modelId]?.priceInput ?? 0, output: MODEL_BY_ID[modelId]?.priceOutput ?? 0 };
    const read = Math.max(0, Math.min(cachedInputTokens, inputTokens));
    const write = Math.max(0, Math.min(cacheWriteTokens, inputTokens - read));
    const plain = inputTokens - read - write;
    return (plain / 1e6) * p.input + (read / 1e6) * p.input * this.billing.cacheReadMultiplier + (write / 1e6) * p.input * this.billing.cacheWriteMultiplier + (outputTokens / 1e6) * p.output;
  }

  /** 代理開放模型（百煉）向客戶收費：供應商牌價 × (1 + 加價 %) */
  cloudCharge(listUsd: number): number {
    return listUsd * (1 + this.billing.cloudMarkupPct / 100);
  }

  private pricePolicy() {
    return { cloudMarkupPct: this.billing.cloudMarkupPct, proxyDiscountPct: this.billing.proxyDiscountPct, negotiatedDiscountPct: this.billing.negotiatedDiscountPct };
  }

  /** 代理模型向客戶收費：開放模型 ＝ 牌價 × (1 + 加價)；閉源／夥伴 ＝ 牌價 × (1 − 代理折扣) */
  proxyCharge(m: Pick<ModelInfo, 'providerId' | 'proxyDiscountPct'>, listUsd: number): number {
    return listUsd * customerPriceFactor(m, this.pricePolicy());
  }

  /** 代理模型我們的成本：開放模型 ＝ 牌價；閉源／夥伴 ＝ 牌價 × (1 − 議價折扣) */
  proxyCost(m: Pick<ModelInfo, 'providerId'>, listUsd: number): number {
    return listUsd * vendorCostFactor(m, this.pricePolicy());
  }

  /** 向客戶的單價（USD／單位）：自建 ＝ 牌價（可由設定覆寫）；代理 ＝ 依政策換算 */
  customerUnitPrice(m: ModelInfo): { input: number; output: number } {
    if (isLocalModel(m)) {
      const p = this.billing.tokenPrices[m.id] ?? { input: m.priceInput, output: m.priceOutput };
      return { input: p.input, output: p.output };
    }
    const f = customerPriceFactor(m, this.pricePolicy());
    return { input: Math.round(m.priceInput * f * 10000) / 10000, output: Math.round(m.priceOutput * f * 10000) / 10000 };
  }

  // ---------- 預付儲值、限流層級、留存 ----------
  /** 本月至今對帳單合計（純計算） */
  private monthSpendOf(tenant: Tenant, month = CURRENT_MONTH): number {
    return this.computeStatement(tenant, month, this.usage.filter((u) => u.tenantId === tenant.id && u.date.startsWith(month))).charges.totalUsd;
  }

  /** 累計消費（用量資料涵蓋的所有月份對帳單合計）：決定限流層級 */
  private cumulativeSpendOf(tenant: Tenant): number {
    const months = Array.from(new Set(this.usage.map((u) => u.date.slice(0, 7))));
    return r2(months.reduce((s, m) => s + this.monthSpendOf(tenant, m), 0));
  }

  /** 預付租戶的可用餘額（總帳餘額 − 本月至今扣抵） */
  private creditsView(tenant: Tenant): BillingStatement['credits'] {
    if (tenant.billingMode !== 'prepaid' || !tenant.credits) return null;
    const deducted = this.monthSpendOf(tenant);
    const available = r2(tenant.credits.balanceUsd - deducted);
    const threshold = tenant.credits.autoReload?.thresholdUsd ?? LOW_BALANCE_DEFAULT_USD;
    return { balanceUsd: tenant.credits.balanceUsd, deductedUsd: deducted, availableUsd: available, lowBalance: available <= threshold };
  }

  /** 租戶帳戶（純計算） */
  private accountOf(tenant: Tenant): TenantAccount {
    const contract = tenant.billingMode === 'postpaid';
    const cumulative = this.cumulativeSpendOf(tenant);
    const current = tierForSpend(cumulative, contract);
    const next = contract ? null : nextTier(current);
    const cv = this.creditsView(tenant);
    const monthTopups = r2(this.topups.filter((t) => t.tenantId === tenant.id && t.at.startsWith(CURRENT_MONTH)).reduce((s, t) => s + t.amountUsd, 0));
    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      plan: tenant.plan,
      billingMode: tenant.billingMode,
      retention: tenant.retention,
      credits:
        cv && tenant.credits
          ? {
              balanceUsd: cv.balanceUsd,
              monthSpendUsd: cv.deductedUsd,
              availableUsd: cv.availableUsd,
              lowBalance: cv.lowBalance,
              lowBalanceThresholdUsd: tenant.credits.autoReload?.thresholdUsd ?? LOW_BALANCE_DEFAULT_USD,
              autoReload: tenant.credits.autoReload,
              trial: tenant.credits.trial ? { ...tenant.credits.trial, expired: new Date(tenant.credits.trial.expiresAt).getTime() < Date.now() } : undefined,
              monthTopupsUsd: monthTopups,
            }
          : null,
      tier: { current, next, cumulativeSpendUsd: cumulative, toNextUsd: next && next.minSpendUsd !== null ? r2(Math.max(0, next.minSpendUsd - cumulative)) : null, contract },
      monthSpendUsd: this.monthSpendOf(tenant),
      commitment: tenant.commitment,
    };
  }

  /** 租戶帳戶：需該租戶範圍的 billing.read（客戶管理員／財務／檢視者；我們的擁有者／財務可看全部） */
  async getTenantAccount(session: Session, tenantId: string): Promise<ApiResult<TenantAccount>> {
    const g = await this.guard(session, 'billing.read', tenantScope(tenantId), { resourceType: 'account', resourceId: tenantId });
    if (!g.ok) return g;
    const t = this.tenantById(tenantId);
    if (!t) return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.tenant', { id: tenantId }), g.requestId);
    return { ok: true, data: this.accountOf(t), requestId: g.requestId };
  }

  /** 儲值：預付租戶、US$10–10,000（示意）；需 billing.topup（客戶管理員／客戶財務／我們的擁有者／財務）；寫入稽核（前後餘額） */
  async topUpCredits(session: Session, tenantId: string, amountUsd: number): Promise<ApiResult<{ account: TenantAccount; record: TopUpRecord }>> {
    const g = await this.guard(session, 'billing.topup', tenantScope(tenantId), { resourceType: 'credits', resourceId: tenantId });
    if (!g.ok) return g;
    const t = this.tenantById(tenantId);
    if (!t) return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.tenant', { id: tenantId }), g.requestId);
    if (t.billingMode !== 'prepaid') return this.err(409, 'NOT_PREPAID', kt('server.err.NOT_PREPAID', { tenant: t.name }), g.requestId);
    if (!(Number.isFinite(amountUsd) && amountUsd >= TOPUP_MIN_USD && amountUsd <= TOPUP_MAX_USD)) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.topupRange', { min: TOPUP_MIN_USD, max: TOPUP_MAX_USD.toLocaleString() }), g.requestId);
    const before = { ...(t.credits ?? { balanceUsd: 0 }) };
    t.credits = { ...(t.credits ?? { balanceUsd: 0 }), balanceUsd: r2((t.credits?.balanceUsd ?? 0) + amountUsd) };
    const record: TopUpRecord = { id: this.nextId('tu'), tenantId, amountUsd: r2(amountUsd), at: new Date().toISOString(), by: g.principal.id, kind: 'topup' };
    this.topups.push(record);
    this.log({ actorId: g.principal.id, principalId: g.principal.id, action: 'billing.topup', scope: tenantScope(tenantId), decision: 'allow', requestId: g.requestId, before, after: { ...t.credits, topup: record }, resourceType: 'credits', resourceId: tenantId, ...rsn('server.audit.topup', { amount: record.amountUsd, from: before.balanceUsd, to: t.credits.balanceUsd }) });
    return { ok: true, data: { account: this.accountOf(t), record }, requestId: g.requestId };
  }

  /** 資料留存政策：零留存／30 天；需 tenant.update（客戶管理員、平台擁有者）；寫入稽核 */
  async updateTenantRetention(session: Session, tenantId: string, retention: RetentionPolicy): Promise<ApiResult<Tenant>> {
    const g = await this.guard(session, 'tenant.update', tenantScope(tenantId), { resourceType: 'tenant', resourceId: tenantId });
    if (!g.ok) return g;
    const t = this.tenantById(tenantId);
    if (!t) return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.tenant', { id: tenantId }), g.requestId);
    if (retention !== 'zero' && retention !== '30d') return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.retentionValue'), g.requestId);
    if (t.dataClass === 'public-sector' && retention !== 'zero') return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.publicSectorZeroRetention'), g.requestId);
    const before = t.retention;
    t.retention = retention;
    this.log({ actorId: g.principal.id, principalId: g.principal.id, action: 'tenant.update', scope: tenantScope(tenantId), decision: 'allow', requestId: g.requestId, before: { retention: before }, after: { retention }, resourceType: 'tenant', resourceId: tenantId, ...rsn('server.audit.retention', { from: before, to: retention }) });
    return { ok: true, data: t, requestId: g.requestId };
  }

  async invokePlayground(session: Session, input: PlaygroundInput): Promise<ApiResult<PlaygroundResult>> {
    const scope = projectScope(input.tenantId, input.projectId);
    const g = await this.guard(session, 'playground.invoke', scope, { resourceType: 'model', resourceId: input.modelId });
    if (!g.ok) return g;
    const requested = MODEL_BY_ID[input.modelId];
    if (!requested) return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.model', { id: input.modelId }), g.requestId);
    if (requested.modality === 'embedding' || requested.modality === 'rerank') {
      return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.notChatModel'), g.requestId);
    }
    const isMedia = isMediaModality(requested.modality);
    const tenant = this.tenantById(input.tenantId);
    if (!tenant) return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.tenant', { id: input.tenantId }), g.requestId);
    if (!this.projects.some((p) => p.id === input.projectId && p.tenantId === tenant.id)) return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.tenantProject', { tenant: tenant.id, project: input.projectId }), g.requestId);
    const localOnly = tenantIsLocalOnly(tenant);
    const denyLog = (code: string, msg: KeyedText) => this.log({ actorId: g.principal.id, principalId: g.principal.id, action: 'playground.invoke', scope, decision: 'deny', requestId: g.requestId, ...codedRsn(code, msg), resourceType: 'model', resourceId: input.modelId });
    const projectRow = this.projects.find((p) => p.id === input.projectId)!;
    const retention: RetentionPolicy = projectRow.retention ?? tenant.retention;

    let served: ModelInfo = requested;
    let servedBy: PlaygroundResult['servedBy'] = isLocalModel(requested) ? 'local' : 'cloud';
    let tier: UsageTier = servedBy === 'local' ? 'local' : 'cloud';
    let deploymentId: string | null = null;
    let spilloverFrom: string | null = null;
    let billingBasis: PlaygroundResult['billingBasis'] = servedBy === 'local' ? 'token' : 'cloud';
    const headers: Record<string, string> = { 'x-maas-request-id': g.requestId, 'x-maas-tenant': tenant.id, 'x-maas-retention': retention };

    // 預付儲值：可用餘額（總帳 − 本月至今扣抵）≤ 0 → 402 INSUFFICIENT_CREDITS（儲值後即可繼續）
    const credits = this.creditsView(tenant);
    if (credits && credits.availableUsd <= 0) {
      const msg = kt('server.err.INSUFFICIENT_CREDITS', { tenant: tenant.name, available: credits.availableUsd.toFixed(2), balance: credits.balanceUsd.toFixed(2), deducted: credits.deductedUsd.toFixed(2), min: TOPUP_MIN_USD, max: TOPUP_MAX_USD.toLocaleString() });
      denyLog('INSUFFICIENT_CREDITS', msg);
      return this.err(402, 'INSUFFICIENT_CREDITS', msg, g.requestId, { headers: { ...headers, 'x-maas-balance': credits.availableUsd.toFixed(2) } });
    }
    headers['x-maas-balance'] = credits ? credits.availableUsd.toFixed(2) : 'postpaid';

    if (!isLocalModel(requested) && localOnly) {
      const msg = kt('server.err.TIER_NOT_ALLOWED.playgroundLocalOnly', { tenant: tenant.name, cls: classFrag(tenant), model: requested.displayName, basis: tenant.dataClass === 'public-sector' ? '@server.frag.basisQwen' : '' });
      denyLog('TIER_NOT_ALLOWED', msg);
      return this.err(400, 'TIER_NOT_ALLOWED', msg, g.requestId, { headers: { ...headers, 'x-maas-policy': 'local-only' } });
    }
    if (!this.modelAllowedForTenant(tenant, requested.id)) {
      const msg = kt('server.err.MODEL_NOT_ALLOWED.playgroundPlan', { model: requested.displayName, tenant: tenant.name });
      denyLog('MODEL_NOT_ALLOWED', msg);
      return this.err(400, 'MODEL_NOT_ALLOWED', msg, g.requestId, { headers });
    }
    const excludedOrigin = this.excludedOriginOf(tenant, requested.id);
    if (excludedOrigin) {
      const op = { model: requested.displayName, origin: excludedOrigin, tenant: tenant.name, basis: basisFrag(tenant) };
      const msg = requested.baseModel ? kt('server.err.MODEL_NOT_ALLOWED.playgroundOriginBase', { ...op, base: requested.baseModel }) : kt('server.err.MODEL_NOT_ALLOWED.playgroundOrigin', op);
      denyLog('MODEL_NOT_ALLOWED', msg);
      return this.err(400, 'MODEL_NOT_ALLOWED', msg, g.requestId, { headers: { ...headers, 'x-maas-policy': 'origin-excluded' } });
    }
    const consentRegions = new Set(tenant.crossBorderConsent?.regions ?? []);

    if (!isLocalModel(requested)) {
      // 直接呼叫雲端模型：以路由白名單內、且租戶已簽署跨境同意的區域為目標；沒有任何同意區域 → 視同僅自建
      const provider = this.providers.find((p) => p.id === requested.providerId);
      const routeFor = this.routes.find((r) => [...r.targets, ...r.fallbackChain].some((t) => t.modelId === requested.id));
      const candidates = (provider?.endpoints ?? []).filter((e) => !e.legacy && !CN_REGIONS.includes(e.region) && (!routeFor || routeFor.allowedRegions.includes(e.region)));
      const target = candidates.find((e) => consentRegions.has(e.region));
      if (!target) {
        const msg = kt('server.err.TIER_NOT_ALLOWED.noConsent', { tenant: tenant.name, provider: requested.providerId, regions: candidates.map((e) => e.region).join('、') || '@server.frag.anyRegion', model: requested.displayName });
        denyLog('TIER_NOT_ALLOWED', msg);
        return this.err(400, 'TIER_NOT_ALLOWED', msg, g.requestId, { headers: { ...headers, 'x-maas-policy': 'no_cross_border_consent' } });
      }
      headers['x-maas-served-by'] = 'cloud';
      headers['x-maas-tier'] = 'external';
      headers['x-maas-deployment'] = `${requested.providerId}:${target.region}`;
      headers['x-maas-region'] = target.region;
      if (routeFor) headers['x-maas-route'] = routeFor.alias;
    } else {
      const deps = this.deployments.filter((d) => d.modelId === requested.id);
      // 專屬部署只服務「對應到它的路由／專案」：別名的目標區域 = 專屬部署所在機房、且租戶是該專屬部署的租戶、且此專案被允許使用該別名
      // （聯合金融 p-risk → risk-local → 新竹 B 專屬部署；p-advisor 用同一模型但走台北 A 共用部署，按牌價計費）
      const project = this.projects.find((p) => p.id === input.projectId)!;
      const dedicatedCandidates = deps.filter((d) => d.sharing === 'dedicated' && d.dedicatedTenantId === tenant.id && d.status === 'ready');
      const dedicatedRoute = this.routes.find((r) => r.placementPolicy === 'local-only' && tenant.allowedModels.includes(r.alias) && this.projectMayUseAlias(project, r.alias) && r.targets.some((t) => t.modelId === requested.id && dedicatedCandidates.some((d) => this.clusters.find((c) => c.id === d.clusterId)?.region === t.region)));
      const dedicatedDep = dedicatedRoute ? dedicatedCandidates.find((d) => this.clusters.find((c) => c.id === d.clusterId)?.region === dedicatedRoute.targets.find((t) => t.modelId === requested.id)?.region) : undefined;
      // 以部署本身的狀態挑選（叢集中斷由 localExhausted 處理 → 溢出或 429，而非 503）
      const readyDep = dedicatedDep ?? deps.find((d) => d.sharing === 'shared' && d.status === 'ready');
      const depRegion = readyDep ? this.clusters.find((c) => c.id === readyDep.clusterId)?.region : undefined;
      const route = dedicatedRoute ?? this.routes.find((r) => r.placementPolicy !== 'local-only' && r.targets.some((t) => t.modelId === requested.id && t.region === depRegion)) ?? this.routes.find((r) => r.targets.some((t) => t.modelId === requested.id && t.region === depRegion)) ?? this.routes.find((r) => r.targets.some((t) => t.modelId === requested.id));
      if (!readyDep) {
        const zero = deps.find((d) => d.status === 'scaled-to-zero');
        if (zero) {
          denyLog('DEPLOYMENT_SCALING_UP', kt('server.audit.msg.scalingUp', { name: zero.name }));
          return this.err(503, 'DEPLOYMENT_SCALING_UP', kt('server.err.DEPLOYMENT_SCALING_UP', { name: zero.name }), g.requestId, { retryAfterSec: 30, headers: { ...headers, 'x-maas-served-by': 'local', 'x-maas-deployment': zero.id } });
        }
        return this.err(503, 'NO_CAPACITY', kt('server.err.NO_CAPACITY', { model: requested.displayName }), g.requestId, { retryAfterSec: 30, headers });
      }
      const exhausted = this.localExhausted(readyDep.clusterId);
      if (exhausted) {
        const spillTarget = route?.spillover.target ?? null;
        const routeAllowsSpill = !localOnly && !!route && route.placementPolicy !== 'local-only' && route.spillover.enabled && !!spillTarget;
        const regionAllowed = !!spillTarget && !!route && route.allowedRegions.includes(spillTarget.region) && !CN_REGIONS.includes(spillTarget.region);
        const consentOk = !!spillTarget && consentRegions.has(spillTarget.region);
        if (routeAllowsSpill && regionAllowed && consentOk && spillTarget && route) {
          const t = spillTarget;
          served = MODEL_BY_ID[t.modelId] ?? requested;
          servedBy = 'cloud';
          tier = 'spillover';
          billingBasis = 'cloud';
          spilloverFrom = readyDep.id;
          headers['x-maas-served-by'] = 'cloud';
          headers['x-maas-tier'] = 'spillover';
          headers['x-maas-deployment'] = `${t.providerId}:${t.region}`;
          headers['x-maas-region'] = t.region;
          headers['x-maas-spillover-from'] = readyDep.id;
          headers['x-maas-spillover-reason'] = this.options.simulateClusterOutage ? 'cluster_disconnected' : `kv_cache_usage>=${route.spillover.threshold.kvCacheUsage};queue_depth_per_replica>=${route.spillover.threshold.queueDepth}`;
          headers['x-maas-route'] = route.alias;
        } else {
          const retry = 15;
          const reason = !routeAllowsSpill ? (localOnly ? 'tenant_local_only' : 'route_local_only') : !regionAllowed ? 'region_not_allowed' : 'no_cross_border_consent';
          const lp: TParams = { deployment: readyDep.name, retry };
          if (reason === 'no_cross_border_consent') Object.assign(lp, { route: String(route?.alias), region: String(spillTarget?.region), tenant: tenant.name, regions: [...consentRegions].join('、') || '@server.frag.none' });
          else if (reason === 'region_not_allowed') lp.region = String(spillTarget?.region);
          const msg = kt(`server.err.local_capacity_exhausted.${reason}`, lp);
          this.log({ actorId: g.principal.id, principalId: g.principal.id, action: 'playground.invoke', scope, decision: 'deny', requestId: g.requestId, reason: `local_capacity_exhausted：${zh(msg.key, msg.params)}（reason=${reason}）`, reasonKey: `server.audit.codedReason.${msg.key}`, reasonParams: { ...lp, code: 'local_capacity_exhausted', reason }, resourceType: 'model', resourceId: input.modelId });
          return this.err(429, 'local_capacity_exhausted', msg, g.requestId, { retryAfterSec: retry, headers: { ...headers, 'x-maas-served-by': 'local', 'x-maas-deployment': readyDep.id, 'x-maas-policy': 'local-only', 'x-maas-deny-reason': reason, 'retry-after': String(retry) } });
        }
      } else {
        deploymentId = readyDep.id;
        billingBasis = readyDep.sharing === 'dedicated' ? 'dedicated' : 'token';
        headers['x-maas-served-by'] = 'local';
        headers['x-maas-tier'] = 'local';
        headers['x-maas-deployment'] = readyDep.id;
        headers['x-maas-cluster'] = readyDep.clusterId;
        headers['x-maas-region'] = depRegion ?? readyDep.clusterId;
        headers['x-maas-sharing'] = readyDep.sharing;
        if (route) headers['x-maas-route'] = route.alias;
      }
    }
    // 實際服務此請求的模型（溢出時為雲端模型，與使用者請求的 model 可能不同）
    headers['x-maas-model'] = served.id;

    const lastUser = [...input.messages].reverse().find((m) => m.role === 'user')?.content ?? '';

    // 非文字模態（圖像／影片／語音）：不串流 tokens，回傳模擬產物卡與單位計價（每張／每秒／每分鐘 + 加價）；不進入 token 數學
    if (isMedia) {
      const kind = requested.modality as PlaygroundMedia['kind'];
      const asr = kind === 'audio' && requested.family === 'Whisper';
      const endpoint = kind === 'image' ? '/images/generations' : kind === 'video' ? '/videos' : asr ? '/audio/transcriptions' : '/audio/speech';
      const units = kind === 'image' ? 1 : kind === 'video' ? 5 : asr ? 0.5 : Math.max(0.1, Math.round((lastUser.length / 220) * 10) / 10);
      const unitPriceUsd = this.proxyCharge(requested, requested.priceInput);
      const estimatedCostUsd = unitPriceUsd * units;
      const mediaSlug = kind === 'image' ? 'image' : kind === 'video' ? 'video' : asr ? 'asr' : 'tts';
      const artifactKey = `server.playground.media.${mediaSlug}.artifact`;
      const artifactParams: TParams | undefined = mediaSlug === 'tts' ? { seconds: Math.round(units * 60) } : undefined;
      const altTextKey = `server.playground.media.${mediaSlug}.altText`;
      const altTextParams: TParams | undefined = mediaSlug === 'asr' ? undefined : { prompt: lastUser.slice(0, 40) };
      const artifact = zh(artifactKey, artifactParams);
      const altText = zh(altTextKey, altTextParams);
      const media: PlaygroundMedia = { kind, endpoint, units, unitLabel: UNIT_TYPE_LABELS[requested.unitType], unitPriceUsd, artifact, altText, artifactKey, artifactParams, altTextKey, altTextParams };
      const mediaBody: Record<string, unknown> = kind === 'image' ? { model: requested.id, prompt: lastUser, size: '1024x1024', n: 1 } : kind === 'video' ? { model: requested.id, prompt: lastUser, duration: 5, resolution: '720p' } : asr ? { model: requested.id, file: '@sample.wav', response_format: 'json' } : { model: requested.id, input: lastUser, voice: 'default', format: 'mp3' };
      const mediaCurl = `curl -i ${PLATFORM_BASE_URL}${endpoint} \\\n  -H "Authorization: Bearer $MAAS_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(mediaBody, null, 2).replace(/'/g, "'\\''")}'`;
      headers['x-maas-unit'] = requested.unitType;
      headers['x-maas-units'] = String(units);
      this.log({ actorId: g.principal.id, principalId: g.principal.id, action: 'playground.invoke', scope, decision: 'allow', requestId: g.requestId, after: { requestedModel: requested.id, servedModel: served.id, tier, billingBasis, modality: kind, units, unitType: requested.unitType }, resourceType: 'model', resourceId: requested.id });
      return {
        ok: true,
        requestId: g.requestId,
        data: { tokens: [], ttftMs: Math.round(800 + Math.random() * 600), inputTokens: 0, outputTokens: 0, estimatedCostUsd, billingBasis, model: served, requestedModel: requested, servedBy, tier, deploymentId, spilloverFrom, headers, curl: mediaCurl, media },
      };
    }
    // 模擬回覆：由多段可翻譯句子組成（answerKeys）；tokens 為 zh-TW 文字的串流切片（計量用），UI 可用 tokenizeStream(翻譯後全文) 以目前語言串流
    const answerKeys: KeyedText[] = [kt('server.playground.intro')];
    if (tier === 'spillover') answerKeys.push(kt('server.playground.spillover', { from: String(spilloverFrom), model: served.displayName, provider: served.providerId }));
    else if (servedBy === 'local') answerKeys.push(kt('server.playground.servedLocal', { sharing: billingBasis === 'dedicated' ? '@server.frag.dedicated' : '@server.frag.shared', deployment: String(deploymentId), model: served.displayName }));
    else answerKeys.push(kt('server.playground.servedCloud', { provider: served.providerId, model: served.displayName }));
    if (input.enableThinking && isQwen3x(served.id)) answerKeys.push(kt('server.playground.thinking'));
    answerKeys.push(kt('server.playground.temperature', { value: String(input.temperature) }));
    if (lastUser) answerKeys.push(kt('server.playground.lastMessage', { text: `${lastUser.slice(0, 60)}${lastUser.length > 60 ? '…' : ''}` }));
    answerKeys.push(kt('server.playground.outro'));
    const answer = answerKeys.map((k) => zh(k.key, k.params)).join('');
    const tokens = tokenizeStream(answer);
    const inputTokens = Math.round((input.system.length + input.messages.reduce((s, m) => s + m.content.length, 0)) * 1.3) + 12;
    const outputTokens = Math.round(tokens.length * 1.2);
    // 向客戶收費的估算：共用部署 → 我們的 token 牌價；專屬部署 → 0（含於 GPU 時數）；代理／溢出 → 開放模型牌價 + 加價、閉源／夥伴牌價 − 代理折扣
    const estimatedCostUsd = billingBasis === 'token' ? this.tokenCharge(served.id, inputTokens, 0, outputTokens) : billingBasis === 'dedicated' ? 0 : this.proxyCharge(served, (inputTokens / 1e6) * served.priceInput + (outputTokens / 1e6) * served.priceOutput);
    const body: Record<string, unknown> = {
      model: requested.id,
      messages: [...(input.system ? [{ role: 'system', content: input.system }] : []), ...input.messages],
      temperature: input.temperature,
      max_tokens: input.maxTokens,
      stream: true,
    };
    if (isQwen3x(requested.id)) body.extra_body = { enable_thinking: input.enableThinking };
    const curl = `curl -i ${PLATFORM_BASE_URL}/chat/completions \\\n  -H "Authorization: Bearer $MAAS_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body, null, 2).replace(/'/g, "'\\''")}'`;
    this.log({ actorId: g.principal.id, principalId: g.principal.id, action: 'playground.invoke', scope, decision: 'allow', requestId: g.requestId, after: { requestedModel: requested.id, servedModel: served.id, tier, billingBasis, deploymentId, spilloverFrom, inputTokens, outputTokens }, resourceType: 'model', resourceId: requested.id, ...(tier === 'spillover' ? rsn('server.audit.spillover', { from: String(spilloverFrom), to: headers['x-maas-deployment'] }) : { reason: undefined }) });
    return {
      ok: true,
      requestId: g.requestId,
      data: { tokens, answerKeys, ttftMs: Math.round((servedBy === 'local' ? 120 : 260) + Math.random() * 400), inputTokens, outputTokens, estimatedCostUsd, billingBasis, model: served, requestedModel: requested, servedBy, tier, deploymentId, spilloverFrom, headers, curl },
    };
  }

  // ---------- 用量與帳單（我們向客戶收費 + 平台營收／毛利；預付餘額扣抵） ----------
  /** 月份已過天數（示範日期 2026-11-08） */
  private daysInPeriod(month: string): number {
    if (month === CURRENT_MONTH) return 8;
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }

  private daysInMonth(month: string): number {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }

  /** 對帳期間 [start, end)：月初 00:00（+08:00）起算 daysInPeriod 天（本月為 11-01 ～ 11-08 止） */
  private periodOf(month: string): { start: Date; end: Date; days: number } {
    const days = this.daysInPeriod(month);
    const start = new Date(`${month}-01T00:00:00+08:00`);
    const end = new Date(start.getTime() + days * 86_400_000);
    return { start, end, days };
  }

  /** 某租戶的專屬部署（含縮至零） */
  private dedicatedDeploymentsOf(tenantId: string): Deployment[] {
    return this.deployments.filter((d) => d.sharing === 'dedicated' && d.dedicatedTenantId === tenantId);
  }

  /** 專屬部署在某月份的 GPU 時數與費用：依建立時間與副本歷史在期間內按分鐘比例（新建立的部署只計入期間內實際存在的時數） */
  private dedicatedCharges(tenantId: string, month: string) {
    const { start, end } = this.periodOf(month);
    return this.dedicatedDeploymentsOf(tenantId).map((d) => {
      const cluster = this.clusters.find((c) => c.id === d.clusterId);
      const gpuType = cluster?.gpuType ?? '';
      const gpus = d.replicas * d.gpusPerReplica;
      const hours = dedicatedGpuHours(d, start, end);
      const unitUsd = this.billing.gpuListUsdPerHour[gpuType] ?? 0;
      return { deploymentId: d.id, deploymentName: d.name, modelId: d.modelId, modelName: MODEL_BY_ID[d.modelId]?.displayName ?? d.modelId, clusterName: cluster?.name ?? d.clusterId, gpuType, gpus, hours, unitUsd, usd: r2(hours * unitUsd) };
    });
  }

  /** 一筆自建用量的計費依據：以服務它的部署（deploymentId／sharing）判定，不是「租戶 × 模型」 */
  private localBasisOf(u: UsageRecord): 'token' | 'dedicated' {
    const dep = u.deploymentId ? this.deployments.find((d) => d.id === u.deploymentId) : undefined;
    const sharing = dep?.sharing ?? u.sharing;
    return sharing === 'dedicated' ? 'dedicated' : 'token';
  }

  /** 計算我們向某客戶開立的月對帳單（純計算，不做授權；rows 已過濾） */
  private computeStatement(tenant: Tenant, month: string, rows: UsageRecord[]): BillingStatement {
    const b = this.billing;
    const sum = (rs: UsageRecord[], f: (u: UsageRecord) => number) => rs.reduce((s, u) => s + f(u), 0);
    const local = rows.filter((u) => u.tier === 'local');
    const cloud = rows.filter((u) => u.tier === 'cloud');
    const spill = rows.filter((u) => u.tier === 'spillover');
    const days = this.daysInPeriod(month);
    // (a) 自建模型 token 費：按「服務該筆用量的部署」分列——共用部署按牌價；專屬部署的 tokens 含於 (b) GPU 時數（0 token 費）
    const depKeys = Array.from(new Set(local.map((u) => `${u.modelId}|${u.deploymentId ?? ''}`)));
    const localByModel = depKeys.map((key) => {
      const [mid, did] = key.split('|');
      const rs = local.filter((u) => u.modelId === mid && (u.deploymentId ?? '') === did);
      const dep = this.deployments.find((d) => d.id === did);
      const tokens = sum(rs, (u) => u.inputTokens + u.outputTokens);
      const cachedTokens = sum(rs, (u) => u.cachedInputTokens);
      const cacheWriteTokens = sum(rs, (u) => u.cacheWriteTokens);
      const basis = this.localBasisOf(rs[0]);
      const price = b.tokenPrices[mid] ?? { input: MODEL_BY_ID[mid]?.priceInput ?? 0, output: MODEL_BY_ID[mid]?.priceOutput ?? 0 };
      const usd = basis === 'token' ? r2(sum(rs, (u) => this.tokenCharge(mid, u.inputTokens, u.cachedInputTokens, u.outputTokens, u.cacheWriteTokens))) : 0;
      return { modelId: mid, modelName: MODEL_BY_ID[mid]?.displayName ?? mid, deploymentId: did, deploymentName: dep?.name ?? did, tokens, cachedTokens, cacheWriteTokens, inputUsdPerMTok: price.input, outputUsdPerMTok: price.output, usd, basis };
    });
    const localTokensUsd = r2(localByModel.reduce((s, m) => s + m.usd, 0));
    // (b) 專屬部署費
    const dedicatedItems = this.dedicatedCharges(tenant.id, month);
    const dedicatedUsd = r2(dedicatedItems.reduce((s, i) => s + i.usd, 0));
    // (c) 代理模型：開放模型（百煉）牌價 + 加價；閉源／夥伴牌價 × (1 − 代理折扣)；我們的成本：開放 ＝ 牌價、閉源 ＝ 牌價 × (1 − 議價折扣)
    const cloudRows = [...cloud, ...spill];
    const modelOf = (mid: string): Pick<ModelInfo, 'providerId' | 'proxyDiscountPct'> => MODEL_BY_ID[mid] ?? { providerId: 'bailian' as const, proxyDiscountPct: undefined };
    const cloudByModel = Array.from(new Set(cloudRows.map((u) => u.modelId))).map((mid) => {
      const rs = cloudRows.filter((u) => u.modelId === mid);
      const listUsd = r2(sum(rs, (u) => u.costUsd));
      const m = modelOf(mid);
      return { modelId: mid, modelName: MODEL_BY_ID[mid]?.displayName ?? mid, kind: proxyKindOf(m), tokens: sum(rs, (u) => u.inputTokens + u.outputTokens), listUsd, usd: r2(this.proxyCharge(m, listUsd)), costUsd: r2(this.proxyCost(m, listUsd)) };
    });
    const cloudList = r2(cloudByModel.reduce((s, m) => s + m.listUsd, 0));
    const cloudUsd = r2(cloudByModel.reduce((s, m) => s + m.usd, 0));
    const cloudCost = r2(cloudByModel.reduce((s, m) => s + m.costUsd, 0));
    const cloudMarkup = r2(cloudByModel.filter((m) => m.kind === 'proxied-open').reduce((s, m) => s + (m.usd - m.listUsd), 0));
    const cloudDiscount = r2(cloudByModel.filter((m) => m.kind === 'proxied-closed').reduce((s, m) => s + (m.listUsd - m.usd), 0));
    const subtotal = r2(localTokensUsd + dedicatedUsd + cloudUsd);
    // (d) 承諾用量方案：月承諾額按天數比例；承諾額內折扣、超額按牌價、不足額補足到最低消費
    let commitment: BillingStatement['charges']['commitment'] = null;
    let total = subtotal;
    if (tenant.plan === 'committed' && tenant.commitment) {
      const prorated = r2((tenant.commitment.monthlyUsd * days) / this.daysInMonth(month));
      const discountUsd = r2(prorated * (tenant.commitment.discountPct / 100));
      const overageUsd = r2(Math.max(0, subtotal - prorated));
      const shortfallUsd = r2(Math.max(0, prorated - subtotal));
      commitment = { monthlyUsd: tenant.commitment.monthlyUsd, proratedUsd: prorated, discountPct: tenant.commitment.discountPct, discountUsd, overageUsd, shortfallUsd };
      total = r2(subtotal - discountUsd + shortfallUsd);
    }
    const pct = tenant.quotas.monthlyBudgetUsd ? total / tenant.quotas.monthlyBudgetUsd : 0;
    const projectRows = this.projects
      .filter((p) => p.tenantId === tenant.id)
      .map((p) => {
        const pr = rows.filter((u) => u.projectId === p.id);
        const lrows = pr.filter((u) => u.tier === 'local');
        const lt = sum(lrows, (u) => u.inputTokens + u.outputTokens);
        const l = sum(lrows.filter((u) => this.localBasisOf(u) === 'token'), (u) => this.tokenCharge(u.modelId, u.inputTokens, u.cachedInputTokens, u.outputTokens, u.cacheWriteTokens));
        const c = sum(pr.filter((u) => u.tier === 'cloud'), (u) => this.proxyCharge(modelOf(u.modelId), u.costUsd));
        const sp = sum(pr.filter((u) => u.tier === 'spillover'), (u) => this.proxyCharge(modelOf(u.modelId), u.costUsd));
        return { projectId: p.id, projectName: p.name, localTokens: lt, localTokenUsd: r2(l), cloudUsd: r2(c), spilloverUsd: r2(sp), totalUsd: r2(l + c + sp) };
      });
    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      costCenter: tenant.costCenter,
      billingContact: tenant.billingContact,
      plan: tenant.plan,
      dataClass: tenant.dataClass,
      allowedTiers: tenant.allowedTiers,
      month,
      daysInPeriod: days,
      billingMode: tenant.billingMode,
      retention: tenant.retention,
      rates: { cloudMarkupPct: b.cloudMarkupPct, proxyDiscountPct: b.proxyDiscountPct, cacheReadMultiplier: b.cacheReadMultiplier, cacheWriteMultiplier: b.cacheWriteMultiplier, twdPerUsd: b.twdPerUsd },
      charges: {
        localTokens: { tokens: sum(local, (u) => u.inputTokens + u.outputTokens), cachedTokens: sum(local, (u) => u.cachedInputTokens), cacheWriteTokens: sum(local, (u) => u.cacheWriteTokens), usd: localTokensUsd, byModel: localByModel },
        dedicated: { gpuHours: Math.round(dedicatedItems.reduce((s, i) => s + i.hours, 0) * 100) / 100, usd: dedicatedUsd, items: dedicatedItems },
        cloud: { listUsd: cloudList, markupUsd: cloudMarkup, discountUsd: cloudDiscount, usd: cloudUsd, costUsd: cloudCost, requests: sum(cloudRows, (u) => u.requests), tokens: sum(cloudRows, (u) => u.inputTokens + u.outputTokens), spilloverRequests: sum(spill, (u) => u.requests), byModel: cloudByModel },
        subtotalUsd: subtotal,
        commitment,
        totalUsd: total,
        totalTwd: Math.round(total * b.twdPerUsd),
      },
      local: { requests: sum(local, (u) => u.requests), tokens: sum(local, (u) => u.inputTokens + u.outputTokens), gpuHours: Math.round(sum(local, (u) => u.gpuHours) * 10) / 10 },
      spillover: { requests: sum(spill, (u) => u.requests), tokens: sum(spill, (u) => u.inputTokens + u.outputTokens) },
      cloud: { requests: sum(cloud, (u) => u.requests), tokens: sum(cloud, (u) => u.inputTokens + u.outputTokens) },
      totalUsd: total,
      budget: { monthlyBudgetUsd: tenant.quotas.monthlyBudgetUsd, spentUsd: total, pct: Math.round(pct * 1000) / 1000, alert: pct >= 1 ? 'critical' : pct >= 0.8 ? 'warning' : 'ok' },
      credits:
        tenant.billingMode === 'prepaid' && tenant.credits && month === CURRENT_MONTH
          ? (() => {
              const available = r2(tenant.credits.balanceUsd - total);
              return { balanceUsd: tenant.credits.balanceUsd, deductedUsd: total, availableUsd: available, lowBalance: available <= (tenant.credits.autoReload?.thresholdUsd ?? LOW_BALANCE_DEFAULT_USD) };
            })()
          : null,
      projects: projectRows,
    };
  }

  /** 客戶月對帳單：自建模型 token 費 + 專屬部署費 + 雲端代理費 ± 承諾用量調整 */
  async getBillingStatement(session: Session, tenantId: string, month: string): Promise<ApiResult<BillingStatement>> {
    const g = await this.guard(session, 'billing.read', tenantScope(tenantId), { resourceType: 'statement', resourceId: `${tenantId}:${month}` });
    if (!g.ok) return g;
    const tenant = this.tenantById(tenantId);
    if (!tenant) return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.tenant', { id: tenantId }), g.requestId);
    if (!/^\d{4}-\d{2}$/.test(month)) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.month'), g.requestId);
    const rows = this.usage.filter((u) => u.tenantId === tenantId && u.date.startsWith(month) && this.authorize(g.principal, 'usage.read', projectScope(u.tenantId, u.projectId)).allowed);
    return { ok: true, data: this.computeStatement(tenant, month, rows), requestId: g.requestId };
  }

  /** 平台財務：每個部署的內部成本 vs 牌價 vs 毛利（只給平台範圍 billing.read 的主體） */
  async getUnitPrices(session: Session): Promise<ApiResult<UnitPriceRow[]>> {
    const g = await this.guard(session, 'billing.read', PLATFORM_SCOPE, { resourceType: 'unit-prices' });
    if (!g.ok) return g;
    const b = this.billing;
    const data: UnitPriceRow[] = this.deployments.map((d) => {
      const m = MODEL_BY_ID[d.modelId];
      const cluster = this.clusters.find((c) => c.id === d.clusterId);
      const gpuType = cluster?.gpuType ?? '—';
      const util = d.utilization;
      const cost = b.gpuCostUsdPerHour[gpuType] ?? 0;
      const list = b.gpuListUsdPerHour[gpuType] ?? 0;
      const price = b.tokenPrices[d.modelId] ?? { input: m?.priceInput ?? 0, output: m?.priceOutput ?? 0 };
      const blended = blendedListPrice(price.input, price.output);
      const floor = d.tokPerSec > 0 ? internalUnitPrice(cost, d.gpusPerReplica, d.tokPerSec, 1) : 0;
      // token 毛利只對「有在服務、收 token 費」的共用部署有意義：專屬（收 GPU 時數）、0 副本、利用率或 tok/s 為 0 → n/a
      const applicable = d.sharing === 'shared' && d.replicas > 0 && util > 0 && d.tokPerSec > 0;
      const internal = applicable ? internalUnitPrice(cost, d.gpusPerReplica, d.tokPerSec, util) : 0;
      return {
        deploymentId: d.id,
        deploymentName: d.name,
        modelId: d.modelId,
        modelName: m?.displayName ?? d.modelId,
        clusterName: cluster?.name ?? d.clusterId,
        gpuType,
        sharing: d.sharing,
        dedicatedTenantId: d.dedicatedTenantId,
        dedicatedTenantName: this.tenantName(d.dedicatedTenantId),
        gpusPerReplica: d.gpusPerReplica,
        replicas: d.replicas,
        costUsdPerGpuHour: cost,
        listUsdPerGpuHour: list,
        tokPerSec: d.tokPerSec,
        utilization: util,
        internalUsdPerMTok: Math.round(internal * 1000) / 1000,
        floorUsdPerMTok: Math.round(floor * 1000) / 1000,
        listInputUsdPerMTok: price.input,
        listOutputUsdPerMTok: price.output,
        listBlendedUsdPerMTok: Math.round(blended * 1000) / 1000,
        tokenMarginPct: applicable ? Math.round(grossMargin(blended, internal) * 1000) / 10 : null,
        gpuHourMarginPct: Math.round(grossMargin(list, cost) * 1000) / 10,
        utilizationForTargetMargin: d.sharing === 'shared' && d.tokPerSec > 0 ? utilizationForTargetMargin(floor, blended, TARGET_MARGIN_PCT / 100) : null,
        targetMarginPct: TARGET_MARGIN_PCT,
        marketRefUsd: m?.marketRefUsd,
        cloudComparables: (CLOUD_COMPARABLES[d.modelId] ?? []).map((cid) => MODEL_BY_ID[cid]).filter(Boolean).map((cm) => ({ modelId: cm.id, displayName: cm.displayName, priceInput: cm.priceInput, priceOutput: cm.priceOutput, withMarkup: Math.round(this.proxyCharge(cm, blendedListPrice(cm.priceInput, cm.priceOutput)) * 1000) / 1000 })),
      };
    });
    return { ok: true, data, requestId: g.requestId };
  }

  /** 平台營收與毛利（純計算） */
  private computeRevenue(month: string): RevenueView {
    const days = this.daysInPeriod(month);
    const b = this.billing;
    const monthRows = this.usage.filter((u) => u.date.startsWith(month));
    const statements = this.tenants.map((t) => this.computeStatement(t, month, monthRows.filter((u) => u.tenantId === t.id)));
    const tokenRevenue = r2(statements.reduce((s, st) => s + st.charges.localTokens.usd, 0));
    const dedicatedRevenue = r2(statements.reduce((s, st) => s + st.charges.dedicated.usd, 0));
    const cloudRevenue = r2(statements.reduce((s, st) => s + st.charges.cloud.usd, 0));
    const cloudVendorList = r2(statements.reduce((s, st) => s + st.charges.cloud.listUsd, 0));
    // 我們付給代理供應商的實際成本（閉源模型已含議價折扣）
    const cloudList = r2(statements.reduce((s, st) => s + st.charges.cloud.costUsd, 0));
    const proxyAgg = (kind: ProxyKind) => {
      const rows = statements.flatMap((st) => st.charges.cloud.byModel.filter((m) => m.kind === kind));
      const listUsd = r2(rows.reduce((s, m) => s + m.listUsd, 0));
      const revenueUsd = r2(rows.reduce((s, m) => s + m.usd, 0));
      const costUsd = r2(rows.reduce((s, m) => s + m.costUsd, 0));
      return { listUsd, revenueUsd, costUsd, marginPct: revenueUsd ? Math.round(((revenueUsd - costUsd) / revenueUsd) * 1000) / 10 : 0 };
    };
    const prepaidTopups = r2(this.topups.filter((t) => t.at.startsWith(month)).reduce((s, t) => s + t.amountUsd, 0));
    const commitAdj = r2(statements.reduce((s, st) => s + (st.charges.commitment ? st.charges.commitment.shortfallUsd - st.charges.commitment.discountUsd : 0), 0));
    const totalRevenue = r2(statements.reduce((s, st) => s + st.charges.totalUsd, 0));
    // 我們自己的 GPU TCO：所有機房的 GPU（含閒置與服務異常）× 時價 × 期間內存在的小時數（依叢集 createdAt 按分鐘比例；新註冊的機房只計入加入後的時數）
    const { start, end } = this.periodOf(month);
    const byGpuMap: Record<string, { gpus: number; hours: number }> = {};
    for (const c of this.clusters) {
      const h = overlapHours(c.createdAt, start, end) * c.gpuTotal;
      const e = (byGpuMap[c.gpuType] ??= { gpus: 0, hours: 0 });
      e.gpus += c.gpuTotal;
      e.hours += h;
    }
    const byGpuType = Object.entries(byGpuMap).map(([gpuType, { gpus, hours }]) => {
      const costUsdPerHour = b.gpuCostUsdPerHour[gpuType] ?? 0;
      return { gpuType, gpus, hours: Math.round(hours * 100) / 100, costUsdPerHour, costUsd: r2(hours * costUsdPerHour), listUsdPerHour: b.gpuListUsdPerHour[gpuType] ?? 0 };
    });
    const gpuCost = r2(byGpuType.reduce((s, g) => s + g.costUsd, 0));
    const gpuTotal = this.clusters.reduce((s, c) => s + c.gpuTotal, 0);
    const gpuAllocated = this.clusters.reduce((s, c) => s + c.gpuAllocated, 0);
    const connected = this.clusters.map((c) => this.clusterView(c)).filter((c) => c.status === 'connected');
    const connectedGpus = connected.reduce((s, c) => s + c.gpuTotal, 0);
    const utilization = connectedGpus ? connected.reduce((s, c) => s + c.gpuUtil * c.gpuTotal, 0) / connectedGpus : 0;
    const grossProfit = r2(totalRevenue - gpuCost - cloudList);
    const byModel = Array.from(new Set(monthRows.filter((u) => u.tier === 'local').map((u) => u.modelId))).map((mid) => {
      const rows = monthRows.filter((u) => u.tier === 'local' && u.modelId === mid);
      // 以收 token 費的共用部署估算內部成本；只有專屬部署服務的模型不收 token 費 → 毛利 n/a
      const sharedDep = this.deployments.find((d) => d.modelId === mid && d.sharing === 'shared' && d.status === 'ready' && d.utilization > 0) ?? this.deployments.find((d) => d.modelId === mid && d.sharing === 'shared');
      const cluster = sharedDep ? this.clusters.find((c) => c.id === sharedDep.clusterId) : undefined;
      const cost = cluster ? b.gpuCostUsdPerHour[cluster.gpuType] ?? 0 : 0;
      const applicable = !!sharedDep && sharedDep.tokPerSec > 0 && sharedDep.utilization > 0 && rows.some((u) => this.localBasisOf(u) === 'token');
      const internal = applicable && sharedDep ? internalUnitPrice(cost, sharedDep.gpusPerReplica, sharedDep.tokPerSec, sharedDep.utilization) : 0;
      const price = b.tokenPrices[mid] ?? { input: MODEL_BY_ID[mid]?.priceInput ?? 0, output: MODEL_BY_ID[mid]?.priceOutput ?? 0 };
      const list = blendedListPrice(price.input, price.output);
      const tokens = rows.reduce((s, u) => s + u.inputTokens + u.outputTokens, 0);
      const revenueUsd = r2(statements.reduce((s, st) => s + st.charges.localTokens.byModel.filter((x) => x.modelId === mid).reduce((a, x) => a + x.usd, 0), 0));
      return { modelId: mid, modelName: MODEL_BY_ID[mid]?.displayName ?? mid, tokens, revenueUsd, internalUsdPerMTok: Math.round(internal * 1000) / 1000, listUsdPerMTok: Math.round(list * 1000) / 1000, marginPct: applicable ? Math.round(grossMargin(list, internal) * 1000) / 10 : null };
    });
    return {
      month,
      daysInPeriod: days,
      totalRevenueUsd: totalRevenue,
      tokenRevenueUsd: tokenRevenue,
      dedicatedRevenueUsd: dedicatedRevenue,
      cloudRevenueUsd: cloudRevenue,
      commitmentAdjustmentUsd: commitAdj,
      cloudListCostUsd: cloudList,
      cloudVendorListUsd: cloudVendorList,
      prepaidTopupsUsd: prepaidTopups,
      proxiedOpen: proxyAgg('proxied-open'),
      proxiedClosed: proxyAgg('proxied-closed'),
      gpuCostUsd: gpuCost,
      grossProfitUsd: grossProfit,
      grossMarginPct: totalRevenue ? Math.round((grossProfit / totalRevenue) * 1000) / 10 : 0,
      fleet: { gpuTotal, gpuAllocated, utilization: Math.round(utilization * 1000) / 1000, gpuHours: Math.round(byGpuType.reduce((s, g) => s + g.hours, 0) * 100) / 100, byGpuType },
      cloud: { listUsd: cloudVendorList, markupUsd: r2(cloudRevenue - cloudList), marginPct: cloudRevenue ? Math.round(((cloudRevenue - cloudList) / cloudRevenue) * 1000) / 10 : 0 },
      byTenant: statements.map((st) => ({ tenantId: st.tenantId, tenantName: st.tenantName, costCenter: st.costCenter, plan: st.plan, revenueUsd: st.charges.totalUsd, tokenUsd: st.charges.localTokens.usd, dedicatedUsd: st.charges.dedicated.usd, cloudUsd: st.charges.cloud.usd, commitmentAdjustmentUsd: st.charges.commitment ? r2(st.charges.commitment.shortfallUsd - st.charges.commitment.discountUsd) : 0 })),
      byModel,
    };
  }

  /** 平台營收與毛利檢視：只給平台範圍 billing.read（我們的擁有者／財務） */
  async getRevenue(session: Session, month = '2026-11'): Promise<ApiResult<RevenueView>> {
    const g = await this.guard(session, 'billing.read', PLATFORM_SCOPE, { resourceType: 'revenue', resourceId: month });
    if (!g.ok) return g;
    if (!/^\d{4}-\d{2}$/.test(month)) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.month'), g.requestId);
    return { ok: true, data: this.computeRevenue(month), requestId: g.requestId };
  }

  /** 定價與帳務參數：需 billing.configure（平台擁有者／平台財務），驗證範圍並寫入稽核（變更前後值） */
  async updateBillingSettings(
    session: Session,
    patch: Partial<Pick<BillingSettings, 'cacheReadMultiplier' | 'cacheWriteMultiplier' | 'cloudMarkupPct' | 'proxyDiscountPct' | 'negotiatedDiscountPct' | 'twdPerUsd'>> & { tokenPrices?: Record<string, { input: number; output: number }>; gpuListUsdPerHour?: Record<string, number>; gpuCostUsdPerHour?: Record<string, number> },
  ): Promise<ApiResult<BillingSettings>> {
    const g = await this.guard(session, 'billing.configure', PLATFORM_SCOPE, { resourceType: 'settings', resourceId: 'billing' });
    if (!g.ok) return g;
    const inRange = (v: number | undefined, max: number) => v === undefined || (Number.isFinite(v) && v >= 0 && v <= max);
    if (!inRange(patch.cloudMarkupPct, 100)) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.markupRange'), g.requestId);
    if (!inRange(patch.proxyDiscountPct, 100)) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.proxyDiscountRange'), g.requestId);
    if (!inRange(patch.negotiatedDiscountPct, 100)) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.negotiatedDiscountRange'), g.requestId);
    if (!inRange(patch.cacheReadMultiplier, 1)) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.cacheReadRange'), g.requestId);
    if (!inRange(patch.cacheWriteMultiplier, 5)) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.cacheWriteRange'), g.requestId);
    if (patch.twdPerUsd !== undefined && !(patch.twdPerUsd > 0 && patch.twdPerUsd < 100)) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.fxRange'), g.requestId);
    for (const [mid, p] of Object.entries(patch.tokenPrices ?? {})) {
      if (!MODEL_BY_ID[mid] || !isLocalModel(MODEL_BY_ID[mid])) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.tokenPriceLocalOnly', { model: mid }), g.requestId);
      if (!inRange(p.input, 100) || !inRange(p.output, 100)) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.tokenPriceRange', { model: mid }), g.requestId);
    }
    for (const [gpu, v] of Object.entries(patch.gpuListUsdPerHour ?? {})) {
      if (!GPU_SPECS[gpu] || !inRange(v, 100)) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.gpuPriceRange', { gpu }), g.requestId);
    }
    for (const [gpu, v] of Object.entries(patch.gpuCostUsdPerHour ?? {})) {
      if (!GPU_SPECS[gpu] || !inRange(v, 100)) return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.gpuCostRange', { gpu }), g.requestId);
    }
    const before = JSON.parse(JSON.stringify(this.billing)) as BillingSettings;
    if (patch.cloudMarkupPct !== undefined) this.billing.cloudMarkupPct = patch.cloudMarkupPct;
    if (patch.proxyDiscountPct !== undefined) this.billing.proxyDiscountPct = patch.proxyDiscountPct;
    if (patch.negotiatedDiscountPct !== undefined) this.billing.negotiatedDiscountPct = patch.negotiatedDiscountPct;
    if (patch.cacheReadMultiplier !== undefined) this.billing.cacheReadMultiplier = patch.cacheReadMultiplier;
    if (patch.cacheWriteMultiplier !== undefined) this.billing.cacheWriteMultiplier = patch.cacheWriteMultiplier;
    if (patch.twdPerUsd !== undefined) this.billing.twdPerUsd = patch.twdPerUsd;
    for (const [mid, p] of Object.entries(patch.tokenPrices ?? {})) this.billing.tokenPrices[mid] = { input: p.input, output: p.output };
    for (const [gpu, v] of Object.entries(patch.gpuListUsdPerHour ?? {})) this.billing.gpuListUsdPerHour[gpu] = v;
    for (const [gpu, v] of Object.entries(patch.gpuCostUsdPerHour ?? {})) this.billing.gpuCostUsdPerHour[gpu] = v;
    const after = JSON.parse(JSON.stringify(this.billing)) as BillingSettings;
    this.log({ actorId: g.principal.id, principalId: g.principal.id, action: 'billing.configure', scope: PLATFORM_SCOPE, decision: 'allow', requestId: g.requestId, before, after, resourceType: 'settings', resourceId: 'billing', ...rsn('server.audit.billingConfigure') });
    return { ok: true, data: after, requestId: g.requestId };
  }

  async getUsage(session: Session, q: UsageQuery = {}): Promise<ApiResult<UsageRecord[]>> {
    const requestId = newRequestId();
    await this.simulate();
    const principal = this.authenticate(session);
    if (!principal) return this.err(401, 'UNAUTHENTICATED', kt('server.err.UNAUTHENTICATED'), requestId);
    if (!canAnywhere(principal, 'usage.read', this.ctx())) {
      this.log({ actorId: principal.id, principalId: principal.id, action: 'usage.read', scope: PLATFORM_SCOPE, decision: 'deny', requestId, ...rsn('server.audit.defaultDeny') });
      return this.err(403, 'FORBIDDEN', kt('server.err.FORBIDDEN.usage'), requestId);
    }
    const data = this.usage.filter(
      (u) =>
        (!q.tenantId || u.tenantId === q.tenantId) &&
        (!q.projectId || u.projectId === q.projectId) &&
        (!q.modelId || u.modelId === q.modelId) &&
        (!q.tier || u.tier === q.tier) &&
        (!q.from || u.date >= q.from) &&
        (!q.to || u.date <= q.to) &&
        this.authorize(principal, 'usage.read', projectScope(u.tenantId, u.projectId)).allowed,
    );
    return { ok: true, data, requestId };
  }

  /** 一筆用量向客戶收費的金額與依據（供 UI 與 CSV 使用）：自建層以服務它的部署（sharing）判定，專屬 → 0 token 費 */
  usageCharge(r: UsageRecord): { usd: number; basis: 'token' | 'dedicated' | 'cloud' } {
    if (r.tier !== 'local') return { usd: r2(this.proxyCharge(MODEL_BY_ID[r.modelId] ?? { providerId: r.providerId, proxyDiscountPct: undefined }, r.costUsd)), basis: 'cloud' };
    if (this.localBasisOf(r) === 'dedicated') return { usd: 0, basis: 'dedicated' };
    return { usd: r2(this.tokenCharge(r.modelId, r.inputTokens, r.cachedInputTokens, r.outputTokens, r.cacheWriteTokens)), basis: 'token' };
  }

  async exportUsageCsv(session: Session, q: UsageQuery = {}): Promise<ApiResult<string>> {
    const scope = q.projectId && q.tenantId ? projectScope(q.tenantId, q.projectId) : q.tenantId ? tenantScope(q.tenantId) : PLATFORM_SCOPE;
    const g = await this.guard(session, 'billing.export', scope, { resourceType: 'usage' });
    if (!g.ok) return g;
    const rows = this.usage.filter(
      (u) =>
        (!q.tenantId || u.tenantId === q.tenantId) &&
        (!q.projectId || u.projectId === q.projectId) &&
        (!q.modelId || u.modelId === q.modelId) &&
        (!q.tier || u.tier === q.tier) &&
        (!q.from || u.date >= q.from) &&
        (!q.to || u.date <= q.to),
    );
    const header = 'date,tenantId,costCenter,projectId,modelId,providerId,tier,deploymentId,sharing,region,billingBasis,requests,errors,inputTokens,cacheReadTokens,cacheWriteTokens,outputTokens,gpuHours,chargeUsd';
    const csv = [
      header,
      ...rows.map((r) => {
        const ch = this.usageCharge(r);
        return [r.date, r.tenantId, `"${this.tenantById(r.tenantId)?.costCenter ?? ''}"`, r.projectId, r.modelId, r.providerId, r.tier, r.deploymentId ?? '', r.sharing ?? '', r.region, ch.basis, r.requests, r.errors, r.inputTokens, r.cachedInputTokens, r.cacheWriteTokens, r.outputTokens, r.gpuHours, ch.usd].join(',');
      }),
    ].join('\n');
    this.log({ actorId: g.principal.id, principalId: g.principal.id, action: 'billing.export', scope, decision: 'allow', requestId: g.requestId, after: { rows: rows.length, filter: q }, resourceType: 'usage' });
    return { ok: true, data: csv, requestId: g.requestId };
  }

  async getOverview(session: Session): Promise<ApiResult<OverviewData>> {
    const requestId = newRequestId();
    await this.simulate();
    const principal = this.authenticate(session);
    if (!principal) return this.err(401, 'UNAUTHENTICATED', kt('server.err.UNAUTHENTICATED'), requestId);
    const visible = this.usage.filter((u) => this.authorize(principal, 'usage.read', projectScope(u.tenantId, u.projectId)).allowed);
    const today = visible.filter((u) => u.date === `${CURRENT_MONTH}-08`);
    const month = visible.filter((u) => u.date >= `${CURRENT_MONTH}-01`);
    const requestsToday = today.reduce((s, u) => s + u.requests, 0);
    const errorsToday = today.reduce((s, u) => s + u.errors, 0);
    const sum = (rows: UsageRecord[], f: (u: UsageRecord) => number) => rows.reduce((s, u) => s + f(u), 0);
    const localMonth = month.filter((u) => u.tier === 'local');
    const cloudMonth = month.filter((u) => u.tier !== 'local');
    const visibleTenants = this.tenants.filter((t) => this.authorize(principal, 'billing.read', tenantScope(t.id)).allowed);
    const statements = visibleTenants.map((t) => this.computeStatement(t, CURRENT_MONTH, month.filter((u) => u.tenantId === t.id)));
    const localRevenue = r2(statements.reduce((s, st) => s + st.charges.localTokens.usd + st.charges.dedicated.usd, 0));
    const cloudRevenue = r2(statements.reduce((s, st) => s + st.charges.cloud.usd, 0));
    const monthSpend = r2(statements.reduce((s, st) => s + st.charges.totalUsd, 0));
    const budget = visibleTenants.reduce((s, t) => s + t.quotas.monthlyBudgetUsd, 0);
    const customer: CustomerKpis = {
      requestsToday,
      tokensToday: today.reduce((s, u) => s + u.inputTokens + u.outputTokens, 0),
      monthSpendUsd: monthSpend,
      budgetUsd: budget,
      budgetPct: budget ? Math.round((monthSpend / budget) * 1000) / 1000 : 0,
      errorRate: requestsToday ? errorsToday / requestsToday : 0,
      avgTtftMs: today.length ? Math.round(today.reduce((s, u) => s + u.avgTtftMs, 0) / today.length) : 0,
    };
    const tiers = {
      localRequests: sum(localMonth, (u) => u.requests),
      cloudRequests: sum(cloudMonth, (u) => u.requests),
      spilloverRequests: sum(month.filter((u) => u.tier === 'spillover'), (u) => u.requests),
      localTokens: sum(localMonth, (u) => u.inputTokens + u.outputTokens),
      cloudTokens: sum(cloudMonth, (u) => u.inputTokens + u.outputTokens),
      localRevenueUsd: localRevenue,
      cloudRevenueUsd: cloudRevenue,
      localGpuHours: Math.round(sum(localMonth, (u) => u.gpuHours) * 10) / 10,
    };
    const canAudit = canAnywhere(principal, 'audit.read', this.ctx());
    const recentAudit = canAudit ? [...this.audit.all()].filter((e) => this.authorize(principal, 'audit.read', e.scope).allowed).slice(-6).reverse() : [];
    const canProviders = canAnywhere(principal, 'provider.read', this.ctx());
    const canClusters = canAnywhere(principal, 'cluster.read', this.ctx());
    const clusterViews = canClusters ? this.clusters.filter((c) => this.authorize(principal, 'cluster.read', clusterScope(c.id)).allowed).map((c) => this.clusterView(c)) : [];
    const clusters: ClusterSummary[] = clusterViews.map((c) => ({ id: c.id, name: c.name, site: c.site, status: c.status, gpuType: c.gpuType, gpuUtil: c.gpuUtil, queueDepth: c.queueDepth, gpuAllocated: c.gpuAllocated, gpuTotal: c.gpuTotal }));
    // 平台營收／毛利：只有在平台範圍具 billing.read 的我們的主體
    const isVendor = principal.tenantId === null;
    const revenue: RevenueView | null = this.authorize(principal, 'billing.read', PLATFORM_SCOPE).allowed ? this.computeRevenue(CURRENT_MONTH) : null;
    let vendor: VendorKpis | null = null;
    if (isVendor) {
      const gpuTotal = clusterViews.reduce((s, c) => s + c.gpuTotal, 0);
      const connected = clusterViews.filter((c) => c.status === 'connected');
      const connectedGpus = connected.reduce((s, c) => s + c.gpuTotal, 0);
      const totalReq = tiers.localRequests + tiers.cloudRequests;
      const week = visible.filter((u) => u.date >= '2026-11-02' && u.date <= `${CURRENT_MONTH}-08`);
      const monthReq = sum(month, (u) => u.requests);
      const monthErr = sum(month, (u) => u.errors);
      const approvedTrials = this.trials.filter((t) => t.status === 'approved');
      const converted = approvedTrials.filter((t) => {
        const tt = t.tenantId ? this.tenantById(t.tenantId) : undefined;
        if (!tt) return false;
        if (tt.billingMode === 'postpaid') return true;
        return this.topups.some((x) => x.tenantId === tt.id && x.kind === 'topup');
      }).length;
      vendor = {
        weekTokens: { local: sum(week.filter((u) => u.tier === 'local'), (u) => u.inputTokens + u.outputTokens), proxied: sum(week.filter((u) => u.tier !== 'local'), (u) => u.inputTokens + u.outputTokens) },
        revenueSplit: revenue ? { tokenUsd: revenue.tokenRevenueUsd, proxiedUsd: revenue.cloudRevenueUsd, dedicatedUsd: revenue.dedicatedRevenueUsd, prepaidTopupsUsd: revenue.prepaidTopupsUsd } : null,
        trialFunnel: { submitted: this.trials.length, approved: approvedTrials.length, converted },
        slaAttainmentPct: monthReq ? Math.round((1 - monthErr / monthReq) * 10000) / 100 : 100,
        // 已連線機房的加權利用率（服務異常的台中 C 不計入分母，否則會被閒置 GPU 稀釋）
        gpuUtilization: connectedGpus ? Math.round((connected.reduce((s, c) => s + c.gpuUtil * c.gpuTotal, 0) / connectedGpus) * 1000) / 1000 : 0,
        gpuTotal,
        gpuAllocated: clusterViews.reduce((s, c) => s + c.gpuAllocated, 0),
        // 沒有平台範圍 billing.read（例如平台營運）→ null，UI 顯示「無權限」而不是 0
        monthRevenueUsd: revenue ? revenue.totalRevenueUsd : null,
        grossMarginPct: revenue ? revenue.grossMarginPct : null,
        spilloverPct: totalReq ? Math.round((tiers.spilloverRequests / totalReq) * 1000) / 10 : 0,
        activeTenants: this.tenants.filter((t) => t.status === 'active').length,
        clustersHealthy: connected.length,
        clustersTotal: clusterViews.length,
      };
    }
    return { ok: true, requestId, data: { audience: isVendor ? 'vendor' : 'customer', vendor, customer, tiers, providers: canProviders ? this.providers : [], clusters, revenue, hourly: this.hourly, recentAudit } };
  }

  // ---------- IAM ----------
  private view(a: RoleAssignment, atScope: string): AssignmentView {
    const p = this.principalById(a.principalId);
    return {
      ...a,
      principalName: p?.displayName ?? a.principalId,
      principalType: p?.type ?? 'user',
      roleName: ROLES[a.roleId].name,
      inherited: normalizeScope(a.scope) !== normalizeScope(atScope),
      createdByName: this.nameOf(a.createdBy),
    };
  }

  async listRoleAssignments(session: Session, scope: string): Promise<ApiResult<AssignmentView[]>> {
    const g = await this.guard(session, 'iam.read', scope);
    if (!g.ok) return g;
    const target = normalizeScope(scope);
    const data = this.assignments
      .filter((a) => isAncestorOrSelf(a.scope, target))
      .map((a) => this.view(a, target))
      .sort((a, b) => Number(a.inherited) - Number(b.inherited));
    return { ok: true, data, requestId: g.requestId };
  }

  async getEffectiveAccess(session: Session, principalId: string, scope: string): Promise<ApiResult<EffectiveAccess>> {
    const g = await this.guard(session, 'iam.read', scope);
    if (!g.ok) return g;
    const target = this.principalById(principalId);
    // 不揭露其他租戶的主體：租戶內的呼叫者只能查自己租戶的主體（找不到與不可見都回 404）
    const callerTenant = g.principal.tenantId ?? tenantIdOfScope(scope);
    if (!target || (callerTenant && target.tenantId !== callerTenant)) return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.principal', { id: principalId }), g.requestId);
    const decisions = ALL_ACTIONS.map((action) => ({ action, decision: this.authorize(target, action, scope) }));
    return { ok: true, data: { principal: target, scope: normalizeScope(scope), decisions }, requestId: g.requestId };
  }

  /** 預覽指派影響：目前 vs 擬議的有效存取、是否需核准、風險警示（需 iam.read；不寫入任何資料） */
  async previewRoleAssignment(
    session: Session,
    input: CreateAssignmentInput,
  ): Promise<ApiResult<{ current: Decision[]; proposed: Decision[]; needsApproval: boolean; warnings: string[]; blockers: string[]; warningKeys?: KeyedText[]; blockerKeys?: KeyedText[] }>> {
    const scope = normalizeScope(input.scope);
    const g = await this.guard(session, 'iam.read', scope);
    if (!g.ok) return g;
    const target = this.principalById(input.principalId);
    if (!target) return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.principal', { id: input.principalId }), g.requestId);
    const role = ROLES[input.roleId];
    const actor = g.principal;
    const current = ALL_ACTIONS.map((a) => this.authorize(target, a, scope));
    const simulated: RoleAssignment = { id: 'preview', principalId: target.id, roleId: input.roleId, scope, tenantId: tenantIdOfScope(scope), status: 'active', createdAt: '', createdBy: actor.id };
    const proposed = ALL_ACTIONS.map((a) => can(target, a, scope, { assignments: [...this.assignments, simulated] }));
    const needsApproval = this.privilegedNeedsApproval(role.privileged, actor, scope);
    const warnings = new KeyedList();
    const blockers = new KeyedList();
    const roleRef = `@server.role.${input.roleId}.name`;
    if (!this.authorize(actor, 'iam.assign', scope).allowed) blockers.push('server.iam.blocker.noAssign', { scope });
    else if (!isWithinDelegation(actor, scope, this.ctx())) blockers.push('server.iam.blocker.outOfDelegation', { scope });
    const scopeTenant = tenantIdOfScope(scope);
    if (scopeTenant && target.tenantId && target.tenantId !== scopeTenant) blockers.push('server.iam.blocker.crossTenant', { principalTenant: target.tenantId, scopeTenant });
    if (!scopeTenant && target.tenantId) blockers.push('server.iam.blocker.customerPlatformScope');
    if (VENDOR_ROLES.includes(input.roleId) && scope !== PLATFORM_SCOPE) blockers.push('server.iam.blocker.vendorRole', { role: roleRef });
    const actorIds = new Set([actor.id, ...actor.groupIds]);
    if (actorIds.has(target.id) && role.rank > highestRank(actor, scope, this.ctx())) blockers.push('server.iam.blocker.selfEscalation');
    if (role.privileged) warnings.push(needsApproval ? 'server.iam.warn.privilegedPending' : 'server.iam.warn.privilegedDirect', { role: roleRef });
    if (scope === PLATFORM_SCOPE) warnings.push('server.iam.warn.platformScope');
    if (role.actions.includes('iam.assign') && role.actions.some((a) => ['key.create', 'key.revoke', 'model.route.update', 'project.delete'].includes(a))) warnings.push('server.iam.warn.highRiskCombo');
    if (target.type === 'group') warnings.push('server.iam.warn.group');
    if (!input.expiresAt) warnings.push('server.iam.warn.noExpiry');
    return { ok: true, requestId: g.requestId, data: { current, proposed, needsApproval, warnings: warnings.texts, blockers: blockers.texts, warningKeys: warnings.keys, blockerKeys: blockers.keys } };
  }

  /**
   * 特權角色是否需另一人核准：
   * - 平台層主體（我們的擁有者）在其具 iam.approve 的範圍可直接生效；
   * - 客戶的租戶管理員雖在租戶範圍具 iam.approve，但自己提出的特權指派仍需「另一位」核准者（職責分離：申請者 ≠ 核准者）。
   */
  private privilegedNeedsApproval(privileged: boolean, actor: Principal, scope: string): boolean {
    if (!privileged) return false;
    if (!this.authorize(actor, 'iam.approve', scope).allowed) return true;
    return actor.tenantId !== null;
  }

  /** 新增角色指派：範圍委派檢查、租戶邊界、自我提權、特權角色核准流程 */
  async createRoleAssignment(session: Session, input: CreateAssignmentInput): Promise<ApiResult<CreateAssignmentResult>> {
    const scope = normalizeScope(input.scope);
    if (!isValidScope(scope)) {
      await this.simulate();
      return this.err(400, 'VALIDATION', kt('server.err.VALIDATION.invalidScope', { scope: input.scope }), newRequestId());
    }
    const g = await this.guard(session, 'iam.assign', scope, { resourceType: 'roleAssignment' });
    if (!g.ok) return g;
    const actor = g.principal;
    const deny = (status: ApiError['status'], code: string, msg: KeyedText) => {
      this.log({ actorId: actor.id, principalId: input.principalId, action: 'iam.assign', scope, decision: 'deny', requestId: g.requestId, ...rsn(msg.key, msg.params), resourceType: 'roleAssignment' });
      return this.err(status, code, msg, g.requestId);
    };

    if (!ROLES[input.roleId]) return deny(400, 'VALIDATION', kt('server.err.VALIDATION.unknownRole', { role: input.roleId }));
    if (!isWithinDelegation(actor, scope, this.ctx())) {
      return deny(403, 'OUT_OF_DELEGATION', kt('server.err.OUT_OF_DELEGATION', { scope }));
    }
    const target = this.principalById(input.principalId);
    if (!target) return deny(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.principal', { id: input.principalId }));

    const scopeTenant = tenantIdOfScope(scope);
    if (scopeTenant && target.tenantId && target.tenantId !== scopeTenant) {
      return deny(403, 'CROSS_TENANT', kt('server.err.CROSS_TENANT', { principalTenant: target.tenantId, scopeTenant }));
    }
    if (!scopeTenant && target.tenantId) {
      return deny(403, 'CROSS_TENANT', kt('server.err.CROSS_TENANT.platformScope'));
    }
    if (VENDOR_ROLES.includes(input.roleId) && scope !== PLATFORM_SCOPE) {
      return deny(400, 'VALIDATION', kt('server.err.VALIDATION.vendorRole', { role: `@server.role.${input.roleId}.name` }));
    }

    const role = ROLES[input.roleId];
    const actorIds = new Set([actor.id, ...actor.groupIds]);
    if (actorIds.has(target.id) && role.rank > highestRank(actor, scope, this.ctx())) {
      return deny(403, 'SELF_ESCALATION', kt('server.err.SELF_ESCALATION', { role: `@server.role.${input.roleId}.name` }));
    }

    const dup = this.assignments.find(
      (a) => a.principalId === target.id && a.roleId === input.roleId && normalizeScope(a.scope) === scope && (a.status === 'active' || a.status === 'pending'),
    );
    if (dup) return deny(409, 'CONFLICT', kt(dup.status === 'pending' ? 'server.err.CONFLICT.duplicateAssignment.pending' : 'server.err.CONFLICT.duplicateAssignment.active', { id: dup.id }));

    const needsApproval = this.privilegedNeedsApproval(role.privileged, actor, scope);
    const assignment: RoleAssignment = {
      id: this.nextId('ra'),
      principalId: target.id,
      roleId: input.roleId,
      scope,
      tenantId: scopeTenant,
      status: needsApproval ? 'pending' : 'active',
      createdAt: new Date().toISOString(),
      createdBy: actor.id,
      expiresAt: input.expiresAt,
      justification: input.justification,
      ...(needsApproval ? {} : { approvedBy: actor.id, approvedAt: new Date().toISOString() }),
    };
    this.assignments.push(assignment);
    this.log({
      actorId: actor.id,
      principalId: target.id,
      action: 'iam.assign',
      scope,
      decision: 'allow',
      requestId: g.requestId,
      ...(needsApproval ? rsn('server.audit.assignPending', { role: `@server.role.${input.roleId}.name` }) : rsn('server.audit.assignActive')),
      before: null,
      after: assignment,
      resourceType: 'roleAssignment',
      resourceId: assignment.id,
    });
    return { ok: true, data: { assignment, outcome: needsApproval ? 'pending' : 'active' }, requestId: g.requestId };
  }

  /** 刪除角色指派：必須在指派所在範圍操作；繼承的指派不可於子範圍刪除 */
  async deleteRoleAssignment(session: Session, assignmentId: string, atScope: string): Promise<ApiResult<{ id: string }>> {
    const a = this.assignments.find((x) => x.id === assignmentId);
    if (!a) {
      await this.simulate();
      return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.assignment', { id: assignmentId }), newRequestId());
    }
    const g = await this.guard(session, 'iam.assign', a.scope, { resourceType: 'roleAssignment', resourceId: assignmentId });
    if (!g.ok) return g;
    if (normalizeScope(atScope) !== normalizeScope(a.scope)) {
      const msg = kt('server.err.INHERITED_ASSIGNMENT', { source: a.scope, at: normalizeScope(atScope) });
      this.log({ actorId: g.principal.id, principalId: a.principalId, action: 'iam.assign', scope: atScope, decision: 'deny', requestId: g.requestId, ...rsn(msg.key, msg.params), resourceType: 'roleAssignment', resourceId: assignmentId });
      return this.err(409, 'INHERITED_ASSIGNMENT', msg, g.requestId);
    }
    if (a.principalId === g.principal.id && a.roleId === 'platform-owner') {
      return this.err(409, 'CONFLICT', kt('server.err.CONFLICT.removeOwnOwner'), g.requestId);
    }
    this.assignments = this.assignments.filter((x) => x.id !== assignmentId);
    this.log({ actorId: g.principal.id, principalId: a.principalId, action: 'iam.assign', scope: a.scope, decision: 'allow', requestId: g.requestId, ...rsn('server.audit.deleteAssignment'), before: a, after: null, resourceType: 'roleAssignment', resourceId: assignmentId });
    return { ok: true, data: { id: assignmentId }, requestId: g.requestId };
  }

  async listPendingRequests(session: Session, scope: string): Promise<ApiResult<AssignmentView[]>> {
    const g = await this.guard(session, 'iam.read', scope);
    if (!g.ok) return g;
    const target = normalizeScope(scope);
    const data = this.assignments
      .filter((a) => (a.status === 'pending' || a.status === 'rejected') && isAncestorOrSelf(target, a.scope))
      .map((a) => this.view(a, target));
    return { ok: true, data, requestId: g.requestId };
  }

  async approveRequest(session: Session, assignmentId: string): Promise<ApiResult<RoleAssignment>> {
    return this.resolveRequest(session, assignmentId, 'approve');
  }
  async rejectRequest(session: Session, assignmentId: string): Promise<ApiResult<RoleAssignment>> {
    return this.resolveRequest(session, assignmentId, 'reject');
  }

  private async resolveRequest(session: Session, assignmentId: string, verb: 'approve' | 'reject'): Promise<ApiResult<RoleAssignment>> {
    const a = this.assignments.find((x) => x.id === assignmentId);
    if (!a) {
      await this.simulate();
      return this.err(404, 'NOT_FOUND', kt('server.err.NOT_FOUND.request', { id: assignmentId }), newRequestId());
    }
    const g = await this.guard(session, 'iam.approve', a.scope, { resourceType: 'roleAssignment', resourceId: assignmentId });
    if (!g.ok) return g;
    if (a.status !== 'pending') return this.err(409, 'CONFLICT', kt('server.err.CONFLICT.requestProcessed'), g.requestId);
    const actorIds = new Set([g.principal.id, ...g.principal.groupIds]);
    if (a.createdBy === g.principal.id || actorIds.has(a.principalId)) {
      const msg = kt('server.err.SEPARATION_OF_DUTIES');
      this.log({ actorId: g.principal.id, principalId: a.principalId, action: 'iam.approve', scope: a.scope, decision: 'deny', requestId: g.requestId, ...rsn(msg.key), resourceType: 'roleAssignment', resourceId: assignmentId });
      return this.err(403, 'SEPARATION_OF_DUTIES', msg, g.requestId);
    }
    const before = { ...a };
    if (verb === 'approve') {
      a.status = 'active';
      a.approvedBy = g.principal.id;
      a.approvedAt = new Date().toISOString();
    } else {
      a.status = 'rejected';
      a.approvedBy = g.principal.id;
      a.approvedAt = new Date().toISOString();
    }
    this.log({ actorId: g.principal.id, principalId: a.principalId, action: 'iam.approve', scope: a.scope, decision: 'allow', requestId: g.requestId, ...rsn(verb === 'approve' ? 'server.audit.approve' : 'server.audit.reject'), before, after: { ...a }, resourceType: 'roleAssignment', resourceId: assignmentId });
    return { ok: true, data: a, requestId: g.requestId };
  }

  // ---------- 稽核 ----------
  async listAuditLogs(session: Session, q: AuditQuery = {}): Promise<ApiResult<AuditEvent[]>> {
    const requestId = newRequestId();
    await this.simulate();
    const principal = this.authenticate(session);
    if (!principal) return this.err(401, 'UNAUTHENTICATED', kt('server.err.UNAUTHENTICATED'), requestId);
    if (!canAnywhere(principal, 'audit.read', this.ctx())) {
      this.log({ actorId: principal.id, principalId: principal.id, action: 'audit.read', scope: q.scope ?? PLATFORM_SCOPE, decision: 'deny', requestId, ...rsn('server.audit.defaultDeny') });
      return this.err(403, 'FORBIDDEN', kt('server.err.FORBIDDEN.audit'), requestId);
    }
    const text = q.text?.toLowerCase();
    const data = [...this.audit.all()]
      .filter((e) => this.authorize(principal, 'audit.read', e.scope).allowed)
      .filter((e) => !q.scope || isAncestorOrSelf(q.scope, e.scope))
      .filter((e) => !q.decision || e.decision === q.decision)
      .filter((e) => !q.actorId || e.actorId === q.actorId)
      .filter((e) => !q.action || e.action === q.action)
      .filter((e) => !text || [e.actorName, e.principalName, e.action, e.scope, e.requestId, e.reason ?? ''].join(' ').toLowerCase().includes(text))
      .reverse();
    return { ok: true, data, requestId };
  }

  async exportAudit(session: Session, scope: string): Promise<ApiResult<string>> {
    const g = await this.guard(session, 'audit.export', scope, { resourceType: 'audit' });
    if (!g.ok) return g;
    const rows = this.audit.all().filter((e) => isAncestorOrSelf(scope, e.scope));
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
      'timestamp,actor,principal,action,scope,decision,requestId,reason',
      ...rows.map((e) => [e.timestamp, e.actorName, e.principalName, e.action, e.scope, e.decision, e.requestId, e.reason].map(esc).join(',')),
    ].join('\n');
    this.log({ actorId: g.principal.id, principalId: g.principal.id, action: 'audit.export', scope, decision: 'allow', requestId: g.requestId, after: { rows: rows.length }, resourceType: 'audit' });
    return { ok: true, data: csv, requestId: g.requestId };
  }
}

/** 公部門政策與平台情境說明（供 UI 顯示） */
export { PUBLIC_SECTOR_NOTE, PLATFORM_NOTE };

/** 應用程式共用的單一模擬伺服器實例 */
export const server = new MockServer();
