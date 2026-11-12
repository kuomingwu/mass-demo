// @vitest-environment jsdom
// 煙霧測試：以不同角色掛載每個路由，確認不會拋出執行期錯誤且顯示預期內容；導覽分組依角色不同
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { SessionProvider } from '../SessionContext';
import { NotifyProvider } from '../../components/Notify';
import { AppRoutes } from '../routes';
import { server } from '../../server/api';
import { landingFor } from '../AppShell';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  server.options.latency = [0, 0];
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
  window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, media: '', dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  Object.defineProperty(window, 'innerWidth', { value: 1400, writable: true });
});

const ROUTES = [
  '/',
  '/hub',
  '/hub?tab=integrations',
  '/hub?tab=faq',
  '/hub/trial',
  '/playground',
  '/playground?model=flux.1-schnell',
  '/keys',
  '/usage',
  '/usage?tab=statement',
  '/usage?tab=unit',
  '/plan',
  '/trials',
  '/tenants',
  '/tenants?tab=trials',
  '/tenants/t-star',
  '/tenants/t-union',
  '/tenants/t-gov',
  '/tenants/t-acme-trial',
  '/models',
  '/deployments',
  '/clusters',
  '/clusters/cl-tpe-a',
  '/clusters/cl-hc-b?tab=deployments',
  '/clusters/cl-hc-b?tab=pools',
  '/clusters/cl-tc-c?tab=events',
  '/clusters/nope',
  '/providers',
  '/routing',
  '/pricing',
  '/pricing?tab=unit',
  '/pricing?tab=proxy',
  '/pricing?tab=settings',
  '/iam',
  '/iam?tab=roles',
  '/iam?tab=effective',
  '/iam?tab=requests',
  '/iam?tab=audit',
  '/audit',
  '/guides',
  '/guides?guide=welcome',
  '/guides?guide=hub-first-call',
  '/guides?guide=trial-request',
  '/guides?guide=register-cluster',
  '/guides?guide=deploy-model',
  '/guides?guide=onboard-tenant',
  '/guides?guide=billing',
  '/settings',
  '/forbidden?action=key.create',
  '/nope',
];
const PERSONAS = ['owner', 'cluster-operator', 'finance', 'tenant-admin', 'viewer', 'access-admin', 'billing', 'gov-admin', 'trial-admin'];
const VENDOR_ITEMS = ['總覽', '試用申請', '租戶與專案', '推論叢集', '雲端與夥伴供應商', '路由與溢出', '定價與帳務'];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

async function mount(path: string, persona: string) {
  localStorage.setItem('maas-demo-persona', persona);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <React.StrictMode>
        <ThemeProvider>
          <SessionProvider>
            <NotifyProvider>
              <MemoryRouter initialEntries={[path]}>
                <AppRoutes />
              </MemoryRouter>
            </NotifyProvider>
          </SessionProvider>
        </ThemeProvider>
      </React.StrictMode>,
    );
  });
  // 等待模擬 API 解析
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  return container!.textContent ?? '';
}

function navText(): string {
  return container?.querySelector('nav[aria-label="主導覽"]')?.textContent ?? '';
}

function unmount() {
  if (root) act(() => root!.unmount());
  container?.remove();
}

describe('路由煙霧測試', () => {
  for (const persona of PERSONAS) {
    for (const path of ROUTES) {
      it(`${persona} 可開啟 ${path}`, async () => {
        const errors: unknown[] = [];
        const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
          const msg = String(args[0] ?? '');
          if (msg.includes('act(') || msg.includes('not wrapped')) return;
          errors.push(args);
        });
        const text = await mount(path, persona);
        spy.mockRestore();
        expect(text).toContain('MaaS 控制台');
        expect(text).toContain('並非官方 Azure Portal');
        if (path === '/nope') expect(text).toContain('404');
        expect(errors, JSON.stringify(errors.slice(0, 2))).toHaveLength(0);
      });
    }
  }

  it('導覽分組：我們的角色見「客戶入口」+「平台營運」；客戶角色見「客戶入口」+「帳戶與團隊」、看不到任何平台營運項目；操作指引所有人都有', async () => {
    await mount('/', 'owner');
    let nav = navText();
    expect(nav).toContain('客戶入口');
    expect(nav).toContain('平台營運');
    expect(nav).not.toContain('帳戶與團隊');
    for (const item of [...VENDOR_ITEMS, '模型中心', 'Playground', 'API 金鑰', '用量與帳單', '試用與方案', '存取控制 (IAM)', '稽核紀錄', '設定', '操作指引']) expect(nav, item).toContain(item);
    unmount();
    await mount('/', 'cluster-operator');
    nav = navText();
    expect(nav).toContain('平台營運');
    expect(nav).not.toContain('推論叢集（我們的 GPU）');
    expect(nav).toContain('推論叢集');
    unmount();
    for (const persona of ['tenant-admin', 'viewer', 'access-admin', 'billing', 'gov-admin', 'trial-admin']) {
      await mount('/hub', persona);
      nav = navText();
      expect(nav, persona).toContain('客戶入口');
      expect(nav, persona).toContain('帳戶與團隊');
      expect(nav, persona).not.toContain('平台營運');
      for (const item of VENDOR_ITEMS) expect(nav, `${persona} 不應看到 ${item}`).not.toContain(item);
      expect(nav, persona).toContain('操作指引');
      expect(nav, persona).toContain('模型中心');
      unmount();
    }
  });

  it('首頁導向：客戶開 / 看到模型中心（不是總覽）；我們的角色開 / 看到 token 事業 KPI；切換角色的落地頁', async () => {
    const admin = await mount('/', 'tenant-admin');
    expect(admin).toContain('一個 API，所有主流模型，永續的價格');
    expect(admin).not.toContain('試用漏斗');
    unmount();
    const owner = await mount('/', 'owner');
    expect(owner).toContain('本週 tokens');
    expect(owner).toContain('試用漏斗');
    expect(owner).toContain('儲值預收');
    expect(owner).toContain('SLA 達成');
    unmount();
    const fin = await mount('/', 'finance');
    expect(fin).toContain('毛利率');
    unmount();
    expect(landingFor('owner')).toBe('/');
    expect(landingFor('finance')).toBe('/');
    expect(landingFor('tenant-admin')).toBe('/hub');
    expect(landingFor('trial-admin')).toBe('/hub');
  });

  it('平台層頁面：客戶開 /clusters、/pricing、/trials 得到 403（伺服器拒絕）；平台營運開 /pricing、/trials 也是 403；擁有者／財務看得到', async () => {
    for (const persona of ['tenant-admin', 'gov-admin', 'trial-admin']) {
      for (const path of ['/clusters', '/pricing', '/trials']) {
        const t = await mount(path, persona);
        expect(t, `${persona} ${path}`).toContain('權限不足');
        unmount();
      }
    }
    const opsPricing = await mount('/pricing', 'cluster-operator');
    expect(opsPricing).toContain('權限不足');
    unmount();
    const opsTrials = await mount('/trials', 'cluster-operator');
    expect(opsTrials).toContain('權限不足');
    unmount();
    const finPricing = await mount('/pricing', 'finance');
    expect(finPricing).toContain('平台營收與毛利');
    expect(finPricing).toContain('GPU 機隊成本');
    expect(finPricing).toContain('儲值預收');
    unmount();
    const ownerProxy = await mount('/pricing?tab=proxy', 'owner');
    expect(ownerProxy).toContain('代理模型定價');
    expect(ownerProxy).toContain('我們的成本');
    unmount();
    const ownerSettings = await mount('/pricing?tab=settings', 'owner');
    expect(ownerSettings).toContain('快取讀取倍率');
    expect(ownerSettings).toContain('議價折扣');
    unmount();
    const ownerTrials = await mount('/trials', 'owner');
    expect(ownerTrials).toContain('示範市立圖書館');
    expect(ownerTrials).toContain('待審');
    unmount();
    // 舊路由導向
    const oldRevenue = await mount('/usage?tab=revenue', 'finance');
    expect(oldRevenue).toContain('平台營收與毛利');
    unmount();
    const oldTrials = await mount('/tenants?tab=trials', 'owner');
    expect(oldTrials).toContain('試用申請');
    expect(oldTrials).toContain('示範市立圖書館');
  });

  it('集合類 API 過濾、需權限頁面 403；平台營運見三座機房與「註冊叢集」；公部門客戶管理員見強制僅自建政策與零留存', async () => {
    const viewerText = await mount('/iam', 'viewer');
    expect(viewerText).toContain('角色指派');
    unmount();
    const billingKeys = await mount('/keys', 'billing');
    expect(billingKeys).toContain('沒有可檢視的金鑰');
    unmount();
    const billingAudit = await mount('/audit', 'billing');
    expect(billingAudit).toContain('權限不足');
    unmount();
    const opsClusters = await mount('/clusters', 'cluster-operator');
    expect(opsClusters).toContain('台北機房 A');
    expect(opsClusters).toContain('新竹機房 B');
    expect(opsClusters).toContain('台中機房 C');
    expect(opsClusters).toContain('註冊叢集');
    unmount();
    const govTenant = await mount('/tenants/t-gov', 'gov-admin');
    expect(govTenant).toContain('僅自建');
    expect(govTenant).toContain('行政院');
    expect(govTenant).toContain('零留存');
    expect(govTenant).toContain('預付儲值');
    unmount();
    const tenants = await mount('/tenants', 'owner');
    expect(tenants).toContain('新增租戶');
    expect(tenants).toContain('承諾用量');
    expect(tenants).toContain('ACME（試用 acme-eval）');
    unmount();
    const custTenants = await mount('/tenants', 'tenant-admin');
    expect(custTenants).not.toContain('新增租戶');
  });

  it('試用與方案、標頭餘額：試用客戶見 US$20、Tier 0、儲值；公部門見預付餘額與 Tier 3；星耀見月結 Tier 4；對帳單含快取讀取／寫入與代理模型我們的價格', async () => {
    const trial = await mount('/plan', 'trial-admin');
    expect(trial).toContain('試用中');
    expect(trial).toContain('Tier 0');
    expect(trial).toContain('餘額 US$20');
    expect(trial).toContain('服務抵扣');
    unmount();
    const gov = await mount('/plan', 'gov-admin');
    expect(gov).toContain('預付儲值');
    expect(gov).toContain('Tier 3');
    expect(gov).toContain('餘額 US$');
    unmount();
    const star = await mount('/plan', 'tenant-admin');
    expect(star).toContain('月結（合約）');
    expect(star).toContain('Tier 4');
    expect(star).toContain('月結 · Tier 4');
    unmount();
    const stmt = await mount('/usage?tab=statement', 'tenant-admin');
    expect(stmt).toContain('快取讀取');
    expect(stmt).toContain('快取寫入');
    expect(stmt).toContain('我們的價格（向客戶）');
    unmount();
    const govStmt = await mount('/usage?tab=statement', 'gov-admin');
    expect(govStmt).toContain('預付餘額扣抵');
  });

  it('模型中心：所有角色可見；代理卡片顯示「供應商牌價 → 我們的價格」；公部門客戶看不到中國來源卡片；文件分頁含公開價格 API 與 /v1/messages；SLA 區塊', async () => {
    const owner = await mount('/hub', 'owner');
    expect(owner).toContain('一個 API，所有主流模型，永續的價格');
    expect(owner).toContain('客戶入口預覽');
    expect(owner).toContain('DeepSeek');
    expect(owner).toContain('Qwen · 我們的 GPU 機房');
    expect(owner).toContain('供應商牌價 US$1.25 / US$10 → 我們的價格（−10% 代理折扣）');
    expect(owner).toContain('SLA 與服務抵扣');
    unmount();
    const gov = await mount('/hub', 'gov-admin');
    expect(gov).toContain('gpt-oss-120b');
    expect(gov).toContain('已排除');
    expect(gov).not.toContain('DeepSeek');
    expect(gov).not.toContain('Qwen · 我們的 GPU 機房');
    expect(gov).not.toContain('Kling');
    expect(gov).not.toContain('MaaS-Assist');
    unmount();
    const star = await mount('/hub', 'tenant-admin');
    expect(star).toContain('依租戶「星耀科技」政策由伺服器過濾');
    expect(star).toContain('不在方案內');
    unmount();
    const docs = await mount('/hub?tab=integrations', 'operator');
    expect(docs).toContain('Claude Code');
    expect(docs).toContain('api.maas.example');
    expect(docs).toContain('GET /v1/models');
    expect(docs).toContain('vendor_list_pricing');
    expect(docs).toContain('/v1/messages');
    expect(docs).toContain('Tier 4');
    unmount();
    const faq = await mount('/hub?tab=faq', 'billing');
    expect(faq).toContain('什麼是 MaaS');
    expect(faq).toContain('預付儲值還是月結');
    unmount();
    const pg = await mount('/playground?model=flux.1-schnell', 'tenant-admin');
    expect(pg).toContain('非文字模態：圖像生成');
    expect(pg).toContain('FLUX.1');
  });

  it('操作指引分成客戶旅程與平台營運，12 則都在', async () => {
    const t = await mount('/guides', 'owner');
    expect(t).toContain('客戶旅程');
    expect(t).toContain('平台營運');
    for (const title of ['從模型中心到第一次 API 呼叫', '建立 API 金鑰並測試', '權限不足（403）與申請存取', '客戶申請測試', '註冊叢集', '部署模型', '新增租戶', '連接代理供應商', '自建優先與溢出', '新增角色指派', '向客戶收費與平台毛利', '平台導覽']) expect(t, title).toContain(title);
  });
});
