// 模型中心（MaaS 入口）與申請測試：listModels 新欄位、listHubModels 伺服器端過濾、非文字模態 Playground、試用申請驗證與 RBAC
import { describe, expect, it } from 'vitest';
import { MockServer, TRIAL_TERMS, type TrialRequestInput } from '../api';
import { MODELS, MODEL_BY_ID, TEXT_MODELS, isMediaModality, originOfModel, withHubFields } from '../../data/models';
import { ROLES, PLATFORM_ONLY_ACTIONS } from '../../auth/roles';

const fresh = () => new MockServer({ latency: [0, 0], agentConnectMs: 0, deploymentReadyMs: 0, drainMs: 0 });
const as = (userId: string) => ({ userId });
const OWNER = as('u-owner');
const FIN = as('u-finance');
const STAR = as('u-admin-star');
const GOV = as('u-admin-gov');
const auditOf = (s: MockServer) => (s as unknown as { audit: { all(): { action: string; decision: string; actorId: string; resourceId?: string }[] } }).audit.all();

const trialInput = (over: Partial<TrialRequestInput> = {}): TrialRequestInput => ({
  accountName: 'acme-eval-x',
  ipAllowlist: false,
  models: [
    { modelId: 'qwen3.8-27b-vllm', rpm: 60, tpm: 100_000, ttftMs: 800, cacheHitPct: 30 },
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
  otherNeeds: '',
  company: '艾克米股份有限公司',
  companyShort: 'ACME',
  contactName: '林小測',
  email: 'eval@acme.example',
  phone: '02-1234-5678',
  ...over,
});

describe('模型目錄：模型中心欄位', () => {
  it('每個模型都有 modality／unitType／badges／toolCalling；既有 id 未變；非 token 模態不在 TEXT_MODELS 與可部署清單', async () => {
    const s = fresh();
    const res = await s.listModels(OWNER);
    expect(res.ok).toBe(true);
    const list = res.ok ? res.data : [];
    expect(list.length).toBe(MODELS.length);
    for (const m of list) {
      expect(['text', 'vision', 'image', 'video', 'audio', 'embedding', 'rerank'], m.id).toContain(m.modality);
      expect(['per_1m_tokens', 'per_image', 'per_second', 'per_minute'], m.id).toContain(m.unitType);
      expect(Array.isArray(m.badges), m.id).toBe(true);
      expect(typeof m.toolCalling, m.id).toBe('boolean');
      expect(m.badges.includes(m.providerId === 'vllm' ? 'self-hosted' : 'proxied'), m.id).toBe(true);
      if (isMediaModality(m.modality)) {
        expect(m.unitType, m.id).not.toBe('per_1m_tokens');
        expect(m.providerId, m.id).not.toBe('vllm');
        expect(m.toolCalling, m.id).toBe(false);
      } else expect(m.unitType, m.id).toBe('per_1m_tokens');
    }
    // 既有 id 與牌價未變
    for (const id of ['qwen3.8-27b-vllm', 'gpt-oss-120b-vllm', 'llama-3.3-70b-vllm', 'taide-lx-8b-vllm', 'maas-assist-27b', 'qwen3-embedding-8b-vllm', 'embeddinggemma-300m-vllm', 'qwen3-coder-30b-a3b-vllm', 'qwen3.8-max', 'qwen3.7-plus', 'gpt-5', 'claude-sonnet-4.5', 'gemini-2.5-pro']) expect(MODEL_BY_ID[id], id).toBeDefined();
    expect([MODEL_BY_ID['qwen3.8-27b-vllm'].priceInput, MODEL_BY_ID['qwen3.8-27b-vllm'].priceOutput]).toEqual([0.2, 0.6]);
    // 新增的示意模型
    expect(MODEL_BY_ID['flux.1-schnell'].modality).toBe('image');
    expect(MODEL_BY_ID['flux.1-schnell'].unitType).toBe('per_image');
    expect(MODEL_BY_ID['kling-v2.5'].unitType).toBe('per_second');
    expect(MODEL_BY_ID['whisper-large-v3'].unitType).toBe('per_minute');
    expect(MODEL_BY_ID['minimax-speech-2.6'].modality).toBe('audio');
    // 閉源代理：目錄保存供應商牌價；向客戶 = 牌價 × (1 − 10% 代理折扣)（所有閉源／夥伴供應商預設）、需簽約
    const g51 = MODEL_BY_ID['gpt-5.1'];
    expect(g51.proxyDiscountPct).toBeUndefined(); // 未個別覆寫 → 採「定價參數」的代理折扣（示意 10%）
    expect(g51.priceInput).toBe(1.25);
    expect(g51.marketRefUsd).toMatchObject({ input: 1.25, output: 10 });
    expect(g51.badges).toContain('proxy-discount');
    expect(g51.badges).toContain('contract-required');
    expect(g51.origin).toBe('us');
    const s2 = fresh();
    expect(s2.customerUnitPrice(g51).input).toBeCloseTo(1.25 * 0.9, 4);
    expect(MODEL_BY_ID['claude-sonnet-4.5'].badges).toContain('proxy-discount');
    expect(MODEL_BY_ID['kling-v2.5'].badges).toContain('proxy-discount');
    expect(MODEL_BY_ID['qwen3.7-plus'].proxyDiscountPct).toBeUndefined();
    expect(s2.customerUnitPrice(MODEL_BY_ID['qwen3.7-plus']).input).toBeCloseTo(MODEL_BY_ID['qwen3.7-plus'].priceInput * 1.15, 4);
    expect(TEXT_MODELS.every((m) => m.unitType === 'per_1m_tokens' && m.modality !== 'embedding' && m.modality !== 'rerank')).toBe(true);
    expect(TEXT_MODELS.some((m) => m.id === 'flux.1-schnell')).toBe(false);
    expect(MODELS.filter((m) => m.deployable).every((m) => m.unitType === 'per_1m_tokens')).toBe(true);
    // 徽章推導：自建 + 非中國來源 → 公部門可用；自建 Qwen 不是
    expect(MODEL_BY_ID['gpt-oss-120b-vllm'].badges).toContain('gov-ok');
    expect(MODEL_BY_ID['gpt-oss-120b-vllm'].badges).toContain('int4');
    expect(MODEL_BY_ID['qwen3.8-27b-vllm'].badges).not.toContain('gov-ok');
    expect(MODEL_BY_ID['qwen3.8-27b-vllm'].badges).toContain('fp8');
    expect(MODEL_BY_ID['qwen3.8-27b-vllm'].badges).toContain('hot');
    expect(MODEL_BY_ID['taide-lx-8b-vllm'].toolCalling).toBe(false);
    expect(MODEL_BY_ID['qwen3.8-27b-vllm'].toolCalling).toBe(true);
    // 衍生模型來源地隨基底
    expect(originOfModel(MODEL_BY_ID['maas-assist-27b'], MODEL_BY_ID)).toBe('cn');
    const w = withHubFields({ ...MODEL_BY_ID['taide-lx-8b-vllm'], capabilities: ['embedding'], modality: undefined, unitType: undefined, badges: undefined, toolCalling: undefined } as never);
    expect(w.modality).toBe('embedding');
  });

  it('listHubModels：平台角色見完整目錄（排除 0）；公部門客戶看不到任何中國來源（含基底）；星耀標示方案允許清單；客戶財務（無 model.read）403', async () => {
    const s = fresh();
    const owner = await s.listHubModels(OWNER);
    expect(owner.ok).toBe(true);
    if (owner.ok) {
      expect(owner.data.excluded.count).toBe(0);
      expect(owner.data.tenantName).toBeNull();
      expect(owner.data.localOnly).toBe(false);
      expect(owner.data.models.every((m) => m.allowedByPlan && !m.tierBlocked)).toBe(true);
      expect(owner.data.models.length).toBe(MODELS.filter((m) => m.status !== 'deprecated').length);
    }
    const gov = await s.listHubModels(GOV);
    expect(gov.ok).toBe(true);
    if (gov.ok) {
      expect(gov.data.tenantName).toContain('市政府');
      expect(gov.data.localOnly).toBe(true);
      expect(gov.data.excluded.origins).toEqual(['cn']);
      expect(gov.data.excluded.count).toBeGreaterThan(5);
      for (const m of gov.data.models) expect(originOfModel(m, MODEL_BY_ID), m.id).not.toBe('cn');
      const ids = gov.data.models.map((m) => m.id);
      expect(ids).not.toContain('qwen3.8-27b-vllm');
      expect(ids).not.toContain('maas-assist-27b');
      expect(ids).not.toContain('deepseek-v4');
      expect(ids).not.toContain('kling-v2.5');
      expect(ids).toContain('gpt-oss-120b-vllm');
      expect(ids).toContain('taide-lx-8b-vllm');
      // 雲端代理模型對僅自建租戶標示需合約變更
      expect(gov.data.models.find((m) => m.id === 'gpt-5.1')?.tierBlocked).toBe(true);
      expect(gov.data.models.find((m) => m.id === 'gpt-oss-120b-vllm')?.tierBlocked).toBe(false);
    }
    const star = await s.listHubModels(STAR);
    expect(star.ok).toBe(true);
    if (star.ok) {
      expect(star.data.excluded.count).toBe(0);
      expect(star.data.localOnly).toBe(false);
      expect(star.data.models.find((m) => m.id === 'qwen3.8-27b-vllm')?.allowedByPlan).toBe(true);
      expect(star.data.models.find((m) => m.id === 'qwen3.7-plus')?.allowedByPlan).toBe(true); // 經別名 qwen-plus 的溢出目標
      expect(star.data.models.find((m) => m.id === 'maas-assist-27b')?.allowedByPlan).toBe(false);
      expect(star.data.models.find((m) => m.id === 'kling-v2.5')?.allowedByPlan).toBe(false);
    }
    const billing = await s.listHubModels(as('u-billing-union'));
    expect(!billing.ok && billing.status).toBe(403);
  });

  it('Playground：圖像／語音模型回傳模擬產物卡（每張／每分鐘計價 + 加價，不串流 tokens）；嵌入 400；未簽同意的合作夥伴區域 400 TIER_NOT_ALLOWED；公部門呼叫 FLUX（歐盟來源但雲端）→ TIER_NOT_ALLOWED', async () => {
    const s = fresh();
    s.options.simulateLocalExhausted = false;
    const base = { tenantId: 't-star', projectId: 'p-cs-bot', system: '', messages: [{ role: 'user' as const, content: '台北 101 的水彩畫' }], temperature: 0.7, maxTokens: 256, enableThinking: false };
    const img = await s.invokePlayground(STAR, { ...base, modelId: 'flux.1-schnell' });
    expect(img.ok, JSON.stringify(img)).toBe(true);
    if (img.ok) {
      expect(img.data.media?.kind).toBe('image');
      expect(img.data.media?.endpoint).toBe('/images/generations');
      expect(img.data.media?.units).toBe(1);
      expect(img.data.tokens).toEqual([]);
      expect(img.data.inputTokens).toBe(0);
      expect(img.data.estimatedCostUsd).toBeCloseTo(0.004 * 1.15, 6);
      expect(img.data.headers['x-maas-tier']).toBe('external');
      expect(img.data.headers['x-maas-unit']).toBe('per_image');
      expect(img.data.curl).toContain('/images/generations');
    }
    const asr = await s.invokePlayground(STAR, { ...base, modelId: 'whisper-large-v3' });
    expect(asr.ok).toBe(true);
    if (asr.ok) {
      expect(asr.data.media?.kind).toBe('audio');
      expect(asr.data.media?.endpoint).toBe('/audio/transcriptions');
      expect(asr.data.media?.unitLabel).toBe('每分鐘音訊');
    }
    const emb = await s.invokePlayground(STAR, { ...base, modelId: 'qwen3-embedding-8b-vllm' });
    expect(!emb.ok && emb.status).toBe(400);
    // Kling（合作夥伴 partner-global）：星耀方案未列入 → MODEL_NOT_ALLOWED；聯合金融列入但未簽署該區域跨境同意 → 視同僅自建
    const klingStar = await s.invokePlayground(STAR, { ...base, modelId: 'kling-v2.5' });
    expect(!klingStar.ok && klingStar.code).toBe('MODEL_NOT_ALLOWED');
    const kling = await s.invokePlayground(as('u-admin-union'), { ...base, tenantId: 't-union', projectId: 'p-advisor', modelId: 'kling-v2.5' });
    expect(!kling.ok && kling.code).toBe('TIER_NOT_ALLOWED');
    if (!kling.ok) expect(kling.headers?.['x-maas-policy']).toBe('no_cross_border_consent');
    const govImg = await s.invokePlayground(GOV, { ...base, tenantId: 't-gov', projectId: 'p-gov-qa', modelId: 'flux.1-schnell' });
    expect(!govImg.ok && govImg.code).toBe('TIER_NOT_ALLOWED');
    // 文字模型仍為串流
    const txt = await s.invokePlayground(STAR, { ...base, modelId: 'qwen3.8-27b-vllm' });
    expect(txt.ok && txt.data.media).toBeUndefined();
    expect(txt.ok && txt.data.tokens.length).toBeGreaterThan(10);
  });
});

describe('申請測試（Testing Questionnaire）', () => {
  it('trial.review 是平台層動作：擁有者與平台財務有、客戶角色無', () => {
    expect(PLATFORM_ONLY_ACTIONS).toContain('trial.review');
    expect(ROLES['platform-owner'].actions).toContain('trial.review');
    expect(ROLES.finance.actions).toContain('trial.review');
    for (const r of ['tenant-admin', 'access-admin', 'project-operator', 'viewer', 'auditor', 'billing-reader', 'inference-caller', 'cluster-operator'] as const) expect(ROLES[r].actions, r).not.toContain('trial.review');
  });

  it('公開送出：驗證帳號格式、模型在目錄、情境、Email、公司；成功 → pending、寫入稽核 actor=public；同一 Email 最多 3 筆待審；同帳號名稱重複 409', async () => {
    const s = fresh();
    expect((await s.submitTrialRequest(trialInput({ accountName: 'Bad Name!' }))).ok).toBe(false);
    expect((await s.submitTrialRequest(trialInput({ models: [] }))).ok).toBe(false);
    expect((await s.submitTrialRequest(trialInput({ models: [{ modelId: 'nope', rpm: 1, tpm: 1, ttftMs: 1, cacheHitPct: 1 }] }))).ok).toBe(false);
    expect((await s.submitTrialRequest(trialInput({ models: [{ modelId: 'qwen3.8-27b-vllm', rpm: 1, tpm: 1, ttftMs: 1, cacheHitPct: 120 }] }))).ok).toBe(false);
    expect((await s.submitTrialRequest(trialInput({ scenarios: [] }))).ok).toBe(false);
    expect((await s.submitTrialRequest(trialInput({ email: 'not-an-email' }))).ok).toBe(false);
    expect((await s.submitTrialRequest(trialInput({ company: ' ' }))).ok).toBe(false);
    expect((await s.submitTrialRequest(trialInput({ useCase: 'other', useCaseOther: '' }))).ok).toBe(false);
    expect((await s.submitTrialRequest(trialInput({ contactName: '' }))).ok).toBe(false);
    const ok = await s.submitTrialRequest(trialInput());
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.data.status).toBe('pending');
      expect(ok.data.freeCreditUsd).toBe(TRIAL_TERMS.freeCreditUsd);
      expect(ok.data.id).toMatch(/^trial-acme-eval-x-/);
      expect(ok.data.dataResidencyTw).toBe(true);
    }
    expect(auditOf(s).some((e) => e.action === 'trial.submit' && e.actorId === 'public' && e.decision === 'allow')).toBe(true);
    // 送出不建立租戶（種子 4 個：星耀、聯合、公部門、ACME 試用）
    const tenants = await s.listTenants(OWNER);
    expect(tenants.ok && tenants.data.length).toBe(4);
    // 同帳號名稱重複 → 409
    const dup = await s.submitTrialRequest(trialInput());
    expect(!dup.ok && dup.status).toBe(409);
    // 同一 Email 最多 3 筆待審
    expect((await s.submitTrialRequest(trialInput({ accountName: 'acme-eval-2' }))).ok).toBe(true);
    expect((await s.submitTrialRequest(trialInput({ accountName: 'acme-eval-3' }))).ok).toBe(true);
    const fourth = await s.submitTrialRequest(trialInput({ accountName: 'acme-eval-4' }));
    expect(!fourth.ok && fourth.status).toBe(429);
  });

  it('佇列與審核：客戶角色 403（含直接呼叫核准／拒絕）；擁有者核准 → 建立試用租戶（payg、預算 = 免費額度、資料留台 → 僅自建、雲端模型剔除、+3 個工作天）並稽核；重複核准 409；平台財務可拒絕（需原因）', async () => {
    const s = fresh();
    const a = await s.submitTrialRequest(trialInput());
    const b = await s.submitTrialRequest(trialInput({ accountName: 'city-eval', publicSector: true, dataResidencyTw: false, company: '示範市立圖書館', companyShort: '市圖', email: 'lib@gov.example', models: [{ modelId: 'qwen3.8-27b-vllm', rpm: 10, tpm: 10_000, ttftMs: 1000, cacheHitPct: 0 }, { modelId: 'gpt-oss-120b-vllm', rpm: 30, tpm: 50_000, ttftMs: 1000, cacheHitPct: 10 }] }));
    const c = await s.submitTrialRequest(trialInput({ accountName: 'reject-me', email: 'r@x.example' }));
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (!a.ok || !b.ok || !c.ok) return;

    // 客戶角色 403
    const list403 = await s.listTrialRequests(STAR);
    expect(!list403.ok && list403.status).toBe(403);
    const approve403 = await s.approveTrialRequest(STAR, a.data.id);
    expect(!approve403.ok && approve403.status).toBe(403);
    const reject403 = await s.rejectTrialRequest(as('u-iam-star'), a.data.id, 'x');
    expect(!reject403.ok && reject403.status).toBe(403);
    const ops403 = await s.listTrialRequests(as('u-cluster-ops'));
    expect(!ops403.ok && ops403.status).toBe(403);
    expect(auditOf(s).filter((e) => e.action === 'trial.review' && e.decision === 'deny').length).toBeGreaterThanOrEqual(2);

    // 平台角色可見：3 筆新送出 + 2 筆種子（ACME 已核准、市圖待審）
    const list = await s.listTrialRequests(FIN);
    expect(list.ok && list.data.length).toBe(5);
    expect(list.ok && list.data.filter((t) => t.status === 'pending').length).toBe(4);
    expect(list.ok && list.data.find((t) => t.id === 'trial-acme-eval-seed')?.tenantId).toBe('t-acme-trial');

    // 擁有者核准 a（資料留台 → 僅自建；gpt-5.1 被剔除）
    const approved = await s.approveTrialRequest(OWNER, a.data.id);
    expect(approved.ok, JSON.stringify(approved)).toBe(true);
    if (approved.ok) {
      const { tenant, request, droppedModels, nextSteps } = approved.data;
      expect(tenant.plan).toBe('payg');
      expect(tenant.billingMode).toBe('prepaid');
      expect(tenant.credits?.balanceUsd).toBe(TRIAL_TERMS.freeCreditUsd);
      expect(tenant.credits?.trial?.grantedUsd).toBe(TRIAL_TERMS.freeCreditUsd);
      expect(tenant.retention).toBe('30d');
      expect(tenant.quotas.monthlyBudgetUsd).toBe(TRIAL_TERMS.freeCreditUsd);
      expect(tenant.allowedTiers).toBe('local');
      expect(tenant.dataClass).toBe('sensitive');
      expect(tenant.allowedModels).toEqual(['qwen3.8-27b-vllm']);
      expect(tenant.costCenter).toBe('TRIAL-acme-eval-x');
      expect(tenant.billingContact.email).toBe('eval@acme.example');
      expect(droppedModels.map((d) => d.modelId)).toEqual(['gpt-5.1']);
      expect(request.status).toBe('approved');
      expect(request.tenantId).toBe(tenant.id);
      expect(request.defaultProjectId).toBeTruthy();
      expect(request.trialEndsAt).toBeTruthy();
      const ends = new Date(request.trialEndsAt!);
      expect(ends.getTime()).toBeGreaterThan(Date.now() + 2 * 86_400_000);
      expect(ends.getTime()).toBeLessThan(Date.now() + 6 * 86_400_000);
      expect([0, 6]).not.toContain(ends.getDay());
      expect(nextSteps.some((n) => n.includes('API 金鑰'))).toBe(true);
      // 租戶出現在清單；稽核含 tenant.create 與 trial.review
      const tenants = await s.listTenants(OWNER);
      expect(tenants.ok && tenants.data.some((t) => t.id === tenant.id)).toBe(true);
      expect(auditOf(s).some((e) => e.action === 'trial.review' && e.decision === 'allow' && e.resourceId === a.data.id)).toBe(true);
      expect(auditOf(s).some((e) => e.action === 'tenant.create' && e.decision === 'allow')).toBe(true);
    }
    // 重複核准 → 409
    const again = await s.approveTrialRequest(OWNER, a.data.id);
    expect(!again.ok && again.status).toBe(409);

    // 公部門 b：平台財務核准 → 公部門資料分級、排除 cn、Qwen 剔除、gpt-oss 保留
    const gov = await s.approveTrialRequest(FIN, b.data.id, '規格可服務');
    expect(gov.ok, JSON.stringify(gov)).toBe(true);
    if (gov.ok) {
      expect(gov.data.tenant.dataClass).toBe('public-sector');
      expect(gov.data.tenant.retention).toBe('zero');
      expect(gov.data.tenant.excludeOrigins).toEqual(['cn']);
      expect(gov.data.tenant.allowedTiers).toBe('local');
      expect(gov.data.tenant.allowedModels).toEqual(['gpt-oss-120b-vllm']);
      expect(gov.data.droppedModels[0].modelId).toBe('qwen3.8-27b-vllm');
      expect(gov.data.droppedModels[0].reason).toContain('公部門');
      expect(gov.data.request.reviewNote).toBe('規格可服務');
    }

    // 拒絕 c：需原因
    const noReason = await s.rejectTrialRequest(FIN, c.data.id, '  ');
    expect(!noReason.ok && noReason.status).toBe(400);
    const rejected = await s.rejectTrialRequest(FIN, c.data.id, 'TTFT 要求超出共用部署承諾');
    expect(rejected.ok && rejected.data.status).toBe('rejected');
    expect(rejected.ok && rejected.data.reviewNote).toContain('TTFT');
    const after = await s.listTrialRequests(OWNER);
    expect(after.ok && after.data.map((t) => t.status).sort()).toEqual(['approved', 'approved', 'approved', 'pending', 'rejected']);
    const missing = await s.approveTrialRequest(OWNER, 'trial-nope');
    expect(!missing.ok && missing.status).toBe(404);
  });
});
