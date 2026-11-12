// 應用程式層級 RBAC 型別定義（非 Azure 原生 RBAC）
// 情境：我們（平台供應商）擁有 GPU 機房並以 OpenAI 相容 API 向客戶（租戶）提供模型推論；
// 叢集／部署／代理供應商／定價為平台層資源，租戶／專案／金鑰為客戶層資源。
export type Action =
  | 'model.read'
  | 'model.route.update'
  | 'provider.read'
  | 'provider.configure'
  | 'cluster.read'
  | 'cluster.register'
  | 'cluster.operate'
  | 'deployment.read'
  | 'deployment.manage'
  | 'key.read'
  | 'key.create'
  | 'key.revoke'
  | 'playground.invoke'
  | 'usage.read'
  | 'billing.read'
  | 'billing.export'
  | 'billing.configure'
  | 'billing.topup'
  | 'tenant.read'
  | 'tenant.create'
  | 'tenant.update'
  | 'trial.review'
  | 'project.read'
  | 'project.create'
  | 'project.update'
  | 'project.delete'
  | 'iam.read'
  | 'iam.assign'
  | 'iam.approve'
  | 'audit.read'
  | 'audit.export';

export const ALL_ACTIONS: Action[] = [
  'model.read',
  'model.route.update',
  'provider.read',
  'provider.configure',
  'cluster.read',
  'cluster.register',
  'cluster.operate',
  'deployment.read',
  'deployment.manage',
  'key.read',
  'key.create',
  'key.revoke',
  'playground.invoke',
  'usage.read',
  'billing.read',
  'billing.export',
  'billing.configure',
  'billing.topup',
  'tenant.read',
  'tenant.create',
  'tenant.update',
  'trial.review',
  'project.read',
  'project.create',
  'project.update',
  'project.delete',
  'iam.read',
  'iam.assign',
  'iam.approve',
  'audit.read',
  'audit.export',
];

export type RoleId =
  | 'platform-owner'
  | 'cluster-operator'
  | 'finance'
  | 'tenant-admin'
  | 'project-operator'
  | 'viewer'
  | 'access-admin'
  | 'auditor'
  | 'billing-reader'
  | 'inference-caller';

export type PrincipalType = 'user' | 'group' | 'servicePrincipal';

export interface Principal {
  id: string;
  type: PrincipalType;
  displayName: string;
  /** 使用者所屬租戶（平台層級主體＝我們的員工＝ null） */
  tenantId: string | null;
  email?: string;
  /** 由可信來源（模擬 IdP）解析出的群組成員資格 */
  groupIds: string[];
}

export type AssignmentStatus = 'active' | 'pending' | 'expired' | 'rejected';

export interface RoleAssignment {
  id: string;
  principalId: string;
  roleId: RoleId;
  /** 正規化路徑："/"、"/clusters/{c}"、"/tenants/t1"、"/tenants/t1/projects/p1"… */
  scope: string;
  /** 該範圍所屬租戶（平台範圍與叢集範圍為 null）；由伺服器端解析，不信任客戶端 */
  tenantId: string | null;
  status: AssignmentStatus;
  createdAt: string;
  createdBy: string;
  expiresAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  justification?: string;
}

export type DecisionSource = 'direct' | 'inherited' | 'deny';

export interface Decision {
  allowed: boolean;
  /** zh-TW 原因（UI 在有 reasonKey 時優先顯示翻譯） */
  reason: string;
  /** 可翻譯的原因鍵（src/i18n/dict/<locale>/server.ts）與插補參數 */
  reasonKey?: string;
  reasonParams?: Record<string, string | number | boolean | null | undefined>;
  source: DecisionSource;
  assignmentId?: string;
  /** 授予權限之指派所在範圍 */
  grantedAtScope?: string;
  roleId?: RoleId;
}
