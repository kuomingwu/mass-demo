// 商業模型（One API token 事業）：預付儲值與 402、儲值 RBAC／稽核、限流層級、快取讀寫計價、代理閉源／開放毛利、零留存標頭、試用漏斗
import { describe, expect, it } from 'vitest';
import { MockServer } from '../api';
import { MODEL_BY_ID } from '../../data/models';
import { RATE_LIMIT_TIERS, SLA_TERMS, customerPriceFactor, nextTier, proxiedPriceView, proxyKindOf, tierForSpend, vendorCostFactor } from '../../data/commercial';
import { ROLES } from '../../auth/roles';

const fresh = () => new MockServer({ latency: [0, 0], agentConnectMs: 0, deploymentReadyMs: 0, drainMs: 0 });
const as = (userId: string) => ({ userId });
const OWNER = as('u-owner');
const FIN = as('u-finance');
const OPS = as('u-cluster-ops');
const GOV = as('u-admin-gov');
const ACME = as('u-admin-acme');
const STAR = as('u-admin-star');
const pg = (over: Partial<Parameters<MockServer['invokePlayground']>[1]> = {}) => ({ tenantId: 't-acme-trial', projectId: 'p-acme-trial-default', modelId: 'qwen3.8-27b-vllm', system: '', messages: [{ role: 'user' as const, content: 'hi' }], temperature: 0.5, maxTokens: 64, enableThinking: false, ...over });

describe('限流層級（GMI 式）', () => {
  it('依累計消費自動升級：Tier 0 1M → Tier 1 3M（≥ 50）→ Tier 2 50M（≥ 500）→ Tier 3 100M（≥ 1,000）→ Tier 4 300M（合約）', () => {
    expect(RATE_LIMIT_TIERS.map((t) => t.tpm)).toEqual([1_000_000, 3_000_000, 50_000_000, 100_000_000, 300_000_000]);
    expect(tierForSpend(0, false).level).toBe(0);
    expect(tierForSpend(49.99, false).level).toBe(0);
    expect(tierForSpend(50, false).level).toBe(1);
    expect(tierForSpend(500, false).level).toBe(2);
    expect(tierForSpend(1000, false).level).toBe(3);
    expect(tierForSpend(1_000_000, false).level).toBe(3); // 不會自動升到合約層
    expect(tierForSpend(0, true).level).toBe(4);
    expect(nextTier(RATE_LIMIT_TIERS[0])?.level).toBe(1);
    expect(nextTier(RATE_LIMIT_TIERS[3])).toBeNull();
  });

  it('伺服器端計算：試用 ACME Tier 0、公部門（預付，累計 > US$1,000）Tier 3、星耀／聯合（月結合約）Tier 4；客戶只能看自己的帳戶（跨租戶 403）', async () => {
    const s = fresh();
    const acme = await s.getTenantAccount(ACME, 't-acme-trial');
    expect(acme.ok, JSON.stringify(acme)).toBe(true);
    if (acme.ok) {
      expect(acme.data.tier.current.level).toBe(0);
      expect(acme.data.tier.next?.level).toBe(1);
      expect(acme.data.tier.toNextUsd).toBe(50);
      expect(acme.data.billingMode).toBe('prepaid');
      expect(acme.data.credits?.trial?.grantedUsd).toBe(20);
    }
    const gov = await s.getTenantAccount(GOV, 't-gov');
    expect(gov.ok && gov.data.tier.current.level).toBe(3);
    expect(gov.ok && gov.data.tier.cumulativeSpendUsd).toBeGreaterThan(1000);
    const star = await s.getTenantAccount(STAR, 't-star');
    expect(star.ok && star.data.tier.current.level).toBe(4);
    expect(star.ok && star.data.tier.contract).toBe(true);
    expect(star.ok && star.data.credits).toBeNull();
    const cross = await s.getTenantAccount(STAR, 't-gov');
    expect(!cross.ok && cross.status).toBe(403);
    const fin = await s.getTenantAccount(FIN, 't-gov');
    expect(fin.ok).toBe(true);
    const ops = await s.getTenantAccount(OPS, 't-gov');
    expect(!ops.ok && ops.status).toBe(403);
  });
});

describe('預付儲值與 402', () => {
  it('可用餘額 = 總帳 − 本月至今扣抵（＝對帳單合計）；公部門 4,000 − 11 月用量；試用 20 − 0；星耀月結無餘額', async () => {
    const s = fresh();
    const gov = await s.getTenantAccount(GOV, 't-gov');
    const st = await s.getBillingStatement(GOV, 't-gov', '2026-11');
    expect(gov.ok && st.ok).toBe(true);
    if (!gov.ok || !st.ok) return;
    expect(gov.data.credits?.balanceUsd).toBe(4000);
    expect(gov.data.credits?.monthSpendUsd).toBeCloseTo(st.data.charges.totalUsd, 2);
    expect(gov.data.credits?.availableUsd).toBeCloseTo(4000 - st.data.charges.totalUsd, 2);
    expect(gov.data.credits?.availableUsd).toBeGreaterThan(0);
    expect(st.data.credits?.availableUsd).toBeCloseTo(gov.data.credits!.availableUsd, 2);
    expect(st.data.billingMode).toBe('prepaid');
    expect(gov.data.credits?.monthTopupsUsd).toBe(2000);
    const acme = await s.getTenantAccount(ACME, 't-acme-trial');
    expect(acme.ok && acme.data.credits?.availableUsd).toBe(20);
    expect(acme.ok && acme.data.credits?.lowBalance).toBe(true); // 20 ≤ 預設門檻 100
    const star = await s.getBillingStatement(STAR, 't-star', '2026-11');
    expect(star.ok && star.data.credits).toBeNull();
  });

  it('Playground：預付餘額 > 0 可呼叫並帶 x-maas-balance；餘額耗盡 → 402 INSUFFICIENT_CREDITS 並稽核；儲值後恢復；月結租戶 x-maas-balance: postpaid', async () => {
    const s = fresh();
    const ok = await s.invokePlayground(ACME, pg());
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
    if (ok.ok) expect(ok.data.headers['x-maas-balance']).toBe('20.00');
    // 把試用租戶的總帳餘額歸零（模擬扣抵用盡）
    const tenants = (s as unknown as { tenants: { id: string; credits?: { balanceUsd: number } }[] }).tenants;
    tenants.find((t) => t.id === 't-acme-trial')!.credits!.balanceUsd = 0;
    const broke = await s.invokePlayground(ACME, pg());
    expect(broke.ok).toBe(false);
    if (!broke.ok) {
      expect(broke.status).toBe(402);
      expect(broke.code).toBe('INSUFFICIENT_CREDITS');
      expect(broke.headers?.['x-maas-balance']).toBe('0.00');
      expect(broke.headers?.['x-maas-retention']).toBe('30d');
    }
    expect(s.audit.all().some((e) => e.action === 'playground.invoke' && e.decision === 'deny' && (e.reason ?? '').includes('INSUFFICIENT_CREDITS'))).toBe(true);
    const topped = await s.topUpCredits(ACME, 't-acme-trial', 50);
    expect(topped.ok).toBe(true);
    const again = await s.invokePlayground(ACME, pg());
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.data.headers['x-maas-balance']).toBe('50.00');
    const star = await s.invokePlayground(STAR, pg({ tenantId: 't-star', projectId: 'p-cs-bot' }));
    expect(star.ok && star.data.headers['x-maas-balance']).toBe('postpaid');
  });

  it('儲值：US$10–10,000；需 billing.topup（客戶管理員／客戶財務／我們的擁有者／財務；檢視者、平台營運 403）；月結租戶 409 NOT_PREPAID；寫入稽核前後餘額；試用儲值後計入付費轉換', async () => {
    const s = fresh();
    expect(ROLES['tenant-admin'].actions).toContain('billing.topup');
    expect(ROLES['billing-reader'].actions).toContain('billing.topup');
    expect(ROLES.finance.actions).toContain('billing.topup');
    expect(ROLES.viewer.actions).not.toContain('billing.topup');
    expect(ROLES['cluster-operator'].actions).not.toContain('billing.topup');
    expect((await s.topUpCredits(ACME, 't-acme-trial', 5)).ok).toBe(false);
    expect((await s.topUpCredits(ACME, 't-acme-trial', 10_001)).ok).toBe(false);
    expect((await s.topUpCredits(ACME, 't-acme-trial', Number.NaN)).ok).toBe(false);
    const viewer = await s.topUpCredits(as('u-viewer-star'), 't-gov', 100);
    expect(!viewer.ok && viewer.status).toBe(403);
    const ops = await s.topUpCredits(OPS, 't-gov', 100);
    expect(!ops.ok && ops.status).toBe(403);
    const cross = await s.topUpCredits(ACME, 't-gov', 100);
    expect(!cross.ok && cross.status).toBe(403);
    const postpaid = await s.topUpCredits(STAR, 't-star', 100);
    expect(!postpaid.ok && postpaid.code).toBe('NOT_PREPAID');
    const before = await s.getOverview(OWNER);
    expect(before.ok && before.data.vendor?.trialFunnel.converted).toBe(0);
    const ok = await s.topUpCredits(ACME, 't-acme-trial', 100);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.data.account.credits?.balanceUsd).toBe(120);
      expect(ok.data.account.credits?.availableUsd).toBe(120);
      expect(ok.data.account.credits?.lowBalance).toBe(false);
      expect(ok.data.record.kind).toBe('topup');
    }
    const ev = s.audit.all().find((e) => e.action === 'billing.topup' && e.decision === 'allow' && e.actorId === 'u-admin-acme');
    expect(ev).toBeDefined();
    expect((ev?.before as { balanceUsd: number }).balanceUsd).toBe(20);
    expect((ev?.after as { balanceUsd: number }).balanceUsd).toBe(120);
    expect(ev?.scope).toBe('/tenants/t-acme-trial');
    const after = await s.getOverview(OWNER);
    expect(after.ok && after.data.vendor?.trialFunnel.converted).toBe(1);
    expect(after.ok && after.data.revenue?.prepaidTopupsUsd).toBeCloseTo(2120, 2);
    // 客戶財務（聯合金融）：月結 → 409；我們的財務替公部門登錄儲值 → 允許
    const unionFin = await s.topUpCredits(as('u-billing-union'), 't-union', 100);
    expect(!unionFin.ok && unionFin.code).toBe('NOT_PREPAID');
    const finGov = await s.topUpCredits(FIN, 't-gov', 500);
    expect(finGov.ok && finGov.data.account.credits?.balanceUsd).toBe(4500);
  });

  it('新增租戶：隨用隨付預設預付（可設初始儲值）、承諾／專屬預設月結（不可設初始儲值）；公部門零留存', async () => {
    const s = fresh();
    const base = { dataClass: 'general' as const, quotas: { rpm: 10, tpm: 1000, monthlyBudgetUsd: 100 }, costCenter: 'c', billingContact: { name: 'n', email: 'a@b.co' } };
    const payg = await s.createTenant(OWNER, { ...base, name: '預付客戶', plan: 'payg', initialCreditUsd: 300 });
    expect(payg.ok && payg.data.billingMode).toBe('prepaid');
    expect(payg.ok && payg.data.credits?.balanceUsd).toBe(300);
    expect(payg.ok && payg.data.retention).toBe('30d');
    const ded = await s.createTenant(OWNER, { ...base, name: '專屬客戶', plan: 'dedicated' });
    expect(ded.ok && ded.data.billingMode).toBe('postpaid');
    expect(ded.ok && ded.data.credits).toBeUndefined();
    const bad = await s.createTenant(OWNER, { ...base, name: '月結不可儲值', plan: 'dedicated', initialCreditUsd: 10 });
    expect(!bad.ok && bad.status).toBe(400);
    const gov = await s.createTenant(OWNER, { ...base, name: '公部門新客戶', plan: 'payg', dataClass: 'public-sector' });
    expect(gov.ok && gov.data.retention).toBe('zero');
    if (payg.ok) {
      const acct = await s.getTenantAccount(OWNER, payg.data.id);
      expect(acct.ok && acct.data.credits?.availableUsd).toBe(300);
      expect(acct.ok && acct.data.tier.current.level).toBe(0);
    }
  });
});

describe('快取讀寫計價與代理模型價格政策', () => {
  it('供應類型：vllm 自建；bailian 代理開放；openai／anthropic／google／partner 代理閉源。客戶係數：開放 1.15、閉源 0.9；成本係數：開放 1、閉源 0.85', () => {
    const policy = { cloudMarkupPct: 15, proxyDiscountPct: 10, negotiatedDiscountPct: 15 };
    expect(proxyKindOf(MODEL_BY_ID['qwen3.8-27b-vllm'])).toBe('self-hosted');
    expect(proxyKindOf(MODEL_BY_ID['qwen3.7-plus'])).toBe('proxied-open');
    expect(proxyKindOf(MODEL_BY_ID['gpt-5.1'])).toBe('proxied-closed');
    expect(proxyKindOf(MODEL_BY_ID['kling-v2.5'])).toBe('proxied-closed');
    expect(customerPriceFactor(MODEL_BY_ID['qwen3.7-plus'], policy)).toBeCloseTo(1.15, 9);
    expect(customerPriceFactor(MODEL_BY_ID['gpt-5.1'], policy)).toBeCloseTo(0.9, 9);
    expect(vendorCostFactor(MODEL_BY_ID['qwen3.7-plus'], policy)).toBe(1);
    expect(vendorCostFactor(MODEL_BY_ID['gpt-5.1'], policy)).toBeCloseTo(0.85, 9);
    const v = proxiedPriceView(MODEL_BY_ID['gpt-5.1'], policy);
    expect(v).toMatchObject({ kind: 'proxied-closed', listInput: 1.25, listOutput: 10, ourInput: 1.125, ourOutput: 9, costInput: 1.063, costOutput: 8.5 });
    expect(v.pctLabel).toContain('−10%');
  });

  it('對帳單代理列：閉源模型（Claude Haiku）向客戶 = 牌價 × 0.9、成本 = 牌價 × 0.85；開放模型（Qwen3.7-plus）= 牌價 × 1.15；平台成本 = 各模型成本合計', async () => {
    const s = fresh();
    const st = await s.getBillingStatement(STAR, 't-star', '2026-11');
    expect(st.ok).toBe(true);
    if (!st.ok) return;
    const c = st.data.charges.cloud;
    const haiku = c.byModel.find((m) => m.modelId === 'claude-haiku-4.5');
    const qwen = c.byModel.find((m) => m.modelId === 'qwen3.7-plus');
    expect(haiku?.kind).toBe('proxied-closed');
    expect(qwen?.kind).toBe('proxied-open');
    expect(haiku!.usd).toBeCloseTo(haiku!.listUsd * 0.9, 1);
    expect(haiku!.costUsd).toBeCloseTo(haiku!.listUsd * 0.85, 1);
    expect(qwen!.usd).toBeCloseTo(qwen!.listUsd * 1.15, 1);
    expect(qwen!.costUsd).toBeCloseTo(qwen!.listUsd, 1);
    expect(c.usd).toBeCloseTo(c.byModel.reduce((a, m) => a + m.usd, 0), 1);
    expect(c.costUsd).toBeCloseTo(c.byModel.reduce((a, m) => a + m.costUsd, 0), 1);
    expect(c.markupUsd).toBeCloseTo(c.byModel.filter((m) => m.kind === 'proxied-open').reduce((a, m) => a + m.usd - m.listUsd, 0), 1);
    expect(c.discountUsd).toBeCloseTo(c.byModel.filter((m) => m.kind === 'proxied-closed').reduce((a, m) => a + m.listUsd - m.usd, 0), 1);
    // 調整代理折扣與議價折扣後重算；Playground 的代理估算用同一政策
    const upd = await s.updateBillingSettings(FIN, { proxyDiscountPct: 20, negotiatedDiscountPct: 30 });
    expect(upd.ok).toBe(true);
    const st2 = await s.getBillingStatement(STAR, 't-star', '2026-11');
    const haiku2 = st2.ok ? st2.data.charges.cloud.byModel.find((m) => m.modelId === 'claude-haiku-4.5') : undefined;
    expect(haiku2!.usd).toBeCloseTo(haiku!.listUsd * 0.8, 1);
    expect(haiku2!.costUsd).toBeCloseTo(haiku!.listUsd * 0.7, 1);
    const rev = await s.getRevenue(FIN);
    expect(rev.ok && rev.data.proxiedClosed.marginPct).toBeCloseTo(((0.8 - 0.7) / 0.8) * 100, 0);
    const call = await s.invokePlayground(STAR, pg({ tenantId: 't-star', projectId: 'p-cs-bot', modelId: 'claude-haiku-4.5' }));
    expect(call.ok, JSON.stringify(call)).toBe(true);
    if (call.ok) {
      const list = (call.data.inputTokens / 1e6) * MODEL_BY_ID['claude-haiku-4.5'].priceInput + (call.data.outputTokens / 1e6) * MODEL_BY_ID['claude-haiku-4.5'].priceOutput;
      expect(call.data.estimatedCostUsd).toBeCloseTo(list * 0.8, 9);
      expect(call.data.headers['x-maas-tier']).toBe('external');
    }
  });

  it('CSV 與 usageCharge 使用同一政策：代理閉源列 = 牌價 × 0.9；自建列含快取讀寫', async () => {
    const s = fresh();
    const rows = await s.getUsage(OWNER, { tenantId: 't-star', modelId: 'claude-haiku-4.5' });
    expect(rows.ok && rows.data.length).toBeGreaterThan(0);
    if (rows.ok) for (const r of rows.data) expect(s.usageCharge(r).usd).toBeCloseTo(Math.round(r.costUsd * 0.9 * 100) / 100, 2);
    const local = await s.getUsage(OWNER, { tenantId: 't-star', modelId: 'qwen3.8-27b-vllm' });
    if (local.ok) for (const r of local.data) expect(s.usageCharge(r).usd).toBeCloseTo(Math.round(s.tokenCharge(r.modelId, r.inputTokens, r.cachedInputTokens, r.outputTokens, r.cacheWriteTokens) * 100) / 100, 2);
  });
});

describe('零留存與 SLA', () => {
  it('x-maas-retention：公部門 zero、星耀 30d；客戶管理員可切換（稽核 tenant.update）、檢視者 403、公部門不可改為 30d；專案層覆寫', async () => {
    const s = fresh();
    const gov = await s.invokePlayground(GOV, pg({ tenantId: 't-gov', projectId: 'p-gov-qa', modelId: 'gpt-oss-120b-vllm' }));
    expect(gov.ok && gov.data.headers['x-maas-retention']).toBe('zero');
    const star = await s.invokePlayground(STAR, pg({ tenantId: 't-star', projectId: 'p-cs-bot' }));
    expect(star.ok && star.data.headers['x-maas-retention']).toBe('30d');
    const denied = await s.updateTenantRetention(as('u-viewer-star'), 't-star', 'zero');
    expect(!denied.ok && denied.status).toBe(403);
    const ok = await s.updateTenantRetention(STAR, 't-star', 'zero');
    expect(ok.ok && ok.data.retention).toBe('zero');
    const after = await s.invokePlayground(STAR, pg({ tenantId: 't-star', projectId: 'p-cs-bot' }));
    expect(after.ok && after.data.headers['x-maas-retention']).toBe('zero');
    expect(s.audit.all().some((e) => e.action === 'tenant.update' && e.decision === 'allow' && (e.after as { retention: string })?.retention === 'zero')).toBe(true);
    const acct = await s.getTenantAccount(STAR, 't-star');
    expect(acct.ok && acct.data.retention).toBe('zero');
    const bad = await s.updateTenantRetention(OWNER, 't-gov', '30d');
    expect(!bad.ok && bad.status).toBe(400);
    const projects = (s as unknown as { projects: { id: string; retention?: string }[] }).projects;
    projects.find((p) => p.id === 'p-doc-rag')!.retention = '30d';
    const proj = await s.invokePlayground(STAR, pg({ tenantId: 't-star', projectId: 'p-doc-rag' }));
    expect(proj.ok && proj.data.headers['x-maas-retention']).toBe('30d');
  });

  it('SLA 常數：共用 99.9%、專屬 99.9% + 吞吐承諾、服務抵扣 10／25／100%', () => {
    expect(SLA_TERMS.shared.availabilityPct).toBe(99.9);
    expect(SLA_TERMS.dedicated.availabilityPct).toBe(99.9);
    expect(SLA_TERMS.dedicated.note).toContain('吞吐承諾');
    expect(SLA_TERMS.credits.map((c) => c.creditPct)).toEqual([10, 25, 100]);
  });
});

describe('試用漏斗與種子', () => {
  it('種子：2 筆試用申請（ACME 已核准 → t-acme-trial、市圖待審）；核准種子的試用租戶是預付 US$20、Tier 0；客戶角色 403', async () => {
    const s = fresh();
    const list = await s.listTrialRequests(OWNER);
    expect(list.ok && list.data.map((t) => t.status).sort()).toEqual(['approved', 'pending']);
    const denied = await s.listTrialRequests(ACME);
    expect(!denied.ok && denied.status).toBe(403);
    const ov = await s.getOverview(OWNER);
    expect(ov.ok && ov.data.vendor?.trialFunnel).toEqual({ submitted: 2, approved: 1, converted: 0 });
    // 核准待審的市圖 → 公部門預付試用租戶（零留存）；漏斗 approved 2
    const pending = list.ok ? list.data.find((t) => t.status === 'pending')! : undefined;
    const approved = await s.approveTrialRequest(FIN, pending!.id);
    expect(approved.ok, JSON.stringify(approved)).toBe(true);
    if (approved.ok) {
      expect(approved.data.tenant.billingMode).toBe('prepaid');
      expect(approved.data.tenant.credits?.balanceUsd).toBe(20);
      expect(approved.data.tenant.retention).toBe('zero');
      const acct = await s.getTenantAccount(OWNER, approved.data.tenant.id);
      expect(acct.ok && acct.data.tier.current.level).toBe(0);
      expect(acct.ok && acct.data.credits?.trial?.expired).toBe(false);
    }
    const ov2 = await s.getOverview(OWNER);
    expect(ov2.ok && ov2.data.vendor?.trialFunnel).toEqual({ submitted: 2, approved: 2, converted: 0 });
  });
});
