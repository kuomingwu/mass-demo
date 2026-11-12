/**
 * 操作指引（互動式導覽）定義。
 * - 每個指引由多個步驟組成；步驟可指定 data-tour 目標與所在路由，導覽引擎會自動導頁並聚焦。
 * - 無 target 的步驟以置中對話框呈現（開場／結尾）。
 * - interactive 步驟不會遮擋目標，等使用者實際點擊（advanceOn.click）或下一個畫面出現（advanceOn.appear）後自動前進。
 * 情境：我們（平台供應商）擁有 GPU 機房，客戶透過我們的 OpenAI 相容 API 使用模型，我們向客戶收費。
 * - 文案來源：zh-TW 字典的 guides 區域（以 zh() 取得 zh-TW 文字）。渲染端以
 *   tf(t, 'guides.<guideId>.<field>', 原值)、tf(t, 'guides.<guideId>.step.<stepId>.<field>', 原值)、
 *   tf(t, 'guides.<guideId>.pages.<index>.label', 原值) 取得目前語言的文字。
 */
import { zh } from '../i18n/core';

/** 分類代碼（穩定 id）；顯示文字在 overview 區域的 overview.guides.category.<id> */
export type GuideCategory = 'intro' | 'daily' | 'access' | 'platform' | 'billing';
/** 指引所屬旅程：客戶旅程（客戶入口）或平台營運（我們的角色）；字典鍵 guides.const.JOURNEY_LABELS.<journey> */
export type GuideJourney = 'customer' | 'vendor';
export const JOURNEY_LABELS: Record<GuideJourney, string> = { customer: zh('guides.const.JOURNEY_LABELS.customer'), vendor: zh('guides.const.JOURNEY_LABELS.vendor') };

/** 公部門排除中國來源模型的法規依據（全站統一引用字串；字典鍵 guides.const.LAW_CITATION） */
export const LAW_CITATION = zh('guides.const.LAW_CITATION');

/** 示範環境與正式環境的時間差異說明（註冊叢集／部署模型指引共用；字典鍵 guides.const.SIMULATION_TIMING_NOTE） */
export const SIMULATION_TIMING_NOTE = zh('guides.const.SIMULATION_TIMING_NOTE');

export interface GuideStep {
  id: string;
  /** data-tour 目標；省略表示置中對話框 */
  target?: string;
  title: string;
  /** 純文字，支援 \n 換行 */
  body: string;
  position?: 'above' | 'below' | 'before' | 'after';
  /** 此步驟必須位於的路由（可含查詢字串） */
  route?: string;
  /** 互動步驟：允許操作目標，等待使用者完成 */
  interactive?: boolean;
  /** 自動前進條件 */
  advanceOn?: { kind: 'click' | 'appear'; target: string };
  /** 互動提示文字 */
  hint?: string;
  /** 目標稍後才會出現（例如抽屜動畫中），前進時不先檢查存在 */
  lazy?: boolean;
}

export interface Guide {
  id: string;
  title: string;
  summary: string;
  category: GuideCategory;
  /** 旅程分組（操作指引頁） */
  journey: GuideJourney;
  /** 預估所需分鐘數 */
  minutes: number;
  /** 建議以哪個示範角色進行（PERSONAS 的 id） */
  recommendedPersona?: string;
  /** 含實際操作步驟 */
  interactive?: boolean;
  /** 導覽會經過的頁面（供清單顯示；label 的字典鍵為 guides.<guideId>.pages.<index>.label） */
  pages: { label: string; route: string }[];
  steps: GuideStep[];
}

export const GUIDES: Guide[] = [
  {
    id: 'welcome',
    title: zh('guides.welcome.title'),
    summary: zh('guides.welcome.summary'),
    category: 'intro',
    journey: 'vendor',
    minutes: 2,
    recommendedPersona: 'owner',
    pages: [
      { label: zh('guides.welcome.pages.0.label'), route: '/' },
      { label: zh('guides.welcome.pages.1.label'), route: '/hub' },
    ],
    steps: [
      { id: 'welcome', title: zh('guides.welcome.step.welcome.title'), body: zh('guides.welcome.step.welcome.body') },
      { id: 'persona', target: 'persona', position: 'below', title: zh('guides.welcome.step.persona.title'), body: zh('guides.welcome.step.persona.body') },
      { id: 'nav', target: 'nav', position: 'after', title: zh('guides.welcome.step.nav.title'), body: zh('guides.welcome.step.nav.body') },
      { id: 'nav-hub', target: 'nav-hub', position: 'after', title: zh('guides.welcome.step.nav-hub.title'), body: zh('guides.welcome.step.nav-hub.body') },
      { id: 'kpi', target: 'kpi', position: 'below', route: '/', title: zh('guides.welcome.step.kpi.title'), body: zh('guides.welcome.step.kpi.body') },
      { id: 'token-mix', target: 'token-mix', position: 'after', route: '/', title: zh('guides.welcome.step.token-mix.title'), body: zh('guides.welcome.step.token-mix.body') },
      { id: 'nav-trials', target: 'nav-trials', position: 'after', title: zh('guides.welcome.step.nav-trials.title'), body: zh('guides.welcome.step.nav-trials.body') },
      { id: 'nav-models', target: 'nav-models', position: 'after', title: zh('guides.welcome.step.nav-models.title'), body: zh('guides.welcome.step.nav-models.body') },
      { id: 'nav-pricing', target: 'nav-pricing', position: 'after', title: zh('guides.welcome.step.nav-pricing.title'), body: zh('guides.welcome.step.nav-pricing.body') },
      { id: 'nav-iam', target: 'nav-iam', position: 'after', title: zh('guides.welcome.step.nav-iam.title'), body: zh('guides.welcome.step.nav-iam.body') },
      { id: 'nav-guides', target: 'nav-guides', position: 'after', title: zh('guides.welcome.step.nav-guides.title'), body: zh('guides.welcome.step.nav-guides.body') },
      { id: 'help', target: 'help', position: 'below', title: zh('guides.welcome.step.help.title'), body: zh('guides.welcome.step.help.body') },
      { id: 'done', title: zh('guides.welcome.step.done.title'), body: zh('guides.welcome.step.done.body') },
    ],
  },
  {
    id: 'register-cluster',
    title: zh('guides.register-cluster.title'),
    summary: zh('guides.register-cluster.summary'),
    category: 'platform',
    journey: 'vendor',
    minutes: 3,
    recommendedPersona: 'cluster-operator',
    interactive: true,
    pages: [
      { label: zh('guides.register-cluster.pages.0.label'), route: '/clusters' },
    ],
    steps: [
      { id: 'intro', title: zh('guides.register-cluster.step.intro.title'), body: zh('guides.register-cluster.step.intro.body') },
      { id: 'click-register', route: '/clusters', target: 'clusters-register', position: 'below', interactive: true, advanceOn: { kind: 'click', target: 'clusters-register' }, hint: zh('guides.register-cluster.step.click-register.hint'), title: zh('guides.register-cluster.step.click-register.title'), body: zh('guides.register-cluster.step.click-register.body') },
      { id: 'form', target: 'register-form', position: 'before', lazy: true, interactive: true, advanceOn: { kind: 'appear', target: 'register-command' }, hint: zh('guides.register-cluster.step.form.hint'), title: zh('guides.register-cluster.step.form.title'), body: zh('guides.register-cluster.step.form.body') },
      { id: 'command', target: 'register-command', position: 'before', lazy: true, interactive: true, advanceOn: { kind: 'appear', target: 'register-waiting' }, hint: zh('guides.register-cluster.step.command.hint'), title: zh('guides.register-cluster.step.command.title'), body: zh('guides.register-cluster.step.command.body') },
      { id: 'waiting', target: 'register-waiting', position: 'before', lazy: true, interactive: true, advanceOn: { kind: 'appear', target: 'register-done' }, hint: zh('guides.register-cluster.step.waiting.hint'), title: zh('guides.register-cluster.step.waiting.title'), body: zh('guides.register-cluster.step.waiting.body') },
      { id: 'done-panel', target: 'register-done', position: 'before', lazy: true, interactive: true, advanceOn: { kind: 'click', target: 'register-view-nodes' }, hint: zh('guides.register-cluster.step.done-panel.hint'), title: zh('guides.register-cluster.step.done-panel.title'), body: zh('guides.register-cluster.step.done-panel.body') },
      { id: 'nodes', target: 'cluster-nodes', position: 'above', lazy: true, title: zh('guides.register-cluster.step.nodes.title'), body: zh('guides.register-cluster.step.nodes.body') },
      { id: 'done', title: zh('guides.register-cluster.step.done.title'), body: zh('guides.register-cluster.step.done.body') },
    ],
  },
  {
    id: 'deploy-model',
    title: zh('guides.deploy-model.title'),
    summary: zh('guides.deploy-model.summary'),
    category: 'platform',
    journey: 'vendor',
    minutes: 3,
    recommendedPersona: 'cluster-operator',
    interactive: true,
    pages: [
      { label: zh('guides.deploy-model.pages.0.label'), route: '/deployments' },
    ],
    steps: [
      { id: 'intro', title: zh('guides.deploy-model.step.intro.title'), body: zh('guides.deploy-model.step.intro.body') },
      { id: 'click-create', route: '/deployments', target: 'deployments-create', position: 'below', interactive: true, advanceOn: { kind: 'click', target: 'deployments-create' }, hint: zh('guides.deploy-model.step.click-create.hint'), title: zh('guides.deploy-model.step.click-create.title'), body: zh('guides.deploy-model.step.click-create.body') },
      { id: 'form', target: 'deploy-form', position: 'before', lazy: true, interactive: true, advanceOn: { kind: 'appear', target: 'deploy-result' }, hint: zh('guides.deploy-model.step.form.hint'), title: zh('guides.deploy-model.step.form.title'), body: zh('guides.deploy-model.step.form.body') },
      { id: 'result', target: 'deploy-result', position: 'before', lazy: true, interactive: true, advanceOn: { kind: 'appear', target: 'deploy-ready' }, hint: zh('guides.deploy-model.step.result.hint'), title: zh('guides.deploy-model.step.result.title'), body: zh('guides.deploy-model.step.result.body') },
      { id: 'ready', target: 'deploy-ready', position: 'before', lazy: true, title: zh('guides.deploy-model.step.ready.title'), body: zh('guides.deploy-model.step.ready.body') },
      { id: 'done', title: zh('guides.deploy-model.step.done.title'), body: zh('guides.deploy-model.step.done.body') },
    ],
  },
  {
    id: 'onboard-tenant',
    title: zh('guides.onboard-tenant.title'),
    summary: zh('guides.onboard-tenant.summary'),
    category: 'platform',
    journey: 'vendor',
    minutes: 3,
    recommendedPersona: 'owner',
    interactive: true,
    pages: [
      { label: zh('guides.onboard-tenant.pages.0.label'), route: '/tenants' },
    ],
    steps: [
      { id: 'intro', title: zh('guides.onboard-tenant.step.intro.title'), body: zh('guides.onboard-tenant.step.intro.body') },
      { id: 'click-create', route: '/tenants', target: 'tenants-create', position: 'below', interactive: true, advanceOn: { kind: 'click', target: 'tenants-create' }, hint: zh('guides.onboard-tenant.step.click-create.hint'), title: zh('guides.onboard-tenant.step.click-create.title'), body: zh('guides.onboard-tenant.step.click-create.body') },
      { id: 'form', target: 'tenant-form', position: 'before', lazy: true, interactive: true, advanceOn: { kind: 'appear', target: 'tenant-result' }, hint: zh('guides.onboard-tenant.step.form.hint'), title: zh('guides.onboard-tenant.step.form.title'), body: zh('guides.onboard-tenant.step.form.body') },
      { id: 'result', target: 'tenant-result', position: 'before', lazy: true, title: zh('guides.onboard-tenant.step.result.title'), body: zh('guides.onboard-tenant.step.result.body') },
      { id: 'done', title: zh('guides.onboard-tenant.step.done.title'), body: zh('guides.onboard-tenant.step.done.body') },
    ],
  },
  {
    id: 'create-key-playground',
    title: zh('guides.create-key-playground.title'),
    summary: zh('guides.create-key-playground.summary'),
    category: 'daily',
    journey: 'customer',
    minutes: 3,
    recommendedPersona: 'tenant-admin',
    interactive: true,
    pages: [
      { label: zh('guides.create-key-playground.pages.0.label'), route: '/keys' },
      { label: zh('guides.create-key-playground.pages.1.label'), route: '/playground' },
    ],
    steps: [
      { id: 'intro', title: zh('guides.create-key-playground.step.intro.title'), body: zh('guides.create-key-playground.step.intro.body') },
      { id: 'keys-create', route: '/keys', target: 'keys-create', position: 'below', interactive: true, advanceOn: { kind: 'click', target: 'keys-create' }, hint: zh('guides.create-key-playground.step.keys-create.hint'), title: zh('guides.create-key-playground.step.keys-create.title'), body: zh('guides.create-key-playground.step.keys-create.body') },
      { id: 'keys-form', target: 'keys-form', position: 'before', lazy: true, interactive: true, advanceOn: { kind: 'appear', target: 'keys-result' }, hint: zh('guides.create-key-playground.step.keys-form.hint'), title: zh('guides.create-key-playground.step.keys-form.title'), body: zh('guides.create-key-playground.step.keys-form.body') },
      { id: 'keys-result', target: 'keys-result', position: 'before', lazy: true, title: zh('guides.create-key-playground.step.keys-result.title'), body: zh('guides.create-key-playground.step.keys-result.body') },
      { id: 'pg-model', route: '/playground', target: 'pg-model', position: 'after', title: zh('guides.create-key-playground.step.pg-model.title'), body: zh('guides.create-key-playground.step.pg-model.body') },
      { id: 'pg-send', route: '/playground', target: 'pg-send', position: 'above', interactive: true, advanceOn: { kind: 'click', target: 'pg-send' }, hint: zh('guides.create-key-playground.step.pg-send.hint'), title: zh('guides.create-key-playground.step.pg-send.title'), body: zh('guides.create-key-playground.step.pg-send.body') },
      { id: 'pg-headers', route: '/playground', target: 'pg-headers', position: 'before', title: zh('guides.create-key-playground.step.pg-headers.title'), body: zh('guides.create-key-playground.step.pg-headers.body') },
      { id: 'done', title: zh('guides.create-key-playground.step.done.title'), body: zh('guides.create-key-playground.step.done.body') },
    ],
  },
  {
    id: 'connect-provider-bailian',
    title: zh('guides.connect-provider-bailian.title'),
    summary: zh('guides.connect-provider-bailian.summary'),
    category: 'platform',
    journey: 'vendor',
    minutes: 4,
    recommendedPersona: 'owner',
    interactive: true,
    pages: [
      { label: zh('guides.connect-provider-bailian.pages.0.label'), route: '/providers' },
    ],
    steps: [
      { id: 'intro', title: zh('guides.connect-provider-bailian.step.intro.title'), body: zh('guides.connect-provider-bailian.step.intro.body') },
      { id: 'click-connect', route: '/providers', target: 'prov-connect', position: 'below', interactive: true, advanceOn: { kind: 'click', target: 'prov-connect' }, hint: zh('guides.connect-provider-bailian.step.click-connect.hint'), title: zh('guides.connect-provider-bailian.step.click-connect.title'), body: zh('guides.connect-provider-bailian.step.click-connect.body') },
      { id: 'type', target: 'connect-type', position: 'before', lazy: true, interactive: true, advanceOn: { kind: 'appear', target: 'connect-endpoint' }, hint: zh('guides.connect-provider-bailian.step.type.hint'), title: zh('guides.connect-provider-bailian.step.type.title'), body: zh('guides.connect-provider-bailian.step.type.body') },
      { id: 'endpoint', target: 'connect-endpoint', position: 'before', lazy: true, interactive: true, advanceOn: { kind: 'appear', target: 'connect-key' }, hint: zh('guides.connect-provider-bailian.step.endpoint.hint'), title: zh('guides.connect-provider-bailian.step.endpoint.title'), body: zh('guides.connect-provider-bailian.step.endpoint.body') },
      { id: 'key', target: 'connect-key', position: 'before', lazy: true, interactive: true, advanceOn: { kind: 'appear', target: 'connect-test' }, hint: zh('guides.connect-provider-bailian.step.key.hint'), title: zh('guides.connect-provider-bailian.step.key.title'), body: zh('guides.connect-provider-bailian.step.key.body') },
      { id: 'test', target: 'connect-test', position: 'before', lazy: true, interactive: true, advanceOn: { kind: 'appear', target: 'connect-models' }, hint: zh('guides.connect-provider-bailian.step.test.hint'), title: zh('guides.connect-provider-bailian.step.test.title'), body: zh('guides.connect-provider-bailian.step.test.body') },
      { id: 'models', target: 'connect-models', position: 'before', lazy: true, interactive: true, advanceOn: { kind: 'appear', target: 'connect-review' }, hint: zh('guides.connect-provider-bailian.step.models.hint'), title: zh('guides.connect-provider-bailian.step.models.title'), body: zh('guides.connect-provider-bailian.step.models.body') },
      { id: 'review', target: 'connect-review', position: 'before', lazy: true, interactive: true, advanceOn: { kind: 'appear', target: 'connect-done' }, hint: zh('guides.connect-provider-bailian.step.review.hint'), title: zh('guides.connect-provider-bailian.step.review.title'), body: zh('guides.connect-provider-bailian.step.review.body') },
      { id: 'done-panel', target: 'connect-done', position: 'before', lazy: true, title: zh('guides.connect-provider-bailian.step.done-panel.title'), body: zh('guides.connect-provider-bailian.step.done-panel.body') },
      { id: 'done', title: zh('guides.connect-provider-bailian.step.done.title'), body: zh('guides.connect-provider-bailian.step.done.body') },
    ],
  },
  {
    id: 'routing-spillover',
    title: zh('guides.routing-spillover.title'),
    summary: zh('guides.routing-spillover.summary'),
    category: 'platform',
    journey: 'vendor',
    minutes: 3,
    recommendedPersona: 'owner',
    pages: [
      { label: zh('guides.routing-spillover.pages.0.label'), route: '/routing' },
      { label: zh('guides.routing-spillover.pages.1.label'), route: '/settings' },
      { label: zh('guides.routing-spillover.pages.2.label'), route: '/playground' },
    ],
    steps: [
      { id: 'intro', title: zh('guides.routing-spillover.step.intro.title'), body: zh('guides.routing-spillover.step.intro.body') },
      { id: 'routing-list', route: '/routing', target: 'route-qwen-plus', position: 'above', title: zh('guides.routing-spillover.step.routing-list.title'), body: zh('guides.routing-spillover.step.routing-list.body') },
      { id: 'local-only', route: '/routing', target: 'route-risk-local', position: 'above', title: zh('guides.routing-spillover.step.local-only.title'), body: zh('guides.routing-spillover.step.local-only.body') },
      { id: 'docs', route: '/routing', target: 'routing-docs', position: 'above', title: zh('guides.routing-spillover.step.docs.title'), body: zh('guides.routing-spillover.step.docs.body') },
      { id: 'sim', route: '/settings', target: 'settings-sim', position: 'above', title: zh('guides.routing-spillover.step.sim.title'), body: zh('guides.routing-spillover.step.sim.body') },
      { id: 'pg', route: '/playground', target: 'pg-headers', position: 'before', title: zh('guides.routing-spillover.step.pg.title'), body: zh('guides.routing-spillover.step.pg.body') },
      { id: 'done', title: zh('guides.routing-spillover.step.done.title'), body: zh('guides.routing-spillover.step.done.body') },
    ],
  },
  {
    id: 'assign-role-approval',
    title: zh('guides.assign-role-approval.title'),
    summary: zh('guides.assign-role-approval.summary'),
    category: 'access',
    journey: 'vendor',
    minutes: 4,
    recommendedPersona: 'access-admin',
    interactive: true,
    pages: [
      { label: zh('guides.assign-role-approval.pages.0.label'), route: '/iam' },
      { label: zh('guides.assign-role-approval.pages.1.label'), route: '/audit' },
    ],
    steps: [
      { id: 'intro', title: zh('guides.assign-role-approval.step.intro.title'), body: zh('guides.assign-role-approval.step.intro.body') },
      { id: 'iam-scope', route: '/iam', target: 'iam-scope', position: 'below', title: zh('guides.assign-role-approval.step.iam-scope.title'), body: zh('guides.assign-role-approval.step.iam-scope.body') },
      { id: 'iam-add', route: '/iam', target: 'iam-add', position: 'below', interactive: true, advanceOn: { kind: 'click', target: 'iam-add' }, hint: zh('guides.assign-role-approval.step.iam-add.hint'), title: zh('guides.assign-role-approval.step.iam-add.title'), body: zh('guides.assign-role-approval.step.iam-add.body') },
      { id: 'assign-0', target: 'assign-step-0', position: 'before', lazy: true, interactive: true, advanceOn: { kind: 'appear', target: 'assign-step-1' }, hint: zh('guides.assign-role-approval.step.assign-0.hint'), title: zh('guides.assign-role-approval.step.assign-0.title'), body: zh('guides.assign-role-approval.step.assign-0.body') },
      { id: 'assign-1', target: 'assign-step-1', position: 'before', lazy: true, interactive: true, advanceOn: { kind: 'appear', target: 'assign-step-2' }, hint: zh('guides.assign-role-approval.step.assign-1.hint'), title: zh('guides.assign-role-approval.step.assign-1.title'), body: zh('guides.assign-role-approval.step.assign-1.body') },
      { id: 'assign-2', target: 'assign-step-2', position: 'before', lazy: true, interactive: true, advanceOn: { kind: 'appear', target: 'assign-step-3' }, hint: zh('guides.assign-role-approval.step.assign-2.hint'), title: zh('guides.assign-role-approval.step.assign-2.title'), body: zh('guides.assign-role-approval.step.assign-2.body') },
      { id: 'assign-3', target: 'assign-step-3', position: 'before', lazy: true, interactive: true, advanceOn: { kind: 'appear', target: 'assign-step-4' }, hint: zh('guides.assign-role-approval.step.assign-3.hint'), title: zh('guides.assign-role-approval.step.assign-3.title'), body: zh('guides.assign-role-approval.step.assign-3.body') },
      { id: 'assign-4', target: 'assign-step-4', position: 'before', lazy: true, interactive: true, advanceOn: { kind: 'click', target: 'assign-submit' }, hint: zh('guides.assign-role-approval.step.assign-4.hint'), title: zh('guides.assign-role-approval.step.assign-4.title'), body: zh('guides.assign-role-approval.step.assign-4.body') },
      { id: 'iam-tabs', route: '/iam', target: 'iam-tabs', position: 'below', title: zh('guides.assign-role-approval.step.iam-tabs.title'), body: zh('guides.assign-role-approval.step.iam-tabs.body') },
      { id: 'audit', route: '/audit', target: 'nav-audit', position: 'after', title: zh('guides.assign-role-approval.step.audit.title'), body: zh('guides.assign-role-approval.step.audit.body') },
      { id: 'done', title: zh('guides.assign-role-approval.step.done.title'), body: zh('guides.assign-role-approval.step.done.body') },
    ],
  },
  {
    id: 'billing',
    title: zh('guides.billing.title'),
    summary: zh('guides.billing.summary'),
    category: 'billing',
    journey: 'vendor',
    minutes: 5,
    recommendedPersona: 'finance',
    pages: [
      { label: zh('guides.billing.pages.0.label'), route: '/usage' },
      { label: zh('guides.billing.pages.1.label'), route: '/pricing' },
    ],
    steps: [
      { id: 'intro', title: zh('guides.billing.step.intro.title'), body: zh('guides.billing.step.intro.body') },
      { id: 'charts', route: '/usage', target: 'usage-charts', position: 'above', title: zh('guides.billing.step.charts.title'), body: zh('guides.billing.step.charts.body') },
      { id: 'statement-tab', route: '/usage', target: 'tab-statement', position: 'below', interactive: true, advanceOn: { kind: 'click', target: 'tab-statement' }, hint: zh('guides.billing.step.statement-tab.hint'), title: zh('guides.billing.step.statement-tab.title'), body: zh('guides.billing.step.statement-tab.body') },
      { id: 'statement', route: '/usage?tab=statement', target: 'statement', position: 'above', lazy: true, title: zh('guides.billing.step.statement.title'), body: zh('guides.billing.step.statement.body') },
      { id: 'export', route: '/usage?tab=statement', target: 'usage-export', position: 'below', title: zh('guides.billing.step.export.title'), body: zh('guides.billing.step.export.body') },
      { id: 'revenue-tab', route: '/pricing', target: 'tab-revenue', position: 'below', interactive: true, advanceOn: { kind: 'click', target: 'tab-revenue' }, hint: zh('guides.billing.step.revenue-tab.hint'), title: zh('guides.billing.step.revenue-tab.title'), body: zh('guides.billing.step.revenue-tab.body') },
      { id: 'revenue', route: '/pricing?tab=revenue', target: 'revenue', position: 'above', lazy: true, title: zh('guides.billing.step.revenue.title'), body: zh('guides.billing.step.revenue.body') },
      { id: 'unit-tab', route: '/pricing?tab=revenue', target: 'tab-unit', position: 'below', interactive: true, advanceOn: { kind: 'click', target: 'tab-unit' }, hint: zh('guides.billing.step.unit-tab.hint'), title: zh('guides.billing.step.unit-tab.title'), body: zh('guides.billing.step.unit-tab.body') },
      { id: 'unit', route: '/pricing?tab=unit', target: 'unit-prices', position: 'above', lazy: true, title: zh('guides.billing.step.unit.title'), body: zh('guides.billing.step.unit.body') },
      { id: 'proxy', route: '/pricing?tab=proxy', target: 'pricing-proxy', position: 'above', lazy: true, title: zh('guides.billing.step.proxy.title'), body: zh('guides.billing.step.proxy.body') },
      { id: 'settings', route: '/pricing?tab=settings', target: 'pricing-settings', position: 'above', lazy: true, title: zh('guides.billing.step.settings.title'), body: zh('guides.billing.step.settings.body') },
      { id: 'done', title: zh('guides.billing.step.done.title'), body: zh('guides.billing.step.done.body') },
    ],
  },
  {
    id: 'denied-request-access',
    title: zh('guides.denied-request-access.title'),
    summary: zh('guides.denied-request-access.summary'),
    category: 'access',
    journey: 'customer',
    minutes: 2,
    recommendedPersona: 'viewer',
    pages: [
      { label: zh('guides.denied-request-access.pages.0.label'), route: '/keys' },
      { label: zh('guides.denied-request-access.pages.1.label'), route: '/forbidden' },
      { label: zh('guides.denied-request-access.pages.2.label'), route: '/iam' },
    ],
    steps: [
      { id: 'intro', title: zh('guides.denied-request-access.step.intro.title'), body: zh('guides.denied-request-access.step.intro.body') },
      { id: 'persona', target: 'persona', position: 'below', title: zh('guides.denied-request-access.step.persona.title'), body: zh('guides.denied-request-access.step.persona.body') },
      { id: 'nav-keys', target: 'nav-keys', position: 'after', title: zh('guides.denied-request-access.step.nav-keys.title'), body: zh('guides.denied-request-access.step.nav-keys.body') },
      { id: 'keys-create', route: '/keys', target: 'keys-create', position: 'below', title: zh('guides.denied-request-access.step.keys-create.title'), body: zh('guides.denied-request-access.step.keys-create.body') },
      { id: 'forbidden', route: '/forbidden?action=key.create', target: 'forbidden-request', position: 'below', title: zh('guides.denied-request-access.step.forbidden.title'), body: zh('guides.denied-request-access.step.forbidden.body') },
      { id: 'iam', route: '/iam', target: 'iam-tabs', position: 'below', title: zh('guides.denied-request-access.step.iam.title'), body: zh('guides.denied-request-access.step.iam.body') },
      { id: 'done', title: zh('guides.denied-request-access.step.done.title'), body: zh('guides.denied-request-access.step.done.body') },
    ],
  },
];

export const HUB_FIRST_CALL_GUIDE: Guide = {
  id: 'hub-first-call',
  title: zh('guides.hub-first-call.title'),
  summary: zh('guides.hub-first-call.summary'),
  category: 'intro',
  journey: 'customer',
  minutes: 4,
  recommendedPersona: 'tenant-admin',
  interactive: true,
  pages: [
    { label: zh('guides.hub-first-call.pages.0.label'), route: '/hub' },
    { label: zh('guides.hub-first-call.pages.1.label'), route: '/keys' },
    { label: zh('guides.hub-first-call.pages.2.label'), route: '/playground' },
  ],
  steps: [
    { id: 'intro', title: zh('guides.hub-first-call.step.intro.title'), body: zh('guides.hub-first-call.step.intro.body') },
    { id: 'hero', route: '/hub', target: 'hub-hero', position: 'below', title: zh('guides.hub-first-call.step.hero.title'), body: zh('guides.hub-first-call.step.hero.body') },
    { id: 'tabs', route: '/hub', target: 'hub-tabs', position: 'below', title: zh('guides.hub-first-call.step.tabs.title'), body: zh('guides.hub-first-call.step.tabs.body') },
    { id: 'filter-local', route: '/hub', target: 'hub-source-local', position: 'below', interactive: true, advanceOn: { kind: 'click', target: 'hub-source-local' }, hint: zh('guides.hub-first-call.step.filter-local.hint'), title: zh('guides.hub-first-call.step.filter-local.title'), body: zh('guides.hub-first-call.step.filter-local.body') },
    { id: 'cards', route: '/hub', target: 'hub-grid', position: 'above', lazy: true, title: zh('guides.hub-first-call.step.cards.title'), body: zh('guides.hub-first-call.step.cards.body') },
    { id: 'api', route: '/hub', target: 'hub-api', position: 'below', lazy: true, interactive: true, advanceOn: { kind: 'appear', target: 'hub-api-dialog' }, hint: zh('guides.hub-first-call.step.api.hint'), title: zh('guides.hub-first-call.step.api.title'), body: zh('guides.hub-first-call.step.api.body') },
    { id: 'api-dialog', target: 'hub-api-dialog', position: 'before', lazy: true, title: zh('guides.hub-first-call.step.api-dialog.title'), body: zh('guides.hub-first-call.step.api-dialog.body') },
    { id: 'keys-create', route: '/keys', target: 'keys-create', position: 'below', interactive: true, advanceOn: { kind: 'click', target: 'keys-create' }, hint: zh('guides.hub-first-call.step.keys-create.hint'), title: zh('guides.hub-first-call.step.keys-create.title'), body: zh('guides.hub-first-call.step.keys-create.body') },
    { id: 'keys-form', target: 'keys-form', position: 'before', lazy: true, interactive: true, advanceOn: { kind: 'appear', target: 'keys-result' }, hint: zh('guides.hub-first-call.step.keys-form.hint'), title: zh('guides.hub-first-call.step.keys-form.title'), body: zh('guides.hub-first-call.step.keys-form.body') },
    { id: 'keys-result', target: 'keys-result', position: 'before', lazy: true, title: zh('guides.hub-first-call.step.keys-result.title'), body: zh('guides.hub-first-call.step.keys-result.body') },
    { id: 'pg-model', route: '/playground?model=qwen3.8-27b-vllm', target: 'pg-model', position: 'after', title: zh('guides.hub-first-call.step.pg-model.title'), body: zh('guides.hub-first-call.step.pg-model.body') },
    { id: 'pg-send', route: '/playground', target: 'pg-send', position: 'above', interactive: true, advanceOn: { kind: 'click', target: 'pg-send' }, hint: zh('guides.hub-first-call.step.pg-send.hint'), title: zh('guides.hub-first-call.step.pg-send.title'), body: zh('guides.hub-first-call.step.pg-send.body') },
    { id: 'pg-headers', route: '/playground', target: 'pg-headers', position: 'before', title: zh('guides.hub-first-call.step.pg-headers.title'), body: zh('guides.hub-first-call.step.pg-headers.body') },
    { id: 'done', title: zh('guides.hub-first-call.step.done.title'), body: zh('guides.hub-first-call.step.done.body') },
  ],
};

export const TRIAL_REQUEST_GUIDE: Guide = {
  id: 'trial-request',
  title: zh('guides.trial-request.title'),
  summary: zh('guides.trial-request.summary'),
  category: 'daily',
  journey: 'vendor',
  minutes: 4,
  recommendedPersona: 'owner',
  interactive: true,
  pages: [
    { label: zh('guides.trial-request.pages.0.label'), route: '/hub' },
    { label: zh('guides.trial-request.pages.1.label'), route: '/hub/trial' },
    { label: zh('guides.trial-request.pages.2.label'), route: '/trials' },
  ],
  steps: [
    { id: 'intro', title: zh('guides.trial-request.step.intro.title'), body: zh('guides.trial-request.step.intro.body') },
    { id: 'hub-trial', route: '/hub', target: 'hub-trial', position: 'below', interactive: true, advanceOn: { kind: 'click', target: 'hub-trial' }, hint: zh('guides.trial-request.step.hub-trial.hint'), title: zh('guides.trial-request.step.hub-trial.title'), body: zh('guides.trial-request.step.hub-trial.body') },
    { id: 'form', route: '/hub/trial', target: 'trial-form', position: 'after', lazy: true, interactive: true, advanceOn: { kind: 'appear', target: 'trial-done' }, hint: zh('guides.trial-request.step.form.hint'), title: zh('guides.trial-request.step.form.title'), body: zh('guides.trial-request.step.form.body') },
    { id: 'done-dialog', target: 'trial-done', position: 'below', lazy: true, title: zh('guides.trial-request.step.done-dialog.title'), body: zh('guides.trial-request.step.done-dialog.body') },
    { id: 'queue', route: '/trials', target: 'trials-table', position: 'above', lazy: true, interactive: true, advanceOn: { kind: 'appear', target: 'trial-detail' }, hint: zh('guides.trial-request.step.queue.hint'), title: zh('guides.trial-request.step.queue.title'), body: zh('guides.trial-request.step.queue.body') },
    { id: 'review', target: 'trial-approve', position: 'before', lazy: true, interactive: true, advanceOn: { kind: 'appear', target: 'trial-approved' }, hint: zh('guides.trial-request.step.review.hint'), title: zh('guides.trial-request.step.review.title'), body: zh('guides.trial-request.step.review.body') },
    { id: 'approved', target: 'trial-approved', position: 'before', lazy: true, interactive: true, advanceOn: { kind: 'click', target: 'trial-view-tenant' }, hint: zh('guides.trial-request.step.approved.hint'), title: zh('guides.trial-request.step.approved.title'), body: zh('guides.trial-request.step.approved.body') },
    { id: 'tenant', target: 'tenant-cards', position: 'below', lazy: true, title: zh('guides.trial-request.step.tenant.title'), body: zh('guides.trial-request.step.tenant.body') },
    { id: 'done', title: zh('guides.trial-request.step.done.title'), body: zh('guides.trial-request.step.done.body') },
  ],
};

GUIDES.push(HUB_FIRST_CALL_GUIDE, TRIAL_REQUEST_GUIDE);

export function getGuide(id: string | null | undefined): Guide | undefined {
  return GUIDES.find((g) => g.id === id);
}
