// 示範資料（Seed）：所有租戶（客戶）、使用者、金鑰均為虛構
// 情境：我們（平台供應商）擁有 GPU 機房；客戶透過我們的 OpenAI 相容 API 使用模型，我們依方案向客戶收費。
import type { Principal, RoleAssignment } from '../auth/types';
import type { BillingMode, RetentionPolicy } from '../data/commercial';
import { zh } from '../i18n/core';

/** 資料分級：決定可用的推論層級（公部門一律僅自建） */
export type DataClass = 'general' | 'sensitive' | 'public-sector';
/** 允許的推論層級：local＝只用我們自建的 GPU；cloud＝只用雲端代理；both＝自建為主、可溢出雲端 */
export type TierPolicy = 'local' | 'cloud' | 'both';
/** 收費方案 */
export type TenantPlan = 'payg' | 'committed' | 'dedicated';

export const DATA_CLASS_LABELS: Record<DataClass, string> = {
  general: zh('data.DATA_CLASS_LABELS.general'),
  sensitive: zh('data.DATA_CLASS_LABELS.sensitive'),
  'public-sector': zh('data.DATA_CLASS_LABELS.public-sector'),
};

export const TIER_POLICY_LABELS: Record<TierPolicy, string> = {
  local: zh('data.TIER_POLICY_LABELS.local'),
  cloud: zh('data.TIER_POLICY_LABELS.cloud'),
  both: zh('data.TIER_POLICY_LABELS.both'),
};

export const PLAN_LABELS: Record<TenantPlan, string> = {
  payg: zh('data.PLAN_LABELS.payg'),
  committed: zh('data.PLAN_LABELS.committed'),
  dedicated: zh('data.PLAN_LABELS.dedicated'),
};

export const PLAN_DESCRIPTIONS: Record<TenantPlan, string> = {
  payg: zh('data.PLAN_DESCRIPTIONS.payg'),
  committed: zh('data.PLAN_DESCRIPTIONS.committed'),
  dedicated: zh('data.PLAN_DESCRIPTIONS.dedicated'),
};

/** 預付儲值帳戶（prepaid 租戶）：餘額（儲值入帳的總帳）、自動儲值、試用免費額度 */
export interface TenantCredits {
  /** 總帳餘額（USD）：儲值入帳總額 − 已結算月份；本月至今用量由伺服器即時扣抵後得到可用餘額 */
  balanceUsd: number;
  autoReload?: { thresholdUsd: number; amountUsd: number };
  trial?: { grantedUsd: number; expiresAt: string };
}

export interface Tenant {
  id: string;
  name: string;
  plan: TenantPlan;
  status: 'active' | 'suspended';
  quotas: { rpm: number; tpm: number; monthlyBudgetUsd: number };
  /** 成本中心（客戶端的帳務歸屬） */
  costCenter: string;
  /** 客戶的帳務聯絡人 */
  billingContact: { name: string; email: string };
  /** 資料分級 */
  dataClass: DataClass;
  /** 允許的推論層級；公部門租戶由伺服器強制為 local */
  allowedTiers: TierPolicy;
  /** 允許使用的模型／別名（空陣列＝不限） */
  allowedModels: string[];
  /** 排除的模型來源地（例如公部門排除 'cn'） */
  excludeOrigins: ('cn' | 'us' | 'eu' | 'tw' | 'other')[];
  /** 承諾用量方案：月承諾額與折扣 % */
  commitment?: { monthlyUsd: number; discountPct: number };
  /** 計費模式：預付儲值（餘額扣抵）或月結合約 */
  billingMode: BillingMode;
  /** 預付儲值帳戶（billingMode = prepaid 時必有） */
  credits?: TenantCredits;
  /** 資料留存政策（預設 30 天；公部門零留存）；回應標頭 x-maas-retention */
  retention: RetentionPolicy;
  /** 強制政策的說明（例如法規依據） */
  policyNote?: string;
  /**
   * 跨境資料傳輸同意（個資法／金管會委外規範）：客戶簽署後，溢出或雲端代理才能把請求送到清單內的區域；
   * 未簽署（或目標區域不在清單內）時，伺服器把該租戶視同「僅自建」（429 local_capacity_exhausted，reason no_cross_border_consent）。
   */
  crossBorderConsent?: { regions: string[]; signedAt: string; by: string };
  createdAt: string;
}

export interface Project {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  status: 'active' | 'archived';
  quotas: { rpm: number; tpm: number; monthlyBudgetUsd: number };
  /** 專案層的資料留存覆寫（省略 → 沿用租戶） */
  retention?: RetentionPolicy;
  /** 本月至今的專案花費（USD）：由伺服器依對帳單計算後填入（listProjects），種子值不使用 */
  monthSpendUsd: number;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  /** 顯示用前綴（sk-maas-xxxx） */
  prefix: string;
  /** 清單顯示的部分提示（partial hint），例如 sk-maas-7f3a…9c1e */
  hint: string;
  /** 伺服器只保存雜湊（示範為假值） */
  hash: string;
  /** 服務主體 ID（金鑰本身即為一個主體） */
  servicePrincipalId: string;
  allowedModels: string[];
  /** 層級限制：此金鑰可使用的推論層級 */
  tierRestriction: TierPolicy;
  rpmLimit: number;
  tpmLimit: number;
  maxParallelRequests: number;
  /** 預算：上限與重置週期（LiteLLM max_budget / budget_duration） */
  monthlyBudgetUsd: number;
  budgetDuration: '1d' | '7d' | '30d';
  /** 臨時金鑰（CI 用，≤ 1 小時） */
  ephemeral: boolean;
  expiresAt: string | null;
  autoRotate: { enabled: boolean; intervalDays: number; gracePeriodHours: number };
  status: 'active' | 'revoked' | 'expired';
  lastUsedAt: string | null;
  /** 目前這一版金鑰材料的產生時間（自動輪替後更新）；到期日 ≤ createdAt + 90 天 */
  createdAt: string;
  createdBy: string;
  /** 自動輪替：上一次輪替時間（有輪替過才有） */
  rotatedAt?: string;
}

export const PLATFORM_NOTE = zh('server.const.PLATFORM_NOTE');

/** 公部門限制的法規依據（統一字串，UI 與伺服器訊息共用） */
export const PUBLIC_SECTOR_LEGAL_BASIS = zh('data.LAW_CITATION');

export const PUBLIC_SECTOR_NOTE = zh('server.const.PUBLIC_SECTOR_NOTE');

export const TENANTS: Tenant[] = [
  {
    id: 't-star',
    name: '星耀科技',
    plan: 'committed',
    status: 'active',
    quotas: { rpm: 3000, tpm: 5_000_000, monthlyBudgetUsd: 36000 },
    costCenter: 'CC-1100 數位產品部',
    billingContact: { name: '陳曉明', email: 'xiaoming.chen@star.example' },
    dataClass: 'general',
    allowedTiers: 'both',
    allowedModels: ['qwen-plus', 'fast-chat', 'embedding', 'embedding-local', 'qwen-max', 'coder', 'qwen3-rerank', 'qwen3-vl-plus', 'qwen3.8-27b-vllm', 'qwen3-embedding-8b-vllm', 'qwen3-coder-30b-a3b-vllm', 'gpt-oss-120b-vllm', 'llama-3.3-70b-vllm', 'qwen3.7-plus', 'qwen3.8-flash', 'qwen3.8-max', 'claude-haiku-4.5', 'gpt-5-mini', 'gpt-5.1', 'flux.1-schnell', 'whisper-large-v3'],
    excludeOrigins: [],
    commitment: { monthlyUsd: 15000, discountPct: 15 },
    billingMode: 'postpaid',
    retention: '30d',
    crossBorderConsent: { regions: ['ap-southeast-1', 'anthropic-global', 'openai-global'], signedAt: '2026-01-20T00:00:00+08:00', by: '陳曉明（數位產品部）' },
    createdAt: '2026-01-15T09:00:00+08:00',
  },
  {
    id: 't-union',
    name: '聯合金融',
    plan: 'dedicated',
    status: 'active',
    quotas: { rpm: 2000, tpm: 3_000_000, monthlyBudgetUsd: 38000 },
    costCenter: 'CC-2300 風險管理處',
    billingContact: { name: '吳帳務', email: 'billing.wu@union.example' },
    dataClass: 'sensitive',
    allowedTiers: 'both',
    allowedModels: ['risk-local', 'coder', 'qwen-plus', 'fast-chat', 'embedding', 'qwen3.8-27b-vllm', 'maas-assist-27b', 'qwen3-coder-plus', 'qwen3.7-plus', 'claude-sonnet-4.5', 'gemini-2.5-flash', 'qwen3.8-flash', 'claude-haiku-4.5', 'kling-v2.5'],
    excludeOrigins: [],
    policyNote: zh('server.tenant.t-union.policyNote'),
    billingMode: 'postpaid',
    retention: '30d',
    crossBorderConsent: { regions: ['ap-southeast-1', 'anthropic-global', 'google-global'], signedAt: '2026-03-05T00:00:00+08:00', by: zh('server.tenant.t-union.consentBy') },
    createdAt: '2026-03-02T09:00:00+08:00',
  },
  {
    id: 't-gov',
    name: '示範市政府資訊局',
    plan: 'payg',
    status: 'active',
    quotas: { rpm: 600, tpm: 800_000, monthlyBudgetUsd: 6000 },
    costCenter: 'CC-9001 資訊局（公務預算）',
    billingContact: { name: '許公務', email: 'admin.hsu@gov.example' },
    dataClass: 'public-sector',
    allowedTiers: 'local',
    allowedModels: ['gov-chat', 'gov-embedding', 'gpt-oss-120b-vllm', 'llama-3.3-70b-vllm', 'taide-lx-8b-vllm', 'embeddinggemma-300m-vllm'],
    excludeOrigins: ['cn'],
    policyNote: PUBLIC_SECTOR_NOTE,
    // 公部門：預付儲值（公務預算先撥款入帳）、零留存
    billingMode: 'prepaid',
    credits: { balanceUsd: 4000, autoReload: { thresholdUsd: 500, amountUsd: 2000 } },
    retention: 'zero',
    createdAt: '2026-09-01T09:00:00+08:00',
  },
  {
    // 試用租戶：由「申請測試」問卷核准建立（見 api.ts 的種子試用申請），預付、免費額度 US$20、僅自建、3 個工作天
    id: 't-acme-trial',
    name: zh('server.tenant.t-acme-trial.name'),
    plan: 'payg',
    status: 'active',
    quotas: { rpm: 60, tpm: 100_000, monthlyBudgetUsd: 20 },
    costCenter: 'TRIAL-acme-eval',
    billingContact: { name: '林小測', email: 'eval@acme.example' },
    dataClass: 'sensitive',
    allowedTiers: 'local',
    allowedModels: ['qwen3.8-27b-vllm', 'gpt-oss-120b-vllm'],
    excludeOrigins: [],
    billingMode: 'prepaid',
    credits: { balanceUsd: 20, trial: { grantedUsd: 20, expiresAt: '2026-11-12T00:00:00+08:00' } },
    retention: '30d',
    createdAt: '2026-11-06T10:00:00+08:00',
  },
];

export const PROJECTS: Project[] = [
  {
    id: 'p-cs-bot',
    tenantId: 't-star',
    name: '客服助理',
    description: zh('server.project.p-cs-bot.description'),
    status: 'active',
    quotas: { rpm: 1200, tpm: 2_000_000, monthlyBudgetUsd: 18000 },
    monthSpendUsd: 0,
    createdAt: '2026-02-01T09:00:00+08:00',
  },
  {
    id: 'p-doc-rag',
    tenantId: 't-star',
    name: '知識庫 RAG',
    description: zh('server.project.p-doc-rag.description'),
    status: 'active',
    quotas: { rpm: 800, tpm: 1_500_000, monthlyBudgetUsd: 15000 },
    monthSpendUsd: 0,
    createdAt: '2026-04-10T09:00:00+08:00',
  },
  {
    id: 'p-vision-qc',
    tenantId: 't-star',
    name: '產線影像品檢',
    description: zh('server.project.p-vision-qc.description'),
    status: 'active',
    quotas: { rpm: 300, tpm: 500_000, monthlyBudgetUsd: 2000 },
    monthSpendUsd: 0,
    createdAt: '2026-08-20T09:00:00+08:00',
  },
  {
    id: 'p-risk',
    tenantId: 't-union',
    name: '風控文件摘要',
    description: zh('server.project.p-risk.description'),
    status: 'active',
    quotas: { rpm: 600, tpm: 1_000_000, monthlyBudgetUsd: 3000 },
    monthSpendUsd: 0,
    createdAt: '2026-03-15T09:00:00+08:00',
  },
  {
    id: 'p-advisor',
    tenantId: 't-union',
    name: '理財顧問助手',
    description: zh('server.project.p-advisor.description'),
    status: 'active',
    quotas: { rpm: 400, tpm: 800_000, monthlyBudgetUsd: 6000 },
    monthSpendUsd: 0,
    createdAt: '2026-06-01T09:00:00+08:00',
  },
  {
    id: 'p-legacy',
    tenantId: 't-union',
    name: '舊版實驗專案',
    description: zh('server.project.p-legacy.description'),
    status: 'archived',
    quotas: { rpm: 60, tpm: 100_000, monthlyBudgetUsd: 200 },
    monthSpendUsd: 0,
    createdAt: '2026-03-20T09:00:00+08:00',
  },
  {
    id: 'p-gov-qa',
    tenantId: 't-gov',
    name: '市民服務問答',
    description: zh('server.project.p-gov-qa.description'),
    status: 'active',
    quotas: { rpm: 300, tpm: 400_000, monthlyBudgetUsd: 5000 },
    monthSpendUsd: 0,
    createdAt: '2026-09-05T09:00:00+08:00',
  },
  {
    id: 'p-acme-trial-default',
    tenantId: 't-acme-trial',
    name: '預設專案',
    description: zh('server.project.p-acme-trial-default.description'),
    status: 'active',
    quotas: { rpm: 60, tpm: 100_000, monthlyBudgetUsd: 20 },
    monthSpendUsd: 0,
    createdAt: '2026-11-06T10:00:00+08:00',
  },
];

export const GROUPS: Principal[] = [
  { id: 'g-star-ops', type: 'group', displayName: '星耀-平台維運組', tenantId: 't-star', groupIds: [] },
  { id: 'g-union-audit', type: 'group', displayName: '聯合-稽核部', tenantId: 't-union', groupIds: [] },
];

export const USERS: Principal[] = [
  { id: 'u-owner', type: 'user', displayName: zh('server.user.u-owner.displayName'), email: 'owner@example-maas.local', tenantId: null, groupIds: [] },
  { id: 'u-cluster-ops', type: 'user', displayName: zh('server.user.u-cluster-ops.displayName'), email: 'sre.lin@example-maas.local', tenantId: null, groupIds: [] },
  { id: 'u-finance', type: 'user', displayName: zh('server.user.u-finance.displayName'), email: 'finance.kuo@example-maas.local', tenantId: null, groupIds: [] },
  { id: 'u-admin-star', type: 'user', displayName: '陳曉明', email: 'xiaoming.chen@star.example', tenantId: 't-star', groupIds: ['g-star-ops'] },
  { id: 'u-op-star', type: 'user', displayName: '王大衛', email: 'david.wang@star.example', tenantId: 't-star', groupIds: ['g-star-ops'] },
  { id: 'u-viewer-star', type: 'user', displayName: '張小芸', email: 'yun.chang@star.example', tenantId: 't-star', groupIds: [] },
  { id: 'u-iam-star', type: 'user', displayName: '李存取', email: 'access.lee@star.example', tenantId: 't-star', groupIds: [] },
  { id: 'u-audit-union', type: 'user', displayName: '黃稽核', email: 'audit.huang@union.example', tenantId: 't-union', groupIds: ['g-union-audit'] },
  { id: 'u-billing-union', type: 'user', displayName: '吳帳務', email: 'billing.wu@union.example', tenantId: 't-union', groupIds: [] },
  { id: 'u-admin-union', type: 'user', displayName: '周管理', email: 'admin.chou@union.example', tenantId: 't-union', groupIds: [] },
  { id: 'u-op-union', type: 'user', displayName: '鄭操作', email: 'ops.cheng@union.example', tenantId: 't-union', groupIds: [] },
  { id: 'u-admin-gov', type: 'user', displayName: '許公務', email: 'admin.hsu@gov.example', tenantId: 't-gov', groupIds: [] },
  { id: 'u-admin-acme', type: 'user', displayName: '林小測', email: 'eval@acme.example', tenantId: 't-acme-trial', groupIds: [] },
];

const DEFAULT_ROTATE = { enabled: false, intervalDays: 90, gracePeriodHours: 48 };

export const API_KEYS: ApiKey[] = [
  {
    id: 'k-cs-prod',
    tenantId: 't-star',
    projectId: 'p-cs-bot',
    name: '客服機器人-正式',
    prefix: 'sk-maas-7f3a',
    hint: 'sk-maas-7f3a…9c1e',
    hash: 'sha256:3a1f…d0c2',
    servicePrincipalId: 'sp-k-cs-prod',
    allowedModels: ['qwen-plus', 'fast-chat'],
    tierRestriction: 'both',
    rpmLimit: 600,
    tpmLimit: 1_000_000,
    maxParallelRequests: 32,
    monthlyBudgetUsd: 9000,
    budgetDuration: '30d',
    ephemeral: false,
    // 自動輪替（每 60 天）：目前版本 2026-10-02 產生，到期 ≤ 90 天
    expiresAt: '2026-12-31T00:00:00+08:00',
    autoRotate: { enabled: true, intervalDays: 60, gracePeriodHours: 48 },
    status: 'active',
    lastUsedAt: '2026-11-08T09:41:12+08:00',
    createdAt: '2026-10-02T10:00:00+08:00',
    rotatedAt: '2026-10-02T10:00:00+08:00',
    createdBy: 'u-op-star',
  },
  {
    id: 'k-cs-stg',
    tenantId: 't-star',
    projectId: 'p-cs-bot',
    name: '客服機器人-測試',
    prefix: 'sk-maas-21be',
    hint: 'sk-maas-21be…77a0',
    hash: 'sha256:9b77…a0e1',
    servicePrincipalId: 'sp-k-cs-stg',
    // 僅自建金鑰可選「自建優先」別名（qwen-plus）：此金鑰的請求釘在自建目標，容量耗盡回 429 而不溢出
    allowedModels: ['qwen-plus'],
    tierRestriction: 'local',
    rpmLimit: 60,
    tpmLimit: 100_000,
    maxParallelRequests: 4,
    monthlyBudgetUsd: 300,
    budgetDuration: '30d',
    ephemeral: false,
    expiresAt: '2027-01-03T00:00:00+08:00',
    autoRotate: DEFAULT_ROTATE,
    status: 'active',
    lastUsedAt: '2026-11-07T18:02:44+08:00',
    createdAt: '2026-10-05T10:05:00+08:00',
    createdBy: 'u-op-star',
  },
  {
    id: 'k-rag-prod',
    tenantId: 't-star',
    projectId: 'p-doc-rag',
    name: 'RAG 服務',
    prefix: 'sk-maas-c0de',
    hint: 'sk-maas-c0de…41bb',
    hash: 'sha256:41bb…c0de',
    servicePrincipalId: 'sp-k-rag-prod',
    allowedModels: ['embedding-local', 'qwen-max', 'qwen3-rerank', 'gpt-oss-120b-vllm', 'llama-3.3-70b-vllm'],
    tierRestriction: 'both',
    rpmLimit: 400,
    tpmLimit: 800_000,
    maxParallelRequests: 16,
    monthlyBudgetUsd: 8000,
    budgetDuration: '30d',
    ephemeral: false,
    expiresAt: '2027-01-18T00:00:00+08:00',
    autoRotate: DEFAULT_ROTATE,
    status: 'active',
    lastUsedAt: '2026-11-08T08:15:30+08:00',
    createdAt: '2026-10-20T10:00:00+08:00',
    createdBy: 'u-admin-star',
  },
  {
    id: 'k-vision-poc',
    tenantId: 't-star',
    projectId: 'p-vision-qc',
    name: '影像品檢 PoC',
    prefix: 'sk-maas-9a1f',
    hint: 'sk-maas-9a1f…2e8d',
    hash: 'sha256:2e8d…9a1f',
    servicePrincipalId: 'sp-k-vision-poc',
    allowedModels: ['qwen3-vl-plus'],
    tierRestriction: 'cloud',
    rpmLimit: 120,
    tpmLimit: 200_000,
    maxParallelRequests: 8,
    monthlyBudgetUsd: 1000,
    budgetDuration: '30d',
    ephemeral: false,
    expiresAt: '2026-11-19T00:00:00+08:00',
    autoRotate: DEFAULT_ROTATE,
    status: 'active',
    lastUsedAt: '2026-11-06T14:20:00+08:00',
    createdAt: '2026-08-21T10:00:00+08:00',
    createdBy: 'u-op-star',
  },
  {
    id: 'k-ci-ephemeral',
    tenantId: 't-star',
    projectId: 'p-cs-bot',
    name: 'CI 整合測試（臨時）',
    prefix: 'sk-maas-e1c1',
    hint: 'sk-maas-e1c1…0f55',
    hash: 'sha256:0f55…e1c1',
    servicePrincipalId: 'sp-k-ci-ephemeral',
    allowedModels: ['qwen-plus'],
    tierRestriction: 'local',
    rpmLimit: 30,
    tpmLimit: 50_000,
    maxParallelRequests: 2,
    monthlyBudgetUsd: 5,
    budgetDuration: '1d',
    ephemeral: true,
    expiresAt: '2026-11-08T10:30:00+08:00',
    autoRotate: DEFAULT_ROTATE,
    status: 'active',
    lastUsedAt: '2026-11-08T09:35:00+08:00',
    createdAt: '2026-11-08T09:30:00+08:00',
    createdBy: 'u-op-star',
  },
  {
    id: 'k-risk-prod',
    tenantId: 't-union',
    projectId: 'p-risk',
    name: '風控摘要-正式',
    prefix: 'sk-maas-5e77',
    hint: 'sk-maas-5e77…b1a9',
    hash: 'sha256:b1a9…5e77',
    servicePrincipalId: 'sp-k-risk-prod',
    allowedModels: ['risk-local', 'maas-assist-27b'],
    tierRestriction: 'local',
    rpmLimit: 300,
    tpmLimit: 600_000,
    maxParallelRequests: 16,
    monthlyBudgetUsd: 3000,
    budgetDuration: '30d',
    ephemeral: false,
    // 自動輪替（每 90 天）：目前版本 2026-11-01 產生
    expiresAt: '2027-01-30T00:00:00+08:00',
    autoRotate: { enabled: true, intervalDays: 90, gracePeriodHours: 72 },
    status: 'active',
    lastUsedAt: '2026-11-08T07:55:10+08:00',
    createdAt: '2026-11-01T10:00:00+08:00',
    rotatedAt: '2026-11-01T10:00:00+08:00',
    createdBy: 'u-admin-union',
  },
  {
    id: 'k-advisor',
    tenantId: 't-union',
    projectId: 'p-advisor',
    name: '理財助手',
    prefix: 'sk-maas-b3d2',
    hint: 'sk-maas-b3d2…6c40',
    hash: 'sha256:6c40…b3d2',
    servicePrincipalId: 'sp-k-advisor',
    allowedModels: ['qwen-plus', 'fast-chat'],
    tierRestriction: 'both',
    rpmLimit: 200,
    tpmLimit: 400_000,
    maxParallelRequests: 8,
    monthlyBudgetUsd: 2500,
    budgetDuration: '30d',
    ephemeral: false,
    expiresAt: '2026-10-31T00:00:00+08:00',
    autoRotate: DEFAULT_ROTATE,
    status: 'expired',
    lastUsedAt: '2026-10-30T23:10:00+08:00',
    createdAt: '2026-08-02T10:00:00+08:00',
    createdBy: 'u-op-union',
  },
  {
    id: 'k-legacy',
    tenantId: 't-union',
    projectId: 'p-legacy',
    name: '舊版實驗金鑰',
    prefix: 'sk-maas-0ld1',
    hint: 'sk-maas-0ld1…ffff',
    hash: 'sha256:ffff…0ld1',
    servicePrincipalId: 'sp-k-legacy',
    allowedModels: ['qwen-plus'],
    tierRestriction: 'both',
    rpmLimit: 30,
    tpmLimit: 50_000,
    maxParallelRequests: 2,
    monthlyBudgetUsd: 100,
    budgetDuration: '30d',
    ephemeral: false,
    expiresAt: '2026-06-19T00:00:00+08:00',
    autoRotate: DEFAULT_ROTATE,
    status: 'revoked',
    lastUsedAt: '2026-05-10T12:00:00+08:00',
    createdAt: '2026-03-21T10:00:00+08:00',
    createdBy: 'u-op-union',
  },
  {
    id: 'k-gov-qa',
    tenantId: 't-gov',
    projectId: 'p-gov-qa',
    name: '市民問答-正式',
    prefix: 'sk-maas-a0b1',
    hint: 'sk-maas-a0b1…3d3d',
    hash: 'sha256:3d3d…a0b1',
    servicePrincipalId: 'sp-k-gov-qa',
    allowedModels: ['gov-chat', 'gov-embedding'],
    tierRestriction: 'local',
    rpmLimit: 200,
    tpmLimit: 300_000,
    maxParallelRequests: 8,
    monthlyBudgetUsd: 1000,
    budgetDuration: '30d',
    ephemeral: false,
    expiresAt: '2026-12-15T00:00:00+08:00',
    autoRotate: { enabled: true, intervalDays: 60, gracePeriodHours: 24 },
    status: 'active',
    lastUsedAt: '2026-11-08T09:12:00+08:00',
    createdAt: '2026-09-20T10:00:00+08:00',
    createdBy: 'u-admin-gov',
  },
];

/** 服務主體：每把金鑰對應一個服務主體 */
export const SERVICE_PRINCIPALS: Principal[] = API_KEYS.map((k) => ({
  id: k.servicePrincipalId,
  type: 'servicePrincipal',
  displayName: `API 金鑰：${k.name}`,
  tenantId: k.tenantId,
  groupIds: [],
}));

export const ASSIGNMENTS: RoleAssignment[] = [
  // 平台（我們）
  { id: 'ra-001', principalId: 'u-owner', roleId: 'platform-owner', scope: '/', tenantId: null, status: 'active', createdAt: '2026-01-10T09:00:00+08:00', createdBy: 'system' },
  { id: 'ra-002', principalId: 'u-cluster-ops', roleId: 'cluster-operator', scope: '/', tenantId: null, status: 'active', createdAt: '2026-01-20T09:00:00+08:00', createdBy: 'u-owner', justification: zh('server.assignment.ra-002.justification') },
  { id: 'ra-003', principalId: 'u-finance', roleId: 'finance', scope: '/', tenantId: null, status: 'active', createdAt: '2026-01-20T09:10:00+08:00', createdBy: 'u-owner', justification: zh('server.assignment.ra-003.justification') },
  // 星耀
  { id: 'ra-010', principalId: 'u-admin-star', roleId: 'tenant-admin', scope: '/tenants/t-star', tenantId: 't-star', status: 'active', createdAt: '2026-01-16T09:00:00+08:00', createdBy: 'u-owner', approvedBy: 'u-owner' },
  { id: 'ra-011', principalId: 'u-op-star', roleId: 'project-operator', scope: '/tenants/t-star/projects/p-cs-bot', tenantId: 't-star', status: 'active', createdAt: '2026-02-02T09:00:00+08:00', createdBy: 'u-admin-star' },
  { id: 'ra-012', principalId: 'u-op-star', roleId: 'project-operator', scope: '/tenants/t-star/projects/p-doc-rag', tenantId: 't-star', status: 'active', createdAt: '2026-04-11T09:00:00+08:00', createdBy: 'u-admin-star' },
  { id: 'ra-013', principalId: 'u-viewer-star', roleId: 'viewer', scope: '/tenants/t-star', tenantId: 't-star', status: 'active', createdAt: '2026-02-05T09:00:00+08:00', createdBy: 'u-admin-star' },
  { id: 'ra-014', principalId: 'u-iam-star', roleId: 'access-admin', scope: '/tenants/t-star', tenantId: 't-star', status: 'active', createdAt: '2026-02-05T09:30:00+08:00', createdBy: 'u-owner' },
  { id: 'ra-015', principalId: 'g-star-ops', roleId: 'viewer', scope: '/tenants/t-star', tenantId: 't-star', status: 'active', createdAt: '2026-02-06T09:00:00+08:00', createdBy: 'u-admin-star' },
  { id: 'ra-016', principalId: 'u-viewer-star', roleId: 'project-operator', scope: '/tenants/t-star/projects/p-vision-qc', tenantId: 't-star', status: 'expired', createdAt: '2026-08-21T09:00:00+08:00', createdBy: 'u-admin-star', expiresAt: '2026-10-31T00:00:00+08:00' },
  // 聯合
  { id: 'ra-020', principalId: 'u-admin-union', roleId: 'tenant-admin', scope: '/tenants/t-union', tenantId: 't-union', status: 'active', createdAt: '2026-03-03T09:00:00+08:00', createdBy: 'u-owner', approvedBy: 'u-owner' },
  { id: 'ra-021', principalId: 'g-union-audit', roleId: 'auditor', scope: '/tenants/t-union', tenantId: 't-union', status: 'active', createdAt: '2026-03-05T09:00:00+08:00', createdBy: 'u-admin-union' },
  { id: 'ra-022', principalId: 'u-billing-union', roleId: 'billing-reader', scope: '/tenants/t-union', tenantId: 't-union', status: 'active', createdAt: '2026-03-05T09:10:00+08:00', createdBy: 'u-admin-union' },
  { id: 'ra-023', principalId: 'u-op-union', roleId: 'project-operator', scope: '/tenants/t-union/projects/p-risk', tenantId: 't-union', status: 'active', createdAt: '2026-03-16T09:00:00+08:00', createdBy: 'u-admin-union' },
  { id: 'ra-024', principalId: 'u-op-union', roleId: 'project-operator', scope: '/tenants/t-union/projects/p-advisor', tenantId: 't-union', status: 'active', createdAt: '2026-06-02T09:00:00+08:00', createdBy: 'u-admin-union' },
  // 公部門
  { id: 'ra-040', principalId: 'u-admin-gov', roleId: 'tenant-admin', scope: '/tenants/t-gov', tenantId: 't-gov', status: 'active', createdAt: '2026-09-02T09:00:00+08:00', createdBy: 'u-owner', approvedBy: 'u-owner' },
  // 試用租戶（核准後由平台擁有者指派聯絡人為客戶管理員）
  { id: 'ra-050', principalId: 'u-admin-acme', roleId: 'tenant-admin', scope: '/tenants/t-acme-trial', tenantId: 't-acme-trial', status: 'active', createdAt: '2026-11-06T10:30:00+08:00', createdBy: 'u-owner', approvedBy: 'u-owner', justification: zh('server.assignment.ra-050.justification') },
  // 待核准：存取管理員申請把王大衛升為租戶管理員
  { id: 'ra-030', principalId: 'u-op-star', roleId: 'tenant-admin', scope: '/tenants/t-star', tenantId: 't-star', status: 'pending', createdAt: '2026-11-07T16:30:00+08:00', createdBy: 'u-iam-star', justification: zh('server.assignment.ra-030.justification') },
  // 服務主體（金鑰）在專案範圍只能呼叫推論（最小權限：inference-caller，不含 key.create／key.revoke／路由更新）
  ...API_KEYS.filter((k) => k.status === 'active').map<RoleAssignment>((k, i) => ({
    id: `ra-sp-${i + 1}`,
    principalId: k.servicePrincipalId,
    roleId: 'inference-caller',
    scope: `/tenants/${k.tenantId}/projects/${k.projectId}`,
    tenantId: k.tenantId,
    status: 'active',
    createdAt: k.createdAt,
    createdBy: k.createdBy,
  })),
];

/** 示範用角色切換清單 */
export interface PersonaPreset {
  id: string;
  label: string;
  userId: string;
  description: string;
}

export const PERSONAS: PersonaPreset[] = [
  { id: 'owner', label: zh('server.persona.owner.label'), userId: 'u-owner', description: zh('server.persona.owner.description') },
  { id: 'cluster-operator', label: zh('server.persona.cluster-operator.label'), userId: 'u-cluster-ops', description: zh('server.persona.cluster-operator.description') },
  { id: 'finance', label: zh('server.persona.finance.label'), userId: 'u-finance', description: zh('server.persona.finance.description') },
  { id: 'tenant-admin', label: zh('server.persona.tenant-admin.label'), userId: 'u-admin-star', description: zh('server.persona.tenant-admin.description') },
  { id: 'operator', label: zh('server.persona.operator.label'), userId: 'u-op-star', description: zh('server.persona.operator.description') },
  { id: 'viewer', label: zh('server.persona.viewer.label'), userId: 'u-viewer-star', description: zh('server.persona.viewer.description') },
  { id: 'access-admin', label: zh('server.persona.access-admin.label'), userId: 'u-iam-star', description: zh('server.persona.access-admin.description') },
  { id: 'auditor', label: zh('server.persona.auditor.label'), userId: 'u-audit-union', description: zh('server.persona.auditor.description') },
  { id: 'billing', label: zh('server.persona.billing.label'), userId: 'u-billing-union', description: zh('server.persona.billing.description') },
  { id: 'gov-admin', label: zh('server.persona.gov-admin.label'), userId: 'u-admin-gov', description: zh('server.persona.gov-admin.description') },
  { id: 'trial-admin', label: zh('server.persona.trial-admin.label'), userId: 'u-admin-acme', description: zh('server.persona.trial-admin.description') },
];
