import { Button, MessageBar, MessageBarBody, Tab, TabList, Text, Tooltip, makeStyles, tokens } from '@fluentui/react-components';
import { RocketRegular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { AsyncView, EmptyState } from '../../components/States';
import { useApi } from '../../hooks/useApi';
import { server } from '../../server/api';
import { useSession } from '../../app/SessionContext';
import { PLATFORM_SCOPE } from '../../auth/scope';
import { DeploymentsTable } from './DeploymentsTable';
import { CreateDeploymentDrawer } from './CreateDeploymentDrawer';
import { useT } from '../../i18n';

const useStyles = makeStyles({
  tabs: { marginBottom: tokens.spacingVerticalM },
  note: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, marginBottom: tokens.spacingVerticalS },
});

/** 模型與部署頁共用的分頁列（模型目錄 ↔ 部署） */
export function ModelsDeploymentsTabs({ value }: { value: 'models' | 'deployments' }) {
  const s = useStyles();
  const t = useT();
  const navigate = useNavigate();
  return (
    <TabList selectedValue={value} onTabSelect={(_, d) => navigate(d.value === 'models' ? '/models' : '/deployments')} className={s.tabs} aria-label={t('ops.deployments.tabsAria')} data-tour="models-tabs">
      <Tab value="models">{t('ops.deployments.tab.models')}</Tab>
      <Tab value="deployments" data-tour="tab-deployments">
        {t('ops.deployments.tab.deployments')}
      </Tab>
    </TabList>
  );
}

export function DeploymentsPage() {
  const s = useStyles();
  const t = useT();
  const { session, canUi, principal } = useSession();
  const isVendor = principal?.tenantId === null;
  const [params, setParams] = useSearchParams();
  const clusterFilter = params.get('cluster') ?? undefined;
  const st = useApi(() => server.listDeployments(session, clusterFilter ? { clusterId: clusterFilter } : undefined), [session, clusterFilter]);
  const [creating, setCreating] = useState(params.get('create') === '1');
  const canManage = canUi('deployment.manage', PLATFORM_SCOPE);

  useEffect(() => {
    if (params.get('create') === '1') {
      setCreating(true);
      setParams((p) => {
        p.delete('create');
        return p;
      }, { replace: true });
    }
  }, [params, setParams]);

  // 建立中的部署會在數秒後就緒：自動重新載入一次
  useEffect(() => {
    if (st.data?.some((d) => d.status === 'creating')) {
      const timer = window.setTimeout(() => st.reload(), 3000);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [st]);

  return (
    <>
      <PageHeader
        title={t('ops.deployments.title')}
        subtitle={isVendor ? t('ops.deployments.subtitleVendor') : t('ops.deployments.subtitleCustomer')}
        crumbs={[{ label: t('ops.deployments.title') }, { label: t('ops.deployments.crumb') }]}
        actions={
          isVendor ? (
            <Tooltip content={canManage ? t('ops.deployments.createTip') : t('ops.deployments.createDenied')} relationship="description">
              <Button data-tour="deployments-create" appearance="primary" icon={<RocketRegular />} onClick={() => setCreating(true)}>
                {t('ops.deployments.create')}
              </Button>
            </Tooltip>
          ) : undefined
        }
      />
      <ModelsDeploymentsTabs value="deployments" />
      {clusterFilter && (
        <MessageBar intent="info" style={{ marginBottom: 12 }}>
          <MessageBarBody>
            {t('ops.deployments.filter.before')}
            <code>{clusterFilter}</code>
            {t('ops.deployments.filter.after')}
            <Button appearance="transparent" size="small" onClick={() => setParams({})}>
              {t('ops.deployments.filter.showAll')}
            </Button>
          </MessageBarBody>
        </MessageBar>
      )}
      <Text className={s.note} as="p">
        {t('ops.deployments.statusNote')}
      </Text>
      <AsyncView {...st} actionLabel={t('ops.clusterDetail.depsAction')} isEmpty={(d) => d.length === 0} empty={<EmptyState title={t('ops.deployments.empty.title')} description={isVendor ? t('ops.deployments.empty.vendor') : t('ops.deployments.empty.customer')} />}>
        {(deps) => <DeploymentsTable items={deps} onChanged={st.reload} showCluster />}
      </AsyncView>
      <CreateDeploymentDrawer open={creating} defaultClusterId={clusterFilter} onClose={() => setCreating(false)} onCreated={st.reload} />
    </>
  );
}
