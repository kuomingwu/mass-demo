import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { useSession } from './SessionContext';
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

/** 首頁：我們的角色看營運總覽；客戶角色的首頁是模型中心（客戶入口） */
function Home() {
  const { principal } = useSession();
  if (principal && principal.tenantId !== null) return <Navigate to="/hub" replace />;
  return <OverviewPage />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Home />} />
        {/* 客戶入口 */}
        <Route path="/hub" element={<HubPage />} />
        <Route path="/hub/trial" element={<TrialRequestPage />} />
        <Route path="/playground" element={<PlaygroundPage />} />
        <Route path="/keys" element={<KeysPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/plan" element={<PlanPage />} />
        {/* 平台營運 */}
        <Route path="/trials" element={<TrialsPage />} />
        <Route path="/tenants" element={<TenantsPage />} />
        <Route path="/tenants/:tenantId" element={<TenantDetailPage />} />
        <Route path="/tenants/:tenantId/projects/:projectId" element={<TenantDetailPage />} />
        <Route path="/models" element={<ModelsPage />} />
        <Route path="/deployments" element={<DeploymentsPage />} />
        <Route path="/clusters" element={<ClustersPage />} />
        <Route path="/clusters/:clusterId" element={<ClusterDetailPage />} />
        <Route path="/providers" element={<ProvidersPage />} />
        <Route path="/routing" element={<RoutingPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        {/* 管理 */}
        <Route path="/iam" element={<IamPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/guides" element={<GuidesPage />} />
        <Route path="/forbidden" element={<ForbiddenPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
