import { describe, it, expect } from 'vitest';
import { MockServer } from '../../server/api';
import { can } from '../policy';
import { isAncestorOrSelf, isValidScope, clusterScope, tenantIdOfScope } from '../scope';
import { ROLES, VENDOR_ROLES, PLATFORM_ONLY_ACTIONS } from '../roles';
import { USERS } from '../../server/seed';

const fresh = () => new MockServer({ latency: [0, 0] });
const as = (userId: string) => ({ userId });

const STAR = '/tenants/t-star';
const CS_BOT = '/tenants/t-star/projects/p-cs-bot';
const UNION_RISK = '/tenants/t-union/projects/p-risk';
const TPE_A = '/clusters/cl-tpe-a';

describe('範圍比對', () => {
  it('採分段式比對，不做子字串比對', () => {
    expect(isAncestorOrSelf('/tenants/t-star', '/tenants/t-star/projects/p-cs-bot')).toBe(true);
    expect(isAncestorOrSelf('/tenants/t-star', '/tenants/t-star2')).toBe(false);
    expect(isAncestorOrSelf('/tenants/t-star/projects/p-cs', '/tenants/t-star/projects/p-cs-bot')).toBe(false);
    expect(isAncestorOrSelf('/', '/tenants/t-union')).toBe(true);
    expect(isAncestorOrSelf('/', '/clusters/cl-tpe-a')).toBe(true);
    expect(isAncestorOrSelf('/tenants/t-star', '/clusters/cl-tpe-a')).toBe(false);
  });

  it('叢集範圍為平台層：/clusters/{c} 合法、不屬於任何租戶；/tenants/{t}/clusters/{c} 不再合法', () => {
    expect(isValidScope(clusterScope('cl-tpe-a'))).toBe(true);
    expect(tenantIdOfScope(TPE_A)).toBeNull();
    expect(isValidScope('/tenants/t-star/clusters/cl-tpe-a')).toBe(false);
    expect(isValidScope('/clusters')).toBe(false);
  });
});

describe('政策評估器 can()', () => {
  it('檢視者呼叫 key.create → 403 並預設拒絕', async () => {
    const s = fresh();
    const res = await s.createKey(as('u-viewer-star'), {
      tenantId: 't-star',
      projectId: 'p-cs-bot',
      name: 'x',
      allowedModels: ['qwen-plus'],
      rpmLimit: 10,
      tpmLimit: 1000,
      monthlyBudgetUsd: 10,
      expiresAt: null,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(403);
      expect(res.requestId).toMatch(/^req-/);
    }
  });

  it('專案操作員於所屬專案內可建立金鑰（直接指派）', async () => {
    const s = fresh();
    const op = s.authenticate(as('u-op-star'))!;
    const d = s.authorize(op, 'key.create', CS_BOT);
    expect(d.allowed).toBe(true);
    expect(d.source).toBe('direct');
    const res = await s.createKey(as('u-op-star'), {
      tenantId: 't-star',
      projectId: 'p-cs-bot',
      name: '測試金鑰',
      allowedModels: ['qwen-plus'],
      rpmLimit: 10,
      tpmLimit: 1000,
      monthlyBudgetUsd: 10,
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.plaintext.startsWith('sk-maas-')).toBe(true);
      expect(res.data.key.hash.startsWith('sha256:')).toBe(true);
    }
  });

  it('租戶層級授權會由子專案繼承', () => {
    const s = fresh();
    const admin = s.authenticate(as('u-admin-star'))!;
    const d = s.authorize(admin, 'key.create', CS_BOT);
    expect(d.allowed).toBe(true);
    expect(d.source).toBe('inherited');
    expect(d.grantedAtScope).toBe(STAR);
  });

  it('租戶 A 的授權不適用於租戶 B（租戶邊界獨立驗證）', () => {
    const s = fresh();
    const admin = s.authenticate(as('u-admin-star'))!;
    const d = s.authorize(admin, 'project.read', UNION_RISK);
    expect(d.allowed).toBe(false);
    expect(d.source).toBe('deny');
    expect(d.reason).toContain('租戶邊界');
  });

  it('客戶主體對平台層的叢集範圍一律預設拒絕（即使是客戶管理員）', () => {
    const s = fresh();
    for (const u of ['u-admin-star', 'u-admin-union', 'u-admin-gov', 'u-viewer-star', 'u-iam-star']) {
      const p = s.authenticate(as(u))!;
      expect(s.authorize(p, 'cluster.read', TPE_A).allowed, u).toBe(false);
      expect(s.authorize(p, 'cluster.register', '/').allowed, u).toBe(false);
      expect(s.authorize(p, 'deployment.manage', TPE_A).allowed, u).toBe(false);
      expect(s.authorize(p, 'tenant.create', '/').allowed, u).toBe(false);
      expect(s.authorize(p, 'billing.configure', '/').allowed, u).toBe(false);
    }
  });

  it('群組成員資格由可信來源解析並參與評估', () => {
    const s = fresh();
    const auditor = s.authenticate(as('u-audit-union'))!;
    expect(auditor.groupIds).toContain('g-union-audit');
    const d = can(auditor, 'audit.read', UNION_RISK, { assignments: [] });
    expect(d.allowed).toBe(false);
    const d2 = s.authorize(auditor, 'audit.read', UNION_RISK);
    expect(d2.allowed).toBe(true);
    expect(d2.reason).toContain('群組');
  });
});

describe('角色指派流程', () => {
  it('存取管理員不可直接指派客戶管理員 → 成為待核准', async () => {
    const s = fresh();
    const res = await s.createRoleAssignment(as('u-iam-star'), { principalId: 'u-viewer-star', roleId: 'tenant-admin', scope: STAR });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.outcome).toBe('pending');
      expect(res.data.assignment.status).toBe('pending');
    }
    // 待核准期間無有效存取
    const viewer = s.authenticate(as('u-viewer-star'))!;
    expect(s.authorize(viewer, 'key.create', CS_BOT).allowed).toBe(false);
  });

  it('申請者不可核准自己的請求；平台擁有者核准後才生效', async () => {
    const s = fresh();
    const created = await s.createRoleAssignment(as('u-iam-star'), { principalId: 'u-viewer-star', roleId: 'tenant-admin', scope: STAR });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.data.assignment.id;
    const self = await s.approveRequest(as('u-iam-star'), id);
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.status).toBe(403);
    const owner = await s.approveRequest(as('u-owner'), id);
    expect(owner.ok).toBe(true);
    const viewer = s.authenticate(as('u-viewer-star'))!;
    expect(s.authorize(viewer, 'key.create', CS_BOT).allowed).toBe(true);
  });

  it('自我提權遭拒', async () => {
    const s = fresh();
    const res = await s.createRoleAssignment(as('u-iam-star'), { principalId: 'u-iam-star', roleId: 'tenant-admin', scope: STAR });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(403);
      expect(res.code).toBe('SELF_ESCALATION');
    }
  });

  it('跨租戶授權遭拒；客戶主體不可被授予平台或叢集範圍', async () => {
    const s = fresh();
    const res = await s.createRoleAssignment(as('u-owner'), { principalId: 'u-op-union', roleId: 'viewer', scope: STAR });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('CROSS_TENANT');
    const platform = await s.createRoleAssignment(as('u-owner'), { principalId: 'u-admin-star', roleId: 'viewer', scope: '/' });
    expect(!platform.ok && platform.code).toBe('CROSS_TENANT');
    const cluster = await s.createRoleAssignment(as('u-owner'), { principalId: 'u-admin-star', roleId: 'viewer', scope: TPE_A });
    expect(!cluster.ok && cluster.code).toBe('CROSS_TENANT');
  });

  it('我們的角色（擁有者／營運／財務）只能指派於平台範圍', async () => {
    const s = fresh();
    expect(VENDOR_ROLES.sort()).toEqual(['cluster-operator', 'finance', 'platform-owner']);
    for (const roleId of VENDOR_ROLES) {
      const res = await s.createRoleAssignment(as('u-owner'), { principalId: 'u-cluster-ops', roleId, scope: TPE_A });
      expect(!res.ok && res.status, roleId).toBe(400);
    }
    const fin = await s.createRoleAssignment(as('u-owner'), { principalId: 'u-cluster-ops', roleId: 'finance', scope: '/' });
    expect(fin.ok).toBe(true);
  });

  it('未授權主體繞過 UI 直接呼叫 createRoleAssignment 仍被拒絕', async () => {
    const s = fresh();
    const res = await s.createRoleAssignment(as('u-viewer-star'), { principalId: 'u-viewer-star', roleId: 'viewer', scope: CS_BOT });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
    const op = await s.createRoleAssignment(as('u-op-star'), { principalId: 'u-viewer-star', roleId: 'viewer', scope: CS_BOT });
    expect(op.ok).toBe(false);
    const fin = await s.createRoleAssignment(as('u-finance'), { principalId: 'u-finance', roleId: 'platform-owner', scope: '/' });
    expect(!fin.ok && fin.status).toBe(403);
    const anon = await s.createRoleAssignment(as(''), { principalId: 'u-viewer-star', roleId: 'viewer', scope: CS_BOT });
    expect(anon.ok).toBe(false);
    if (!anon.ok) expect(anon.status).toBe(401);
  });

  it('存取管理員不可在委派範圍外指派', async () => {
    const s = fresh();
    const res = await s.createRoleAssignment(as('u-iam-star'), { principalId: 'u-owner', roleId: 'viewer', scope: '/' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });

  it('繼承的指派不可於子範圍刪除', async () => {
    const s = fresh();
    const res = await s.deleteRoleAssignment(as('u-admin-star'), 'ra-013', CS_BOT);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('INHERITED_ASSIGNMENT');
    const ok = await s.deleteRoleAssignment(as('u-admin-star'), 'ra-013', STAR);
    expect(ok.ok).toBe(true);
  });

  it('列出的指派標示繼承，且集合僅含授權範圍', async () => {
    const s = fresh();
    const list = await s.listRoleAssignments(as('u-op-star'), CS_BOT);
    expect(list.ok).toBe(true);
    if (list.ok) {
      const inherited = list.data.filter((a) => a.inherited);
      expect(inherited.some((a) => a.id === 'ra-010')).toBe(true);
      expect(list.data.find((a) => a.id === 'ra-011')?.inherited).toBe(false);
    }
    const denied = await s.listRoleAssignments(as('u-op-union'), '/tenants/t-union');
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.status).toBe(403);
  });
});

describe('我們的叢集／部署／層級政策', () => {
  const EXPIRY_30D = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const baseKey = { name: '測試', rpmLimit: 10, tpmLimit: 1000, monthlyBudgetUsd: 10, expiresAt: EXPIRY_30D };

  it('平台營運可建立部署，但不可指派角色、建立金鑰、新增租戶或改定價（403）', async () => {
    const s = fresh();
    s.options.deploymentReadyMs = 0;
    const dep = await s.createDeployment(as('u-cluster-ops'), {
      name: 'ops-test',
      modelId: 'qwen3.8-27b-vllm',
      clusterId: 'cl-tpe-a',
      sharing: 'shared',
      engine: 'vLLM',
      quantization: 'FP8',
      gpusPerReplica: 1,
      replicas: 1,
      maxNumSeqs: 128,
      priorityScheduling: true,
      cacheSaltByTenant: true,
      autoscaling: { minReplicas: 1, maxReplicas: 2, metric: 'queue-depth', scaleToZero: false },
      rollout: { strategy: 'canary', canaryPercent: 10 },
    });
    expect(dep.ok).toBe(true);
    const assign = await s.createRoleAssignment(as('u-cluster-ops'), { principalId: 'u-cluster-ops', roleId: 'platform-owner', scope: '/' });
    expect(!assign.ok && assign.status).toBe(403);
    const key = await s.createKey(as('u-cluster-ops'), { ...baseKey, tenantId: 't-star', projectId: 'p-cs-bot', allowedModels: ['qwen-plus'] });
    expect(!key.ok && key.status).toBe(403);
    const tenant = await s.createTenant(as('u-cluster-ops'), { name: 'x', plan: 'payg', dataClass: 'general', allowedTiers: 'both', quotas: { rpm: 1, tpm: 1, monthlyBudgetUsd: 1 }, costCenter: 'c', billingContact: { name: 'n', email: 'a@b.co' } });
    expect(!tenant.ok && tenant.status).toBe(403);
    const price = await s.updateBillingSettings(as('u-cluster-ops'), { cloudMarkupPct: 20 });
    expect(!price.ok && price.status).toBe(403);
  });

  it('檢視者／客戶管理員不可註冊叢集（403，且寫入拒絕稽核）；平台營運可在平台範圍註冊；客戶管理員不可操作節點', async () => {
    const s = fresh();
    s.options.agentConnectMs = 0;
    const input = { name: '測試機房', site: '台中', k8sVersion: 'v1.32.0', gpuType: 'H100 80GB', nodeCount: 1, gpusPerNode: 4, engine: 'vLLM' as const };
    const viewer = await s.registerCluster(as('u-viewer-star'), input);
    expect(viewer.ok).toBe(false);
    if (!viewer.ok) expect(viewer.status).toBe(403);
    expect(s.audit.all().some((e) => e.action === 'cluster.register' && e.decision === 'deny' && e.actorId === 'u-viewer-star')).toBe(true);
    const admin = await s.registerCluster(as('u-admin-star'), input);
    expect(!admin.ok && admin.status).toBe(403);
    const ops = await s.registerCluster(as('u-cluster-ops'), input);
    expect(ops.ok).toBe(true);
    const drain = await s.drainNode(as('u-admin-star'), 'n-tpe-a-02');
    expect(!drain.ok && drain.status).toBe(403);
  });

  it('公部門租戶的金鑰不可選用雲端 Qwen（400 TIER_NOT_ALLOWED，附法規依據）；中國來源的自建模型 → MODEL_NOT_ALLOWED；非中國來源可用', async () => {
    const s = fresh();
    const res = await s.createKey(as('u-admin-gov'), { ...baseKey, tenantId: 't-gov', projectId: 'p-gov-qa', allowedModels: ['qwen-plus'] });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(400);
      expect(res.code).toBe('TIER_NOT_ALLOWED');
      expect(res.message).toContain('行政院');
    }
    const cloudModel = await s.createKey(as('u-admin-gov'), { ...baseKey, tenantId: 't-gov', projectId: 'p-gov-qa', allowedModels: ['qwen3.7-plus'] });
    expect(cloudModel.ok).toBe(false);
    if (!cloudModel.ok) expect(cloudModel.code).toBe('TIER_NOT_ALLOWED');
    const cnLocal = await s.createKey(as('u-admin-gov'), { ...baseKey, tenantId: 't-gov', projectId: 'p-gov-qa', allowedModels: ['qwen3.8-27b-vllm'] });
    expect(!cnLocal.ok && cnLocal.code).toBe('MODEL_NOT_ALLOWED');
    const ok = await s.createKey(as('u-admin-gov'), { ...baseKey, tenantId: 't-gov', projectId: 'p-gov-qa', allowedModels: ['gov-chat', 'gpt-oss-120b-vllm', 'taide-lx-8b-vllm'] });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.data.key.tierRestriction).toBe('local');
  });

  it('金鑰到期 > 90 天被拒；未填到期被拒；臨時金鑰 > 1 小時被拒', async () => {
    const s = fresh();
    const tooLong = await s.createKey(as('u-owner'), { ...baseKey, tenantId: 't-star', projectId: 'p-cs-bot', allowedModels: ['qwen-plus'], expiresAt: new Date(Date.now() + 120 * 86_400_000).toISOString() });
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.code).toBe('KEY_EXPIRY_TOO_LONG');
    const missing = await s.createKey(as('u-owner'), { ...baseKey, tenantId: 't-star', projectId: 'p-cs-bot', allowedModels: ['qwen-plus'], expiresAt: null });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe('KEY_EXPIRY_REQUIRED');
    const eph = await s.createKey(as('u-owner'), { ...baseKey, tenantId: 't-star', projectId: 'p-cs-bot', allowedModels: ['qwen-plus'], ephemeral: true, expiresAt: new Date(Date.now() + 3 * 3_600_000).toISOString() });
    expect(eph.ok).toBe(false);
    if (!eph.ok) expect(eph.code).toBe('EPHEMERAL_TOO_LONG');
    const ephOk = await s.createKey(as('u-owner'), { ...baseKey, tenantId: 't-star', projectId: 'p-cs-bot', allowedModels: ['qwen-plus'], ephemeral: true, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() });
    expect(ephOk.ok).toBe(true);
    if (ephOk.ok) {
      expect(ephOk.data.key.ephemeral).toBe(true);
      expect(ephOk.data.key.hint).toMatch(/^sk-maas-[0-9a-f]{4}…/);
      expect(ephOk.data.plaintext.startsWith('sk-maas-')).toBe(true);
    }
  });

  it('僅自建租戶在自建容量耗盡時得到 429 local_capacity_exhausted（含 Retry-After）；自建優先租戶則溢出到雲端代理', async () => {
    const s = fresh();
    const input = { system: '', messages: [{ role: 'user' as const, content: 'hi' }], temperature: 0.5, maxTokens: 100, enableThinking: false };
    const before = await s.invokePlayground(as('u-owner'), { ...input, modelId: 'gpt-oss-120b-vllm', tenantId: 't-gov', projectId: 'p-gov-qa' });
    expect(before.ok).toBe(true);
    if (before.ok) expect(before.data.headers['x-maas-served-by']).toBe('local');
    s.options.simulateLocalExhausted = true;
    const gov = await s.invokePlayground(as('u-owner'), { ...input, modelId: 'gpt-oss-120b-vllm', tenantId: 't-gov', projectId: 'p-gov-qa' });
    expect(gov.ok).toBe(false);
    if (!gov.ok) {
      expect(gov.status).toBe(429);
      expect(gov.code).toBe('local_capacity_exhausted');
      expect(gov.retryAfterSec).toBeGreaterThan(0);
      expect(gov.headers?.['x-maas-policy']).toBe('local-only');
    }
    const star = await s.invokePlayground(as('u-owner'), { ...input, modelId: 'qwen3.8-27b-vllm', tenantId: 't-star', projectId: 'p-cs-bot' });
    expect(star.ok).toBe(true);
    if (star.ok) {
      expect(star.data.tier).toBe('spillover');
      expect(star.data.billingBasis).toBe('cloud');
      expect(star.data.headers['x-maas-served-by']).toBe('cloud');
      expect(star.data.headers['x-maas-spillover-from']).toBe('dep-qwen27b-shared');
      expect(star.data.headers['x-maas-tier']).toBe('spillover');
      expect(star.data.model.id).toBe('qwen3.7-plus');
    }
  });

  it('公部門租戶直接呼叫雲端模型 → 400 TIER_NOT_ALLOWED；呼叫中國來源自建模型 → 400 MODEL_NOT_ALLOWED', async () => {
    const s = fresh();
    const base = { tenantId: 't-gov', projectId: 'p-gov-qa', system: '', messages: [{ role: 'user' as const, content: 'hi' }], temperature: 0.5, maxTokens: 100, enableThinking: false };
    const res = await s.invokePlayground(as('u-admin-gov'), { ...base, modelId: 'qwen3.7-plus' });
    expect(!res.ok && res.code).toBe('TIER_NOT_ALLOWED');
    const cn = await s.invokePlayground(as('u-admin-gov'), { ...base, modelId: 'qwen3.8-27b-vllm' });
    expect(!cn.ok && cn.code).toBe('MODEL_NOT_ALLOWED');
  });

  it('角色矩陣：我們的角色在平台範圍持有叢集／部署／租戶建立／定價動作；客戶角色一律沒有平台層動作', () => {
    const s = fresh();
    const ops = s.authenticate(as('u-cluster-ops'))!;
    expect(s.authorize(ops, 'deployment.manage', '/clusters/cl-hc-b').allowed).toBe(true);
    expect(s.authorize(ops, 'cluster.register', '/').allowed).toBe(true);
    expect(s.authorize(ops, 'iam.assign', '/').allowed).toBe(false);
    expect(s.authorize(ops, 'key.create', CS_BOT).allowed).toBe(false);
    expect(s.authorize(ops, 'billing.configure', '/').allowed).toBe(false);
    const fin = s.authenticate(as('u-finance'))!;
    expect(s.authorize(fin, 'billing.configure', '/').allowed).toBe(true);
    expect(s.authorize(fin, 'billing.read', '/tenants/t-union').allowed).toBe(true);
    expect(s.authorize(fin, 'deployment.manage', TPE_A).allowed).toBe(false);
    expect(s.authorize(fin, 'tenant.create', '/').allowed).toBe(false);
    const admin = s.authenticate(as('u-admin-star'))!;
    expect(s.authorize(admin, 'deployment.read', STAR).allowed).toBe(true);
    expect(s.authorize(admin, 'billing.read', STAR).allowed).toBe(true);
    expect(s.authorize(admin, 'cluster.read', TPE_A).allowed).toBe(false);
    expect(s.authorize(admin, 'cluster.register', '/').allowed).toBe(false);
    for (const roleId of ['tenant-admin', 'project-operator', 'viewer', 'access-admin', 'auditor', 'billing-reader'] as const) {
      for (const action of PLATFORM_ONLY_ACTIONS) expect(ROLES[roleId].actions.includes(action), `${roleId} ${action}`).toBe(false);
    }
    expect(ROLES['platform-owner'].actions).toContain('tenant.create');
  });

  it('金鑰層級限制：僅自建金鑰不可選雲端別名；僅雲端金鑰不可選自建別名；僅自建租戶不可放寬為 both；限流與預算需為合理數值', async () => {
    const s = fresh();
    const star = { ...baseKey, tenantId: 't-star', projectId: 'p-cs-bot' };
    const localKeyCloudAlias = await s.createKey(as('u-admin-star'), { ...star, tierRestriction: 'local', allowedModels: ['fast-chat'] });
    expect(!localKeyCloudAlias.ok && localKeyCloudAlias.code).toBe('TIER_NOT_ALLOWED');
    const cloudKeyLocalAlias = await s.createKey(as('u-admin-star'), { ...star, tierRestriction: 'cloud', allowedModels: ['embedding-local'] });
    expect(!cloudKeyLocalAlias.ok && cloudKeyLocalAlias.code).toBe('TIER_NOT_ALLOWED');
    const bothOk = await s.createKey(as('u-admin-star'), { ...star, tierRestriction: 'both', allowedModels: ['qwen-plus', 'fast-chat', 'embedding-local'] });
    expect(bothOk.ok && bothOk.data.key.tierRestriction).toBe('both');
    const govWiden = await s.createKey(as('u-admin-gov'), { ...baseKey, tenantId: 't-gov', projectId: 'p-gov-qa', tierRestriction: 'both', allowedModels: ['gov-chat'] });
    expect(!govWiden.ok && govWiden.code).toBe('TIER_NOT_ALLOWED');
    const govDefault = await s.createKey(as('u-admin-gov'), { ...baseKey, tenantId: 't-gov', projectId: 'p-gov-qa', allowedModels: ['gov-chat'] });
    expect(govDefault.ok && govDefault.data.key.tierRestriction).toBe('local');
    const negativeBudget = await s.createKey(as('u-admin-star'), { ...star, allowedModels: ['qwen-plus'], monthlyBudgetUsd: -5 });
    expect(!negativeBudget.ok && negativeBudget.status).toBe(400);
    const zeroRpm = await s.createKey(as('u-admin-star'), { ...star, allowedModels: ['qwen-plus'], rpmLimit: 0 });
    expect(!zeroRpm.ok && zeroRpm.status).toBe(400);
    expect(s.audit.all().some((e) => e.action === 'key.create' && e.decision === 'deny' && e.actorId === 'u-admin-star' && (e.reason ?? '').includes('TIER_NOT_ALLOWED'))).toBe(true);
  });

  it('跨租戶讀取：金鑰清單只含自己租戶、撤銷他租戶金鑰 403、讀他租戶 404/403、部署清單依方案與來源地過濾', async () => {
    const s = fresh();
    const keys = await s.listKeys(as('u-admin-star'), { tenantId: 't-union' });
    expect(keys.ok && keys.data.length).toBe(0);
    const own = await s.listKeys(as('u-admin-star'));
    expect(own.ok && own.data.every((k) => k.tenantId === 't-star')).toBe(true);
    const revoke = await s.revokeKey(as('u-admin-star'), 'k-risk-prod');
    expect(!revoke.ok && revoke.status).toBe(403);
    expect(s.audit.all().some((e) => e.action === 'key.revoke' && e.decision === 'deny' && e.actorId === 'u-admin-star')).toBe(true);
    const tenant = await s.getTenant(as('u-admin-star'), 't-union');
    expect(!tenant.ok && tenant.status).toBe(403);
    const tenants = await s.listTenants(as('u-admin-star'));
    expect(tenants.ok && tenants.data.map((t) => t.id)).toEqual(['t-star']);
    const union = await s.getBillingStatement(as('u-billing-union'), 't-star', '2026-11');
    expect(!union.ok && union.status).toBe(403);
    // 公部門：排除中國來源的共用部署（Qwen3.8-27B、Qwen3-Embedding）與他租戶的專屬部署
    const gov = await s.listDeployments(as('u-admin-gov'));
    expect(gov.ok).toBe(true);
    if (gov.ok) {
      expect(gov.data.some((d) => d.modelId === 'gpt-oss-120b-vllm')).toBe(true);
      expect(gov.data.some((d) => d.modelId === 'qwen3.8-27b-vllm')).toBe(false);
      expect(gov.data.some((d) => d.modelId === 'qwen3-embedding-8b-vllm')).toBe(false);
      expect(gov.data.some((d) => d.sharing === 'dedicated')).toBe(false);
    }
    const unionDeps = await s.listDeployments(as('u-admin-union'));
    expect(unionDeps.ok && unionDeps.data.filter((d) => d.sharing === 'dedicated').every((d) => d.dedicatedTenantId === 't-union')).toBe(true);
    expect(unionDeps.ok && unionDeps.data.some((d) => d.sharing === 'dedicated')).toBe(true);
  });

  it('Playground 路由：專案必須屬於指定租戶（404）；叢集中斷時自建優先租戶溢出並標示 cluster_disconnected；專屬部署（僅自建別名）容量耗盡 → 429 不溢出', async () => {
    const s = fresh();
    const input = { system: '', messages: [{ role: 'user' as const, content: 'hi' }], temperature: 0.5, maxTokens: 100, enableThinking: false };
    const mismatch = await s.invokePlayground(as('u-admin-star'), { ...input, modelId: 'qwen3.8-27b-vllm', tenantId: 't-star', projectId: 'p-risk' });
    expect(!mismatch.ok && mismatch.status).toBe(404);
    // 聯合金融風控專案：qwen3.8-27b 由新竹機房 B 的專屬部署服務，對應別名 risk-local（僅自建）
    const normal = await s.invokePlayground(as('u-admin-union'), { ...input, modelId: 'qwen3.8-27b-vllm', tenantId: 't-union', projectId: 'p-risk' });
    expect(normal.ok).toBe(true);
    if (normal.ok) {
      expect(normal.data.deploymentId).toBe('dep-union-qwen27b-dedicated');
      expect(normal.data.billingBasis).toBe('dedicated');
      expect(normal.data.headers['x-maas-route']).toBe('risk-local');
    }
    s.options.simulateLocalExhausted = true;
    const exhausted = await s.invokePlayground(as('u-admin-union'), { ...input, modelId: 'qwen3.8-27b-vllm', tenantId: 't-union', projectId: 'p-risk' });
    expect(exhausted.ok).toBe(false);
    if (!exhausted.ok) {
      expect(exhausted.status).toBe(429);
      expect(exhausted.code).toBe('local_capacity_exhausted');
      expect(exhausted.headers?.['x-maas-deployment']).toBe('dep-union-qwen27b-dedicated');
    }
    s.options.simulateLocalExhausted = false;
    // 台北機房 A 中斷：星耀的 qwen-plus 別名溢出到雲端，理由 cluster_disconnected
    s.options.simulateClusterOutage = true;
    const outage = await s.invokePlayground(as('u-admin-star'), { ...input, modelId: 'qwen3.8-27b-vllm', tenantId: 't-star', projectId: 'p-cs-bot' });
    expect(outage.ok).toBe(true);
    if (outage.ok) {
      expect(outage.data.tier).toBe('spillover');
      expect(outage.data.headers['x-maas-spillover-from']).toBe('dep-qwen27b-shared');
      expect(outage.data.headers['x-maas-spillover-reason']).toBe('cluster_disconnected');
      expect(outage.data.model.id).toBe('qwen3.7-plus');
    }
    // 聯合的專屬部署在新竹機房 B，不受台北中斷影響
    const unionOk = await s.invokePlayground(as('u-admin-union'), { ...input, modelId: 'qwen3.8-27b-vllm', tenantId: 't-union', projectId: 'p-risk' });
    expect(unionOk.ok && unionOk.data.deploymentId).toBe('dep-union-qwen27b-dedicated');
  });

  it('新增租戶的允許清單：未知模型／別名 400；僅自建或公部門租戶不可列入雲端模型或排除來源地的模型', async () => {
    const s = fresh();
    const base = { plan: 'payg' as const, dataClass: 'general' as const, allowedTiers: 'both' as const, quotas: { rpm: 100, tpm: 100_000, monthlyBudgetUsd: 100 }, costCenter: 'CC', billingContact: { name: 'n', email: 'n@e.co' } };
    const unknown = await s.createTenant(as('u-owner'), { ...base, name: 'u1', allowedModels: ['no-such-model'] });
    expect(!unknown.ok && unknown.status).toBe(400);
    const localCloud = await s.createTenant(as('u-owner'), { ...base, name: 'u2', allowedTiers: 'local', allowedModels: ['qwen3.7-plus'] });
    expect(!localCloud.ok && localCloud.status).toBe(400);
    const govCn = await s.createTenant(as('u-owner'), { ...base, name: 'u3', dataClass: 'public-sector', allowedModels: ['qwen3.8-27b-vllm'] });
    expect(!govCn.ok && govCn.status).toBe(400);
    const govOk = await s.createTenant(as('u-owner'), { ...base, name: 'u4', dataClass: 'public-sector', allowedModels: ['gov-chat', 'gpt-oss-120b-vllm'] });
    expect(govOk.ok && govOk.data.allowedModels).toEqual(['gov-chat', 'gpt-oss-120b-vllm']);
    // 選 both 但未附跨境同意 → 400 CROSS_BORDER_CONSENT_REQUIRED；附同意後可
    const noConsent = await s.createTenant(as('u-owner'), { ...base, name: 'u5', allowedModels: ['qwen-plus', 'qwen3.7-plus', 'qwen3.8-27b-vllm'] });
    expect(!noConsent.ok && noConsent.code).toBe('CROSS_BORDER_CONSENT_REQUIRED');
    const anyOk = await s.createTenant(as('u-owner'), { ...base, name: 'u5', allowedModels: ['qwen-plus', 'qwen3.7-plus', 'qwen3.8-27b-vllm'], crossBorderConsent: { regions: ['ap-southeast-1'], by: '法遵' } });
    expect(anyOk.ok).toBe(true);
    if (anyOk.ok) expect(anyOk.data.crossBorderConsent?.regions).toEqual(['ap-southeast-1']);
  });

  it('API 金鑰服務主體只有 inference-caller：可呼叫 Playground、不可建立金鑰／更新路由／讀用量（403）', async () => {
    const s = fresh();
    const sp = s.authenticate(as('sp-k-cs-prod'))!;
    expect(sp.type).toBe('servicePrincipal');
    expect(s.authorize(sp, 'playground.invoke', CS_BOT).allowed).toBe(true);
    expect(s.authorize(sp, 'model.read', CS_BOT).allowed).toBe(true);
    expect(s.authorize(sp, 'key.create', CS_BOT).allowed).toBe(false);
    expect(s.authorize(sp, 'key.revoke', `${CS_BOT}/keys/k-cs-prod`).allowed).toBe(false);
    expect(s.authorize(sp, 'usage.read', CS_BOT).allowed).toBe(false);
    const key = await s.createKey(as('sp-k-cs-prod'), { name: 'x', tenantId: 't-star', projectId: 'p-cs-bot', allowedModels: ['qwen-plus'], rpmLimit: 1, tpmLimit: 1, monthlyBudgetUsd: 1, expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(!key.ok && key.status).toBe(403);
    const routes = await s.listRoutes(as('u-owner'));
    const route = await s.updateRouting(as('sp-k-cs-prod'), routes.ok ? routes.data[0].id : '', { retry: { maxAttempts: 1, backoffMs: 1 } });
    expect(!route.ok && route.status).toBe(403);
    const call = await s.invokePlayground(as('sp-k-cs-prod'), { modelId: 'qwen3.8-27b-vllm', tenantId: 't-star', projectId: 'p-cs-bot', system: '', messages: [{ role: 'user', content: 'hi' }], temperature: 0.5, maxTokens: 10, enableThinking: false });
    expect(call.ok).toBe(true);
    // 新建金鑰的服務主體也只拿 inference-caller
    const created = await s.createKey(as('u-admin-star'), { name: 'new', tenantId: 't-star', projectId: 'p-cs-bot', allowedModels: ['qwen-plus'], rpmLimit: 1, tpmLimit: 1, monthlyBudgetUsd: 1, expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(created.ok).toBe(true);
    if (created.ok) {
      const newSp = s.authenticate(as(created.data.key.servicePrincipalId))!;
      expect(s.authorize(newSp, 'key.create', CS_BOT).allowed).toBe(false);
      expect(s.authorize(newSp, 'playground.invoke', CS_BOT).allowed).toBe(true);
    }
    expect(ROLES['inference-caller'].actions).toEqual(['playground.invoke', 'model.read', 'project.read']);
  });

  it('model.route.update 是平台層動作：客戶管理員／專案操作員沒有；路由 updatedBy 皆為我們的使用者', async () => {
    const s = fresh();
    expect(PLATFORM_ONLY_ACTIONS).toContain('model.route.update');
    expect(ROLES['tenant-admin'].actions).not.toContain('model.route.update');
    expect(ROLES['project-operator'].actions).not.toContain('model.route.update');
    const routes = await s.listRoutes(as('u-owner'));
    expect(routes.ok && routes.data.every((r) => USERS.find((u) => u.id === r.updatedBy)?.tenantId === null)).toBe(true);
    const denied = await s.updateRouting(as('u-admin-star'), routes.ok ? routes.data[0].id : '', { retry: { maxAttempts: 2, backoffMs: 100 } });
    expect(!denied.ok && denied.status).toBe(403);
  });

  it('租戶管理員可核准自己租戶內「他人申請」的特權指派；自己申請的仍待他人核准；平台範圔的待核准不可由租戶管理員核准', async () => {
    const s = fresh();
    // ra-030：存取管理員申請把王大衛升為租戶管理員 → 陳曉明（租戶管理員）可核准
    const ok = await s.approveRequest(as('u-admin-star'), 'ra-030');
    expect(ok.ok && ok.data.status).toBe('active');
    expect(ok.ok && ok.data.approvedBy).toBe('u-admin-star');
    // 租戶管理員自己提出的特權指派 → 仍需另一人核准（職責分離）
    const own = await s.createRoleAssignment(as('u-admin-star'), { principalId: 'u-viewer-star', roleId: 'tenant-admin', scope: STAR });
    expect(own.ok && own.data.outcome).toBe('pending');
    if (!own.ok) return;
    const selfApprove = await s.approveRequest(as('u-admin-star'), own.data.assignment.id);
    expect(!selfApprove.ok && selfApprove.code).toBe('SEPARATION_OF_DUTIES');
    const otherAdmin = await s.approveRequest(as('u-op-star'), own.data.assignment.id); // 王大衛剛成為租戶管理員
    expect(otherAdmin.ok).toBe(true);
    // 平台範圍的待核准：租戶管理員 403
    const platformPending = await s.createRoleAssignment(as('u-owner'), { principalId: 'u-finance', roleId: 'platform-owner', scope: '/' });
    expect(platformPending.ok && platformPending.data.outcome).toBe('active'); // 擁有者在平台範圔直接生效
    const unionAdmin = await s.approveRequest(as('u-admin-union'), 'ra-030');
    expect(!unionAdmin.ok && [403, 409]).toContain(unionAdmin.ok ? 0 : unionAdmin.status);
  });

  it('不揭露其他租戶的主體：租戶範圔的主體清單只含自己租戶；有效存取查詢他租戶主體 → 404', async () => {
    const s = fresh();
    const list = await s.listPrincipals(as('u-admin-star'), STAR);
    expect(list.ok && list.data.every((p) => p.tenantId === 't-star')).toBe(true);
    expect(list.ok && list.data.length).toBeGreaterThan(0);
    const cross = await s.getEffectiveAccess(as('u-admin-star'), 'u-admin-union', STAR);
    expect(!cross.ok && cross.status).toBe(404);
    const vendorUser = await s.getEffectiveAccess(as('u-admin-star'), 'u-owner', STAR);
    expect(!vendorUser.ok && vendorUser.status).toBe(404);
    const own = await s.getEffectiveAccess(as('u-admin-star'), 'u-op-star', STAR);
    expect(own.ok).toBe(true);
    const all = await s.listPrincipals(as('u-owner'), '/');
    expect(all.ok && new Set(all.data.map((p) => p.tenantId)).size).toBeGreaterThan(2);
  });
});

describe('稽核', () => {
  it('被拒絕的嘗試會產生稽核事件（含 requestId）', async () => {
    const s = fresh();
    const before = s.audit.all().length;
    const res = await s.revokeKey(as('u-viewer-star'), 'k-cs-prod');
    expect(res.ok).toBe(false);
    const events = s.audit.all();
    expect(events.length).toBe(before + 1);
    const last = events[events.length - 1];
    expect(last.decision).toBe('deny');
    expect(last.actorId).toBe('u-viewer-star');
    expect(last.action).toBe('key.revoke');
    if (!res.ok) expect(last.requestId).toBe(res.requestId);
  });

  it('異動會記錄 before/after', async () => {
    const s = fresh();
    const res = await s.revokeKey(as('u-op-star'), 'k-cs-prod');
    expect(res.ok).toBe(true);
    const last = s.audit.all()[s.audit.all().length - 1];
    expect(last.decision).toBe('allow');
    expect((last.before as { status: string }).status).toBe('active');
    expect((last.after as { status: string }).status).toBe('revoked');
  });

  it('稽核紀錄集合依範圍過濾（稽核員只看得到自己租戶）', async () => {
    const s = fresh();
    const res = await s.listAuditLogs(as('u-audit-union'));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.length).toBeGreaterThan(0);
      expect(res.data.every((e) => e.scope.startsWith('/tenants/t-union'))).toBe(true);
    }
    const viewer = await s.listAuditLogs(as('u-viewer-star'));
    expect(viewer.ok).toBe(false);
  });

  it('種子中所有使用者皆可被驗證', () => {
    const s = fresh();
    for (const u of USERS) expect(s.authenticate({ userId: u.id })).not.toBeNull();
    expect(s.authenticate({ userId: 'nobody' })).toBeNull();
  });
});
