import { describe, it, expect } from 'vitest';
import { MockServer } from '../api';

const fresh = () => new MockServer({ latency: [0, 0] });
const as = (userId: string) => ({ userId });
const auditOf = (s: MockServer) => (s as unknown as { audit: { all(): { action: string; decision: string; resourceId?: string }[] } }).audit.all();

const SG = { providerId: 'bailian' as const, region: 'ap-southeast-1', baseUrl: 'https://llm-demo.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1' };

describe('連接供應商（testProviderConnection / connectProvider）', () => {
  it('我們的 GPU 節點：不需 API Key，探測回傳節點資訊與可部署模型；建立後自建推論層容量更新；客戶管理員 403', async () => {
    const s = fresh();
    const meta = { nodeName: '台北機房 A 節點 C', gpuType: 'H100 80GB', gpuCount: 4, engine: 'vLLM' };
    const customer = await s.testProviderConnection(as('u-admin-star'), { providerId: 'vllm', region: 'tw-tpe-a-c', baseUrl: 'https://vllm-c.internal.example-maas.local/v1', apiKey: '', meta });
    expect(!customer.ok && customer.status).toBe(403);
    const probe = await s.testProviderConnection(as('u-owner'), { providerId: 'vllm', region: 'tw-tpe-a-c', baseUrl: 'https://vllm-c.internal.example-maas.local/v1', apiKey: '', meta });
    expect(probe.ok).toBe(true);
    if (probe.ok) {
      expect(probe.data.node?.gpu).toContain('H100');
      expect(probe.data.models.some((m) => m.served === false)).toBe(true);
      expect(probe.data.warnings.some((w) => w.includes('尚未服務'))).toBe(true);
    }
    const small = await s.testProviderConnection(as('u-owner'), { providerId: 'vllm', region: 'tw-tpe-a-c', baseUrl: 'https://vllm-c.internal.example-maas.local/v1', apiKey: '', meta: { ...meta, gpuType: 'RTX 6000 Ada 48GB', gpuCount: 1 } });
    expect(small.ok && small.data.warnings.some((w) => w.includes('VRAM'))).toBe(true);
    const before = await s.listProviders(as('u-owner'));
    const nodesBefore = before.ok ? before.data.find((p) => p.id === 'vllm')!.capacity!.nodes : -1;
    const res = await s.connectProvider(as('u-owner'), { providerId: 'vllm', region: 'tw-tpe-a-c', regionLabel: '台北機房 A 節點 C', baseUrl: 'https://vllm-c.internal.example-maas.local/v1', rpmLimit: 600, tpmLimit: 800_000, enabledModels: ['qwen3-coder-30b-a3b-vllm'], meta });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.capacity!.nodes).toBe(nodesBefore + 1);
      expect(res.data.capacity!.models).toContain('qwen3-coder-30b-a3b');
      expect(res.data.endpoints.find((e) => e.region === 'tw-tpe-a-c')!.keyRef).toMatch(/^mtls:/);
    }
  });

  it('檢視者測試連線 → 403 並寫入拒絕稽核', async () => {
    const s = fresh();
    const res = await s.testProviderConnection(as('u-viewer-star'), { ...SG, apiKey: 'sk-demo-12345678' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
    expect(auditOf(s).some((e) => e.action === 'provider.configure' && e.decision === 'deny')).toBe(true);
  });

  it('格式錯誤的金鑰 → 401 invalid_api_key', async () => {
    const s = fresh();
    const res = await s.testProviderConnection(as('u-owner'), { ...SG, apiKey: 'abc-12345678' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(401);
      expect(res.code).toBe('invalid_api_key');
    }
  });

  it('Coding Plan 金鑰（sk-sp-）不能用於後端 → 401', async () => {
    const s = fresh();
    const res = await s.testProviderConnection(as('u-owner'), { ...SG, apiKey: 'sk-sp-12345678' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('invalid_api_key');
  });

  it('正確金鑰 → 回傳延遲與該地域模型；舊網域與佔位字產生警告', async () => {
    const s = fresh();
    const ok = await s.testProviderConnection(as('u-owner'), { ...SG, apiKey: 'sk-demo-12345678' });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.data.latencyMs).toBeGreaterThan(0);
      expect(ok.data.models.length).toBeGreaterThan(0);
      expect(ok.data.models.every((m) => m.id)).toBe(true);
    }
    const legacy = await s.testProviderConnection(as('u-owner'), { ...SG, baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', apiKey: 'sk-demo-12345678' });
    expect(legacy.ok).toBe(true);
    if (legacy.ok) expect(legacy.data.warnings.length).toBeGreaterThan(0);
    const placeholder = await s.testProviderConnection(as('u-owner'), { ...SG, baseUrl: 'https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1', apiKey: 'sk-demo-12345678' });
    expect(placeholder.ok).toBe(true);
    if (placeholder.ok) expect(placeholder.data.warnings.some((w) => w.includes('WorkspaceId'))).toBe(true);
  });

  it('建立連線：新增端點、啟用供應商、寫入允許稽核；檢視者直接呼叫被拒', async () => {
    const s = fresh();
    const input = { providerId: 'bailian' as const, region: 'me-central-1', regionLabel: '杜拜（示範）', baseUrl: 'https://llm-demo.me-central-1.maas.aliyuncs.com/compatible-mode/v1', rpmLimit: 600, tpmLimit: 1_000_000, enabledModels: ['qwen3.7-plus'] };
    const denied = await s.connectProvider(as('u-viewer-star'), input);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.status).toBe(403);

    const before = await s.listProviders(as('u-owner'));
    const countBefore = before.ok ? before.data.find((p) => p.id === 'bailian')!.endpoints.length : -1;
    const res = await s.connectProvider(as('u-owner'), input);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.enabled).toBe(true);
      expect(res.data.endpoints.length).toBe(countBefore + 1);
      const ep = res.data.endpoints.find((e) => e.region === 'me-central-1')!;
      expect(ep.keyRef).toMatch(/^kms:\/\//);
      expect(ep.baseUrl).toBe(input.baseUrl);
    }
    expect(auditOf(s).some((e) => e.action === 'provider.configure' && e.decision === 'allow' && e.resourceId === 'bailian:me-central-1')).toBe(true);
    // 同一地域再連一次 → 更新而非重複新增
    const again = await s.connectProvider(as('u-owner'), { ...input, rpmLimit: 900 });
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.data.endpoints.filter((e) => e.region === 'me-central-1').length).toBe(1);
      expect(again.data.endpoints.find((e) => e.region === 'me-central-1')!.rpmLimit).toBe(900);
    }
  });
});
