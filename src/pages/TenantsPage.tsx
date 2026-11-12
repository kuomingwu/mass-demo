import { Badge, Button, Text, Tooltip, createTableColumn, makeStyles, tokens, type TableColumnDefinition } from '@fluentui/react-components';
import { PersonAddRegular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { AsyncView, EmptyState } from '../components/States';
import { StatusBadge } from '../components/StatusBadge';
import { SimpleGrid } from '../components/SimpleGrid';
import { useApi } from '../hooks/useApi';
import { tenantLabel, tf, tl, useLocale, useT, type TFunction } from '../i18n';
import { server } from '../server/api';
import { useSession } from '../app/SessionContext';
import { PLATFORM_SCOPE } from '../auth/scope';
import { DATA_CLASS_LABELS, PLAN_LABELS, PUBLIC_SECTOR_NOTE, TIER_POLICY_LABELS, type Tenant } from '../server/seed';
import { BILLING_MODE_LABELS } from '../data/commercial';
import { formatUsd } from '../theme/chartPalette';
import { CreateTenantDrawer } from './tenants/CreateTenantDrawer';

const useStyles = makeStyles({
  num: { fontVariantNumeric: 'tabular-nums' },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
});

export function dataClassColor(dc: Tenant['dataClass']): 'brand' | 'warning' | 'danger' {
  return dc === 'general' ? 'brand' : dc === 'sensitive' ? 'warning' : 'danger';
}

export function planColor(plan: Tenant['plan']): 'informative' | 'success' | 'important' {
  return plan === 'payg' ? 'informative' : plan === 'committed' ? 'success' : 'important';
}

/** 租戶政策說明（資料層 zh-TW 文字）：公部門共用說明鍵，其他租戶以租戶 ID 為鍵 */
export function tenantPolicyNote(t: TFunction, tenant: Tenant): string | undefined {
  if (!tenant.policyNote) return undefined;
  if (tenant.policyNote === PUBLIC_SECTOR_NOTE) return tf(t, 'server.const.PUBLIC_SECTOR_NOTE', PUBLIC_SECTOR_NOTE);
  return tf(t, `server.tenant.${tenant.id}.policyNote`, tenant.policyNote);
}

export function TenantsPage() {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const { session, canUi, principal } = useSession();
  const navigate = useNavigate();
  const st = useApi(() => server.listTenants(session), [session]);
  const [creating, setCreating] = useState(false);
  const canCreate = canUi('tenant.create', PLATFORM_SCOPE);
  const isVendor = principal?.tenantId === null;
  const [params] = useSearchParams();
  const columns: TableColumnDefinition<Tenant>[] = useMemo(
    () => [
      createTableColumn<Tenant>({
        columnId: 'name',
        compare: (a, b) => a.name.localeCompare(b.name),
        renderHeaderCell: () => t('customer.tenants.col.customer'),
        renderCell: (x) => (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Text weight="semibold">{tenantLabel(t, x.id, x.name)}</Text>
            <span className={s.mono}>/tenants/{x.id}</span>
          </div>
        ),
      }),
      createTableColumn<Tenant>({
        columnId: 'plan',
        compare: (a, b) => a.plan.localeCompare(b.plan),
        renderHeaderCell: () => t('customer.tenants.col.plan'),
        renderCell: (x) => (
          <div style={{ display: 'flex', flexDirection: 'column', rowGap: 2 }}>
            <Badge appearance="tint" color={planColor(x.plan)} size="small" style={{ alignSelf: 'flex-start' }}>
              {tl(t, 'PLAN_LABELS', x.plan, PLAN_LABELS[x.plan])}
            </Badge>
            <span className={s.mono}>
              {tl(t, 'BILLING_MODE_LABELS', x.billingMode, BILLING_MODE_LABELS[x.billingMode])}
              {x.credits ? t('customer.tenants.balance', { amount: formatUsd(x.credits.balanceUsd, 0) }) + (x.credits.trial ? t('customer.tenants.trialSuffix') : '') : ''}
            </span>
            {x.commitment && <span className={s.mono}>{t('customer.tenants.commitment', { amount: formatUsd(x.commitment.monthlyUsd, 0), pct: x.commitment.discountPct })}</span>}
          </div>
        ),
      }),
      createTableColumn<Tenant>({ columnId: 'cc', renderHeaderCell: () => t('customer.tenants.col.costCenter'), renderCell: (x) => (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span className={s.mono}>{x.costCenter}</span>
          <span className={s.mono}>{x.billingContact.name}</span>
        </div>
      ) }),
      createTableColumn<Tenant>({
        columnId: 'class',
        compare: (a, b) => a.dataClass.localeCompare(b.dataClass),
        renderHeaderCell: () => t('customer.tenants.col.dataClass'),
        renderCell: (x) => (
          <Tooltip content={tenantPolicyNote(t, x) ?? t('customer.tenants.generalNote')} relationship="description">
            <Badge appearance="tint" color={dataClassColor(x.dataClass)} size="small">
              {tl(t, 'DATA_CLASS_LABELS', x.dataClass, DATA_CLASS_LABELS[x.dataClass])}
            </Badge>
          </Tooltip>
        ),
      }),
      createTableColumn<Tenant>({
        columnId: 'tiers',
        renderHeaderCell: () => t('customer.tenants.col.tierPolicy'),
        renderCell: (x) => (
          <Badge appearance="outline" size="small" color={x.allowedTiers === 'local' ? 'danger' : 'informative'}>
            {tl(t, 'TIER_POLICY_LABELS', x.allowedTiers, TIER_POLICY_LABELS[x.allowedTiers])}
            {x.dataClass === 'public-sector' ? t('customer.tenants.enforced') : ''}
          </Badge>
        ),
      }),
      createTableColumn<Tenant>({
        columnId: 'models',
        renderHeaderCell: () => t('customer.tenants.col.models'),
        renderCell: (x) => (
          <span className={s.num}>
            {x.allowedModels.length ? t('customer.tenants.modelCount', { n: x.allowedModels.length }) : t('customer.tenants.unlimited')}
            {x.excludeOrigins.length ? t('customer.tenants.excludeOrigins', { origins: x.excludeOrigins.join(t('common.listSeparator')) }) : ''}
          </span>
        ),
      }),
      createTableColumn<Tenant>({
        columnId: 'quota',
        renderHeaderCell: () => t('customer.tenants.col.quota'),
        renderCell: (x) => (
          <span className={s.num}>
            {L.fmtNumber(x.quotas.rpm)} / {L.fmtNumber(x.quotas.tpm)}
          </span>
        ),
      }),
      createTableColumn<Tenant>({ columnId: 'budget', compare: (a, b) => a.quotas.monthlyBudgetUsd - b.quotas.monthlyBudgetUsd, renderHeaderCell: () => t('customer.tenants.col.budget'), renderCell: (x) => <span className={s.num}>{formatUsd(x.quotas.monthlyBudgetUsd, 0)}</span> }),
      createTableColumn<Tenant>({ columnId: 'created', renderHeaderCell: () => t('customer.tenants.col.onboarded'), renderCell: (x) => L.fmtDate(x.createdAt) }),
      createTableColumn<Tenant>({
        columnId: 'status',
        renderHeaderCell: () => t('common.status'),
        renderCell: (x) => (x.status === 'active' ? <StatusBadge kind="success" label={t('customer.tenants.statusActive')} size="small" /> : <StatusBadge kind="danger" label={t('customer.tenants.statusSuspended')} size="small" />),
      }),
    ],
    [s, t, L],
  );
  // 舊路由：試用申請分頁已獨立為 /trials
  if (params.get('tab') === 'trials') return <Navigate to="/trials" replace />;
  return (
    <>
      <PageHeader
        title={t('customer.tenants.title')}
        subtitle={t('customer.tenants.subtitle')}
        crumbs={[{ label: t('customer.tenants.crumb') }]}
        actions={
          isVendor ? (
            <Tooltip content={canCreate ? t('customer.tenants.createTip') : t('customer.tenants.needCreate')} relationship="description">
              <Button data-tour="tenants-create" appearance="primary" icon={<PersonAddRegular />} onClick={() => setCreating(true)}>
                {t('customer.tenants.create')}
              </Button>
            </Tooltip>
          ) : undefined
        }
      />
      <AsyncView {...st} actionLabel={t('customer.tenants.viewAction')} isEmpty={(d) => d.length === 0} empty={<EmptyState title={t('customer.tenants.emptyTitle')} description={t('customer.tenants.emptyDesc')} />}>
        {(tenants) => (
          <div data-tour="tenants-table">
            <SimpleGrid items={tenants} columns={columns} getRowId={(x) => x.id} ariaLabel={t('customer.tenants.gridAria')} onRowClick={(x) => navigate(`/tenants/${x.id}`)} minWidth={1500} />
          </div>
        )}
      </AsyncView>
      <CreateTenantDrawer open={creating} onClose={() => setCreating(false)} onCreated={() => st.reload()} />
    </>
  );
}
