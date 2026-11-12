import type { Action, RoleId } from './types';
import { ALL_ACTIONS } from './types';
import { zh } from '../i18n/core';

export interface RoleDefinition {
  id: RoleId;
  name: string;
  nameEn: string;
  description: string;
  actions: Action[];
  /** 具特權的角色：由非平台擁有者指派時需另一位具 iam.approve 之主體核准 */
  privileged: boolean;
  /** 角色等級，用於防止自我提權（數值越大權力越大） */
  rank: number;
  /** 供應商（我們）的角色：只能指派於平台範圍 */
  vendor?: boolean;
}

/** 客戶角色可用的唯讀動作（不含叢集：叢集是我們的機房，客戶只看得到服務他們的部署） */
const CUSTOMER_READ_ACTIONS: Action[] = ['model.read', 'provider.read', 'deployment.read', 'key.read', 'usage.read', 'billing.read', 'tenant.read', 'project.read', 'iam.read'];

/** 平台層資源的動作：只應授予供應商角色（平台範圍）。路由／溢出（model.route.update）是平台層資源，客戶角色不得更新。 */
export const PLATFORM_ONLY_ACTIONS: Action[] = ['model.route.update', 'provider.configure', 'cluster.read', 'cluster.register', 'cluster.operate', 'deployment.manage', 'tenant.create', 'trial.review', 'billing.configure'];

export const ROLES: Record<RoleId, RoleDefinition> = {
  'platform-owner': {
    id: 'platform-owner',
    name: zh('server.role.platform-owner.name'),
    nameEn: 'Platform Owner',
    description: zh('server.role.platform-owner.description'),
    actions: [...ALL_ACTIONS],
    privileged: true,
    rank: 100,
    vendor: true,
  },
  'cluster-operator': {
    id: 'cluster-operator',
    name: zh('server.role.cluster-operator.name'),
    nameEn: 'Platform Operations',
    description: zh('server.role.cluster-operator.description'),
    actions: ['cluster.read', 'cluster.register', 'cluster.operate', 'deployment.read', 'deployment.manage', 'model.read', 'provider.read', 'usage.read', 'tenant.read'],
    privileged: false,
    rank: 50,
    vendor: true,
  },
  finance: {
    id: 'finance',
    name: zh('server.role.finance.name'),
    nameEn: 'Platform Finance',
    description: zh('server.role.finance.description'),
    actions: ['usage.read', 'billing.read', 'billing.export', 'billing.configure', 'billing.topup', 'tenant.read', 'trial.review', 'project.read', 'model.read', 'provider.read', 'cluster.read', 'deployment.read'],
    privileged: false,
    rank: 45,
    vendor: true,
  },
  'tenant-admin': {
    id: 'tenant-admin',
    name: zh('server.role.tenant-admin.name'),
    nameEn: 'Tenant Admin',
    description: zh('server.role.tenant-admin.description'),
    actions: ALL_ACTIONS.filter((a) => !PLATFORM_ONLY_ACTIONS.includes(a)),
    privileged: true,
    rank: 80,
  },
  'access-admin': {
    id: 'access-admin',
    name: zh('server.role.access-admin.name'),
    nameEn: 'Access Administrator',
    description: zh('server.role.access-admin.description'),
    actions: ['iam.read', 'iam.assign', 'audit.read', 'tenant.read', 'project.read'],
    privileged: false,
    rank: 60,
  },
  'project-operator': {
    id: 'project-operator',
    name: zh('server.role.project-operator.name'),
    nameEn: 'Project Operator',
    description: zh('server.role.project-operator.description'),
    actions: ['model.read', 'provider.read', 'deployment.read', 'key.read', 'key.create', 'key.revoke', 'playground.invoke', 'usage.read', 'billing.read', 'tenant.read', 'project.read', 'project.update'],
    privileged: false,
    rank: 40,
  },
  'inference-caller': {
    id: 'inference-caller',
    name: zh('server.role.inference-caller.name'),
    nameEn: 'Inference Caller',
    description: zh('server.role.inference-caller.description'),
    actions: ['playground.invoke', 'model.read', 'project.read'],
    privileged: false,
    rank: 5,
  },
  auditor: {
    id: 'auditor',
    name: zh('server.role.auditor.name'),
    nameEn: 'Auditor',
    description: zh('server.role.auditor.description'),
    actions: [...CUSTOMER_READ_ACTIONS, 'audit.read', 'audit.export'],
    privileged: false,
    rank: 30,
  },
  'billing-reader': {
    id: 'billing-reader',
    name: zh('server.role.billing-reader.name'),
    nameEn: 'Billing Reader',
    description: zh('server.role.billing-reader.description'),
    actions: ['usage.read', 'billing.read', 'billing.export', 'billing.topup', 'tenant.read', 'project.read'],
    privileged: false,
    rank: 20,
  },
  viewer: {
    id: 'viewer',
    name: zh('server.role.viewer.name'),
    nameEn: 'Viewer',
    description: zh('server.role.viewer.description'),
    actions: [...CUSTOMER_READ_ACTIONS],
    privileged: false,
    rank: 10,
  },
};

export const ROLE_IDS: RoleId[] = ['platform-owner', 'cluster-operator', 'finance', 'tenant-admin', 'access-admin', 'project-operator', 'auditor', 'billing-reader', 'viewer', 'inference-caller'];

/** 供應商角色：只能指派於平台範圍，且只能指派給平台層級主體（我們的員工） */
export const VENDOR_ROLES: RoleId[] = ROLE_IDS.filter((r) => ROLES[r].vendor);

export function roleHasAction(roleId: RoleId, action: Action): boolean {
  return ROLES[roleId].actions.includes(action);
}

/** 角色 × 動作矩陣（供 UI 與 README 使用） */
export function roleActionMatrix(): { action: Action; roles: Record<RoleId, boolean> }[] {
  return ALL_ACTIONS.map((action) => ({
    action,
    roles: Object.fromEntries(ROLE_IDS.map((r) => [r, roleHasAction(r, action)])) as Record<RoleId, boolean>,
  }));
}

/** 資源異動類動作：與 iam.assign 合併時屬高風險組合 */
export const MUTATION_ACTIONS: Action[] = [
  'model.route.update',
  'provider.configure',
  'cluster.register',
  'cluster.operate',
  'deployment.manage',
  'key.create',
  'key.revoke',
  'billing.configure',
  'billing.topup',
  'tenant.create',
  'tenant.update',
  'trial.review',
  'project.create',
  'project.update',
  'project.delete',
];

/** 危險組合警示（含可翻譯鍵）：UI 用 keyedText(t, w.text, w.key, w.params) 顯示 */
export interface ComboWarning {
  text: string;
  key: string;
  params?: Record<string, string | number | boolean | null | undefined>;
}

export function dangerousComboItems(roleId: RoleId): ComboWarning[] {
  const r = ROLES[roleId];
  const out: ComboWarning[] = [];
  const push = (slug: string, params?: ComboWarning['params']) => {
    const key = `server.role.combo.${slug}`;
    out.push({ text: zh(key, params), key, params });
  };
  const hasAssign = r.actions.includes('iam.assign');
  const mutations = r.actions.filter((a) => MUTATION_ACTIONS.includes(a));
  if (hasAssign && mutations.length > 0) push('assignAndMutate', { actions: mutations.join(', ') });
  if (r.actions.includes('iam.assign') && r.actions.includes('iam.approve')) push('assignAndApprove');
  if (r.actions.includes('audit.export') && r.actions.includes('iam.assign')) push('auditExportAndAssign');
  if (r.actions.includes('cluster.operate') && r.actions.includes('deployment.manage') && r.id !== 'platform-owner') push('drainAndDelete');
  if (r.actions.includes('billing.configure') && r.actions.includes('billing.export') && r.id !== 'platform-owner') push('pricingAndExport');
  return out;
}

/** zh-TW 警示文字（相容既有呼叫端；翻譯請用 dangerousComboItems） */
export function dangerousCombos(roleId: RoleId): string[] {
  return dangerousComboItems(roleId).map((w) => w.text);
}

export const ACTION_LABELS: Record<Action, string> = {
  'model.read': zh('data.ACTION_LABELS.model.read'),
  'model.route.update': zh('data.ACTION_LABELS.model.route.update'),
  'provider.read': zh('data.ACTION_LABELS.provider.read'),
  'provider.configure': zh('data.ACTION_LABELS.provider.configure'),
  'cluster.read': zh('data.ACTION_LABELS.cluster.read'),
  'cluster.register': zh('data.ACTION_LABELS.cluster.register'),
  'cluster.operate': zh('data.ACTION_LABELS.cluster.operate'),
  'deployment.read': zh('data.ACTION_LABELS.deployment.read'),
  'deployment.manage': zh('data.ACTION_LABELS.deployment.manage'),
  'key.read': zh('data.ACTION_LABELS.key.read'),
  'key.create': zh('data.ACTION_LABELS.key.create'),
  'key.revoke': zh('data.ACTION_LABELS.key.revoke'),
  'playground.invoke': zh('data.ACTION_LABELS.playground.invoke'),
  'usage.read': zh('data.ACTION_LABELS.usage.read'),
  'billing.read': zh('data.ACTION_LABELS.billing.read'),
  'billing.export': zh('data.ACTION_LABELS.billing.export'),
  'billing.configure': zh('data.ACTION_LABELS.billing.configure'),
  'billing.topup': zh('data.ACTION_LABELS.billing.topup'),
  'tenant.read': zh('data.ACTION_LABELS.tenant.read'),
  'tenant.create': zh('data.ACTION_LABELS.tenant.create'),
  'tenant.update': zh('data.ACTION_LABELS.tenant.update'),
  'trial.review': zh('data.ACTION_LABELS.trial.review'),
  'project.read': zh('data.ACTION_LABELS.project.read'),
  'project.create': zh('data.ACTION_LABELS.project.create'),
  'project.update': zh('data.ACTION_LABELS.project.update'),
  'project.delete': zh('data.ACTION_LABELS.project.delete'),
  'iam.read': zh('data.ACTION_LABELS.iam.read'),
  'iam.assign': zh('data.ACTION_LABELS.iam.assign'),
  'iam.approve': zh('data.ACTION_LABELS.iam.approve'),
  'audit.read': zh('data.ACTION_LABELS.audit.read'),
  'audit.export': zh('data.ACTION_LABELS.audit.export'),
};

/** 動作分組：title 為 zh-TW；UI 用 tl(t, 'ACTION_GROUPS', g.id, g.title) 或 t(g.titleKey) */
export const ACTION_GROUPS: { id: string; title: string; titleKey: string; actions: Action[] }[] = [
  { id: 'models', title: zh('data.ACTION_GROUPS.models'), titleKey: 'data.ACTION_GROUPS.models', actions: ['model.read', 'model.route.update', 'provider.read', 'provider.configure'] },
  { id: 'clusters', title: zh('data.ACTION_GROUPS.clusters'), titleKey: 'data.ACTION_GROUPS.clusters', actions: ['cluster.read', 'cluster.register', 'cluster.operate', 'deployment.read', 'deployment.manage'] },
  { id: 'keys', title: zh('data.ACTION_GROUPS.keys'), titleKey: 'data.ACTION_GROUPS.keys', actions: ['key.read', 'key.create', 'key.revoke', 'playground.invoke'] },
  { id: 'billing', title: zh('data.ACTION_GROUPS.billing'), titleKey: 'data.ACTION_GROUPS.billing', actions: ['usage.read', 'billing.read', 'billing.export', 'billing.topup', 'billing.configure'] },
  { id: 'tenants', title: zh('data.ACTION_GROUPS.tenants'), titleKey: 'data.ACTION_GROUPS.tenants', actions: ['tenant.read', 'tenant.create', 'tenant.update', 'trial.review', 'project.read', 'project.create', 'project.update', 'project.delete'] },
  { id: 'iam', title: zh('data.ACTION_GROUPS.iam'), titleKey: 'data.ACTION_GROUPS.iam', actions: ['iam.read', 'iam.assign', 'iam.approve', 'audit.read', 'audit.export'] },
];
