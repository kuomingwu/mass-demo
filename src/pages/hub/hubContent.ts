/**
 * 模型中心（MaaS 入口）的靜態文案與整合範例：我們擁有 GPU 機房、自建開源模型 + 代理閉源模型，
 * 統一 OpenAI 相容 API、單一帳單（TWD 統一發票）、SLA。所有價格與數字皆為示意。
 * 文案在 i18n 字典的 hub 區域（hub.feature.*、hub.faq.*、hub.int.*、hub.api.*、hub.sample.*）；
 * 本模組匯出接收 t 的函式，於元件內以目前語言產生內容。
 */
import { PLATFORM_ANTHROPIC_BASE_URL, PLATFORM_BASE_URL, isLocalModel, type ModelInfo } from '../../data/models';
import { RATE_LIMIT_TIERS, SLA_TERMS, proxyKindOf, type PricePolicy, customerPriceFactor } from '../../data/commercial';
import { tf, type TFunction } from '../../i18n';

/** 供應商／模型系列 chips（以字首作為示意 logo；依租戶排除的來源地過濾） */
export interface ProviderChip {
  name: string;
  initials: string;
  /** 名稱或字首需要翻譯時的字典鍵（`${nameKey}.name`、`${nameKey}.initials`） */
  nameKey?: string;
  origin: NonNullable<ModelInfo['origin']>;
  /** 自建於我們的 GPU（開放權重）或雲端代理 */
  kind: 'self-hosted' | 'proxied';
}

export const PROVIDER_CHIPS: ProviderChip[] = [
  { name: 'Qwen', initials: 'Qw', origin: 'cn', kind: 'self-hosted' },
  { name: 'DeepSeek', initials: 'DS', origin: 'cn', kind: 'proxied' },
  { name: 'Llama', initials: 'Ll', origin: 'us', kind: 'self-hosted' },
  { name: 'Gemma', initials: 'Ge', origin: 'us', kind: 'self-hosted' },
  { name: 'gpt-oss', initials: 'go', origin: 'us', kind: 'self-hosted' },
  { name: 'GLM', initials: 'GL', origin: 'cn', kind: 'proxied' },
  { name: 'Kimi', initials: 'Ki', origin: 'cn', kind: 'proxied' },
  { name: 'TAIDE', initials: 'TA', origin: 'tw', kind: 'self-hosted' },
  { name: 'OpenAI', initials: 'OA', origin: 'us', kind: 'proxied' },
  { name: 'Anthropic', initials: 'An', origin: 'us', kind: 'proxied' },
  { name: 'Google', initials: 'Go', origin: 'us', kind: 'proxied' },
  { name: 'bailian', initials: 'bailian', nameKey: 'hub.provider.bailian', origin: 'cn', kind: 'proxied' },
  { name: 'MiniMax', initials: 'MM', origin: 'cn', kind: 'proxied' },
  { name: 'Kling', initials: 'Kl', origin: 'cn', kind: 'proxied' },
  { name: 'Black Forest Labs', initials: 'BF', origin: 'eu', kind: 'proxied' },
  { name: 'Whisper', initials: 'Wh', origin: 'us', kind: 'proxied' },
];

export function chipName(t: TFunction, c: ProviderChip): string {
  return c.nameKey ? t(`${c.nameKey}.name`) : c.name;
}
export function chipInitials(t: TFunction, c: ProviderChip): string {
  return c.nameKey ? t(`${c.nameKey}.initials`) : c.initials;
}

export interface FeatureCard {
  title: string;
  body: string;
  /** 對應的控制台頁面（有連結時顯示「在控制台檢視」） */
  route?: string;
  routeLabel?: string;
}

function card(t: TFunction, id: string, route?: string, params?: Record<string, string | number>): FeatureCard {
  return {
    title: t(`hub.feature.${id}.title`, params),
    body: t(`hub.feature.${id}.body`, params),
    ...(route ? { route, routeLabel: t(`hub.feature.${id}.routeLabel`) } : {}),
  };
}

/** 「不只是 API 路由器」 */
export function notJustRouter(t: TFunction): FeatureCard[] {
  return [card(t, 'router.selfHosted', '/clusters'), card(t, 'router.rightModel', '/routing'), card(t, 'router.multimodal'), card(t, 'router.cost', '/usage?tab=statement')];
}

/** 「相同模型，更好的經濟性」 */
export function sameModelsBetterEconomics(t: TFunction): FeatureCard[] {
  return [card(t, 'econ.discount'), card(t, 'econ.tiers', '/plan'), card(t, 'econ.noLockIn'), card(t, 'econ.oneBill', '/usage?tab=statement')];
}

/** SLA 文案（資料層 SLA_TERMS 的翻譯；字典缺鍵時退回 zh-TW） */
export function slaText(t: TFunction) {
  return {
    sharedLabel: tf(t, 'data.SLA_TERMS.shared.label', SLA_TERMS.shared.label),
    sharedNote: tf(t, 'data.SLA_TERMS.shared.note', SLA_TERMS.shared.note),
    dedicatedLabel: tf(t, 'data.SLA_TERMS.dedicated.label', SLA_TERMS.dedicated.label),
    dedicatedNote: tf(t, 'data.SLA_TERMS.dedicated.note', SLA_TERMS.dedicated.note),
    credits: SLA_TERMS.credits.map((c, i) => ({ below: c.below, creditPct: c.creditPct, label: tf(t, `data.SLA_TERMS.credits.${i}.label`, c.label) })),
    note: tf(t, 'data.SLA_TERMS.note', SLA_TERMS.note),
  };
}

/** 限流層級條件說明（RATE_LIMIT_TIERS.note 的翻譯） */
export function tierNote(t: TFunction, tier: { level: number; note: string }): string {
  return tf(t, `data.RATE_LIMIT_TIER_NOTES.${tier.level}`, tier.note);
}

/** SLA 服務抵扣比例清單（例如 10%／25%／100%） */
export function slaCreditList(t: TFunction): string {
  return SLA_TERMS.credits.map((c) => `${c.creditPct}%`).join(t('hub.sep.slash'));
}

/** 「從 Demo 到正式上線」 */
export function demoToProduction(t: TFunction): FeatureCard[] {
  return [
    card(t, 'prod.sla', '/plan', { shared: SLA_TERMS.shared.availabilityPct, dedicated: SLA_TERMS.dedicated.availabilityPct, sharedNote: tf(t, 'data.SLA_TERMS.shared.note', SLA_TERMS.shared.note), dedicatedNote: tf(t, 'data.SLA_TERMS.dedicated.note', SLA_TERMS.dedicated.note), credits: slaCreditList(t) }),
    card(t, 'prod.zeroRetention', '/tenants'),
    card(t, 'prod.dedicated', '/deployments'),
    card(t, 'prod.trial', '/hub/trial'),
  ];
}

export interface FaqItem {
  q: string;
  a: string;
}

const FAQ_IDS = ['maas', 'billing', 'serverlessWhen', 'faster', 'serverlessPros', 'migrate'] as const;

export function faq(t: TFunction): FaqItem[] {
  return FAQ_IDS.map((id) => ({ q: t(`hub.faq.${id}.q`), a: t(`hub.faq.${id}.a`) }));
}

/** GPU 時租（專屬部署牌價，示意；與「定價與帳務 → 定價參數」同一組數字） */
export function gpuHourlyShowcase(t: TFunction): { gpuType: string; label: string; note: string }[] {
  return [
    { gpuType: 'H100 80GB', label: 'H100 80GB', note: t('hub.gpu.h100.note') },
    { gpuType: 'H200 141GB', label: 'H200 141GB', note: t('hub.gpu.h200.note') },
    { gpuType: 'L40S 48GB', label: 'L40S 48GB', note: t('hub.gpu.l40s.note') },
  ];
}

/** 整合範例（全部指向我們的 base URL） */
export interface IntegrationSnippet {
  id: string;
  title: string;
  description: string;
  language: string;
  code: string;
  /** 建議搭配的模型 */
  recommendedModels: string[];
}

export function integrations(t: TFunction): IntegrationSnippet[] {
  const c = (id: string, name: string) => t(`hub.int.${id}.c.${name}`);
  return [
    {
      id: 'claude-code',
      title: 'Claude Code',
      description: t('hub.int.claudeCode.description'),
      language: 'bash',
      code: `# ${c('claudeCode', 'env')}
export ANTHROPIC_BASE_URL="${PLATFORM_ANTHROPIC_BASE_URL}"
export ANTHROPIC_AUTH_TOKEN="sk-maas-xxxxxxxxxxxxxxxx"   # ${c('claudeCode', 'token')}
export ANTHROPIC_MODEL="qwen3.8-27b-vllm"               # ${c('claudeCode', 'model')}
export ANTHROPIC_SMALL_FAST_MODEL="gpt-oss-120b-vllm"
claude`,
      recommendedModels: ['qwen3.8-27b-vllm', 'gpt-oss-120b-vllm', 'claude-sonnet-4.5', 'claude-opus-4.5'],
    },
    {
      id: 'cursor',
      title: t('hub.int.cursor.title'),
      description: t('hub.int.cursor.description'),
      language: 'text',
      code: `OpenAI Base URL : ${PLATFORM_BASE_URL}
OpenAI API Key  : sk-maas-xxxxxxxxxxxxxxxx
Custom models   : qwen3.8-27b-vllm, qwen3-coder-30b-a3b-vllm, gpt-5.1

# ${c('cursor', 'verify')}
curl -i ${PLATFORM_BASE_URL}/models -H "Authorization: Bearer sk-maas-xxxxxxxxxxxxxxxx"`,
      recommendedModels: ['qwen3-coder-30b-a3b-vllm', 'qwen3.8-27b-vllm', 'gpt-5.1'],
    },
    {
      id: 'dify',
      title: 'Dify',
      description: t('hub.int.dify.description'),
      language: 'yaml',
      code: `# ${c('dify', 'provider')}
model_type: llm
model_name: qwen3.8-27b-vllm           # ${c('dify', 'alias')}
api_key: sk-maas-xxxxxxxxxxxxxxxx
endpoint_url: ${PLATFORM_BASE_URL}
completion_mode: chat
context_size: 131072
function_calling: tool_call            # ${c('dify', 'tools')}

# ${c('dify', 'embedding')}
model_type: text-embedding
model_name: qwen3-embedding-8b-vllm
endpoint_url: ${PLATFORM_BASE_URL}`,
      recommendedModels: ['qwen3.8-27b-vllm', 'qwen3-embedding-8b-vllm', 'embeddinggemma-300m-vllm'],
    },
    {
      id: 'litellm',
      title: t('hub.int.litellm.title'),
      description: t('hub.int.litellm.description'),
      language: 'yaml',
      code: `# litellm config.yaml
model_list:
  - model_name: qwen-plus                 # ${c('litellm', 'publicName')}
    litellm_params:
      model: openai/qwen-plus             # ${c('litellm', 'alias')}
      api_base: ${PLATFORM_BASE_URL}
      api_key: os.environ/MAAS_API_KEY
  - model_name: gov-chat
    litellm_params:
      model: openai/gpt-oss-120b-vllm     # ${c('litellm', 'gov')}
      api_base: ${PLATFORM_BASE_URL}
      api_key: os.environ/MAAS_API_KEY
general_settings:
  forward_openai_org_id: false`,
      recommendedModels: ['qwen3.8-27b-vllm', 'gpt-oss-120b-vllm', 'llama-3.3-70b-vllm'],
    },
    {
      id: 'openclaw',
      title: 'OpenClaw',
      description: t('hub.int.openclaw.description'),
      language: 'json',
      code: `{
  "providers": {
    "maas": {
      "type": "openai-compatible",
      "baseUrl": "${PLATFORM_BASE_URL}",
      "apiKey": "\${MAAS_API_KEY}",
      "defaultModel": "qwen3.8-27b-vllm",
      "models": ["qwen3.8-27b-vllm", "gpt-oss-120b-vllm", "claude-sonnet-4.5"]
    }
  },
  "agent": { "provider": "maas", "toolCalling": true }
}`,
      recommendedModels: ['qwen3.8-27b-vllm', 'gpt-oss-120b-vllm', 'claude-sonnet-4.5'],
    },
  ];
}

const ENDPOINTS: { path: string; key: string }[] = [
  { path: '/v1/chat/completions', key: 'chat' },
  { path: '/v1/messages', key: 'messages' },
  { path: '/v1/embeddings', key: 'embeddings' },
  { path: '/v1/rerank', key: 'rerank' },
  { path: '/v1/images/generations', key: 'images' },
  { path: '/v1/videos', key: 'videos' },
  { path: '/v1/audio/speech', key: 'speech' },
  { path: '/v1/audio/transcriptions', key: 'transcriptions' },
  { path: '/v1/models', key: 'models' },
];

/** 單一 base URL 與驗證方式（文件頁頂部） */
export function apiBasics(t: TFunction) {
  return {
    baseUrl: PLATFORM_BASE_URL,
    anthropicBaseUrl: PLATFORM_ANTHROPIC_BASE_URL,
    auth: 'Authorization: Bearer sk-maas-…',
    endpoints: ENDPOINTS.map((e) => ({ path: e.path, note: t(`hub.api.endpoint.${e.key}`) })),
    headers: ['x-maas-tier: local | spillover | external', t('hub.api.header.model'), 'x-maas-deployment / x-maas-region / x-maas-sharing', 'x-maas-retention: zero | 30d', t('hub.api.header.balance'), 'x-maas-request-id', t('hub.api.header.errors')],
  };
}

/** 公開價格 API 範例：GET /v1/models 回應（含自建與代理模型的價格；代理模型同時揭露供應商牌價） */
export function modelsApiSample(models: ModelInfo[], policy: PricePolicy, tokenPrices: Record<string, { input: number; output: number }>): string {
  const pick = ['qwen3.8-27b-vllm', 'gpt-oss-120b-vllm', 'qwen3.7-plus', 'gpt-5.1', 'claude-sonnet-4.5', 'flux.1-schnell'];
  const rows = pick.map((id) => models.find((m) => m.id === id)).filter((m): m is ModelInfo => !!m);
  const data = rows.map((m) => {
    const local = isLocalModel(m);
    const f = customerPriceFactor(m, policy);
    const p = local ? tokenPrices[m.id] ?? { input: m.priceInput, output: m.priceOutput } : { input: Math.round(m.priceInput * f * 10000) / 10000, output: Math.round(m.priceOutput * f * 10000) / 10000 };
    const base: Record<string, unknown> = {
      id: m.id,
      object: 'model',
      owned_by: local ? 'maas' : m.providerId,
      modality: m.modality,
      hosting: proxyKindOf(m),
      unit: m.unitType,
      pricing: m.unitType === 'per_1m_tokens' ? { input_per_1m_usd: p.input, output_per_1m_usd: p.output, ...(local ? { cache_read_multiplier: 0.1, cache_write_multiplier: 1.25 } : {}) } : { per_unit_usd: p.input },
    };
    if (!local) base.vendor_list_pricing = m.unitType === 'per_1m_tokens' ? { input_per_1m_usd: m.priceInput, output_per_1m_usd: m.priceOutput } : { per_unit_usd: m.priceInput };
    if (m.contextLength) base.context_length = m.maxModelLen ?? m.contextLength;
    return base;
  });
  return `GET ${PLATFORM_BASE_URL}/models
Authorization: Bearer sk-maas-…

HTTP/1.1 200 OK
x-maas-request-id: req-…
x-maas-retention: 30d

${JSON.stringify({ object: 'list', data, rate_limit_tiers: RATE_LIMIT_TIERS.map((t) => ({ tier: t.level, tpm: t.tpm, min_cumulative_spend_usd: t.minSpendUsd })) }, null, 2)}`;
}

/** Anthropic Messages 相容端點範例（Claude Code、Anthropic SDK 直接指向我們） */
export function messagesApiSample(t: TFunction): string {
  return `curl -i ${PLATFORM_ANTHROPIC_BASE_URL}/v1/messages \\
  -H "x-api-key: sk-maas-xxxxxxxxxxxxxxxx" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "content-type: application/json" \\
  -d '{
    "model": "claude-sonnet-4.5",            # ${t('hub.sample.messages.modelComment')}
    "max_tokens": 512,
    "messages": [{"role": "user", "content": "${t('hub.sample.introTaiwan')}"}]
  }'

# ${t('hub.sample.messages.responseComment')}
HTTP/1.1 200 OK
x-maas-tier: external            # local｜spillover｜external
x-maas-model: claude-sonnet-4.5
x-maas-retention: 30d            # zero｜30d
x-maas-balance: 1234.56          # ${t('hub.sample.messages.balanceComment')}
{"id": "msg_…", "type": "message", "role": "assistant", "content": [{"type": "text", "text": "…"}], "usage": {"input_tokens": 23, "output_tokens": 41}}`;
}

/** 模型卡的 API 範例（依模態產生 curl／Python／Node） */
export function apiSnippets(m: ModelInfo, t: TFunction): { curl: string; python: string; node: string; endpoint: string } {
  const key = 'sk-maas-xxxxxxxxxxxxxxxx';
  const base = PLATFORM_BASE_URL;
  if (m.modality === 'embedding' || m.modality === 'rerank') {
    const ep = m.modality === 'embedding' ? '/embeddings' : '/rerank';
    const q = t('hub.sample.whereTaipei101');
    const body = m.modality === 'embedding' ? { model: m.id, input: [q] } : { model: m.id, query: q, documents: [t('hub.sample.docTaipei101'), t('hub.sample.docKaohsiung85')] };
    return {
      endpoint: ep,
      curl: `curl ${base}${ep} \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body)}'`,
      python: `from openai import OpenAI\n\nclient = OpenAI(api_key="${key}", base_url="${base}")\n${m.modality === 'embedding' ? `res = client.embeddings.create(model="${m.id}", input=["${q}"])\nprint(len(res.data[0].embedding))` : `# ${t('hub.sample.rerankComment')}\nimport httpx\nres = httpx.post("${base}${ep}", headers={"Authorization": "Bearer ${key}"}, json=${JSON.stringify(body)})\nprint(res.json())`}`,
      node: `import OpenAI from "openai";\n\nconst client = new OpenAI({ apiKey: "${key}", baseURL: "${base}" });\n${m.modality === 'embedding' ? `const res = await client.embeddings.create({ model: "${m.id}", input: ["${q}"] });\nconsole.log(res.data[0].embedding.length);` : `const res = await fetch("${base}${ep}", { method: "POST", headers: { Authorization: "Bearer ${key}", "Content-Type": "application/json" }, body: JSON.stringify(${JSON.stringify(body)}) });\nconsole.log(await res.json());`}`,
    };
  }
  if (m.modality === 'image') {
    const prompt = t('hub.sample.imagePrompt');
    const body = { model: m.id, prompt, size: '1024x1024', n: 1 };
    return {
      endpoint: '/images/generations',
      curl: `curl ${base}/images/generations \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body)}'`,
      python: `from openai import OpenAI\n\nclient = OpenAI(api_key="${key}", base_url="${base}")\nimg = client.images.generate(model="${m.id}", prompt="${prompt}", size="1024x1024", n=1)\nprint(img.data[0].url)  # ${t('hub.sample.perImageComment', { price: m.priceInput })}`,
      node: `import OpenAI from "openai";\n\nconst client = new OpenAI({ apiKey: "${key}", baseURL: "${base}" });\nconst img = await client.images.generate({ model: "${m.id}", prompt: "${prompt}", size: "1024x1024", n: 1 });\nconsole.log(img.data[0].url);`,
    };
  }
  if (m.modality === 'video') {
    const body = { model: m.id, prompt: t('hub.sample.videoPrompt'), duration: 5, resolution: '720p' };
    return {
      endpoint: '/videos',
      curl: `curl ${base}/videos \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body)}'\n# ${t('hub.sample.videoComment', { url: `${base}/videos/{id}`, price: m.priceInput })}`,
      python: `import httpx\n\nheaders = {"Authorization": "Bearer ${key}"}\njob = httpx.post("${base}/videos", headers=headers, json=${JSON.stringify(body)}).json()\nstatus = httpx.get(f"${base}/videos/{job['id']}", headers=headers).json()\nprint(status["status"], status.get("url"))`,
      node: `const headers = { Authorization: "Bearer ${key}", "Content-Type": "application/json" };\nconst job = await (await fetch("${base}/videos", { method: "POST", headers, body: JSON.stringify(${JSON.stringify(body)}) })).json();\nconst status = await (await fetch(\`${base}/videos/\${job.id}\`, { headers })).json();\nconsole.log(status.status, status.url);`,
    };
  }
  if (m.modality === 'audio') {
    const asr = m.family === 'Whisper';
    const perMinute = t('hub.sample.perMinuteComment', { price: m.priceInput });
    if (asr) {
      return {
        endpoint: '/audio/transcriptions',
        curl: `curl ${base}/audio/transcriptions \\\n  -H "Authorization: Bearer ${key}" \\\n  -F model="${m.id}" \\\n  -F file="@meeting.wav" \\\n  -F response_format="json"\n# ${perMinute}`,
        python: `from openai import OpenAI\n\nclient = OpenAI(api_key="${key}", base_url="${base}")\nwith open("meeting.wav", "rb") as f:\n    text = client.audio.transcriptions.create(model="${m.id}", file=f)\nprint(text.text)`,
        node: `import fs from "node:fs";\nimport OpenAI from "openai";\n\nconst client = new OpenAI({ apiKey: "${key}", baseURL: "${base}" });\nconst res = await client.audio.transcriptions.create({ model: "${m.id}", file: fs.createReadStream("meeting.wav") });\nconsole.log(res.text);`,
      };
    }
    const input = t('hub.sample.ttsInput');
    const body = { model: m.id, input, voice: 'default', format: 'mp3' };
    return {
      endpoint: '/audio/speech',
      curl: `curl ${base}/audio/speech \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body)}' --output hello.mp3\n# ${perMinute}`,
      python: `from openai import OpenAI\n\nclient = OpenAI(api_key="${key}", base_url="${base}")\nwith client.audio.speech.with_streaming_response.create(model="${m.id}", voice="default", input="${input}") as res:\n    res.stream_to_file("hello.mp3")`,
      node: `import fs from "node:fs";\nimport OpenAI from "openai";\n\nconst client = new OpenAI({ apiKey: "${key}", baseURL: "${base}" });\nconst mp3 = await client.audio.speech.create({ model: "${m.id}", voice: "default", input: "${input}" });\nfs.writeFileSync("hello.mp3", Buffer.from(await mp3.arrayBuffer()));`,
    };
  }
  const vision = m.modality === 'vision';
  const tools = m.toolCalling;
  const userContent = vision ? [{ type: 'text', text: t('hub.sample.invoiceQuestion') }, { type: 'image_url', image_url: { url: 'https://example.com/invoice.png' } }] : t('hub.sample.introTaiwan');
  const body: Record<string, unknown> = { model: m.id, messages: [{ role: 'user', content: userContent }], stream: true };
  if (tools) body.tools = [{ type: 'function', function: { name: 'get_weather', description: t('hub.sample.weatherTool'), parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } }];
  return {
    endpoint: '/chat/completions',
    curl: `curl ${base}/chat/completions \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body, null, 2)}'`,
    python: `from openai import OpenAI\n\nclient = OpenAI(api_key="${key}", base_url="${base}")\nstream = client.chat.completions.create(\n    model="${m.id}",\n    messages=[{"role": "user", "content": ${JSON.stringify(userContent)}}],${tools ? `\n    tools=[{"type": "function", "function": {"name": "get_weather", "parameters": {"type": "object", "properties": {"city": {"type": "string"}}}}}],` : ''}\n    stream=True,\n)\nfor chunk in stream:\n    print(chunk.choices[0].delta.content or "", end="", flush=True)`,
    node: `import OpenAI from "openai";\n\nconst client = new OpenAI({ apiKey: "${key}", baseURL: "${base}" });\nconst stream = await client.chat.completions.create({\n  model: "${m.id}",\n  messages: [{ role: "user", content: ${JSON.stringify(userContent)} }],${tools ? `\n  tools: [{ type: "function", function: { name: "get_weather", parameters: { type: "object", properties: { city: { type: "string" } } } } }],` : ''}\n  stream: true,\n});\nfor await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? "");`,
  };
}
