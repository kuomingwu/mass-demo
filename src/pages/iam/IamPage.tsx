import { Button, Tab, TabList, Tooltip, makeStyles, tokens } from '@fluentui/react-components';
import { PersonAddRegular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { ScopePicker, scopeShortName } from '../../components/ScopePicker';
import { useT } from '../../i18n';
import { useSession } from '../../app/SessionContext';
import { normalizeScope, scopeSegments, PLATFORM_SCOPE, tenantScope } from '../../auth/scope';
import { AssignmentsTab } from './AssignmentsTab';
import { RolesTab } from './RolesTab';
import { EffectiveAccessTab } from './EffectiveAccessTab';
import { RequestsTab } from './RequestsTab';
import { IamAuditTab } from './IamAuditTab';
import { AssignDrawer } from './AssignDrawer';

const useStyles = makeStyles({
  scopeRow: { display: 'flex', alignItems: 'flex-end', columnGap: tokens.spacingHorizontalL, rowGap: tokens.spacingVerticalS, flexWrap: 'wrap', marginBottom: tokens.spacingVerticalM },
  tabs: { marginBottom: tokens.spacingVerticalM },
});

type TabKey = 'assignments' | 'roles' | 'effective' | 'requests' | 'audit';
const TAB_KEYS: TabKey[] = ['assignments', 'roles', 'effective', 'requests', 'audit'];

export function IamPage() {
  const s = useStyles();
  const t = useT();
  const { canUi, principal, tenantId } = useSession();
  const [params, setParams] = useSearchParams();
  const defaultScope = tenantId ? tenantScope(tenantId) : principal?.tenantId ? tenantScope(principal.tenantId) : PLATFORM_SCOPE;
  const scope = normalizeScope(params.get('scope') ?? defaultScope);
  const tab = (params.get('tab') as TabKey) || 'assignments';
  const [assignOpen, setAssignOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const setScope = (v: string) => setParams((p) => { p.set('scope', v); return p; });
  const setTab = (v: TabKey) => setParams((p) => { p.set('tab', v); return p; });
  const canAssign = canUi('iam.assign', scope);

  const crumbs = useMemo(() => {
    const segs = scopeSegments(scope);
    const out = [{ label: t('admin.iam.title'), to: '/iam' }, { label: t('admin.scope.platform'), to: '/iam?scope=%2F' }];
    if (segs.length >= 2) out.push({ label: scopeShortName(`/tenants/${segs[1]}`, t, false), to: `/iam?scope=${encodeURIComponent(`/tenants/${segs[1]}`)}` });
    if (segs.length >= 4) out.push({ label: scopeShortName(scope, t, false), to: `/iam?scope=${encodeURIComponent(scope)}` });
    return out;
  }, [scope, t]);

  return (
    <>
      <PageHeader
        title={t('admin.iam.title')}
        subtitle={t('admin.iam.subtitle')}
        crumbs={crumbs}
        actions={
          <Tooltip content={canAssign ? t('admin.iam.addAssignment') : t('admin.iam.noAssign', { scope })} relationship="description">
            <Button data-tour="iam-add" appearance="primary" icon={<PersonAddRegular />} onClick={() => setAssignOpen(true)}>
              {t('admin.iam.addAssignment')}
            </Button>
          </Tooltip>
        }
      />
      <div className={s.scopeRow}>
        <div style={{ minWidth: 320 }} data-tour="iam-scope">
          <ScopePicker value={scope} onChange={setScope} label={t('admin.iam.currentScope')} />
        </div>
      </div>
      <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as TabKey)} className={s.tabs} aria-label={t('admin.iam.tabsAria')} data-tour="iam-tabs">
        {TAB_KEYS.map((k) => (
          <Tab key={k} value={k}>
            {t(`admin.iam.tab.${k}`)}
          </Tab>
        ))}
      </TabList>
      {tab === 'assignments' && <AssignmentsTab scope={scope} refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />}
      {tab === 'roles' && <RolesTab />}
      {tab === 'effective' && <EffectiveAccessTab scope={scope} refreshKey={refreshKey} />}
      {tab === 'requests' && <RequestsTab scope={scope} refreshKey={refreshKey} onChanged={() => setRefreshKey((k) => k + 1)} />}
      {tab === 'audit' && <IamAuditTab scope={scope} refreshKey={refreshKey} />}
      <AssignDrawer open={assignOpen} initialScope={scope} onClose={() => setAssignOpen(false)} onDone={() => setRefreshKey((k) => k + 1)} />
    </>
  );
}
