// 集中式政策評估器：預設拒絕；計算直接 + 繼承指派的有效權限
import type { Action, Decision, Principal, RoleAssignment } from './types';
import { ROLES } from './roles';
import { isAncestorOrSelf, normalizeScope, scopeSegments, tenantIdOfScope, isValidScope } from './scope';
import { zh } from '../i18n/core';

/** 決策原因：zh-TW 文字 + 可翻譯鍵（server.policy.*） */
function why(key: string, params: Record<string, string | number>): Pick<Decision, 'reason' | 'reasonKey' | 'reasonParams'> {
  return { reason: zh(key, params), reasonKey: key, reasonParams: params };
}

export interface PolicyContext {
  assignments: RoleAssignment[];
  now?: Date;
}

function isActive(a: RoleAssignment, now: Date): boolean {
  if (a.status !== 'active') return false;
  if (a.expiresAt && new Date(a.expiresAt).getTime() <= now.getTime()) return false;
  return true;
}

/** 取出主體（含其群組）在目標範圍上適用（直接或繼承）的有效指派 */
export function applicableAssignments(principal: Principal, scope: string, ctx: PolicyContext): RoleAssignment[] {
  const now = ctx.now ?? new Date();
  const target = normalizeScope(scope);
  const ids = new Set<string>([principal.id, ...principal.groupIds]);
  return ctx.assignments.filter((a) => {
    if (!ids.has(a.principalId)) return false;
    if (!isActive(a, now)) return false;
    return isAncestorOrSelf(a.scope, target);
  });
}

/**
 * can(principal, action, scope): Decision
 * - 租戶邊界：主體若屬於某租戶，則不得存取其他租戶的範圍（與客戶端提供的 scope 無關，獨立驗證）。
 * - 直接指派優先於繼承指派作為來源說明；都沒有則預設拒絕。
 */
export function can(principal: Principal, action: Action, scope: string, ctx: PolicyContext): Decision {
  const target = normalizeScope(scope);
  if (!isValidScope(target)) {
    return { allowed: false, ...why('server.policy.invalidScope', { scope }), source: 'deny' };
  }
  const targetTenant = tenantIdOfScope(target);
  if (principal.tenantId && targetTenant && principal.tenantId !== targetTenant) {
    return {
      allowed: false,
      ...why('server.policy.tenantBoundary', { principalTenant: principal.tenantId, targetTenant }),
      source: 'deny',
    };
  }

  const applicable = applicableAssignments(principal, target, ctx).filter((a) =>
    ROLES[a.roleId].actions.includes(action),
  );
  if (applicable.length === 0) {
    return { allowed: false, ...why('server.policy.defaultDeny', { scope: target, action }), source: 'deny' };
  }
  // 選取最接近目標的指派作為來源（直接 > 繼承）
  applicable.sort((a, b) => scopeSegments(b.scope).length - scopeSegments(a.scope).length);
  const best = applicable[0];
  const direct = normalizeScope(best.scope) === target;
  const viaGroup = principal.groupIds.includes(best.principalId);
  const params: Record<string, string> = { role: `@server.role.${best.roleId}.name`, scope: best.scope };
  if (viaGroup) params.group = best.principalId;
  return {
    allowed: true,
    source: direct ? 'direct' : 'inherited',
    ...why(`server.policy.${direct ? 'grantDirect' : 'grantInherited'}${viaGroup ? 'ViaGroup' : ''}`, params),
    assignmentId: best.id,
    grantedAtScope: best.scope,
    roleId: best.roleId,
  };
}

/** 主體在任一範圍（含子範圍）是否具備某動作——用於導覽與集合篩選前置判斷 */
export function canAnywhere(principal: Principal, action: Action, ctx: PolicyContext): boolean {
  const now = ctx.now ?? new Date();
  const ids = new Set<string>([principal.id, ...principal.groupIds]);
  return ctx.assignments.some((a) => {
    if (!ids.has(a.principalId) || !isActive(a, now)) return false;
    if (!ROLES[a.roleId].actions.includes(action)) return false;
    const t = tenantIdOfScope(a.scope);
    return !principal.tenantId || !t || t === principal.tenantId;
  });
}

/** 主體在特定範圍上持有的最高角色等級（用於自我提權檢查） */
export function highestRank(principal: Principal, scope: string, ctx: PolicyContext): number {
  const list = applicableAssignments(principal, scope, ctx);
  return list.reduce((m, a) => Math.max(m, ROLES[a.roleId].rank), 0);
}

/** 主體可委派（指派角色）的範圍清單：所有授予 iam.assign 的有效指派之範圍 */
export function delegationScopes(principal: Principal, ctx: PolicyContext): string[] {
  const now = ctx.now ?? new Date();
  const ids = new Set<string>([principal.id, ...principal.groupIds]);
  const scopes = ctx.assignments
    .filter((a) => ids.has(a.principalId) && isActive(a, now) && ROLES[a.roleId].actions.includes('iam.assign'))
    .map((a) => normalizeScope(a.scope));
  return Array.from(new Set(scopes));
}

export function isWithinDelegation(principal: Principal, scope: string, ctx: PolicyContext): boolean {
  return delegationScopes(principal, ctx).some((d) => isAncestorOrSelf(d, scope));
}
