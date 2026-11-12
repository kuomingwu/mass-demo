import { describe, it, expect } from 'vitest';
import { MockServer, dedicatedGpuHours, maxKeyExpiryMs, overlapHours, type CreateDeploymentInput } from '../api';
import { generateUsage } from '../usage';
import { CLUSTERS, DEPLOYMENTS, GPU_SPECS, blendedListPrice, fleetPeakTokPerSec, grossMargin, internalUnitPrice, tokPerSecPerGpu, tokPerSecPerReplica, utilizationForTargetMargin, vramFit } from '../../data/clusters';
import { MODELS, MODEL_BY_ID, estimateKvCacheGb, estimateVramGb } from '../../data/models';
import { PROVIDER_BY_ID } from '../../data/providers';
import { API_KEYS, PUBLIC_SECTOR_LEGAL_BASIS, PUBLIC_SECTOR_NOTE } from '../seed';

const fresh = () => new MockServer({ latency: [0, 0], agentConnectMs: 0, deploymentReadyMs: 0, drainMs: 0 });
const as = (userId: string) => ({ userId });
const OPS = as('u-cluster-ops');
const OWNER = as('u-owner');
const FIN = as('u-finance');

const depInput = (over: Partial<CreateDeploymentInput> = {}): CreateDeploymentInput => ({
  name: 'test-dep',
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
  autoscaling: { minReplicas: 1, maxReplicas: 2, metric: 'queue-depth', scaleToZero: true },
  rollout: { strategy: 'canary', canaryPercent: 10 },
  ...over,
});

const regInput = { name: '高雄機房 D', site: '高雄', k8sVersion: 'v1.32.4', gpuType: 'H200 141GB', nodeCount: 2, gpusPerNode: 8, engine: 'vLLM' as const };

describe('推論叢集：我們的機房（平台層資源）', () => {
  it('註冊叢集：平台營運於平台範圍 → 等待加入 → 代理程式連線 → 已連線並建立節點；token 作廢；事件與稽核在 /clusters/{c}', async () => {
    const s = new MockServer({ latency: [0, 0], agentConnectMs: 50, deploymentReadyMs: 0, drainMs: 0 });
    const res = await s.registerCluster(OPS, regInput);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.status).toBe('waiting');
    expect(res.data.agentInstallCommand).toContain('kubectl apply -f https://control.example-maas.local/agent/');
    expect(res.data.oneTimeToken).toMatch(/^mcp-/);
    // 一次性 token 以 --from-file 交付，不出現在指令列
    expect(res.data.agentInstallCommand).toContain('--from-file=token=./join-token.txt');
    expect(res.data.agentInstallCommand).not.toContain('--from-literal');
    expect(res.data.agentInstallCommand).not.toContain(res.data.oneTimeToken!);
    expect(res.data.nodePools[0].sharing).toBe('shared');
    const list1 = await s.listClusters(OPS);
    expect(list1.ok && list1.data.find((c) => c.id === res.data.id)?.status).toBe('waiting');
    await new Promise((r) => setTimeout(r, 120));
    const after = await s.getCluster(OPS, res.data.id);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.data.status).toBe('connected');
      expect(after.data.nodeCount).toBe(2);
      expect(after.data.gpuTotal).toBe(16);
      expect(after.data.oneTimeToken).toBeNull();
      expect(after.data.pools[0].gpuTotal).toBe(16);
    }
    const nodes = await s.listNodes(OPS, res.data.id);
    expect(nodes.ok && nodes.data.length).toBe(2);
    if (nodes.ok) expect(nodes.data[0].gpuType).toBe('H200 141GB');
    const events = await s.listClusterEvents(OPS, res.data.id);
    expect(events.ok && events.data.some((e) => e.message.includes('已連線'))).toBe(true);
    expect(s.audit.all().some((e) => e.action === 'cluster.register' && e.decision === 'allow' && e.resourceId === res.data.id && e.scope === `/clusters/${res.data.id}`)).toBe(true);
  });

  it('註冊專屬機房：節點池保留給指定租戶；不存在的租戶 404', async () => {
    const s = fresh();
    const res = await s.registerCluster(OPS, { ...regInput, name: '聯合專屬機房', dedicatedTenantId: 't-union' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.nodePools[0].sharing).toBe('dedicated');
      expect(res.data.nodePools[0].dedicatedTenantId).toBe('t-union');
      expect(res.data.pools[0].dedicatedTenantName).toBe('聯合金融');
    }
    const nope = await s.registerCluster(OPS, { ...regInput, name: 'x', dedicatedTenantId: 't-nope' });
    expect(!nope.ok && nope.status).toBe(404);
  });

  it('客戶角色不可註冊、不可檢視我們的叢集（403 + 拒絕稽核）；我們的三個角色皆可檢視；平台財務不可註冊', async () => {
    const s = fresh();
    for (const u of ['u-admin-star', 'u-admin-union', 'u-admin-gov', 'u-viewer-star', 'u-op-star']) {
      const reg = await s.registerCluster(as(u), regInput);
      expect(!reg.ok && reg.status, u).toBe(403);
      const list = await s.listClusters(as(u));
      expect(!list.ok && list.status, u).toBe(403);
      const one = await s.getCluster(as(u), 'cl-tpe-a');
      expect(!one.ok && one.status, u).toBe(403);
    }
    expect(s.audit.all().some((e) => e.action === 'cluster.register' && e.decision === 'deny' && e.actorId === 'u-admin-star')).toBe(true);
    for (const u of ['u-owner', 'u-cluster-ops', 'u-finance']) {
      const list = await s.listClusters(as(u));
      expect(list.ok && list.data.length, u).toBe(3);
    }
    const fin = await s.registerCluster(FIN, regInput);
    expect(!fin.ok && fin.status).toBe(403);
    // 客戶管理員可看部署（只有服務自己的），但不能部署
    const deps = await s.listDeployments(as('u-admin-star'));
    expect(deps.ok && deps.data.length).toBeGreaterThan(0);
    expect(deps.ok && deps.data.every((d) => d.sharing === 'shared')).toBe(true);
    const dep = await s.createDeployment(as('u-admin-star'), depInput());
    expect(!dep.ok && dep.status).toBe(403);
  });

  it('註冊驗證：重複名稱 409、不支援 GPU 型號 400、K8s 版本 < 1.32 → 400；1.32／1.33 可', async () => {
    const s = fresh();
    const dup = await s.registerCluster(OPS, { ...regInput, name: '台北機房 A（H100）' });
    expect(!dup.ok && dup.status).toBe(409);
    const gpu = await s.registerCluster(OPS, { ...regInput, name: 'x1', gpuType: 'TPU v5' });
    expect(!gpu.ok && gpu.status).toBe(400);
    for (const v of ['v1.25.0', 'v1.31.9', '1.30.2']) {
      const k8s = await s.registerCluster(OPS, { ...regInput, name: `x-${v}`, k8sVersion: v });
      expect(!k8s.ok && k8s.status, v).toBe(400);
      expect(!k8s.ok && k8s.message, v).toContain('1.32');
    }
    const ok132 = await s.registerCluster(OPS, { ...regInput, name: 'x-132', k8sVersion: 'v1.32.0' });
    expect(ok132.ok).toBe(true);
    const ok133 = await s.registerCluster(OPS, { ...regInput, name: 'x-133', k8sVersion: '1.33.1' });
    expect(ok133.ok).toBe(true);
  });

  it('排空／恢復節點需 cluster.operate；狀態轉換正確、重複操作 409、寫入稽核；平台財務 403；排空後 cluster.gpuAllocated 與部署副本一致（池內無可用 GPU → 副本標示待遷移）', async () => {
    const s = fresh();
    const denied = await s.drainNode(FIN, 'n-tpe-a-02');
    expect(!denied.ok && denied.status).toBe(403);
    const before = await s.getCluster(OPS, 'cl-tpe-a');
    const drained = await s.drainNode(OPS, 'n-tpe-a-02');
    expect(drained.ok && drained.data.status).toBe('drained');
    const again = await s.drainNode(OPS, 'n-tpe-a-02');
    expect(!again.ok && again.status).toBe(409);
    // 台北 A 共用池另一節點 4/4 滿載：3 張 GPU 無處遷移 → cluster.gpuAllocated 減少且部署副本縮減、標示待遷移
    const after = await s.getCluster(OPS, 'cl-tpe-a');
    const nodes = await s.listNodes(OPS, 'cl-tpe-a');
    const nodeSum = nodes.ok ? nodes.data.reduce((a, n) => a + n.gpuAllocated, 0) : -1;
    expect(after.ok && after.data.gpuAllocated).toBe(nodeSum);
    expect(before.ok && after.ok && after.data.gpuAllocated).toBeLessThan(before.ok ? before.data.gpuAllocated : 0);
    const deps = await s.listDeployments(OPS, { clusterId: 'cl-tpe-a' });
    const depSum = deps.ok ? deps.data.reduce((a, d) => a + d.replicas * d.gpusPerReplica, 0) : -1;
    expect(after.ok && after.data.gpuAllocated).toBe(depSum);
    expect(deps.ok && deps.data.some((d) => (d.pendingMigrationReplicas ?? 0) > 0 && (d.statusMessage ?? '').includes('待遷移'))).toBe(true);
    const back = await s.uncordonNode(OPS, 'n-tpe-a-02');
    expect(back.ok && back.data.status).toBe('ready');
    const audits = s.audit.all().filter((e) => e.action === 'cluster.operate' && e.decision === 'allow' && e.resourceId === 'n-tpe-a-02');
    expect(audits.length).toBe(2);
    expect(audits[0].scope).toBe('/clusters/cl-tpe-a');
    expect((audits[0].before as { status: string }).status).toBe('ready');
    expect((audits[0].after as { status: string }).status).toBe('drained');
    // 新竹 B 專屬池 8/8：排空一個節點 → 另一節點（共用池）不屬同一池，不可借用 → 專屬部署副本縮減
    const s2 = fresh();
    const d2 = await s2.drainNode(OPS, 'n-hc-b-02');
    expect(d2.ok).toBe(true);
    const deps2 = await s2.listDeployments(OPS, { clusterId: 'cl-hc-b' });
    expect(deps2.ok && deps2.data.filter((d) => d.sharing === 'dedicated').reduce((a, d) => a + d.replicas * d.gpusPerReplica, 0)).toBe(0);
    expect(deps2.ok && deps2.data.filter((d) => d.sharing === 'shared').reduce((a, d) => a + d.replicas * d.gpusPerReplica, 0)).toBe(8);
  });

  it('節點池：新竹機房 B 有共用與專屬（聯合金融）節點池；模擬叢集中斷時台北 A 顯示為中斷且部署顯示錯誤', async () => {
    const s = fresh();
    const pools = await s.listNodePools(OPS, 'cl-hc-b');
    expect(pools.ok && pools.data.length).toBe(2);
    if (pools.ok) {
      const dedicated = pools.data.find((p) => p.sharing === 'dedicated')!;
      expect(dedicated.dedicatedTenantId).toBe('t-union');
      expect(dedicated.gpuTotal).toBe(8);
      expect(dedicated.gpuAllocated).toBe(8); // 已售滿：assist 2 × 2 + qwen27b 2 × 2
    }
    s.options.simulateClusterOutage = true;
    const list = await s.listClusters(OPS);
    expect(list.ok && list.data.find((c) => c.id === 'cl-tpe-a')?.status).toBe('disconnected');
    const deps = await s.listDeployments(OPS, { clusterId: 'cl-tpe-a' });
    expect(deps.ok && deps.data.find((d) => d.id === 'dep-qwen27b-shared')?.status).toBe('error');
    const dep = await s.createDeployment(OPS, depInput());
    expect(!dep.ok && dep.code).toBe('CLUSTER_NOT_CONNECTED');
    const svc = await s.createDeployment(OPS, depInput({ clusterId: 'cl-tc-c', quantization: 'FP8' }));
    expect(!svc.ok && svc.code).toBe('CLUSTER_NOT_CONNECTED'); // 台中 C 服務異常
  });

  it('新增節點（connectProvider vllm + clusterId）加入共用節點池並需要平台範圍 cluster.register', async () => {
    const s = fresh();
    const meta = { nodeName: 'tpe-a-gpu-03', gpuType: 'H100 80GB', gpuCount: 4, engine: 'vLLM', clusterId: 'cl-tpe-a' };
    const byOps = await s.connectProvider(OPS, { providerId: 'vllm', region: 'tw-tpe-a-3', regionLabel: 'x', baseUrl: 'https://gw-x.internal.example-maas.local/v1', rpmLimit: 1, tpmLimit: 1, enabledModels: ['qwen3-coder-30b-a3b-vllm'], meta });
    expect(byOps.ok).toBe(true);
    const customer = await s.connectProvider(as('u-admin-star'), { providerId: 'vllm', region: 'tw-tpe-a-4', regionLabel: 'y', baseUrl: 'https://gw-y.internal.example-maas.local/v1', rpmLimit: 1, tpmLimit: 1, enabledModels: ['qwen3-coder-30b-a3b-vllm'], meta });
    expect(!customer.ok && customer.status).toBe(403);
    const cl = await s.getCluster(OPS, 'cl-tpe-a');
    expect(cl.ok && cl.data.nodeCount).toBe(3);
    expect(cl.ok && cl.data.gpuTotal).toBe(12);
    expect(cl.ok && cl.data.pools.find((p) => p.sharing === 'shared')?.gpuTotal).toBe(12);
    const nodes = await s.listNodes(OPS, 'cl-tpe-a');
    expect(nodes.ok && nodes.data.some((n) => n.name === 'tpe-a-gpu-03' && n.poolId === 'pool-tpe-a-shared')).toBe(true);
  });
});

describe('模型部署（共用／專屬）', () => {
  it('VRAM 估算：權重 27B BF16 ≈ 62 GB、FP8 ≈ 31 GB；加上 KV cache（128 seqs × 131k）後 27B BF16 放不下 1 × H100，FP8 可；gpt-oss 只能 MXFP4（INT4）', () => {
    expect(estimateVramGb(27, 'BF16')).toBeGreaterThanOrEqual(54);
    expect(estimateVramGb(27, 'BF16')).toBeLessThanOrEqual(64);
    expect(estimateVramGb(27, 'FP8')).toBeGreaterThanOrEqual(27);
    expect(estimateVramGb(27, 'FP8')).toBeLessThanOrEqual(32);
    // KV cache：27B 256 KB／token（BF16），1 條滿長度 + 127 條 × 1k → ≈ 66 GB
    expect(estimateKvCacheGb(262_144, 'BF16', 128, 131_072)).toBeGreaterThanOrEqual(60);
    expect(estimateKvCacheGb(262_144, 'FP8', 128, 131_072)).toBeLessThan(estimateKvCacheGb(262_144, 'BF16', 128, 131_072));
    expect(estimateKvCacheGb(0, 'BF16', 512, 32_768)).toBe(0); // 嵌入模型無 KV
    const bf16Default = vramFit('qwen3.8-27b-vllm', 'BF16', 'H100 80GB', 1); // UI 預設：27B BF16／131k／128 seqs
    expect(bf16Default.ok).toBe(false);
    expect(bf16Default.code).toBe('INSUFFICIENT_VRAM');
    expect(bf16Default.kvGb).toBeGreaterThan(0);
    expect(bf16Default.requiredGb).toBe(bf16Default.weightsGb + bf16Default.kvGb);
    expect(vramFit('qwen3.8-27b-vllm', 'FP8', 'H100 80GB', 1).ok).toBe(true);
    expect(vramFit('qwen3.8-27b-vllm', 'BF16', 'H100 80GB', 2).ok).toBe(true);
    expect(vramFit('qwen3.8-27b-vllm', 'BF16', 'H100 80GB', 1, 32, 32_768).ok).toBe(true); // 降低 seqs／ctx 就放得下
    expect(vramFit('qwen3.8-27b-vllm', 'FP8', 'L40S 48GB', 1).ok).toBe(false);
    expect(vramFit('qwen3.8-27b-vllm', 'FP8', 'L40S 48GB', 2).ok).toBe(true);
    expect(vramFit('gpt-oss-120b-vllm', 'INT4', 'H200 141GB', 1).ok).toBe(true);
    const gptossBf16 = vramFit('gpt-oss-120b-vllm', 'BF16', 'H100 80GB', 2);
    expect(gptossBf16.ok).toBe(false);
    expect(gptossBf16.code).toBe('QUANT_NOT_SUPPORTED');
    expect(vramFit('gpt-oss-120b-vllm', 'FP8', 'H200 141GB', 2).code).toBe('QUANT_NOT_SUPPORTED');
    expect(vramFit('llama-3.3-70b-vllm', 'FP8', 'H200 141GB', 1).ok).toBe(true);
    // 種子部署的 vramGb 都放得下其叢集 GPU
    for (const d of DEPLOYMENTS) {
      const c = CLUSTERS.find((x) => x.id === d.clusterId)!;
      expect(d.vramGb, d.id).toBeLessThanOrEqual(GPU_SPECS[c.gpuType].vramGb * d.gpusPerReplica);
    }
  });

  it('VRAM 不足（27B BF16 128 seqs 1 × H100）→ 400 INSUFFICIENT_VRAM 並寫入拒絕稽核；gpt-oss 非 MXFP4 → 400 QUANT_NOT_SUPPORTED；足夠 → 建立中 → 就緒；雲端 API 模型不可部署', async () => {
    const s = fresh();
    const bad = await s.createDeployment(OPS, depInput({ quantization: 'BF16', gpusPerReplica: 1 }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.status).toBe(400);
      expect(bad.code).toBe('INSUFFICIENT_VRAM');
      expect(bad.message).toContain('KV cache');
    }
    expect(s.audit.all().some((e) => e.action === 'deployment.manage' && e.decision === 'deny' && String(e.reason).includes('INSUFFICIENT_VRAM'))).toBe(true);
    const quant = await s.createDeployment(OPS, depInput({ name: 'oss', clusterId: 'cl-hc-b', modelId: 'gpt-oss-120b-vllm', quantization: 'FP8', gpusPerReplica: 2 }));
    expect(!quant.ok && quant.code).toBe('QUANT_NOT_SUPPORTED');
    const before = await s.getCluster(OPS, 'cl-tpe-a');
    const ok = await s.createDeployment(OPS, depInput());
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.data.status).toBe('ready'); // deploymentReadyMs=0 → 立即就緒
      expect(ok.data.sharing).toBe('shared');
      expect(ok.data.vramGb).toBe(vramFit('qwen3.8-27b-vllm', 'FP8', 'H100 80GB', 1, 128).requiredGb);
      // 吞吐與種子／用量同一套估算
      expect(ok.data.tokPerSec).toBe(tokPerSecPerReplica('qwen3.8-27b-vllm', 'H100 80GB', 'FP8', 1));
    }
    const after = await s.getCluster(OPS, 'cl-tpe-a');
    expect(after.ok && before.ok && after.data.gpuAllocated - before.data.gpuAllocated).toBe(1);
    const models = await s.listModels(OPS);
    expect(models.ok && models.data.find((m) => m.id === 'qwen3.8-27b-vllm')?.regions).toContain('tw-tpe-a');
    const cloudOnly = await s.createDeployment(OPS, depInput({ name: 'max', modelId: 'qwen3.8-max' }));
    expect(!cloudOnly.ok && cloudOnly.status).toBe(400);
  });

  it('專屬部署：必須指定租戶；只用該租戶的專屬節點池（售滿 → 409 DEDICATED_POOL_EXHAUSTED，不自動借用共用池；allowSharedFallback 才可並寫入稽核）；公部門租戶排除中國來源模型（含以 Qwen 為基底的 MaaS-Assist）→ 400 MODEL_NOT_ALLOWED；客戶只看得到自己的專屬部署', async () => {
    const s = fresh();
    const noTenant = await s.createDeployment(OPS, depInput({ clusterId: 'cl-hc-b', sharing: 'dedicated', quantization: 'FP8' }));
    expect(!noTenant.ok && noTenant.status).toBe(400);
    // 聯合金融專屬池 8/8 已售滿 → 409，且共用池不會被借用
    const exhausted = await s.createDeployment(OPS, depInput({ name: 'union-llama', clusterId: 'cl-hc-b', sharing: 'dedicated', dedicatedTenantId: 't-union', modelId: 'llama-3.3-70b-vllm', quantization: 'FP8', gpusPerReplica: 2, replicas: 1 }));
    expect(!exhausted.ok && exhausted.status).toBe(409);
    expect(!exhausted.ok && exhausted.code).toBe('DEDICATED_POOL_EXHAUSTED');
    expect(s.audit.all().some((e) => e.action === 'deployment.manage' && e.decision === 'deny' && String(e.reason).includes('DEDICATED_POOL_EXHAUSTED'))).toBe(true);
    // 星耀在台北 A 沒有專屬池：預設 409；明確 allowSharedFallback → 借用共用池（1 張 H100）並寫入稽核
    const starDefault = await s.createDeployment(OPS, depInput({ name: 'star-ded', sharing: 'dedicated', dedicatedTenantId: 't-star', modelId: 'taide-lx-8b-vllm', quantization: 'BF16', gpusPerReplica: 1, replicas: 1 }));
    expect(!starDefault.ok && starDefault.code).toBe('DEDICATED_POOL_EXHAUSTED');
    const sharedBefore = await s.listNodePools(OPS, 'cl-tpe-a');
    const sharedAllocBefore = sharedBefore.ok ? sharedBefore.data.find((p) => p.sharing === 'shared')!.gpuAllocated : -1;
    const ok = await s.createDeployment(OPS, depInput({ name: 'star-ded', sharing: 'dedicated', dedicatedTenantId: 't-star', modelId: 'taide-lx-8b-vllm', quantization: 'BF16', gpusPerReplica: 1, replicas: 1, allowSharedFallback: true }));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.data.sharing).toBe('dedicated');
      expect(ok.data.dedicatedTenantName).toBe('星耀科技');
    }
    const sharedAfter = await s.listNodePools(OPS, 'cl-tpe-a');
    expect(sharedAfter.ok && sharedAfter.data.find((p) => p.sharing === 'shared')!.gpuAllocated).toBe(sharedAllocBefore + 1);
    expect(s.audit.all().some((e) => e.action === 'deployment.manage' && e.decision === 'allow' && String(e.reason).includes('allowSharedFallback'))).toBe(true);
    const gov = await s.createDeployment(OPS, depInput({ name: 'gov-qwen', clusterId: 'cl-hc-b', sharing: 'dedicated', dedicatedTenantId: 't-gov', modelId: 'qwen3.8-27b-vllm', quantization: 'FP8' }));
    expect(!gov.ok && gov.code).toBe('MODEL_NOT_ALLOWED');
    const govAssist = await s.createDeployment(OPS, depInput({ name: 'gov-assist', clusterId: 'cl-hc-b', sharing: 'dedicated', dedicatedTenantId: 't-gov', modelId: 'maas-assist-27b', quantization: 'FP8', gpusPerReplica: 2 }));
    expect(!govAssist.ok && govAssist.code).toBe('MODEL_NOT_ALLOWED');
    expect(!govAssist.ok && govAssist.message).toContain('基底');
    expect(s.audit.all().some((e) => e.action === 'deployment.manage' && e.decision === 'deny' && String(e.reason).includes('MODEL_NOT_ALLOWED'))).toBe(true);
    // 客戶看到的部署：聯合看到自己的專屬 + 共用；星耀看不到聯合的專屬
    const union = await s.listDeployments(as('u-admin-union'));
    expect(union.ok && union.data.some((d) => d.sharing === 'dedicated' && d.dedicatedTenantId === 't-union')).toBe(true);
    const star = await s.listDeployments(as('u-admin-star'));
    expect(star.ok && star.data.every((d) => d.sharing === 'shared' || d.dedicatedTenantId === 't-star')).toBe(true);
    expect(star.ok && star.data.some((d) => d.dedicatedTenantId === 't-union')).toBe(false);
    // 公部門只看到非中國來源的共用部署
    const govList = await s.listDeployments(as('u-admin-gov'));
    expect(govList.ok && govList.data.length).toBeGreaterThan(0);
    expect(govList.ok && govList.data.every((d) => !d.modelId.startsWith('qwen'))).toBe(true);
  });

  it('GPU 不足 → 400 INSUFFICIENT_GPUS（依節點池）；擴縮受上下限、縮至零與叢集狀態限制；刪除唯一就緒部署 → 409 DEPLOYMENT_IN_USE', async () => {
    const s = fresh();
    const tooMany = await s.createDeployment(OPS, depInput({ replicas: 8, gpusPerReplica: 1 })); // 台北 A 共用池只剩 1 張
    expect(!tooMany.ok && tooMany.code).toBe('INSUFFICIENT_GPUS');
    const dep = await s.createDeployment(OPS, depInput({ name: 'scale-me', replicas: 1 }));
    expect(dep.ok).toBe(true);
    if (!dep.ok) return;
    const over = await s.scaleDeployment(OPS, dep.data.id, 5);
    expect(!over.ok && over.status).toBe(400);
    const zero = await s.scaleDeployment(OPS, dep.data.id, 0);
    expect(zero.ok && zero.data.status).toBe('scaled-to-zero');
    const up = await s.scaleDeployment(OPS, dep.data.id, 1);
    expect(up.ok && up.data.replicas).toBe(1);
    expect(up.ok && up.data.replicaHistory?.length).toBe(3); // 建立 1 → 0 → 1
    const noGpu = await s.scaleDeployment(OPS, dep.data.id, 2); // 台北 A 已無可用 GPU
    expect(!noGpu.ok && noGpu.code).toBe('INSUFFICIENT_GPUS');
    // 低於 minReplicas（qwen27b-shared min 2）→ 400；0 但未啟用縮至零 → 400；專屬池售滿擴縮 → 409
    const belowMin = await s.scaleDeployment(OPS, 'dep-qwen27b-shared', 1);
    expect(!belowMin.ok && belowMin.status).toBe(400);
    expect(!belowMin.ok && belowMin.message).toContain('下限');
    const noS2z = await s.scaleDeployment(OPS, 'dep-qwen27b-shared', 0);
    expect(!noS2z.ok && noS2z.status).toBe(400);
    const dedicatedFull = await s.scaleDeployment(OPS, 'dep-union-assist-dedicated', 3);
    expect(!dedicatedFull.ok && dedicatedFull.code).toBe('DEDICATED_POOL_EXHAUSTED');
    // 服務異常的台中 C 不可擴縮
    const svc = await s.scaleDeployment(OPS, 'dep-coder-c', 1);
    expect(!svc.ok && svc.code).toBe('CLUSTER_NOT_CONNECTED');
    const inUse = await s.deleteDeployment(OPS, 'dep-gptoss-shared');
    expect(!inUse.ok && inUse.code).toBe('DEPLOYMENT_IN_USE');
    const del = await s.deleteDeployment(OPS, dep.data.id);
    expect(del.ok).toBe(true);
    const customerDel = await s.deleteDeployment(as('u-admin-star'), 'dep-embed-shared');
    expect(!customerDel.ok && customerDel.status).toBe(403);
  });

  it('縮至零的部署在 Playground 回 503 DEPLOYMENT_SCALING_UP；專屬部署只服務對應的路由／專案（p-risk → risk-local），同租戶其他專案（p-advisor）走共用部署按牌價；回應帶 x-maas-model', async () => {
    const s = fresh();
    const res = await s.invokePlayground(OWNER, { modelId: 'qwen3-coder-30b-a3b-vllm', tenantId: 't-star', projectId: 'p-cs-bot', system: '', messages: [{ role: 'user', content: 'hi' }], temperature: 0.5, maxTokens: 100, enableThinking: false });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(503);
      expect(res.code).toBe('DEPLOYMENT_SCALING_UP');
    }
    const input = { modelId: 'qwen3.8-27b-vllm', tenantId: 't-union', system: '', messages: [{ role: 'user' as const, content: 'hi' }], temperature: 0.5, maxTokens: 100, enableThinking: false };
    const union = await s.invokePlayground(as('u-op-union'), { ...input, projectId: 'p-risk' });
    expect(union.ok).toBe(true);
    if (union.ok) {
      expect(union.data.deploymentId).toBe('dep-union-qwen27b-dedicated');
      expect(union.data.headers['x-maas-sharing']).toBe('dedicated');
      expect(union.data.headers['x-maas-route']).toBe('risk-local');
      expect(union.data.headers['x-maas-model']).toBe('qwen3.8-27b-vllm');
      expect(union.data.billingBasis).toBe('dedicated');
      expect(union.data.estimatedCostUsd).toBe(0);
    }
    const advisor = await s.invokePlayground(as('u-op-union'), { ...input, projectId: 'p-advisor' });
    expect(advisor.ok).toBe(true);
    if (advisor.ok) {
      expect(advisor.data.deploymentId).toBe('dep-qwen27b-shared');
      expect(advisor.data.headers['x-maas-sharing']).toBe('shared');
      expect(advisor.data.headers['x-maas-route']).toBe('qwen-plus');
      expect(advisor.data.headers['x-maas-model']).toBe('qwen3.8-27b-vllm');
      expect(advisor.data.billingBasis).toBe('token');
      expect(advisor.data.estimatedCostUsd).toBeGreaterThan(0);
    }
  });
});

describe('路由與溢出', () => {
  it('僅自建政策不可啟用溢出（400）；啟用溢出需雲端目標；自建優先的主要目標只能是自建（100）；目標區域必須在 allowedRegions 內、prefer-intl 不可含 cn-beijing；門檻為 KV cache + 每副本佇列；平台營運沒有 model.route.update', async () => {
    const s = fresh();
    const routes = await s.listRoutes(OPS);
    const risk = routes.ok ? routes.data.find((r) => r.alias === 'risk-local')! : null;
    const bad = await s.updateRouting(OWNER, risk!.id, { spillover: { enabled: true, threshold: { queueDepth: 4, kvCacheUsage: 0.85 }, target: { providerId: 'bailian', region: 'ap-southeast-1', modelId: 'qwen3.7-plus', weight: 100 } } });
    expect(!bad.ok && bad.status).toBe(400);
    const qp = routes.ok ? routes.data.find((r) => r.alias === 'qwen-plus')! : null;
    // 種子：自建優先 = 自建權重 100、備援與溢出都不含 cn-beijing、有 allowedRegions
    expect(qp!.targets).toEqual([{ providerId: 'vllm', region: 'tw-tpe-a', modelId: 'qwen3.8-27b-vllm', weight: 100 }]);
    expect([...qp!.targets, ...qp!.fallbackChain, qp!.spillover.target!].some((t) => t.region === 'cn-beijing')).toBe(false);
    expect(qp!.allowedRegions).toContain('ap-southeast-1');
    expect(qp!.spillover.threshold.kvCacheUsage).toBeGreaterThanOrEqual(0.8);
    expect(qp!.spillover.threshold.queueDepth).toBeGreaterThanOrEqual(3);
    for (const r of routes.ok ? routes.data : []) {
      const all = [...r.targets, ...r.fallbackChain, ...(r.spillover.target ? [r.spillover.target] : [])];
      expect(all.every((t) => r.allowedRegions.includes(t.region)), r.alias).toBe(true);
      if (r.regionPolicy === 'prefer-intl' || r.regionPolicy === 'intl-only') expect(all.some((t) => t.region.startsWith('cn-beijing')), r.alias).toBe(false);
      if (r.placementPolicy === 'local-first') expect(r.targets.every((t) => t.providerId === 'vllm') && r.targets.reduce((a, t) => a + t.weight, 0) === 100, r.alias).toBe(true);
    }
    const noTarget = await s.updateRouting(OWNER, qp!.id, { spillover: { enabled: true, threshold: { queueDepth: 4, kvCacheUsage: 0.8 }, target: null } });
    expect(!noTarget.ok && noTarget.status).toBe(400);
    // 區域不在白名單 → 400
    const outside = await s.updateRouting(OWNER, qp!.id, { spillover: { enabled: true, threshold: { queueDepth: 4, kvCacheUsage: 0.8 }, target: { providerId: 'openai', region: 'openai-global', modelId: 'gpt-5-mini', weight: 100 } } });
    expect(!outside.ok && outside.status).toBe(400);
    expect(!outside.ok && outside.message).toContain('允許區域');
    // prefer-intl 加入 cn-beijing → 400
    const cn = await s.updateRouting(OWNER, qp!.id, { allowedRegions: [...qp!.allowedRegions, 'cn-beijing'], fallbackChain: [{ providerId: 'bailian', region: 'cn-beijing', modelId: 'qwen3.7-plus', weight: 100 }] });
    expect(!cn.ok && cn.status).toBe(400);
    expect(!cn.ok && cn.message).toContain('中國站');
    // 自建優先的主要目標含雲端 → 400
    const mixed = await s.updateRouting(OWNER, qp!.id, { targets: [{ providerId: 'vllm', region: 'tw-tpe-a', modelId: 'qwen3.8-27b-vllm', weight: 70 }, { providerId: 'bailian', region: 'ap-southeast-1', modelId: 'qwen3.7-plus', weight: 30 }] });
    expect(!mixed.ok && mixed.status).toBe(400);
    // 合法更新：白名單內的雲端目標 + 新門檻；舊格式（只有 gpuUtil）會補上 kvCacheUsage 預設值
    const ok = await s.updateRouting(OWNER, qp!.id, { spillover: { enabled: true, threshold: { queueDepth: 3, kvCacheUsage: 0.8 }, target: { providerId: 'bailian', region: 'ap-southeast-1', modelId: 'qwen3.8-flash', weight: 100 } } });
    expect(ok.ok && ok.data.spillover.threshold.queueDepth).toBe(3);
    expect(ok.ok && ok.data.spillover.threshold.kvCacheUsage).toBe(0.8);
    const legacy = await s.updateRouting(OWNER, qp!.id, { spillover: { enabled: true, threshold: { queueDepth: 5, gpuUtil: 0.85 } as unknown as { queueDepth: number; kvCacheUsage: number }, target: { providerId: 'bailian', region: 'ap-southeast-1', modelId: 'qwen3.7-plus', weight: 100 } } });
    expect(legacy.ok && legacy.data.spillover.threshold.kvCacheUsage).toBe(0.85);
    expect(s.audit.all().some((e) => e.action === 'model.route.update' && e.decision === 'allow' && e.resourceId === qp!.id)).toBe(true);
    const ops = await s.updateRouting(OPS, qp!.id, { placementPolicy: 'local-first' });
    expect(!ops.ok && ops.status).toBe(403);
  });

  it('跨境同意：溢出目標區域不在租戶同意清單 → 429 local_capacity_exhausted（reason no_cross_border_consent，視同僅自建）；在清單內才溢出；直接呼叫未同意區域的雲端模型 → 400', async () => {
    const s = fresh();
    const input = { modelId: 'qwen3.8-27b-vllm', tenantId: 't-star', projectId: 'p-cs-bot', system: '', messages: [{ role: 'user' as const, content: 'hi' }], temperature: 0.5, maxTokens: 100, enableThinking: false };
    s.options.simulateLocalExhausted = true;
    const ok = await s.invokePlayground(OWNER, input);
    expect(ok.ok && ok.data.tier).toBe('spillover');
    expect(ok.ok && ok.data.headers['x-maas-region']).toBe('ap-southeast-1');
    expect(ok.ok && ok.data.headers['x-maas-model']).toBe('qwen3.7-plus');
    // 建一個沒有新加坡同意的租戶（只同意 anthropic-global）→ 同一別名容量耗盡時不溢出
    const t = await s.createTenant(OWNER, { name: '無新加坡同意客戶', plan: 'payg', dataClass: 'general', allowedTiers: 'both', quotas: { rpm: 100, tpm: 100_000, monthlyBudgetUsd: 1000 }, costCenter: 'CC-9', billingContact: { name: 'x', email: 'x@y.co' }, allowedModels: ['qwen-plus', 'claude-haiku-4.5', 'qwen3.8-flash'], crossBorderConsent: { regions: ['anthropic-global'] }, initialCreditUsd: 100 });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    const projects = await s.listProjects(OWNER, t.data.id);
    const pid = projects.ok ? projects.data[0].id : '';
    const denied = await s.invokePlayground(OWNER, { ...input, tenantId: t.data.id, projectId: pid });
    expect(!denied.ok && denied.status).toBe(429);
    expect(!denied.ok && denied.code).toBe('local_capacity_exhausted');
    expect(!denied.ok && denied.headers?.['x-maas-deny-reason']).toBe('no_cross_border_consent');
    expect(!denied.ok && denied.retryAfterSec).toBe(15);
    // 直接呼叫雲端模型：Anthropic 已同意 → 可；百煉新加坡未同意 → 400 TIER_NOT_ALLOWED（視同僅自建）
    s.options.simulateLocalExhausted = false;
    const haiku = await s.invokePlayground(OWNER, { ...input, tenantId: t.data.id, projectId: pid, modelId: 'claude-haiku-4.5' });
    expect(haiku.ok && haiku.data.headers['x-maas-region']).toBe('anthropic-global');
    const flash = await s.invokePlayground(OWNER, { ...input, tenantId: t.data.id, projectId: pid, modelId: 'qwen3.8-flash' });
    expect(!flash.ok && flash.code).toBe('TIER_NOT_ALLOWED');
    expect(!flash.ok && flash.headers?.['x-maas-policy']).toBe('no_cross_border_consent');
    // 種子：公部門沒有跨境同意；星耀／聯合有新加坡
    const tenants = await s.listTenants(OWNER);
    if (tenants.ok) {
      expect(tenants.data.find((x) => x.id === 't-gov')?.crossBorderConsent).toBeUndefined();
      expect(tenants.data.find((x) => x.id === 't-star')?.crossBorderConsent?.regions).toContain('ap-southeast-1');
      expect(tenants.data.find((x) => x.id === 't-union')?.crossBorderConsent?.regions).toContain('ap-southeast-1');
      expect(tenants.data.every((x) => !(x.crossBorderConsent?.regions ?? []).includes('cn-beijing'))).toBe(true);
    }
    // createTenant：未附同意時 allowedTiers 預設 local；附同意預設 both；同意含未連接區域 400
    const defLocal = await s.createTenant(OWNER, { name: '預設僅自建', plan: 'payg', dataClass: 'general', quotas: { rpm: 1, tpm: 1, monthlyBudgetUsd: 1 }, costCenter: 'c', billingContact: { name: 'n', email: 'a@b.co' } });
    expect(defLocal.ok && defLocal.data.allowedTiers).toBe('local');
    const defBoth = await s.createTenant(OWNER, { name: '預設可溢出', plan: 'payg', dataClass: 'general', quotas: { rpm: 1, tpm: 1, monthlyBudgetUsd: 1 }, costCenter: 'c', billingContact: { name: 'n', email: 'a@b.co' }, crossBorderConsent: { regions: ['ap-southeast-1'] } });
    expect(defBoth.ok && defBoth.data.allowedTiers).toBe('both');
    const badRegion = await s.createTenant(OWNER, { name: '壞區域', plan: 'payg', dataClass: 'general', quotas: { rpm: 1, tpm: 1, monthlyBudgetUsd: 1 }, costCenter: 'c', billingContact: { name: 'n', email: 'a@b.co' }, crossBorderConsent: { regions: ['mars-1'] } });
    expect(!badRegion.ok && badRegion.status).toBe(400);
  });

  it('正常情況自建請求由我們的 GPU 服務並帶 x-maas-deployment／x-maas-cluster／x-maas-sharing: shared；費用為 token 牌價', async () => {
    const s = fresh();
    const res = await s.invokePlayground(as('u-op-star'), { modelId: 'qwen3.8-27b-vllm', tenantId: 't-star', projectId: 'p-cs-bot', system: '', messages: [{ role: 'user', content: 'hi' }], temperature: 0.5, maxTokens: 100, enableThinking: false });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.servedBy).toBe('local');
      expect(res.data.headers['x-maas-deployment']).toBe('dep-qwen27b-shared');
      expect(res.data.headers['x-maas-cluster']).toBe('cl-tpe-a');
      expect(res.data.headers['x-maas-tier']).toBe('local');
      expect(res.data.headers['x-maas-sharing']).toBe('shared');
      expect(res.data.headers['x-maas-spillover-from']).toBeUndefined();
      expect(res.data.billingBasis).toBe('token');
      expect(res.data.estimatedCostUsd).toBeCloseTo(s.tokenCharge('qwen3.8-27b-vllm', res.data.inputTokens, 0, res.data.outputTokens), 9);
      expect(res.data.curl).toContain('curl -i');
    }
  });

  it('方案允許清單：不在清單的模型 → 400 MODEL_NOT_ALLOWED', async () => {
    const s = fresh();
    const res = await s.invokePlayground(as('u-op-union'), { modelId: 'gpt-oss-120b-vllm', tenantId: 't-union', projectId: 'p-risk', system: '', messages: [{ role: 'user', content: 'hi' }], temperature: 0.5, maxTokens: 100, enableThinking: false });
    expect(!res.ok && res.code).toBe('MODEL_NOT_ALLOWED');
  });
});

describe('向客戶收費與平台毛利', () => {
  it('用量種子：自建層承接絕大多數 tokens（≥ 75%）、溢出佔請求 0.5–5%，三種層級皆有資料；自建層有快取 tokens 並標示服務部署', () => {
    const rows = generateUsage();
    const totalReq = rows.reduce((a, r) => a + r.requests, 0);
    const totalTok = rows.reduce((a, r) => a + r.inputTokens + r.outputTokens, 0);
    const localTok = rows.filter((r) => r.tier === 'local').reduce((a, r) => a + r.inputTokens + r.outputTokens, 0);
    const spillReq = rows.filter((r) => r.tier === 'spillover').reduce((a, r) => a + r.requests, 0);
    expect(localTok / totalTok).toBeGreaterThanOrEqual(0.75);
    expect(spillReq / totalReq).toBeGreaterThanOrEqual(0.005);
    expect(spillReq / totalReq).toBeLessThanOrEqual(0.05);
    expect(rows.some((r) => r.tier === 'spillover')).toBe(true);
    expect(rows.some((r) => r.tier === 'cloud')).toBe(true);
    expect(rows.filter((r) => r.tier === 'local').every((r) => r.gpuHours > 0 && r.costUsd === 0 && r.deploymentId !== null && r.sharing !== null)).toBe(true);
    expect(rows.filter((r) => r.tier !== 'local').every((r) => r.deploymentId === null && r.sharing === null && r.region !== '')).toBe(true);
    expect(rows.some((r) => r.tier === 'local' && r.cachedInputTokens > 0)).toBe(true);
    // 聯合金融 p-risk 只由新竹 B 的專屬部署服務；p-advisor 由台北 A 共用 Qwen 服務
    expect(rows.filter((r) => r.projectId === 'p-risk' && r.tier === 'local').every((r) => r.sharing === 'dedicated' && r.region === 'tw-hc-b')).toBe(true);
    expect(rows.filter((r) => r.projectId === 'p-advisor' && r.tier === 'local').every((r) => r.deploymentId === 'dep-qwen27b-shared' && r.sharing === 'shared')).toBe(true);
    // 公部門只用非中國來源模型、不上雲
    expect(rows.filter((r) => r.tenantId === 't-gov').every((r) => r.tier === 'local' && MODEL_BY_ID[r.modelId].origin !== 'cn')).toBe(true);
  });

  it('用量一致性：每叢集 Σ GPU-hr ≤ 配置 GPU × 小時 × 0.8；每部署每日 tokens 推得的 tok/s ≤ 容量 × 利用率；GPU-hr 與 tokPerSecPerGpu 同一套換算', () => {
    const rows = generateUsage();
    const nov = rows.filter((r) => r.date >= '2026-11-01' && r.tier === 'local');
    for (const c of CLUSTERS) {
      const gh = nov.filter((r) => r.region === c.region).reduce((s, r) => s + r.gpuHours, 0);
      expect(gh, c.id).toBeLessThanOrEqual(c.gpuAllocated * 24 * 8 * 0.8);
      expect(gh, c.id).toBeLessThanOrEqual(c.gpuTotal * 24 * 8);
    }
    for (const d of DEPLOYMENTS) {
      const c = CLUSTERS.find((x) => x.id === d.clusterId)!;
      const byDay: Record<string, number> = {};
      for (const r of nov.filter((r) => r.deploymentId === d.id)) byDay[r.date] = (byDay[r.date] ?? 0) + r.inputTokens + r.outputTokens;
      const maxDay = Math.max(0, ...Object.values(byDay));
      expect(maxDay / 86_400, d.id).toBeLessThanOrEqual(d.tokPerSec * d.replicas * d.utilization + 1);
      // 單一吞吐查表：部署 tokPerSec ＝ 每卡 × 卡數 × TP 效率
      expect(d.tokPerSec, d.id).toBe(tokPerSecPerReplica(d.modelId, c.gpuType, d.quantization, d.gpusPerReplica));
      if (d.replicas === 0) expect(maxDay).toBe(0);
    }
    // 研究筆記區間：27B FP8 on H100 ≈ 2–4k；70B FP8 on H200 ≈ 1.9–3.3k；嵌入遠高於生成模型
    const q27 = tokPerSecPerGpu('qwen3.8-27b-vllm', 'H100 80GB', 'FP8');
    expect(q27).toBeGreaterThanOrEqual(2000);
    expect(q27).toBeLessThanOrEqual(4000);
    const l70 = tokPerSecPerGpu('llama-3.3-70b-vllm', 'H200 141GB', 'FP8');
    expect(l70).toBeGreaterThanOrEqual(1900);
    expect(l70).toBeLessThanOrEqual(3300);
    expect(tokPerSecPerGpu('qwen3-embedding-8b-vllm', 'H100 80GB', 'BF16')).toBeGreaterThan(q27 * 3);
    expect(tokPerSecPerGpu(27, 'H100 80GB', 'FP8')).toBe(GPU_SPECS['H100 80GB'].refTokPerSec);
    // 供應商頁的自建容量 tokensPerSec ＝ Σ 就緒部署 tokPerSec × 副本
    expect(PROVIDER_BY_ID.vllm.capacity!.tokensPerSec).toBe(fleetPeakTokPerSec());
  });

  it('內部成本公式：GPU TCO × GPU 數 ÷ (tok/s × 利用率 × 3600) × 1e6；混合牌價與毛利率', () => {
    const p = internalUnitPrice(2.1, 2, 2400, 0.71);
    expect(p).toBeCloseTo(((2.1 * 2) / (2400 * 0.71 * 3600)) * 1e6, 6);
    expect(internalUnitPrice(2.1, 2, 2400, 1)).toBeLessThan(p);
    expect(blendedListPrice(0.2, 0.6)).toBeCloseTo(0.32, 9);
    expect(grossMargin(0.32, p)).toBeCloseTo((0.32 - p) / 0.32, 9);
  });

  it('token 牌價：快取讀取 × 0.1、快取寫入 × 1.25；代理開放模型加價 15%', () => {
    const s = fresh();
    // Qwen3.8-27B：0.20 / 0.60
    expect(s.tokenCharge('qwen3.8-27b-vllm', 1_000_000, 0, 1_000_000)).toBeCloseTo(0.8, 9);
    // 500k 快取讀取：0.5M × 0.2 + 0.5M × 0.2 × 0.1 = 0.10 + 0.01
    expect(s.tokenCharge('qwen3.8-27b-vllm', 1_000_000, 500_000, 0)).toBeCloseTo(0.1 + 0.01, 9);
    // 200k 快取寫入：0.8M × 0.2 + 0.2M × 0.2 × 1.25 = 0.16 + 0.05
    expect(s.tokenCharge('qwen3.8-27b-vllm', 1_000_000, 0, 0, 200_000)).toBeCloseTo(0.16 + 0.05, 9);
    expect(s.cloudCharge(100)).toBeCloseTo(115, 9);
  });

  it('getUnitPrices（成本 vs 定價 vs 毛利）只給我們的擁有者／財務；調整 TCO 後重算；客戶 403', async () => {
    const s = fresh();
    const before = await s.getUnitPrices(FIN);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const row = before.data.find((r) => r.deploymentId === 'dep-qwen27b-shared')!;
    expect(row.costUsdPerGpuHour).toBe(2.0);
    expect(row.listUsdPerGpuHour).toBe(3.9);
    expect(row.listBlendedUsdPerMTok).toBeCloseTo(0.32, 3);
    expect(row.tokenMarginPct).not.toBeNull();
    expect(row.tokenMarginPct!).toBeGreaterThan(0);
    expect(row.cloudComparables.some((c) => c.modelId === 'qwen3.8-27b')).toBe(true);
    expect(row.marketRefUsd?.source).toContain('2026-11-09');
    // 達 40% 毛利所需利用率：u* ＝ 100% 成本 ÷ (混合牌價 × 0.6)（4,000 tok/s/GPU、TCO 2.0 → ≈ 0.72）
    expect(row.targetMarginPct).toBe(40);
    expect(row.utilizationForTargetMargin).toBeCloseTo(row.floorUsdPerMTok / (row.listBlendedUsdPerMTok * 0.6), 2);
    expect(row.utilizationForTargetMargin!).toBeGreaterThan(0.5);
    expect(row.utilizationForTargetMargin!).toBeLessThan(1);
    expect(utilizationForTargetMargin(0.1228, 0.32, 0.4)).toBeCloseTo(0.64, 2); // 舊種子 4,750 tok/s/GPU 時的值
    const taide = before.data.find((r) => r.deploymentId === 'dep-taide-shared')!;
    expect(taide.tokenMarginPct!).toBeLessThan(0); // 低利用率的小模型：毛利為負，定價原則的示範
    const llama = before.data.find((r) => r.deploymentId === 'dep-llama70b-shared')!;
    expect(llama.utilizationForTargetMargin!).toBeGreaterThan(1); // 70B 稠密以市場價無法達 40%：UI 顯示「以此牌價無法達標」
    // 專屬部署（收 GPU 時數）與 0 副本／利用率 0 的部署：token 毛利 n/a
    const dedicated = before.data.find((r) => r.deploymentId === 'dep-union-assist-dedicated')!;
    expect(dedicated.tokenMarginPct).toBeNull();
    expect(dedicated.utilizationForTargetMargin).toBeNull();
    expect(dedicated.gpuHourMarginPct).toBeCloseTo(((4.9 - 2.4) / 4.9) * 100, 0);
    const coder = before.data.find((r) => r.deploymentId === 'dep-coder-c')!;
    expect(coder.tokenMarginPct).toBeNull();
    expect(coder.utilizationForTargetMargin).not.toBeNull(); // 仍可告訴財務「要多少利用率才划算」
    // 嵌入模型：以嵌入專用吞吐估算，不會出現荒謬的負毛利（u* < 1）
    const embed = before.data.find((r) => r.deploymentId === 'dep-embed-shared')!;
    expect(embed.utilizationForTargetMargin!).toBeLessThan(1);
    expect(embed.tokenMarginPct!).toBeGreaterThan(-100);
    const denied = await s.updateBillingSettings(as('u-billing-union'), { gpuCostUsdPerHour: { 'H100 80GB': 4.0 } });
    expect(!denied.ok && denied.status).toBe(403);
    const opsDenied = await s.updateBillingSettings(OPS, { cloudMarkupPct: 20 });
    expect(!opsDenied.ok && opsDenied.status).toBe(403);
    const ok = await s.updateBillingSettings(FIN, { gpuCostUsdPerHour: { 'H100 80GB': 4.0 } });
    expect(ok.ok).toBe(true);
    const after = await s.getUnitPrices(FIN);
    if (after.ok) expect(after.data.find((r) => r.deploymentId === 'dep-qwen27b-shared')!.internalUsdPerMTok).toBeCloseTo(row.internalUsdPerMTok * 2, 2);
    const customer = await s.getUnitPrices(as('u-admin-star'));
    expect(!customer.ok && customer.status).toBe(403);
    const bad = await s.updateBillingSettings(FIN, { tokenPrices: { 'qwen3.8-max': { input: 1, output: 1 } } });
    expect(!bad.ok && bad.status).toBe(400);
    expect(s.audit.all().some((e) => e.action === 'billing.configure' && e.resourceId === 'billing' && e.decision === 'allow' && e.actorId === 'u-finance')).toBe(true);
  });

  it('客戶對帳單：承諾用量（星耀）＝token 費 + 雲端代理 − 折扣（+ 最低消費補足）；專屬部署（聯合）＝GPU 時數 × 牌價且專屬模型 tokens 不計；公部門無雲端費用；跨租戶 403', async () => {
    const s = fresh();
    const st = await s.getBillingStatement(as('u-admin-star'), 't-star', '2026-11');
    expect(st.ok).toBe(true);
    if (st.ok) {
      const c = st.data.charges;
      expect(st.data.plan).toBe('committed');
      expect(st.data.costCenter).toContain('CC-1100');
      expect(c.dedicated.usd).toBe(0);
      expect(c.localTokens.usd).toBeGreaterThan(0);
      expect(c.localTokens.byModel.every((m) => m.basis === 'token')).toBe(true);
      // 加價只適用代理開放模型（百煉）；閉源模型（Claude Haiku）以牌價 −10% 計並列為 discountUsd
      expect(c.cloud.markupUsd).toBeCloseTo(c.cloud.byModel.filter((m) => m.kind === 'proxied-open').reduce((a, m) => a + m.listUsd, 0) * 0.15, 0);
      expect(c.cloud.discountUsd).toBeCloseTo(c.cloud.byModel.filter((m) => m.kind === 'proxied-closed').reduce((a, m) => a + m.listUsd, 0) * 0.1, 0);
      expect(c.cloud.usd).toBeCloseTo(c.cloud.listUsd + c.cloud.markupUsd - c.cloud.discountUsd, 0);
      expect(c.subtotalUsd).toBeCloseTo(c.localTokens.usd + c.dedicated.usd + c.cloud.usd, 1);
      expect(c.commitment).not.toBeNull();
      if (c.commitment) {
        expect(c.commitment.proratedUsd).toBeCloseTo((15000 * 8) / 30, 0);
        expect(c.commitment.discountUsd).toBeCloseTo(c.commitment.proratedUsd * 0.15, 0);
        expect(c.totalUsd).toBeCloseTo(c.subtotalUsd - c.commitment.discountUsd + c.commitment.shortfallUsd, 0);
      }
      expect(c.totalTwd).toBe(Math.round(c.totalUsd * 32.5));
      expect(st.data.spillover.requests).toBeGreaterThan(0);
      expect(['ok', 'warning', 'critical']).toContain(st.data.budget.alert);
      expect(st.data.projects.length).toBeGreaterThan(0);
    }
    const union = await s.getBillingStatement(as('u-billing-union'), 't-union', '2026-11');
    expect(union.ok).toBe(true);
    if (union.ok) {
      const c = union.data.charges;
      expect(union.data.plan).toBe('dedicated');
      // 專屬：assist 2 副本 × 2 GPU + qwen27b 2 × 2 GPU = 8 × H200 × 24 × 8 天 × US$4.9（皆於期間前建立 → 整期）
      expect(c.dedicated.gpuHours).toBe(8 * 24 * 8);
      expect(c.dedicated.usd).toBeCloseTo(8 * 24 * 8 * 4.9, 0);
      expect(c.dedicated.items.map((i) => i.deploymentId).sort()).toEqual(['dep-union-assist-dedicated', 'dep-union-qwen27b-dedicated']);
      // 按「服務部署」分列：p-risk 的 Qwen／Assist tokens 走專屬 → 0；p-advisor 的 Qwen tokens 走台北 A 共用 → 按牌價
      const dedicatedRows = c.localTokens.byModel.filter((m) => m.basis === 'dedicated');
      expect(dedicatedRows.map((m) => m.deploymentId).sort()).toEqual(['dep-union-assist-dedicated', 'dep-union-qwen27b-dedicated']);
      expect(dedicatedRows.every((m) => m.usd === 0 && m.tokens > 0)).toBe(true);
      const sharedQwen = c.localTokens.byModel.find((m) => m.modelId === 'qwen3.8-27b-vllm' && m.basis === 'token');
      expect(sharedQwen?.deploymentId).toBe('dep-qwen27b-shared');
      expect(sharedQwen!.usd).toBeGreaterThan(0);
      expect(c.localTokens.usd).toBeGreaterThan(0);
      expect(union.data.projects.find((p) => p.projectId === 'p-risk')!.localTokenUsd).toBe(0);
      expect(union.data.projects.find((p) => p.projectId === 'p-advisor')!.localTokenUsd).toBeGreaterThan(0);
      expect(c.commitment).toBeNull();
      expect(c.totalUsd).toBeCloseTo(c.localTokens.usd + c.dedicated.usd + c.cloud.usd, 0);
    }
    const gov = await s.getBillingStatement(as('u-admin-gov'), 't-gov', '2026-11');
    expect(gov.ok && gov.data.plan).toBe('payg');
    expect(gov.ok && gov.data.cloud.requests).toBe(0);
    expect(gov.ok && gov.data.charges.cloud.usd).toBe(0);
    expect(gov.ok && gov.data.charges.localTokens.usd).toBeGreaterThan(0);
    const cross = await s.getBillingStatement(as('u-admin-star'), 't-union', '2026-11');
    expect(!cross.ok && cross.status).toBe(403);
    const badMonth = await s.getBillingStatement(OWNER, 't-star', '2026/11');
    expect(!badMonth.ok && badMonth.status).toBe(400);
  });

  it('專屬 GPU 時數按建立時間／副本歷史在期間內按分鐘比例：新建的專屬部署在本期（11-01 ～ 11-08）為 0 小時但列於明細；期間前建立者整期；期中擴縮依歷史積分', async () => {
    const s = fresh();
    const before = await s.getBillingStatement(OWNER, 't-star', '2026-11');
    const dep = await s.createDeployment(OPS, depInput({ name: 'star-dedicated-taide', clusterId: 'cl-tpe-a', sharing: 'dedicated', dedicatedTenantId: 't-star', modelId: 'taide-lx-8b-vllm', quantization: 'BF16', gpusPerReplica: 1, replicas: 1, allowSharedFallback: true }));
    expect(dep.ok).toBe(true);
    const after = await s.getBillingStatement(OWNER, 't-star', '2026-11');
    // 現在（真實時鐘）在 11-08 之後 → 本期內存在 0 小時，不會憑空多出 1 × 24 × 8 小時
    expect(before.ok && after.ok && after.data.charges.dedicated.usd - before.data.charges.dedicated.usd).toBeCloseTo(0, 2);
    const item = after.ok ? after.data.charges.dedicated.items.find((i) => i.deploymentName === 'star-dedicated-taide') : undefined;
    expect(item?.gpuType).toBe('H100 80GB');
    expect(item?.hours).toBe(0);
    // 星耀的 qwen27b 仍走共用（token 牌價）
    expect(after.ok && after.data.charges.localTokens.byModel.find((m) => m.modelId === 'qwen3.8-27b-vllm')?.basis).toBe('token');
    // 純函式：期間 11-01 ～ 11-09（8 天）
    const start = new Date('2026-11-01T00:00:00+08:00');
    const end = new Date('2026-11-09T00:00:00+08:00');
    expect(dedicatedGpuHours({ createdAt: '2026-04-20T10:00:00+08:00', replicas: 2, gpusPerReplica: 2 }, start, end)).toBe(4 * 24 * 8);
    // 11-05 00:00 從 1 副本擴到 2：4 天 × 2 GPU + 4 天 × 4 GPU
    expect(dedicatedGpuHours({ createdAt: '2026-10-01T00:00:00+08:00', replicas: 2, gpusPerReplica: 2, replicaHistory: [{ at: '2026-10-01T00:00:00+08:00', replicas: 1 }, { at: '2026-11-05T00:00:00+08:00', replicas: 2 }] }, start, end)).toBe(4 * 24 * 2 + 4 * 24 * 4);
    // 期中（11-07 12:00）建立：1.5 天 × 2 GPU
    expect(dedicatedGpuHours({ createdAt: '2026-11-07T12:00:00+08:00', replicas: 1, gpusPerReplica: 2 }, start, end)).toBe(36 * 2);
    // 期後建立：0
    expect(dedicatedGpuHours({ createdAt: '2026-11-20T00:00:00+08:00', replicas: 1, gpusPerReplica: 2 }, start, end)).toBe(0);
    expect(overlapHours('2026-11-08T00:00:00+08:00', start, end)).toBe(24);
    expect(overlapHours('2026-01-01T00:00:00+08:00', start, end)).toBe(8 * 24);
    // 叢集 TCO 同樣按 createdAt 比例：新註冊的機房不會把整期 TCO 算進本月
    const s2 = new MockServer({ latency: [0, 0], agentConnectMs: 0, deploymentReadyMs: 0, drainMs: 0 });
    const revBefore = await s2.getRevenue(FIN, '2026-11');
    await s2.registerCluster(OPS, regInput);
    const revAfter = await s2.getRevenue(FIN, '2026-11');
    expect(revBefore.ok && revAfter.ok && revAfter.data.gpuCostUsd).toBeCloseTo(revBefore.ok ? revBefore.data.gpuCostUsd : -1, 2);
    expect(revAfter.ok && revAfter.data.fleet.gpuTotal).toBe(48);
  });

  it('平台營收與毛利：只給平台範圍 billing.read；營收＝各租戶對帳單合計；毛利＝營收 − GPU TCO − 雲端牌價', async () => {
    const s = fresh();
    const rev = await s.getRevenue(FIN);
    expect(rev.ok).toBe(true);
    if (rev.ok) {
      const r = rev.data;
      expect(r.byTenant.length).toBe(4);
      expect(r.totalRevenueUsd).toBeCloseTo(r.byTenant.reduce((a, t) => a + t.revenueUsd, 0), 0);
      // TCO：8 × H100 × 2.0 + 16 × H200 × 2.4 + 8 × L40S × 0.6，× 24 × 8 天（含閒置與服務異常）
      expect(r.gpuCostUsd).toBeCloseTo((8 * 2.0 + 16 * 2.4 + 8 * 0.6) * 24 * 8, 0);
      expect(r.grossMarginPct).toBeGreaterThanOrEqual(20); // 示範敘事：平台正毛利約 20–35%
      expect(r.grossMarginPct).toBeLessThanOrEqual(35);
      expect(r.grossProfitUsd).toBeCloseTo(r.totalRevenueUsd - r.gpuCostUsd - r.cloudListCostUsd, 0);
      expect(r.grossMarginPct).toBeCloseTo((r.grossProfitUsd / r.totalRevenueUsd) * 100, 0);
      expect(r.fleet.gpuTotal).toBe(32);
      expect(r.fleet.utilization).toBeGreaterThanOrEqual(0.45);
      expect(r.fleet.utilization).toBeLessThanOrEqual(0.65);
      expect(r.byModel.some((m) => m.modelId === 'qwen3.8-27b-vllm' && (m.marginPct ?? -1) > 0)).toBe(true);
      // 只由專屬部署服務的模型（MaaS-Assist）不收 token 費 → 毛利 n/a
      expect(r.byModel.find((m) => m.modelId === 'maas-assist-27b')?.marginPct).toBeNull();
      // 代理開放模型（百煉）毛利 = 15/115；閉源模型毛利 = (0.9 − 0.85)/0.9；合計成本為我們實付（含議價折扣）
      expect(r.proxiedOpen.marginPct).toBeCloseTo((15 / 115) * 100, 0);
      expect(r.proxiedClosed.marginPct).toBeCloseTo(((0.9 - 0.85) / 0.9) * 100, 0);
      expect(r.cloudListCostUsd).toBeCloseTo(r.proxiedOpen.costUsd + r.proxiedClosed.costUsd, 1);
      expect(r.cloudRevenueUsd).toBeCloseTo(r.proxiedOpen.revenueUsd + r.proxiedClosed.revenueUsd, 1);
      expect(r.prepaidTopupsUsd).toBeCloseTo(2020, 2); // 公部門自動儲值 2,000 + 試用贈送 20
      // 溢出佔比：幾個百分點以內；代理模型只是少數
      expect(r.cloudRevenueUsd).toBeLessThan(r.totalRevenueUsd * 0.25);
    }
    const oct = await s.getRevenue(FIN, '2026-10');
    expect(oct.ok && oct.data.grossMarginPct).toBeGreaterThanOrEqual(20);
    const owner = await s.getOverview(OWNER);
    expect(owner.ok && owner.data.audience).toBe('vendor');
    expect(owner.ok && owner.data.revenue !== null && owner.data.vendor !== null).toBe(true);
    if (owner.ok && owner.data.vendor) {
      expect(owner.data.vendor.clustersTotal).toBe(3);
      expect(owner.data.vendor.activeTenants).toBe(4);
      expect(owner.data.vendor.trialFunnel).toEqual({ submitted: 2, approved: 1, converted: 0 });
      expect(owner.data.vendor.weekTokens.local).toBeGreaterThan(owner.data.vendor.weekTokens.proxied);
      expect(owner.data.vendor.revenueSplit?.prepaidTopupsUsd).toBeCloseTo(2020, 2);
      expect(owner.data.vendor.slaAttainmentPct).toBeGreaterThan(98);
      expect(owner.data.clusters.length).toBe(3);
      expect(owner.data.vendor.monthRevenueUsd).toBeGreaterThan(0);
      expect(owner.data.vendor.grossMarginPct).toBeGreaterThan(0);
      // 已連線機房的加權利用率 ≈ 45–65%（台中 C 服務異常不計入分母）
      expect(owner.data.vendor.gpuUtilization).toBeGreaterThanOrEqual(0.45);
      expect(owner.data.vendor.gpuUtilization).toBeLessThanOrEqual(0.65);
      expect(owner.data.vendor.spilloverPct).toBeGreaterThan(0);
      expect(owner.data.vendor.spilloverPct).toBeLessThan(5);
    }
    // 平台營運（無 billing.read）：營收／毛利為 null（UI 顯示無權限），其餘 KPI 仍有
    const ops = await s.getOverview(OPS);
    expect(ops.ok && ops.data.audience).toBe('vendor');
    expect(ops.ok && ops.data.revenue).toBeNull();
    expect(ops.ok && ops.data.vendor?.monthRevenueUsd).toBeNull();
    expect(ops.ok && ops.data.vendor?.grossMarginPct).toBeNull();
    expect(ops.ok && ops.data.vendor?.gpuTotal).toBe(32);
    const admin = await s.getOverview(as('u-admin-star'));
    expect(admin.ok && admin.data.audience).toBe('customer');
    expect(admin.ok && admin.data.revenue).toBeNull();
    expect(admin.ok && admin.data.vendor).toBeNull();
    expect(admin.ok && admin.data.clusters.length).toBe(0);
    expect(admin.ok && admin.data.customer.monthSpendUsd).toBeGreaterThan(0);
    const denied = await s.getRevenue(as('u-billing-union'));
    expect(!denied.ok && denied.status).toBe(403);
  });

  it('CSV 匯出含計費依據、快取 tokens 與成本中心欄位；專屬部署的 tokens 收費為 0', async () => {
    const s = fresh();
    const res = await s.exportUsageCsv(as('u-billing-union'), { tenantId: 't-union' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.split('\n')[0]).toBe('date,tenantId,costCenter,projectId,modelId,providerId,tier,deploymentId,sharing,region,billingBasis,requests,errors,inputTokens,cacheReadTokens,cacheWriteTokens,outputTokens,gpuHours,chargeUsd');
      expect(res.data).toContain('CC-2300');
      expect(res.data).toContain(',dep-union-qwen27b-dedicated,dedicated,tw-hc-b,dedicated,');
      expect(res.data).toContain(',dep-qwen27b-shared,shared,tw-tpe-a,token,'); // p-advisor 的共用 Qwen 按牌價
      expect(res.data).toContain(',cloud,,,ap-southeast-1,cloud,');
      // 專屬列的 chargeUsd 為 0
      const dedicatedLines = res.data.split('\n').filter((l) => l.includes(',dedicated,tw-hc-b,dedicated,'));
      expect(dedicatedLines.length).toBeGreaterThan(0);
      expect(dedicatedLines.every((l) => l.endsWith(',0'))).toBe(true);
    }
    const cross = await s.exportUsageCsv(as('u-billing-union'), { tenantId: 't-star' });
    expect(!cross.ok && cross.status).toBe(403);
  });

  it('快取讀寫倍率反映在對帳單：讀取倍率 0.1 → 1 的差額 ＝ Σ 快取讀取 tokens × 輸入牌價 × 0.9；寫入倍率 1.25 → 1 的差額 ＝ Σ 快取寫入 × 輸入牌價 × 0.25；讀取 + 寫入 ≤ 輸入', async () => {
    const s = fresh();
    const usage = await s.getUsage(OWNER, { tenantId: 't-star', from: '2026-11-01' });
    const rows = usage.ok ? usage.data : [];
    expect(rows.every((r) => r.cachedInputTokens + r.cacheWriteTokens <= r.inputTokens)).toBe(true);
    expect(rows.some((r) => r.tier === 'local' && r.cacheWriteTokens > 0)).toBe(true);
    const base = await s.getBillingStatement(OWNER, 't-star', '2026-11');
    expect(base.ok && base.data.rates.cacheReadMultiplier).toBe(0.1);
    expect(base.ok && base.data.rates.cacheWriteMultiplier).toBe(1.25);
    const readFull = await s.updateBillingSettings(FIN, { cacheReadMultiplier: 1 });
    expect(readFull.ok).toBe(true);
    const noReadDiscount = await s.getBillingStatement(OWNER, 't-star', '2026-11');
    expect(base.ok && noReadDiscount.ok).toBe(true);
    if (!base.ok || !noReadDiscount.ok) return;
    const localTokenRows = rows.filter((r) => r.tier === 'local' && r.sharing === 'shared');
    const expectedRead = localTokenRows.reduce((a, r) => a + (r.cachedInputTokens / 1e6) * s.billing.tokenPrices[r.modelId].input * 0.9, 0);
    expect(expectedRead).toBeGreaterThan(0);
    expect(noReadDiscount.data.charges.localTokens.usd - base.data.charges.localTokens.usd).toBeCloseTo(expectedRead, 0);
    const writeFlat = await s.updateBillingSettings(FIN, { cacheReadMultiplier: 0.1, cacheWriteMultiplier: 1 });
    expect(writeFlat.ok).toBe(true);
    const noWritePremium = await s.getBillingStatement(OWNER, 't-star', '2026-11');
    if (!noWritePremium.ok) return;
    const expectedWrite = localTokenRows.reduce((a, r) => a + (r.cacheWriteTokens / 1e6) * s.billing.tokenPrices[r.modelId].input * 0.25, 0);
    expect(base.data.charges.localTokens.usd - noWritePremium.data.charges.localTokens.usd).toBeCloseTo(expectedWrite, 0);
    expect(base.data.charges.localTokens.cacheWriteTokens).toBeGreaterThan(0);
    expect(base.data.charges.localTokens.byModel.every((m) => m.cacheWriteTokens >= 0 && m.cachedTokens + m.cacheWriteTokens <= m.tokens)).toBe(true);
    // 範圍驗證
    expect((await s.updateBillingSettings(FIN, { cacheReadMultiplier: 1.5 })).ok).toBe(false);
    expect((await s.updateBillingSettings(FIN, { cacheWriteMultiplier: 9 })).ok).toBe(false);
    // 快取讀取 tokens 若超過輸入 tokens（異常資料）只算到輸入 tokens 為止：1M × 0.2 × 0.1
    expect(s.tokenCharge('qwen3.8-27b-vllm', 1_000_000, 5_000_000, 0)).toBeCloseTo(0.02, 9);
  });

  it('承諾用量不足額：沒有用量的承諾客戶 → 補足額 ＝ 本期承諾額、折扣仍以承諾額計、總額 ＝ 承諾額 × (1 − 折扣)；平台營收的承諾調整為正', async () => {
    const s = fresh();
    const t = await s.createTenant(OWNER, { name: '低用量承諾客戶', plan: 'committed', dataClass: 'general', allowedTiers: 'both', quotas: { rpm: 100, tpm: 100_000, monthlyBudgetUsd: 10_000 }, costCenter: 'CC-7', billingContact: { name: 'x', email: 'x@y.co' }, commitment: { monthlyUsd: 3000, discountPct: 10 }, crossBorderConsent: { regions: ['ap-southeast-1'] } });
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    const st = await s.getBillingStatement(OWNER, t.data.id, '2026-11');
    expect(st.ok).toBe(true);
    if (!st.ok) return;
    const c = st.data.charges;
    expect(c.subtotalUsd).toBe(0);
    expect(c.commitment).not.toBeNull();
    if (!c.commitment) return;
    expect(c.commitment.proratedUsd).toBeCloseTo((3000 * 8) / 30, 2);
    expect(c.commitment.shortfallUsd).toBeCloseTo(c.commitment.proratedUsd, 2);
    expect(c.commitment.overageUsd).toBe(0);
    expect(c.commitment.discountUsd).toBeCloseTo(c.commitment.proratedUsd * 0.1, 2);
    expect(c.totalUsd).toBeCloseTo(c.commitment.proratedUsd * 0.9, 2);
    expect(c.totalUsd).toBeGreaterThan(0);
    const rev = await s.getRevenue(FIN);
    expect(rev.ok && rev.data.byTenant.find((x) => x.tenantId === t.data.id)?.commitmentAdjustmentUsd).toBeCloseTo(c.commitment.shortfallUsd - c.commitment.discountUsd, 2);
    // 整月（2026-10）不按比例：本期承諾額 ＝ 月承諾額
    const oct = await s.getBillingStatement(OWNER, t.data.id, '2026-10');
    expect(oct.ok && oct.data.charges.commitment?.proratedUsd).toBe(3000);
  });

  it('專屬涵蓋 tokens 是「每個部署」的規則：為星耀新建同模型的專屬部署（0 或 1 副本）都不會讓共用部署已服務的 Qwen tokens 變免費', async () => {
    const s = fresh();
    const before = await s.getBillingStatement(OWNER, 't-star', '2026-11');
    const qwenBefore = before.ok ? before.data.charges.localTokens.byModel.find((m) => m.modelId === 'qwen3.8-27b-vllm') : undefined;
    expect(qwenBefore?.basis).toBe('token');
    expect(qwenBefore?.deploymentId).toBe('dep-qwen27b-shared');
    expect(qwenBefore && qwenBefore.usd).toBeGreaterThan(0);
    const dep = await s.createDeployment(OPS, depInput({ name: 'star-qwen-dedicated-zero', clusterId: 'cl-tpe-a', sharing: 'dedicated', dedicatedTenantId: 't-star', quantization: 'FP8', replicas: 0, autoscaling: { minReplicas: 0, maxReplicas: 2, metric: 'queue-depth', scaleToZero: true }, allowSharedFallback: true }));
    expect(dep.ok).toBe(true);
    const after = await s.getBillingStatement(OWNER, 't-star', '2026-11');
    expect(after.ok).toBe(true);
    if (!after.ok || !before.ok) return;
    expect(after.data.charges.dedicated.usd).toBe(0);
    const qwenAfter = after.data.charges.localTokens.byModel.find((m) => m.modelId === 'qwen3.8-27b-vllm');
    expect(qwenAfter?.basis).toBe('token');
    expect(after.data.charges.totalUsd).toBeCloseTo(before.data.charges.totalUsd, 2);
    const csv = await s.exportUsageCsv(OWNER, { tenantId: 't-star', modelId: 'qwen3.8-27b-vllm' });
    expect(csv.ok && csv.data.includes(',dedicated,')).toBe(false);
    // 擴到 1 副本：仍不回溯涵蓋共用部署服務過的 tokens（它們不是這個專屬部署服務的）；專屬費依建立時間比例（本期 0 小時）
    const scaled = await s.scaleDeployment(OPS, dep.ok ? dep.data.id : '', 1);
    expect(scaled.ok).toBe(true);
    const covered = await s.getBillingStatement(OWNER, 't-star', '2026-11');
    expect(covered.ok && covered.data.charges.localTokens.byModel.find((m) => m.modelId === 'qwen3.8-27b-vllm')?.basis).toBe('token');
    expect(covered.ok && covered.data.charges.localTokens.usd).toBeCloseTo(before.data.charges.localTokens.usd, 2);
    expect(covered.ok && covered.data.charges.dedicated.items.some((i) => i.deploymentName === 'star-qwen-dedicated-zero')).toBe(true);
    // usageCharge 以每筆用量的服務部署判定
    const rows = await s.getUsage(OWNER, { tenantId: 't-union', modelId: 'qwen3.8-27b-vllm', from: '2026-11-01' });
    if (rows.ok) {
      expect(rows.data.filter((r) => r.projectId === 'p-risk').every((r) => s.usageCharge(r).basis === 'dedicated' && s.usageCharge(r).usd === 0)).toBe(true);
      expect(rows.data.filter((r) => r.projectId === 'p-advisor').every((r) => s.usageCharge(r).basis === 'token' && s.usageCharge(r).usd > 0)).toBe(true);
    }
  });

  it('預算與專案花費：10 月整月各租戶 ≤ 100% 預算（60–95%）、11 月（8 天）約 15–35%、公部門最小；專案 monthSpendUsd 由伺服器依對帳單填入', async () => {
    const s = fresh();
    for (const [tid, user] of [
      ['t-star', 'u-admin-star'],
      ['t-union', 'u-billing-union'],
      ['t-gov', 'u-admin-gov'],
    ] as const) {
      const oct = await s.getBillingStatement(as(user), tid, '2026-10');
      expect(oct.ok && oct.data.budget.pct, `${tid} oct`).toBeGreaterThanOrEqual(0.6);
      expect(oct.ok && oct.data.budget.pct, `${tid} oct`).toBeLessThanOrEqual(0.95);
      const nov = await s.getBillingStatement(as(user), tid, '2026-11');
      expect(nov.ok && nov.data.budget.pct, `${tid} nov`).toBeGreaterThanOrEqual(0.15);
      expect(nov.ok && nov.data.budget.pct, `${tid} nov`).toBeLessThanOrEqual(0.35);
      expect(nov.ok && nov.data.budget.alert).toBe('ok');
    }
    const star = await s.getBillingStatement(OWNER, 't-star', '2026-11');
    const gov = await s.getBillingStatement(OWNER, 't-gov', '2026-11');
    expect(star.ok && gov.ok && gov.data.totalUsd < star.data.totalUsd * 0.3).toBe(true);
    // 專案花費 ＝ 對帳單專案列（token + 雲端 + 溢出）
    const projects = await s.listProjects(as('u-admin-star'), 't-star');
    expect(projects.ok).toBe(true);
    if (projects.ok && star.ok) {
      for (const p of projects.data) {
        expect(p.monthSpendUsd, p.id).toBeCloseTo(star.data.projects.find((x) => x.projectId === p.id)!.totalUsd, 2);
        expect(p.monthSpendUsd / p.quotas.monthlyBudgetUsd, p.id).toBeLessThan(0.6);
      }
      expect(projects.data.some((p) => p.monthSpendUsd > 0)).toBe(true);
    }
  });

  it('模型目錄：授權義務、基底模型與來源地連帶、市場參考價（含擷取日）、牌價對齊研究筆記、上下文 maxModelLen vs 原生', async () => {
    const s = fresh();
    const res = await s.listModels(OWNER);
    expect(res.ok).toBe(true);
    const byId = Object.fromEntries((res.ok ? res.data : []).map((m) => [m.id, m]));
    expect(byId['maas-assist-27b'].baseModel).toBe('qwen3.8-27b');
    expect(byId['maas-assist-27b'].origin).toBe('cn');
    expect(byId['llama-3.3-70b-vllm'].licenseObligations?.some((o) => o.includes('Built with Llama'))).toBe(true);
    expect(byId['llama-3.3-70b-vllm'].licenseObligations?.some((o) => o.includes('Llama」開頭'))).toBe(true);
    expect(byId['embeddinggemma-300m-vllm'].licenseObligations?.some((o) => o.includes('Prohibited Use Policy'))).toBe(true);
    expect(byId['embeddinggemma-300m-vllm'].licenseObligations?.some((o) => o.includes('遠端限制'))).toBe(true);
    expect(byId['taide-lx-8b-vllm'].displayName).toContain('Llama-3.1-TAIDE-LX-8B-Chat');
    expect(byId['taide-lx-8b-vllm'].licenseObligations?.some((o) => o.includes('Llama 3.1'))).toBe(true);
    expect(byId['qwen3.8-27b-vllm'].licenseObligations?.some((o) => o.includes('Apache-2.0'))).toBe(true);
    expect(byId['qwen3.8-max'].licenseObligations?.some((o) => o.includes('US$50M'))).toBe(true);
    expect(byId['qwen3.8-27b-vllm'].maxModelLen).toBe(131_072);
    expect(byId['qwen3.8-27b-vllm'].nativeContextLength).toBe(262_144);
    // 牌價（USD／百萬）：雲端對齊研究筆記；自建 gpt-oss 0.15/0.60、Llama 0.25/0.50、Qwen 0.20/0.60
    expect([byId['qwen3.8-27b'].priceInput, byId['qwen3.8-27b'].priceOutput]).toEqual([0.5, 3]);
    expect([byId['qwen3.8-flash'].priceInput, byId['qwen3.8-flash'].priceOutput]).toEqual([0.15, 0.47]);
    expect([byId['kimi-k3'].priceInput, byId['kimi-k3'].priceOutput]).toEqual([3, 15]);
    expect([byId['glm-5.3'].priceInput, byId['glm-5.3'].priceOutput]).toEqual([1.4, 4.4]);
    expect([byId['gpt-oss-120b-vllm'].priceInput, byId['gpt-oss-120b-vllm'].priceOutput]).toEqual([0.15, 0.6]);
    expect([byId['llama-3.3-70b-vllm'].priceInput, byId['llama-3.3-70b-vllm'].priceOutput]).toEqual([0.25, 0.5]);
    expect([byId['qwen3.8-27b-vllm'].priceInput, byId['qwen3.8-27b-vllm'].priceOutput]).toEqual([0.2, 0.6]);
    expect(byId['llama-3.3-70b-vllm'].marketRefUsd).toMatchObject({ input: 0.1, output: 0.32 });
    expect(byId['llama-3.3-70b-vllm'].marketRefUsd?.source).toContain('DeepInfra');
    for (const m of MODELS.filter((x) => x.marketRefUsd)) expect(m.marketRefUsd!.source, m.id).toContain('2026-11-09');
    expect(byId['gpt-oss-120b-vllm'].allowedQuantizations).toEqual(['INT4']);
    // 公部門：以 Qwen 為基底的 MaaS-Assist 連帶排除
    const key = await s.createKey(as('u-admin-gov'), { name: 'k', tenantId: 't-gov', projectId: 'p-gov-qa', allowedModels: ['maas-assist-27b'], rpmLimit: 1, tpmLimit: 1, monthlyBudgetUsd: 1, expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(!key.ok && key.code).toBe('MODEL_NOT_ALLOWED');
  });

  it('金鑰種子遵守自己的規則：到期 ≤ createdAt + 90 天；僅自建金鑰只列自建或「自建優先」別名；伺服器到期檢查以日曆日比較（+90 天當日有效、+91 天拒絕）', async () => {
    for (const k of API_KEYS) {
      if (!k.expiresAt) continue;
      const days = (new Date(k.expiresAt).getTime() - new Date(k.createdAt).getTime()) / 86_400_000;
      expect(days, k.id).toBeLessThanOrEqual(k.ephemeral ? 1 / 24 : 90);
      expect(days, k.id).toBeGreaterThan(0);
    }
    expect(API_KEYS.filter((k) => k.autoRotate.enabled && k.rotatedAt).length).toBeGreaterThan(0);
    const s = fresh();
    for (const k of API_KEYS.filter((k) => k.tierRestriction === 'local')) {
      for (const id of k.allowedModels) {
        const tier = s.modelOrAliasTier(id);
        const routes = await s.listRoutes(OWNER);
        const route = routes.ok ? routes.data.find((r) => r.alias === id) : undefined;
        const localFirst = !!route && route.placementPolicy === 'local-first' && route.targets.every((t) => t.providerId === 'vllm');
        expect(tier === 'local' || localFirst, `${k.id} ${id}`).toBe(true);
      }
    }
    // 僅自建金鑰可選 qwen-plus（自建優先別名），不可選 fast-chat（雲端優先）
    const base = { name: 'k', tenantId: 't-star', projectId: 'p-cs-bot', rpmLimit: 1, tpmLimit: 1, monthlyBudgetUsd: 1, tierRestriction: 'local' as const };
    const okAlias = await s.createKey(as('u-admin-star'), { ...base, allowedModels: ['qwen-plus'], expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(okAlias.ok).toBe(true);
    const badAlias = await s.createKey(as('u-admin-star'), { ...base, allowedModels: ['fast-chat'], expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(!badAlias.ok && badAlias.code).toBe('TIER_NOT_ALLOWED');
    // 日曆日：UI 預設「今天 + 90 天」（含當天任一時刻）可通過；+91 天拒絕
    const plus90 = new Date();
    plus90.setDate(plus90.getDate() + 90);
    plus90.setHours(23, 0, 0, 0);
    const ok90 = await s.createKey(as('u-admin-star'), { ...base, name: 'k90', tierRestriction: 'both', allowedModels: ['qwen-plus'], expiresAt: plus90.toISOString() });
    expect(ok90.ok).toBe(true);
    const plus91 = new Date();
    plus91.setDate(plus91.getDate() + 91);
    plus91.setHours(0, 30, 0, 0);
    const bad91 = await s.createKey(as('u-admin-star'), { ...base, name: 'k91', tierRestriction: 'both', allowedModels: ['qwen-plus'], expiresAt: plus91.toISOString() });
    expect(!bad91.ok && bad91.code).toBe('KEY_EXPIRY_TOO_LONG');
    expect(maxKeyExpiryMs(new Date('2026-11-09T15:00:00').getTime())).toBe(new Date('2027-02-07T23:59:59.999').getTime());
  });

  it('法規引用統一：《各機關對危害國家資通安全產品限制使用原則》（2019 訂、2022-11 修）、行政院 2025-02 院會決議、數發部／陸委會 2025-11-17 說明', async () => {
    expect(PUBLIC_SECTOR_LEGAL_BASIS).toContain('2019 訂、2022-11 修');
    expect(PUBLIC_SECTOR_LEGAL_BASIS).toContain('行政院 2025-02 院會決議');
    expect(PUBLIC_SECTOR_LEGAL_BASIS).toContain('2025-11-17');
    expect(PUBLIC_SECTOR_NOTE).toContain(PUBLIC_SECTOR_LEGAL_BASIS);
    expect(PUBLIC_SECTOR_NOTE).not.toMatch(/2025-02《/);
    const s = fresh();
    const key = await s.createKey(as('u-admin-gov'), { name: 'k', tenantId: 't-gov', projectId: 'p-gov-qa', allowedModels: ['qwen3.7-plus'], rpmLimit: 1, tpmLimit: 1, monthlyBudgetUsd: 1, expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(!key.ok && key.message).toContain('2025-11-17');
    const routes = await s.listRoutes(OWNER);
    expect(routes.ok && routes.data.find((r) => r.alias === 'gov-chat')?.description).toContain('2022-11 修');
  });

  it('月份一致性：對帳單的天數與用量資料涵蓋的天數一致（2026-11 ＝ 8 天至今；2026-10 ＝ 整月 31 天），專屬 GPU 時數與 TCO 用同一天數', async () => {
    const s = fresh();
    for (const [month, days] of [
      ['2026-11', 8],
      ['2026-10', 31],
    ] as const) {
      const usage = await s.getUsage(OWNER, { from: `${month}-01`, to: `${month}-31` });
      const dates = new Set(usage.ok ? usage.data.map((u) => u.date) : []);
      expect(dates.size, month).toBe(days);
      const st = await s.getBillingStatement(OWNER, 't-union', month);
      expect(st.ok && st.data.daysInPeriod, month).toBe(days);
      expect(st.ok && st.data.charges.dedicated.gpuHours, month).toBe(8 * 24 * days);
      const rev = await s.getRevenue(FIN, month);
      expect(rev.ok && rev.data.daysInPeriod, month).toBe(days);
      expect(rev.ok && rev.data.fleet.gpuHours, month).toBe(32 * 24 * days);
      expect(rev.ok && rev.data.totalRevenueUsd, month).toBeGreaterThan(0);
    }
    // 整月營收應明顯高於 8 天的營收
    const nov = await s.getRevenue(FIN, '2026-11');
    const oct = await s.getRevenue(FIN, '2026-10');
    expect(nov.ok && oct.ok && oct.data.totalRevenueUsd > nov.data.totalRevenueUsd * 2).toBe(true);
  });

  it('對帳單的合計與各項一致：小計 ＝ token 費 + 專屬費 + 雲端費；專案列（token + 雲端 + 溢出）合計 ≈ 小計 − 專屬費；TWD ＝ 四捨五入', async () => {
    const s = fresh();
    for (const [user, tenantId] of [
      ['u-admin-star', 't-star'],
      ['u-billing-union', 't-union'],
      ['u-admin-gov', 't-gov'],
    ] as const) {
      const st = await s.getBillingStatement(as(user), tenantId, '2026-11');
      expect(st.ok, tenantId).toBe(true);
      if (!st.ok) continue;
      const c = st.data.charges;
      expect(c.subtotalUsd).toBeCloseTo(c.localTokens.usd + c.dedicated.usd + c.cloud.usd, 1);
      expect(c.localTokens.usd).toBeCloseTo(c.localTokens.byModel.reduce((a, m) => a + m.usd, 0), 1);
      expect(c.cloud.usd).toBeCloseTo(c.cloud.byModel.reduce((a, m) => a + m.usd, 0), 0);
      expect(c.dedicated.usd).toBeCloseTo(c.dedicated.items.reduce((a, i) => a + i.usd, 0), 1);
      expect(st.data.projects.reduce((a, p) => a + p.totalUsd, 0)).toBeCloseTo(c.subtotalUsd - c.dedicated.usd, 0);
      expect(c.totalTwd).toBe(Math.round(c.totalUsd * st.data.rates.twdPerUsd));
      expect(st.data.budget.pct).toBeCloseTo(c.totalUsd / st.data.budget.monthlyBudgetUsd, 2);
    }
  });
});

describe('租戶（客戶）上線', () => {
  const input = { name: '遠東零售', plan: 'payg' as const, dataClass: 'general' as const, allowedTiers: 'both' as const, quotas: { rpm: 1000, tpm: 1_500_000, monthlyBudgetUsd: 6000 }, costCenter: 'CC-3100', billingContact: { name: '林採購', email: 'lin@fareast.example' }, allowedModels: ['qwen-plus'], crossBorderConsent: { regions: ['ap-southeast-1'], by: '林採購' } };

  it('平台擁有者可新增租戶（含預設專案、稽核）；平台營運／財務／客戶管理員 403', async () => {
    const s = fresh();
    for (const u of ['u-cluster-ops', 'u-finance', 'u-admin-star']) {
      const d = await s.createTenant(as(u), input);
      expect(!d.ok && d.status, u).toBe(403);
    }
    const ok = await s.createTenant(OWNER, input);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.data.plan).toBe('payg');
    expect(ok.data.allowedModels).toEqual(['qwen-plus']);
    const tenants = await s.listTenants(OWNER);
    expect(tenants.ok && tenants.data.some((t) => t.id === ok.data.id)).toBe(true);
    const projects = await s.listProjects(OWNER, ok.data.id);
    expect(projects.ok && projects.data.length).toBe(1);
    expect(s.audit.all().some((e) => e.action === 'tenant.create' && e.decision === 'allow' && e.scope === `/tenants/${ok.data.id}` && e.after !== null)).toBe(true);
    const st = await s.getBillingStatement(OWNER, ok.data.id, '2026-11');
    expect(st.ok && st.data.charges.totalUsd).toBe(0);
  });

  it('驗證：重複名稱 409、承諾方案需承諾額、配額 > 0、Email 格式；公部門強制僅自建並排除中國來源', async () => {
    const s = fresh();
    const dup = await s.createTenant(OWNER, { ...input, name: '星耀科技' });
    expect(!dup.ok && dup.status).toBe(409);
    const commit = await s.createTenant(OWNER, { ...input, plan: 'committed' });
    expect(!commit.ok && commit.status).toBe(400);
    const commitOk = await s.createTenant(OWNER, { ...input, name: '承諾客戶', plan: 'committed', commitment: { monthlyUsd: 5000, discountPct: 15 } });
    expect(commitOk.ok && commitOk.data.commitment?.discountPct).toBe(15);
    const quota = await s.createTenant(OWNER, { ...input, name: 'q', quotas: { rpm: 0, tpm: 1, monthlyBudgetUsd: 1 } });
    expect(!quota.ok && quota.status).toBe(400);
    const email = await s.createTenant(OWNER, { ...input, name: 'e', billingContact: { name: 'x', email: 'nope' } });
    expect(!email.ok && email.status).toBe(400);
    const gov = await s.createTenant(OWNER, { ...input, name: '示範縣政府', dataClass: 'public-sector', allowedTiers: 'both', allowedModels: [] });
    expect(gov.ok).toBe(true);
    if (gov.ok) {
      expect(gov.data.allowedTiers).toBe('local');
      expect(gov.data.excludeOrigins).toEqual(['cn']);
      expect(gov.data.policyNote).toContain('行政院');
      // 新公部門租戶的專案建立金鑰：中國來源的自建模型被排除
      const projects = await s.listProjects(OWNER, gov.data.id);
      const pid = projects.ok ? projects.data[0].id : '';
      const key = await s.createKey(OWNER, { tenantId: gov.data.id, projectId: pid, name: 'k', allowedModels: ['qwen3.8-27b-vllm'], rpmLimit: 10, tpmLimit: 1000, monthlyBudgetUsd: 10, expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() });
      expect(!key.ok && key.code).toBe('MODEL_NOT_ALLOWED');
      const okKey = await s.createKey(OWNER, { tenantId: gov.data.id, projectId: pid, name: 'k2', allowedModels: ['gpt-oss-120b-vllm'], rpmLimit: 10, tpmLimit: 1000, monthlyBudgetUsd: 10, expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() });
      expect(okKey.ok).toBe(true);
    }
  });
});
