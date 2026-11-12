// 示範資料：模型目錄（價格皆為示意價格，非任何供應商之正式報價）
// 自建模型（providerId 'vllm'）部署在我們的 GPU 機房並以我們的牌價向客戶收費；雲端模型只作代理／溢出。
import { zh } from '../i18n/core';

export type ProviderId = 'bailian' | 'openai' | 'anthropic' | 'google' | 'vllm' | 'partner';

export type Capability = 'vision' | 'tools' | 'json' | 'thinking' | 'embedding' | 'rerank' | 'audio';

export type ModelStatus = 'ga' | 'preview' | 'legacy' | 'deprecated';

/** 模型中心（MaaS 入口）的模態分類 */
export type Modality = 'text' | 'vision' | 'image' | 'video' | 'audio' | 'embedding' | 'rerank';
/** 計價單位：文字／視覺／嵌入／重排以每百萬 tokens；圖像以每張；影片以每秒；語音以每分鐘 */
export type UnitType = 'per_1m_tokens' | 'per_image' | 'per_second' | 'per_minute';
/** 模型中心卡片徽章（由 withHubFields 自動推導，亦可在種子中補充） */
export type HubBadge = 'self-hosted' | 'proxied' | 'new' | 'hot' | 'gov-ok' | 'open-weight' | 'commercial' | 'fp8' | 'int4' | 'tool-calling' | 'contract-required' | 'proxy-discount';

export const MODALITY_LABELS: Record<Modality, string> = {
  text: zh('data.MODALITY_LABELS.text'),
  vision: zh('data.MODALITY_LABELS.vision'),
  image: zh('data.MODALITY_LABELS.image'),
  video: zh('data.MODALITY_LABELS.video'),
  audio: zh('data.MODALITY_LABELS.audio'),
  embedding: zh('data.MODALITY_LABELS.embedding'),
  rerank: zh('data.MODALITY_LABELS.rerank'),
};

export const UNIT_TYPE_LABELS: Record<UnitType, string> = {
  per_1m_tokens: zh('data.UNIT_TYPE_LABELS.per_1m_tokens'),
  per_image: zh('data.UNIT_TYPE_LABELS.per_image'),
  per_second: zh('data.UNIT_TYPE_LABELS.per_second'),
  per_minute: zh('data.UNIT_TYPE_LABELS.per_minute'),
};

export const HUB_BADGE_LABELS: Record<HubBadge, string> = {
  'self-hosted': zh('data.HUB_BADGE_LABELS.self-hosted'),
  proxied: zh('data.HUB_BADGE_LABELS.proxied'),
  new: zh('data.HUB_BADGE_LABELS.new'),
  hot: zh('data.HUB_BADGE_LABELS.hot'),
  'gov-ok': zh('data.HUB_BADGE_LABELS.gov-ok'),
  'open-weight': zh('data.HUB_BADGE_LABELS.open-weight'),
  commercial: zh('data.HUB_BADGE_LABELS.commercial'),
  fp8: zh('data.HUB_BADGE_LABELS.fp8'),
  int4: zh('data.HUB_BADGE_LABELS.int4'),
  'tool-calling': zh('data.HUB_BADGE_LABELS.tool-calling'),
  'contract-required': zh('data.HUB_BADGE_LABELS.contract-required'),
  'proxy-discount': zh('data.HUB_BADGE_LABELS.proxy-discount'),
};

/** 代理閉源／夥伴模型的預設代理折扣 %（示意）：向客戶 = 供應商牌價 × (1 − 10%)；開放模型（百煉）改為牌價 + 加價 */
export const PROXY_DISCOUNT_PCT = 10;
/** 閉源／合作夥伴 API 供應商（代理折扣政策適用）；阿里雲百煉代管的開放模型採牌價 + 加價 */
export const CLOSED_PROXY_PROVIDERS: ProviderId[] = ['openai', 'anthropic', 'google', 'partner'];
export function isClosedProxyProvider(providerId: ProviderId): boolean {
  return CLOSED_PROXY_PROVIDERS.includes(providerId);
}

/** 非 token 計價的模態（圖像／影片／語音）：不進入 token 路由、用量與對帳單的 token 數學 */
export function isMediaModality(m: Modality): boolean {
  return m === 'image' || m === 'video' || m === 'audio';
}

export interface RegionPrice {
  region: string;
  regionLabel: string;
  currency: 'USD' | 'CNY';
  input: number;
  output: number;
}

export interface ModelInfo {
  id: string;
  displayName: string;
  providerId: ProviderId;
  family: string;
  /** 主要區域（顯示用） */
  regions: string[];
  contextLength: number;
  maxOutput: number;
  /** 預設顯示價格（USD／每百萬 tokens，示意）：自建模型＝我們向客戶收的牌價；雲端模型＝供應商牌價（代理開放模型另加加價 %、代理閉源／夥伴模型 × (1 − 代理折扣 %)，見 data/commercial.ts） */
  priceInput: number;
  priceOutput: number;
  /** 各區域示意價格 */
  regionPrices?: RegionPrice[];
  capabilities: Capability[];
  status: ModelStatus;
  openWeight?: boolean;
  license?: string;
  /** 參數量（十億），用於估算部署所需 VRAM（開放權重模型） */
  paramsB?: number;
  /** 模型來源地（公部門租戶的模型來源白名單用） */
  origin?: 'cn' | 'us' | 'eu' | 'tw' | 'other';
  /** 授權類型：開放權重 / 本平台微調授權 / 僅雲端 API（代理） */
  licenseType: 'open-weight' | 'platform-licensed' | 'cloud-api';
  /** 可部署到我們的 GPU（自建推論層） */
  deployable?: boolean;
  /** zh-TW 描述；字典鍵 data.model.<id>.description（UI 用 tf(t, key, description)） */
  description: string;
  /** 第三方模型由百煉代管（字典鍵 data.model.<id>.hostedBy） */
  hostedBy?: string;
  /** MoE 模型的啟用參數量（十億）；吞吐估算以啟用參數為主 */
  activeParamsB?: number;
  /** 每個 token 的 KV cache 位元組數（BF16 KV；= 2 × 層數 × KV heads × head_dim × 2 bytes）；嵌入／重排序模型為 0 */
  kvBytesPerToken?: number;
  /** 自建部署實際設定的 --max-model-len（我們提供給客戶的上下文上限） */
  maxModelLen?: number;
  /** 模型原生上下文長度（若與 maxModelLen 不同，目錄會一併顯示） */
  nativeContextLength?: number;
  /** 衍生／微調模型的基底模型 ID（授權與來源地連帶適用） */
  baseModel?: string;
  /** 授權義務（部署或代管時必須遵守的條款摘要；zh-TW 句子，供 UI 顯示） */
  licenseObligations?: string[];
  /** 與 licenseObligations 同序的字典鍵（data.obligation.<group>.<n>）；UI 以 tf(t, key, 句子) 顯示目前語言 */
  licenseObligationKeys?: string[];
  /** 市場參考價（USD／百萬 tokens，示意；擷取日 2026-11-09）；source 的字典鍵為 data.model.<id>.marketRefSource */
  marketRefUsd?: { input: number; output: number; source: string };
  /** 只允許以這些量化方式部署（例如 gpt-oss 原生 MXFP4，示範以 INT4 估算） */
  allowedQuantizations?: Quantization[];
  // ---- 模型中心（MaaS 入口）欄位：由 withHubFields() 補齊，種子可覆寫 ----
  /** 模態：文字／視覺／圖像生成／影片生成／語音／嵌入／重排 */
  modality: Modality;
  /** 計價單位；非 per_1m_tokens 的模型不進入 token 路由／用量／對帳單數學 */
  unitType: UnitType;
  /** 卡片徽章 */
  badges: HubBadge[];
  /** 支援 OpenAI 相容 tools／function calling */
  toolCalling: boolean;
  /** 熱門／新上架旗標（示意） */
  hot?: boolean;
  new?: boolean;
  /** 自建部署的量化（卡片顯示 FP8／INT4） */
  quantization?: Quantization;
  /** 示意單流速度（tok/s；文字類），卡片顯示用 */
  speedTokPerSec?: number;
  /** 閉源代理模型：需與我們簽約（企業合約）才開通 */
  requiresContract?: boolean;
  /** 代理折扣 %（閉源／夥伴代理模型；向客戶 = 供應商牌價 priceInput/priceOutput × (1 − 此 %)；withHubFields 預設 10） */
  proxyDiscountPct?: number;
}

/** 種子資料型別：模型中心欄位可省略，由 withHubFields() 推導 */
export type ModelSeed = Omit<ModelInfo, 'modality' | 'unitType' | 'badges' | 'toolCalling'> & Partial<Pick<ModelInfo, 'modality' | 'unitType' | 'badges' | 'toolCalling'>>;

/** 來源地（衍生模型隨基底；百煉代管且未標示者視為中國來源） */
export function originOfModel(m: Pick<ModelInfo, 'origin' | 'baseModel' | 'providerId'>, byId?: Record<string, Pick<ModelInfo, 'origin'>>): ModelInfo['origin'] | undefined {
  if (m.origin) return m.origin;
  if (m.baseModel && byId?.[m.baseModel]?.origin) return byId[m.baseModel].origin;
  return m.providerId === 'bailian' ? 'cn' : undefined;
}

function inferModality(m: ModelSeed): Modality {
  if (m.modality) return m.modality;
  if (m.capabilities.includes('embedding')) return 'embedding';
  if (m.capabilities.includes('rerank')) return 'rerank';
  if (m.capabilities.includes('vision')) return 'vision';
  return 'text';
}

/** 補齊模型中心欄位（modality／unitType／badges／toolCalling） */
export function withHubFields(seed: ModelSeed, originById?: Record<string, Pick<ModelInfo, 'origin'>>): ModelInfo {
  const modality = inferModality(seed);
  const unitType: UnitType = seed.unitType ?? (modality === 'image' ? 'per_image' : modality === 'video' ? 'per_second' : modality === 'audio' ? 'per_minute' : 'per_1m_tokens');
  const toolCalling = seed.toolCalling ?? (seed.capabilities.includes('tools') && !isMediaModality(modality));
  const local = seed.providerId === 'vllm';
  const origin = originOfModel(seed, originById);
  // 代理折扣徽章：閉源／夥伴供應商一律適用（實際 % 由「定價參數」決定；seed.proxyDiscountPct 只在個別覆寫時設定）
  const proxyDiscount = seed.proxyDiscountPct !== undefined || (!local && isClosedProxyProvider(seed.providerId));
  const badges: HubBadge[] = [];
  badges.push(local ? 'self-hosted' : 'proxied');
  if (seed.new) badges.push('new');
  if (seed.hot) badges.push('hot');
  // 公部門可用：自建且非中國來源（公部門租戶由伺服器強制僅自建並排除中國來源）
  if (local && origin && origin !== 'cn') badges.push('gov-ok');
  if (seed.licenseType === 'open-weight' || seed.openWeight) badges.push('open-weight');
  else badges.push('commercial');
  if (seed.quantization === 'FP8') badges.push('fp8');
  if (seed.quantization === 'INT4') badges.push('int4');
  if (toolCalling) badges.push('tool-calling');
  if (seed.requiresContract) badges.push('contract-required');
  if (proxyDiscount) badges.push('proxy-discount');
  for (const b of seed.badges ?? []) if (!badges.includes(b)) badges.push(b);
  return { ...seed, modality, unitType, toolCalling, badges };
}

/** 量化方式與每參數位元組數（示範估算） */
export type Quantization = 'BF16' | 'FP8' | 'INT4';
export const QUANT_BYTES: Record<Quantization, number> = { BF16: 2, FP8: 1, INT4: 0.5 };
/** 權重以外的啟動額外保留比例（CUDA graph、activation、碎片；示範估算） */
export const VRAM_OVERHEAD = 1.15;
/** KV cache dtype 對應的位元組倍率：FP8 權重時以 FP8 KV（--kv-cache-dtype fp8）估算；INT4 權重 KV 仍為 BF16 */
export const KV_DTYPE_SCALE: Record<Quantization, number> = { BF16: 1, FP8: 0.5, INT4: 1 };
/** KV 預留估算：1 條滿長度（max_model_len）序列 + 其餘並行序列以平均 1k tokens 估算（待 vllm bench serve 實測） */
export const KV_EST_AVG_SEQ_TOKENS = 1024;

/** 估算模型權重所需 VRAM（GB）：參數量 × 每參數位元組 × 額外保留（不含 KV cache） */
export function estimateVramGb(paramsB: number, quant: Quantization): number {
  return Math.round(paramsB * QUANT_BYTES[quant] * VRAM_OVERHEAD);
}

/**
 * 估算 KV cache 所需 VRAM（GB）：kvBytesPerToken × KV dtype 倍率 × (max_model_len + (max_num_seqs − 1) × 平均序列長度)。
 * 例：27B（256 KB／token）BF16、131k ctx、128 seqs ≈ 66 GB；FP8 KV 減半。嵌入模型（kvBytesPerToken 0）為 0。
 */
export function estimateKvCacheGb(kvBytesPerToken: number, quant: Quantization, maxNumSeqs: number, maxModelLen: number): number {
  if (kvBytesPerToken <= 0) return 0;
  const tokens = Math.max(0, maxModelLen) + Math.max(0, maxNumSeqs - 1) * KV_EST_AVG_SEQ_TOKENS;
  return Math.round((kvBytesPerToken * KV_DTYPE_SCALE[quant] * tokens) / 1e9);
}

/** 部署所需 VRAM（GB，每副本）＝ 權重 + KV cache */
export function estimateDeploymentVramGb(m: Pick<ModelInfo, 'paramsB' | 'kvBytesPerToken' | 'maxModelLen' | 'contextLength'>, quant: Quantization, maxNumSeqs: number, maxModelLen?: number): { weightsGb: number; kvGb: number; totalGb: number } {
  const weightsGb = estimateVramGb(m.paramsB ?? 0, quant);
  const kvGb = estimateKvCacheGb(m.kvBytesPerToken ?? 0, quant, maxNumSeqs, maxModelLen ?? m.maxModelLen ?? m.contextLength);
  return { weightsGb, kvGb, totalGb: weightsGb + kvGb };
}

/** 各授權的義務摘要的字典鍵（data.obligation.<group>.<n>；供模型目錄顯示；非法律意見） */
export const LICENSE_OBLIGATION_KEYS = {
  llama: ['data.obligation.llama.1', 'data.obligation.llama.2', 'data.obligation.llama.3', 'data.obligation.llama.4'],
  gemma: ['data.obligation.gemma.1', 'data.obligation.gemma.2', 'data.obligation.gemma.3'],
  taide: ['data.obligation.taide.1', 'data.obligation.taide.2'],
  apache: ['data.obligation.apache.1', 'data.obligation.apache.2'],
  qwenMax: ['data.obligation.qwenMax.1'],
  platform: ['data.obligation.platform.1', 'data.obligation.platform.2'],
} as const;
export type LicenseObligationGroup = keyof typeof LICENSE_OBLIGATION_KEYS;

/** 各授權的義務摘要（zh-TW 文案，由字典產生） */
export const LICENSE_OBLIGATIONS = Object.fromEntries(
  Object.entries(LICENSE_OBLIGATION_KEYS).map(([g, keys]) => [g, keys.map((k) => zh(k))]),
) as unknown as Record<LicenseObligationGroup, readonly string[]>;

/** 種子用：授權義務（zh-TW 句子 + 對應字典鍵，供 UI 以目前語言顯示） */
function obligations(g: LicenseObligationGroup): Pick<ModelInfo, 'licenseObligations' | 'licenseObligationKeys'> {
  return { licenseObligations: [...LICENSE_OBLIGATIONS[g]], licenseObligationKeys: [...LICENSE_OBLIGATION_KEYS[g]] };
}

/** 市場參考價來源（示意；擷取 2026-11-09）：各模型的 marketRefUsd.source 來自 data.model.<id>.marketRefSource */

/** 自建模型（我們的 GPU）= providerId 'vllm'；其餘為代理供應商（雲端／夥伴）模型 */
export function isLocalModel(m: Pick<ModelInfo, 'providerId'>): boolean {
  return m.providerId === 'vllm';
}

export const LICENSE_TYPE_LABELS: Record<ModelInfo['licenseType'], string> = {
  'open-weight': zh('data.LICENSE_TYPE_LABELS.open-weight'),
  'platform-licensed': zh('data.LICENSE_TYPE_LABELS.platform-licensed'),
  'cloud-api': zh('data.LICENSE_TYPE_LABELS.cloud-api'),
};

export const REGION_LABELS: Record<string, string> = {
  'cn-beijing': zh('data.REGION_LABELS.cn-beijing'),
  'ap-southeast-1': zh('data.REGION_LABELS.ap-southeast-1'),
  'us-east-1': zh('data.REGION_LABELS.us-east-1'),
  'eu-central-1': zh('data.REGION_LABELS.eu-central-1'),
  'ap-northeast-1': zh('data.REGION_LABELS.ap-northeast-1'),
  'cn-hongkong': zh('data.REGION_LABELS.cn-hongkong'),
  'openai-global': zh('data.REGION_LABELS.openai-global'),
  'anthropic-global': zh('data.REGION_LABELS.anthropic-global'),
  'google-global': zh('data.REGION_LABELS.google-global'),
  'partner-global': zh('data.REGION_LABELS.partner-global'),
  'tw-tpe-a': zh('data.REGION_LABELS.tw-tpe-a'),
  'tw-hc-b': zh('data.REGION_LABELS.tw-hc-b'),
  'tw-tc-c': zh('data.REGION_LABELS.tw-tc-c'),
};

const BAILIAN_INTL = ['ap-southeast-1', 'us-east-1', 'eu-central-1', 'ap-northeast-1', 'cn-hongkong'];

const MODEL_SEEDS: ModelSeed[] = [
  {
    id: 'qwen3.8-max',
    hot: true,
    speedTokPerSec: 55,
    displayName: 'Qwen3.8-Max',
    providerId: 'bailian',
    family: 'Qwen',
    regions: ['ap-southeast-1', 'cn-beijing', ...BAILIAN_INTL.slice(1)],
    contextLength: 1_000_000,
    maxOutput: 131_072,
    priceInput: 2,
    priceOutput: 6,
    regionPrices: [
      { region: 'ap-southeast-1', regionLabel: zh('data.regionPrice.ap-southeast-1'), currency: 'USD', input: 2, output: 6 },
      { region: 'global', regionLabel: zh('data.regionPrice.global'), currency: 'USD', input: 1.65, output: 4.951 },
      { region: 'cn-beijing', regionLabel: zh('data.regionPrice.cn-beijing'), currency: 'CNY', input: 12, output: 36 },
    ],
    capabilities: ['tools', 'json', 'thinking'],
    status: 'ga',
    licenseType: 'cloud-api',
    ...obligations('qwenMax'),
    origin: 'cn',
    description: zh('data.model.qwen3.8-max.description'),
  },
  {
    id: 'qwen3.7-plus',
    origin: 'cn',
    speedTokPerSec: 70,
    displayName: 'Qwen3.7-Plus',
    providerId: 'bailian',
    family: 'Qwen',
    regions: ['ap-southeast-1', 'cn-beijing', ...BAILIAN_INTL.slice(1)],
    contextLength: 1_000_000,
    maxOutput: 65_536,
    priceInput: 0.4,
    priceOutput: 1.6,
    regionPrices: [
      { region: 'ap-southeast-1', regionLabel: zh('data.regionPrice.ap-southeast-1'), currency: 'USD', input: 0.4, output: 1.6 },
      { region: 'global', regionLabel: zh('data.regionPrice.global'), currency: 'USD', input: 0.276, output: 1.101 },
      { region: 'cn-beijing', regionLabel: zh('data.regionPrice.cn-beijing'), currency: 'CNY', input: 2, output: 8 },
    ],
    capabilities: ['tools', 'json', 'thinking'],
    status: 'ga',
    licenseType: 'cloud-api',
    description: zh('data.model.qwen3.7-plus.description'),
  },
  {
    id: 'qwen3.8-flash',
    displayName: 'Qwen3.8-Flash',
    providerId: 'bailian',
    family: 'Qwen',
    regions: ['ap-southeast-1', 'cn-beijing'],
    contextLength: 1_000_000,
    maxOutput: 32_768,
    priceInput: 0.15,
    priceOutput: 0.47,
    marketRefUsd: { input: 0.15, output: 0.47, source: zh('data.model.qwen3.8-flash.marketRefSource') },
    capabilities: ['tools', 'json', 'thinking'],
    status: 'ga',
    licenseType: 'cloud-api',
    description: zh('data.model.qwen3.8-flash.description'),
  },
  {
    id: 'qwen3.6-plus',
    displayName: zh('data.model.qwen3.6-plus.displayName'),
    providerId: 'bailian',
    family: 'Qwen',
    regions: ['ap-southeast-1', 'cn-beijing'],
    contextLength: 262_144,
    maxOutput: 32_768,
    priceInput: 0.4,
    priceOutput: 1.2,
    capabilities: ['tools', 'json', 'thinking'],
    status: 'legacy',
    licenseType: 'cloud-api',
    description: zh('data.model.qwen3.6-plus.description'),
  },
  {
    id: 'qwen3.5-flash',
    displayName: zh('data.model.qwen3.5-flash.displayName'),
    providerId: 'bailian',
    family: 'Qwen',
    regions: ['ap-southeast-1', 'cn-beijing'],
    contextLength: 131_072,
    maxOutput: 16_384,
    priceInput: 0.05,
    priceOutput: 0.3,
    capabilities: ['tools', 'json'],
    status: 'legacy',
    licenseType: 'cloud-api',
    description: zh('data.model.qwen3.5-flash.description'),
  },
  {
    id: 'qwen3.8-27b',
    displayName: zh('data.model.qwen3.8-27b.displayName'),
    providerId: 'bailian',
    family: 'Qwen',
    regions: ['ap-southeast-1', 'cn-beijing'],
    contextLength: 262_144,
    maxOutput: 32_768,
    priceInput: 0.5,
    priceOutput: 3,
    marketRefUsd: { input: 0.5, output: 3, source: zh('data.model.qwen3.8-27b.marketRefSource') },
    capabilities: ['tools', 'json', 'thinking'],
    status: 'ga',
    openWeight: true,
    license: 'Apache-2.0',
    ...obligations('apache'),
    paramsB: 27,
    origin: 'cn',
    licenseType: 'cloud-api',
    description: zh('data.model.qwen3.8-27b.description'),
  },
  {
    id: 'qwen3-vl-plus',
    displayName: 'Qwen3-VL-Plus',
    providerId: 'bailian',
    family: 'Qwen',
    regions: ['ap-southeast-1', 'cn-beijing'],
    contextLength: 262_144,
    maxOutput: 32_768,
    priceInput: 0.2,
    priceOutput: 1.6,
    capabilities: ['vision', 'tools', 'json', 'thinking'],
    status: 'ga',
    licenseType: 'cloud-api',
    description: zh('data.model.qwen3-vl-plus.description'),
  },
  {
    id: 'qwen3-coder-plus',
    displayName: 'Qwen3-Coder-Plus',
    providerId: 'bailian',
    family: 'Qwen',
    regions: ['ap-southeast-1', 'cn-beijing'],
    contextLength: 1_000_000,
    maxOutput: 65_536,
    priceInput: 1,
    priceOutput: 5,
    capabilities: ['tools', 'json'],
    status: 'ga',
    licenseType: 'cloud-api',
    description: zh('data.model.qwen3-coder-plus.description'),
  },
  {
    id: 'qwen3-omni-flash',
    displayName: 'Qwen3-Omni-Flash',
    providerId: 'bailian',
    family: 'Qwen',
    regions: ['ap-southeast-1', 'cn-beijing'],
    contextLength: 65_536,
    maxOutput: 16_384,
    priceInput: 0.1,
    priceOutput: 0.4,
    capabilities: ['vision', 'audio', 'tools'],
    status: 'ga',
    licenseType: 'cloud-api',
    description: zh('data.model.qwen3-omni-flash.description'),
  },
  {
    id: 'text-embedding-v4',
    displayName: 'text-embedding-v4',
    providerId: 'bailian',
    family: 'Qwen',
    regions: ['ap-southeast-1', 'cn-beijing'],
    contextLength: 8_192,
    maxOutput: 0,
    priceInput: 0.07,
    priceOutput: 0,
    capabilities: ['embedding'],
    status: 'ga',
    licenseType: 'cloud-api',
    description: zh('data.model.text-embedding-v4.description'),
  },
  {
    id: 'qwen3-rerank',
    displayName: 'qwen3-rerank',
    providerId: 'bailian',
    family: 'Qwen',
    regions: ['ap-southeast-1', 'cn-beijing'],
    contextLength: 32_768,
    maxOutput: 0,
    priceInput: 0.1,
    priceOutput: 0,
    capabilities: ['rerank'],
    status: 'ga',
    licenseType: 'cloud-api',
    description: zh('data.model.qwen3-rerank.description'),
  },
  {
    id: 'deepseek-v4',
    new: true,
    origin: 'cn',
    speedTokPerSec: 60,
    displayName: 'DeepSeek-V4',
    providerId: 'bailian',
    family: 'DeepSeek',
    regions: ['ap-southeast-1', 'cn-beijing'],
    contextLength: 131_072,
    maxOutput: 32_768,
    priceInput: 0.3,
    priceOutput: 1.2,
    capabilities: ['tools', 'json', 'thinking'],
    status: 'ga',
    licenseType: 'cloud-api',
    hostedBy: zh('data.model.deepseek-v4.hostedBy'),
    description: zh('data.model.deepseek-v4.description'),
  },
  {
    id: 'kimi-k3',
    hot: true,
    speedTokPerSec: 50,
    displayName: 'Kimi K3',
    providerId: 'bailian',
    family: 'Moonshot',
    regions: ['ap-southeast-1', 'cn-beijing'],
    contextLength: 262_144,
    maxOutput: 32_768,
    priceInput: 3,
    priceOutput: 15,
    marketRefUsd: { input: 3, output: 15, source: zh('data.model.kimi-k3.marketRefSource') },
    capabilities: ['tools', 'json', 'thinking'],
    status: 'ga',
    licenseType: 'cloud-api',
    origin: 'cn',
    hostedBy: zh('data.model.kimi-k3.hostedBy'),
    description: zh('data.model.kimi-k3.description'),
  },
  {
    id: 'glm-5.3',
    displayName: 'GLM-5.3',
    providerId: 'bailian',
    family: 'Zhipu',
    regions: ['ap-southeast-1', 'cn-beijing'],
    contextLength: 131_072,
    maxOutput: 16_384,
    priceInput: 1.4,
    priceOutput: 4.4,
    marketRefUsd: { input: 1.4, output: 4.4, source: zh('data.model.glm-5.3.marketRefSource') },
    capabilities: ['tools', 'json'],
    status: 'ga',
    licenseType: 'cloud-api',
    origin: 'cn',
    hostedBy: zh('data.model.glm-5.3.hostedBy'),
    description: zh('data.model.glm-5.3.description'),
  },
  {
    id: 'minimax-m2.5',
    displayName: 'MiniMax-M2.5',
    providerId: 'bailian',
    family: 'MiniMax',
    regions: ['ap-southeast-1', 'cn-beijing'],
    contextLength: 204_800,
    maxOutput: 32_768,
    priceInput: 0.3,
    priceOutput: 1.2,
    capabilities: ['tools', 'json', 'thinking'],
    status: 'preview',
    licenseType: 'cloud-api',
    hostedBy: zh('data.model.minimax-m2.5.hostedBy'),
    description: zh('data.model.minimax-m2.5.description'),
  },
  {
    id: 'gpt-5',
    origin: 'us',
    requiresContract: true,
    speedTokPerSec: 60,
    displayName: 'GPT-5',
    providerId: 'openai',
    family: 'GPT',
    regions: ['openai-global'],
    contextLength: 400_000,
    maxOutput: 128_000,
    priceInput: 1.25,
    priceOutput: 10,
    capabilities: ['vision', 'tools', 'json', 'thinking'],
    status: 'ga',
    licenseType: 'cloud-api',
    description: zh('data.model.gpt-5.description'),
  },
  {
    id: 'gpt-5-mini',
    origin: 'us',
    requiresContract: true,
    speedTokPerSec: 110,
    displayName: 'GPT-5 mini',
    providerId: 'openai',
    family: 'GPT',
    regions: ['openai-global'],
    contextLength: 400_000,
    maxOutput: 128_000,
    priceInput: 0.25,
    priceOutput: 2,
    capabilities: ['vision', 'tools', 'json', 'thinking'],
    status: 'ga',
    licenseType: 'cloud-api',
    description: zh('data.model.gpt-5-mini.description'),
  },
  {
    id: 'claude-sonnet-4.5',
    origin: 'us',
    hot: true,
    requiresContract: true,
    speedTokPerSec: 65,
    displayName: 'Claude Sonnet 4.5',
    providerId: 'anthropic',
    family: 'Claude',
    regions: ['anthropic-global'],
    contextLength: 200_000,
    maxOutput: 64_000,
    priceInput: 3,
    priceOutput: 15,
    capabilities: ['vision', 'tools', 'json', 'thinking'],
    status: 'ga',
    licenseType: 'cloud-api',
    description: zh('data.model.claude-sonnet-4.5.description'),
  },
  {
    id: 'claude-haiku-4.5',
    origin: 'us',
    requiresContract: true,
    speedTokPerSec: 120,
    displayName: 'Claude Haiku 4.5',
    providerId: 'anthropic',
    family: 'Claude',
    regions: ['anthropic-global'],
    contextLength: 200_000,
    maxOutput: 64_000,
    priceInput: 1,
    priceOutput: 5,
    capabilities: ['vision', 'tools', 'json', 'thinking'],
    status: 'ga',
    licenseType: 'cloud-api',
    description: zh('data.model.claude-haiku-4.5.description'),
  },
  {
    id: 'gemini-2.5-pro',
    origin: 'us',
    requiresContract: true,
    speedTokPerSec: 70,
    displayName: 'Gemini 2.5 Pro',
    providerId: 'google',
    family: 'Gemini',
    regions: ['google-global'],
    contextLength: 1_048_576,
    maxOutput: 65_536,
    priceInput: 1.25,
    priceOutput: 10,
    capabilities: ['vision', 'audio', 'tools', 'json', 'thinking'],
    status: 'ga',
    licenseType: 'cloud-api',
    description: zh('data.model.gemini-2.5-pro.description'),
  },
  {
    id: 'gemini-2.5-flash',
    origin: 'us',
    requiresContract: true,
    speedTokPerSec: 150,
    displayName: 'Gemini 2.5 Flash',
    providerId: 'google',
    family: 'Gemini',
    regions: ['google-global'],
    contextLength: 1_048_576,
    maxOutput: 65_536,
    priceInput: 0.3,
    priceOutput: 2.5,
    capabilities: ['vision', 'audio', 'tools', 'json', 'thinking'],
    status: 'ga',
    licenseType: 'cloud-api',
    description: zh('data.model.gemini-2.5-flash.description'),
  },
  {
    id: 'qwen3.8-27b-vllm',
    hot: true,
    quantization: 'FP8',
    speedTokPerSec: 85,
    displayName: zh('data.model.qwen3.8-27b-vllm.displayName'),
    providerId: 'vllm',
    family: 'Qwen',
    regions: ['tw-tpe-a', 'tw-hc-b'],
    contextLength: 131_072,
    maxModelLen: 131_072,
    nativeContextLength: 262_144,
    maxOutput: 16_384,
    priceInput: 0.2,
    priceOutput: 0.6,
    marketRefUsd: { input: 0.5, output: 3, source: zh('data.model.qwen3.8-27b-vllm.marketRefSource') },
    capabilities: ['tools', 'json', 'thinking'],
    status: 'ga',
    openWeight: true,
    license: 'Apache-2.0',
    ...obligations('apache'),
    paramsB: 27,
    kvBytesPerToken: 262_144,
    origin: 'cn',
    licenseType: 'open-weight',
    deployable: true,
    description: zh('data.model.qwen3.8-27b-vllm.description'),
  },
  {
    id: 'maas-assist-27b',
    quantization: 'FP8',
    speedTokPerSec: 80,
    displayName: zh('data.model.maas-assist-27b.displayName'),
    providerId: 'vllm',
    family: 'MaaS',
    regions: ['tw-hc-b'],
    contextLength: 131_072,
    maxModelLen: 131_072,
    nativeContextLength: 262_144,
    maxOutput: 16_384,
    priceInput: 0.4,
    priceOutput: 1.2,
    capabilities: ['tools', 'json'],
    status: 'ga',
    openWeight: false,
    license: zh('data.model.maas-assist-27b.license'),
    ...obligations('platform'),
    baseModel: 'qwen3.8-27b',
    paramsB: 27,
    kvBytesPerToken: 262_144,
    origin: 'cn',
    licenseType: 'platform-licensed',
    deployable: true,
    description: zh('data.model.maas-assist-27b.description'),
  },
  {
    id: 'gpt-oss-120b-vllm',
    hot: true,
    quantization: 'INT4',
    speedTokPerSec: 140,
    displayName: zh('data.model.gpt-oss-120b-vllm.displayName'),
    providerId: 'vllm',
    family: 'gpt-oss',
    regions: ['tw-hc-b'],
    contextLength: 131_072,
    maxModelLen: 131_072,
    maxOutput: 16_384,
    priceInput: 0.15,
    priceOutput: 0.6,
    marketRefUsd: { input: 0.15, output: 0.6, source: zh('data.model.gpt-oss-120b-vllm.marketRefSource') },
    capabilities: ['tools', 'json', 'thinking'],
    status: 'ga',
    openWeight: true,
    license: 'Apache-2.0',
    ...obligations('apache'),
    paramsB: 117,
    activeParamsB: 5.1,
    kvBytesPerToken: 73_728,
    allowedQuantizations: ['INT4'],
    origin: 'us',
    licenseType: 'open-weight',
    deployable: true,
    description: zh('data.model.gpt-oss-120b-vllm.description'),
  },
  {
    id: 'llama-3.3-70b-vllm',
    quantization: 'FP8',
    speedTokPerSec: 45,
    displayName: zh('data.model.llama-3.3-70b-vllm.displayName'),
    providerId: 'vllm',
    family: 'Llama',
    regions: ['tw-hc-b'],
    contextLength: 131_072,
    maxModelLen: 131_072,
    maxOutput: 16_384,
    priceInput: 0.25,
    priceOutput: 0.5,
    marketRefUsd: { input: 0.1, output: 0.32, source: zh('data.model.llama-3.3-70b-vllm.marketRefSource') },
    capabilities: ['tools', 'json'],
    status: 'ga',
    openWeight: true,
    license: 'Llama 3.3 Community License',
    ...obligations('llama'),
    paramsB: 70,
    kvBytesPerToken: 327_680,
    origin: 'us',
    licenseType: 'open-weight',
    deployable: true,
    description: zh('data.model.llama-3.3-70b-vllm.description'),
  },
  {
    id: 'taide-lx-8b-vllm',
    quantization: 'FP8',
    speedTokPerSec: 160,
    displayName: zh('data.model.taide-lx-8b-vllm.displayName'),
    providerId: 'vllm',
    family: 'TAIDE',
    regions: ['tw-hc-b'],
    contextLength: 32_768,
    maxModelLen: 32_768,
    nativeContextLength: 131_072,
    maxOutput: 8_192,
    priceInput: 0.15,
    priceOutput: 0.3,
    capabilities: ['json'],
    status: 'ga',
    openWeight: true,
    license: zh('data.model.taide-lx-8b-vllm.license'),
    ...obligations('taide'),
    baseModel: 'Llama-3.1-8B',
    paramsB: 8,
    kvBytesPerToken: 131_072,
    origin: 'tw',
    licenseType: 'open-weight',
    deployable: true,
    description: zh('data.model.taide-lx-8b-vllm.description'),
  },
  {
    id: 'qwen3-embedding-8b-vllm',
    displayName: zh('data.model.qwen3-embedding-8b-vllm.displayName'),
    providerId: 'vllm',
    family: 'Qwen',
    regions: ['tw-tpe-a'],
    contextLength: 32_768,
    maxOutput: 0,
    priceInput: 0.05,
    priceOutput: 0,
    marketRefUsd: { input: 0.07, output: 0, source: zh('data.model.qwen3-embedding-8b-vllm.marketRefSource') },
    capabilities: ['embedding'],
    status: 'ga',
    openWeight: true,
    license: 'Apache-2.0',
    ...obligations('apache'),
    paramsB: 8,
    kvBytesPerToken: 0,
    origin: 'cn',
    licenseType: 'open-weight',
    deployable: true,
    description: zh('data.model.qwen3-embedding-8b-vllm.description'),
  },
  {
    id: 'embeddinggemma-300m-vllm',
    displayName: zh('data.model.embeddinggemma-300m-vllm.displayName'),
    providerId: 'vllm',
    family: 'Gemma',
    regions: ['tw-hc-b'],
    contextLength: 2_048,
    maxOutput: 0,
    priceInput: 0.01,
    priceOutput: 0,
    capabilities: ['embedding'],
    status: 'ga',
    openWeight: true,
    license: 'Gemma Terms of Use',
    ...obligations('gemma'),
    paramsB: 0.3,
    kvBytesPerToken: 0,
    origin: 'us',
    licenseType: 'open-weight',
    deployable: true,
    description: zh('data.model.embeddinggemma-300m-vllm.description'),
  },
  {
    id: 'qwen3-coder-30b-a3b-vllm',
    new: true,
    quantization: 'FP8',
    speedTokPerSec: 180,
    displayName: zh('data.model.qwen3-coder-30b-a3b-vllm.displayName'),
    providerId: 'vllm',
    family: 'Qwen',
    regions: ['tw-tc-c'],
    contextLength: 131_072,
    maxModelLen: 131_072,
    nativeContextLength: 262_144,
    maxOutput: 16_384,
    priceInput: 0.2,
    priceOutput: 0.6,
    marketRefUsd: { input: 0.12, output: 0.5, source: zh('data.model.qwen3-coder-30b-a3b-vllm.marketRefSource') },
    capabilities: ['tools', 'json'],
    status: 'preview',
    openWeight: true,
    license: 'Apache-2.0',
    ...obligations('apache'),
    paramsB: 30,
    activeParamsB: 3,
    kvBytesPerToken: 98_304,
    origin: 'cn',
    licenseType: 'open-weight',
    deployable: true,
    description: zh('data.model.qwen3-coder-30b-a3b-vllm.description'),
  },
  // ---------- 以下為模型中心（MaaS 入口）新增的示意模型：閉源代理（代理折扣）與非文字模態（圖像／影片／語音），全部為雲端代理、非 token 計價者不進入 token 數學 ----------
  {
    id: 'gpt-5.1',
    displayName: zh('data.model.gpt-5.1.displayName'),
    providerId: 'openai',
    family: 'GPT',
    regions: ['openai-global'],
    contextLength: 400_000,
    maxOutput: 128_000,
    priceInput: 1.25,
    priceOutput: 10,
    marketRefUsd: { input: 1.25, output: 10, source: zh('data.model.gpt-5.1.marketRefSource') },
    requiresContract: true,
    new: true,
    speedTokPerSec: 70,
    capabilities: ['vision', 'tools', 'json', 'thinking'],
    status: 'ga',
    licenseType: 'cloud-api',
    origin: 'us',
    description: zh('data.model.gpt-5.1.description'),
  },
  {
    id: 'claude-opus-4.5',
    displayName: zh('data.model.claude-opus-4.5.displayName'),
    providerId: 'anthropic',
    family: 'Claude',
    regions: ['anthropic-global'],
    contextLength: 200_000,
    maxOutput: 64_000,
    priceInput: 5,
    priceOutput: 25,
    marketRefUsd: { input: 5, output: 25, source: zh('data.model.claude-opus-4.5.marketRefSource') },
    requiresContract: true,
    new: true,
    speedTokPerSec: 50,
    capabilities: ['vision', 'tools', 'json', 'thinking'],
    status: 'ga',
    licenseType: 'cloud-api',
    origin: 'us',
    description: zh('data.model.claude-opus-4.5.description'),
  },
  {
    id: 'gemini-2.5-flash-lite',
    displayName: zh('data.model.gemini-2.5-flash-lite.displayName'),
    providerId: 'google',
    family: 'Gemini',
    regions: ['google-global'],
    contextLength: 1_048_576,
    maxOutput: 65_536,
    priceInput: 0.1,
    priceOutput: 0.4,
    marketRefUsd: { input: 0.1, output: 0.4, source: zh('data.model.gemini-2.5-flash-lite.marketRefSource') },
    requiresContract: true,
    speedTokPerSec: 200,
    capabilities: ['vision', 'audio', 'tools', 'json'],
    status: 'ga',
    licenseType: 'cloud-api',
    origin: 'us',
    description: zh('data.model.gemini-2.5-flash-lite.description'),
  },
  {
    id: 'flux.1-schnell',
    displayName: zh('data.model.flux.1-schnell.displayName'),
    providerId: 'bailian',
    family: 'Black Forest Labs',
    regions: ['ap-southeast-1'],
    contextLength: 0,
    maxOutput: 0,
    priceInput: 0.004,
    priceOutput: 0,
    modality: 'image',
    unitType: 'per_image',
    hot: true,
    capabilities: [],
    status: 'ga',
    licenseType: 'cloud-api',
    openWeight: true,
    license: 'Apache-2.0',
    origin: 'eu',
    hostedBy: zh('data.model.flux.1-schnell.hostedBy'),
    description: zh('data.model.flux.1-schnell.description'),
  },
  {
    id: 'kling-v2.5',
    displayName: zh('data.model.kling-v2.5.displayName'),
    providerId: 'partner',
    family: 'Kling',
    regions: ['partner-global'],
    contextLength: 0,
    maxOutput: 0,
    priceInput: 0.07,
    priceOutput: 0,
    modality: 'video',
    unitType: 'per_second',
    new: true,
    capabilities: [],
    status: 'preview',
    licenseType: 'cloud-api',
    origin: 'cn',
    requiresContract: true,
    description: zh('data.model.kling-v2.5.description'),
  },
  {
    id: 'minimax-speech-2.6',
    displayName: zh('data.model.minimax-speech-2.6.displayName'),
    providerId: 'partner',
    family: 'MiniMax',
    regions: ['partner-global'],
    contextLength: 0,
    maxOutput: 0,
    priceInput: 0.06,
    priceOutput: 0,
    modality: 'audio',
    unitType: 'per_minute',
    capabilities: ['audio'],
    status: 'preview',
    licenseType: 'cloud-api',
    origin: 'cn',
    description: zh('data.model.minimax-speech-2.6.description'),
  },
  {
    id: 'whisper-large-v3',
    displayName: zh('data.model.whisper-large-v3.displayName'),
    providerId: 'openai',
    family: 'Whisper',
    regions: ['openai-global'],
    contextLength: 0,
    maxOutput: 0,
    priceInput: 0.006,
    priceOutput: 0,
    modality: 'audio',
    unitType: 'per_minute',
    capabilities: ['audio'],
    status: 'ga',
    licenseType: 'cloud-api',
    origin: 'us',
    description: zh('data.model.whisper-large-v3.description'),
  },
];

export const MODELS: ModelInfo[] = (() => {
  const originById = Object.fromEntries(MODEL_SEEDS.map((m) => [m.id, { origin: m.origin }]));
  return MODEL_SEEDS.map((m) => withHubFields(m, originById));
})();

/** 可部署到我們的 GPU 的模型：開放權重或本平台微調者 */
export const DEPLOYABLE_MODELS: ModelInfo[] = MODELS.filter((m) => m.providerId === 'vllm' && m.deployable);

/** 以 token 計價、可進入對話／路由的模型（排除圖像／影片／語音與嵌入／重排） */
export const TEXT_MODELS: ModelInfo[] = MODELS.filter((m) => m.unitType === 'per_1m_tokens' && m.modality !== 'embedding' && m.modality !== 'rerank');

export const MODEL_BY_ID: Record<string, ModelInfo> = Object.fromEntries(MODELS.map((m) => [m.id, m]));

export const CAPABILITY_LABELS: Record<Capability, string> = {
  vision: zh('data.CAPABILITY_LABELS.vision'),
  tools: zh('data.CAPABILITY_LABELS.tools'),
  json: zh('data.CAPABILITY_LABELS.json'),
  thinking: zh('data.CAPABILITY_LABELS.thinking'),
  embedding: zh('data.CAPABILITY_LABELS.embedding'),
  rerank: zh('data.CAPABILITY_LABELS.rerank'),
  audio: zh('data.CAPABILITY_LABELS.audio'),
};

export const ORIGIN_LABELS: Record<NonNullable<ModelInfo['origin']>, string> = { cn: zh('data.ORIGIN_LABELS.cn'), us: zh('data.ORIGIN_LABELS.us'), eu: zh('data.ORIGIN_LABELS.eu'), tw: zh('data.ORIGIN_LABELS.tw'), other: zh('data.ORIGIN_LABELS.other') };

export const MODEL_STATUS_LABELS: Record<ModelStatus, string> = {
  ga: zh('data.MODEL_STATUS_LABELS.ga'),
  preview: zh('data.MODEL_STATUS_LABELS.preview'),
  legacy: zh('data.MODEL_STATUS_LABELS.legacy'),
  deprecated: zh('data.MODEL_STATUS_LABELS.deprecated'),
};

export function isQwen3x(modelId: string): boolean {
  return /^qwen3(\.\d+)?/.test(modelId);
}

/** 我們對外的單一 OpenAI 相容 base URL（文件、模型中心與 Playground 共用；示意網域） */
export const PLATFORM_BASE_URL = 'https://api.maas.example/v1';
/** Anthropic Messages 相容轉接層（Claude Code 等工具用 ANTHROPIC_BASE_URL，不含 /v1） */
export const PLATFORM_ANTHROPIC_BASE_URL = 'https://api.maas.example';
