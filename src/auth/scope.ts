// 範圍（Scope）工具：採分段式比對，禁止子字串比對
export const PLATFORM_SCOPE = '/';

export function normalizeScope(scope: string): string {
  if (!scope || scope === '/') return '/';
  const segs = scope.split('/').filter(Boolean);
  return '/' + segs.join('/');
}

export function scopeSegments(scope: string): string[] {
  return normalizeScope(scope).split('/').filter(Boolean);
}

/** ancestor 是否等於或包含 descendant（以路徑段為單位） */
export function isAncestorOrSelf(ancestor: string, descendant: string): boolean {
  const a = scopeSegments(ancestor);
  const d = scopeSegments(descendant);
  if (a.length > d.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== d[i]) return false;
  }
  return true;
}

/** 從範圍路徑解析租戶 ID（平台範圍與叢集範圍回傳 null） */
export function tenantIdOfScope(scope: string): string | null {
  const segs = scopeSegments(scope);
  if (segs.length >= 2 && segs[0] === 'tenants') return segs[1];
  return null;
}

export function projectIdOfScope(scope: string): string | null {
  const segs = scopeSegments(scope);
  if (segs.length >= 4 && segs[0] === 'tenants' && segs[2] === 'projects') return segs[3];
  return null;
}

/** 從範圔路徑解析叢集 ID（/clusters/{c}） */
export function clusterIdOfScope(scope: string): string | null {
  const segs = scopeSegments(scope);
  if (segs.length === 2 && segs[0] === 'clusters') return segs[1];
  return null;
}

export type ScopeLevel = 'platform' | 'cluster' | 'tenant' | 'project' | 'resource';

export function scopeLevel(scope: string): ScopeLevel {
  const segs = scopeSegments(scope);
  if (segs.length === 0) return 'platform';
  if (segs.length === 2 && segs[0] === 'clusters') return 'cluster';
  if (segs.length === 2) return 'tenant';
  if (segs.length === 4) return 'project';
  return 'resource';
}

/**
 * 驗證範圍格式是否為本系統認可的正規化路徑
 * - /                               平台
 * - /clusters/{c}                    我們的 GPU 叢集（平台層資源，不屬於任何租戶）
 * - /tenants/{t}                     客戶租戶
 * - /tenants/{t}/projects/{p}        專案
 * - /tenants/{t}/projects/{p}/keys/{k} 或 /routes/{r}
 */
export function isValidScope(scope: string): boolean {
  const segs = scopeSegments(scope);
  if (segs.length === 0) return true;
  if (segs[0] === 'clusters') return segs.length === 2;
  if (segs[0] !== 'tenants' || segs.length < 2) return false;
  if (segs.length === 2) return true;
  if (segs[2] !== 'projects' || segs.length < 4) return false;
  if (segs.length === 4) return true;
  if ((segs[4] === 'keys' || segs[4] === 'routes') && segs.length === 6) return true;
  return false;
}

/** 我們的叢集位於平台層：/clusters/{c} */
export function clusterScope(clusterId: string): string {
  return `/clusters/${clusterId}`;
}

export function tenantScope(tenantId: string): string {
  return `/tenants/${tenantId}`;
}
export function projectScope(tenantId: string, projectId: string): string {
  return `/tenants/${tenantId}/projects/${projectId}`;
}
