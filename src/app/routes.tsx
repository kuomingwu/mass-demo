import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { useSession } from './SessionContext';
import { getPortal } from './portal';
import { OverviewPage } from '../pages/OverviewPage';
import { ModelsPage } from '../pages/ModelsPage';
import { ProvidersPage } from '../pages/ProvidersPage';
import { RoutingPage } from '../pages/RoutingPage';
import { TenantsPage } from '../pages/TenantsPage';
import { TenantDetailPage } from '../pages/TenantDetailPage';
import { KeysPage } from '../pages/KeysPage';
import { PlaygroundPage } from '../pages/PlaygroundPage';
import { UsagePage } from '../pages/UsagePage';
import { IamPage } from '../pages/iam/IamPage';
import { AuditPage } from '../pages/AuditPage';
import { SettingsPage } from '../pages/SettingsPage';
import { GuidesPage } from '../pages/GuidesPage';
import { ClustersPage } from '../pages/clusters/ClustersPage';
import { ClusterDetailPage } from '../pages/clusters/ClusterDetailPage';
import { DeploymentsPage } from '../pages/deployments/DeploymentsPage';
import { ForbiddenPage, NotFoundPage } from '../pages/ErrorPages';
import { HubPage } from '../pages/hub/HubPage';
import { TrialRequestPage } from '../pages/hub/TrialRequestPage';
import { PlanPage } from '../pages/PlanPage';
import { TrialsPage } from '../pages/TrialsPage';
import { PricingPage } from '../pages/PricingPage';
import { LocalGpuPage } from '../pages/localgpu/LocalGpuPage';

/** 首頁：客戶入口 → 模型中心；管理後台 → 營運總覽；合併主控台依角色決定 */
function Home() {
  const { principal } = useSession();
  if (getPortal() === 'customer') return <Navigate to="/hub" replace />;
  if (principal && principal.tenantId !== null) return <Navigate to="/hub" replace />;
  return <OverviewPage />;
}

/**
 * 路由依入口掛載（見 app/portal.ts）：
 * - 客戶入口：模型中心、申請測試、試用與方案 + 共用頁面
 * - 管理後台：平台營運頁面 + 共用頁面
 * 不屬於這個入口的路徑得到 404；入口只是封裝邊界，伺服器端仍逐一授權。
 */
export function AppRoutes() {
  const portal = getPortal();
  const customer = portal !== 'admin';
  const admin = portal !== 'customer';
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Home />} />
        {/* 客戶入口專屬 */}
        {customer && <Route path="/hub" element={<HubPage />} />}
        {customer && <Route path="/hub/trial" element={<TrialRequestPage />} />}
        {customer && <Route path="/plan" element={<PlanPage />} />}
        {/* 兩個入口共用（資料依登入者的範圍過濾） */}
        <Route path="/playground" element={<PlaygroundPage />} />
        <Route path="/keys" element={<KeysPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/iam" element={<IamPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/guides" element={<GuidesPage />} />
        <Route path="/forbidden" element={<ForbiddenPage />} />
        {/* 管理後台專屬（平台營運） */}
        {admin && <Route path="/trials" element={<TrialsPage />} />}
        {admin && <Route path="/tenants" element={<TenantsPage />} />}
        {admin && <Route path="/tenants/:tenantId" element={<TenantDetailPage />} />}
        {admin && <Route path="/tenants/:tenantId/projects/:projectId" element={<TenantDetailPage />} />}
        {admin && <Route path="/models" element={<ModelsPage />} />}
        {admin && <Route path="/deployments" element={<DeploymentsPage />} />}
        {admin && <Route path="/clusters" element={<ClustersPage />} />}
        {admin && <Route path="/clusters/:clusterId" element={<ClusterDetailPage />} />}
        {admin && <Route path="/local-gpu" element={<LocalGpuPage />} />}
        {admin && <Route path="/providers" element={<ProvidersPage />} />}
        {admin && <Route path="/routing" element={<RoutingPage />} />}
        {admin && <Route path="/pricing" element={<PricingPage />} />}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
