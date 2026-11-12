import { Badge, Button, Link, MessageBar, MessageBarBody, MessageBarTitle, ProgressBar, Switch, Text, Tooltip, createTableColumn, makeStyles, tokens, type TableColumnDefinition } from '@fluentui/react-components';
import { DeleteRegular, PersonLockRegular, WalletCreditCardRegular } from '@fluentui/react-icons';
import { DATA_CLASS_LABELS, PLAN_LABELS, TIER_POLICY_LABELS } from '../server/seed';
import { BILLING_MODE_LABELS, RETENTION_LABELS } from '../data/commercial';
import { TopUpDialog } from '../components/TopUpDialog';
import { dataClassColor, planColor, tenantPolicyNote } from './TenantsPage';
import { DeploymentsTable } from './deployments/DeploymentsTable';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { AsyncView, EmptyState, NotFoundState } from '../components/States';
import { StatusBadge } from '../components/StatusBadge';
import { SimpleGrid } from '../components/SimpleGrid';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useNotify } from '../components/Notify';
import { useApi } from '../hooks/useApi';
import { tenantLabel, tf, tl, useLocale, useT } from '../i18n';
import { server } from '../server/api';
import { useSession } from '../app/SessionContext';
import type { Project } from '../server/seed';
import { formatUsd } from '../theme/chartPalette';
import { projectScope, tenantScope } from '../auth/scope';

const useStyles = makeStyles({
  kv: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: tokens.spacingHorizontalM, marginBottom: tokens.spacingVerticalL },
  card: { backgroundColor: tokens.colorNeutralBackground1, borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px', borderTopStyle: 'solid', borderRightStyle: 'solid', borderBottomStyle: 'solid', borderLeftStyle: 'solid', borderTopColor: tokens.colorNeutralStroke2, borderRightColor: tokens.colorNeutralStroke2, borderBottomColor: tokens.colorNeutralStroke2, borderLeftColor: tokens.colorNeutralStroke2, borderRadius: tokens.borderRadiusLarge, padding: tokens.spacingVerticalM, display: 'flex', flexDirection: 'column', rowGap: '4px' },
  label: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  num: { fontVariantNumeric: 'tabular-nums' },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
  budget: { display: 'flex', flexDirection: 'column', rowGap: '2px', minWidth: '140px' },
});

export function TenantDetailPage() {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const { tenantId = '', projectId } = useParams();
  const { session, canUi, bump } = useSession();
  const notify = useNotify();
  const navigate = useNavigate();
  const tenantSt = useApi(() => server.getTenant(session, tenantId), [session, tenantId]);
  const projSt = useApi(() => server.listProjects(session, tenantId), [session, tenantId]);
  const depSt = useApi(() => server.listDeployments(session), [session]);
  const acctSt = useApi(() => server.getTenantAccount(session, tenantId), [session, tenantId]);
  const [toDelete, setToDelete] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [topup, setTopup] = useState(false);
  const [retentionBusy, setRetentionBusy] = useState(false);
  const canTopup = canUi('billing.topup', tenantScope(tenantId));
  const canUpdate = canUi('tenant.update', tenantScope(tenantId));
  const toggleRetention = async (zero: boolean) => {
    setRetentionBusy(true);
    try {
      const res = await server.updateTenantRetention(session, tenantId, zero ? 'zero' : '30d');
      if (res.ok) {
        notify.success(t('customer.tenant.retentionUpdated', { label: tl(t, 'RETENTION_LABELS', res.data.retention, RETENTION_LABELS[res.data.retention]) }), `requestId: ${res.requestId}`);
        bump();
        tenantSt.reload();
        acctSt.reload();
      } else notify.apiError(res, t('customer.tenant.updateRetention'));
    } catch (e) {
      notify.apiError(e as Error, t('customer.tenant.updateRetention'));
    } finally {
      setRetentionBusy(false);
    }
  };

  const columns: TableColumnDefinition<Project>[] = useMemo(
    () => [
      createTableColumn<Project>({
        columnId: 'name',
        compare: (a, b) => a.name.localeCompare(b.name),
        renderHeaderCell: () => t('common.project'),
        renderCell: (p) => (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Text weight="semibold">{p.name}</Text>
            <span className={s.mono}>{projectScope(p.tenantId, p.id)}</span>
          </div>
        ),
      }),
      createTableColumn<Project>({ columnId: 'desc', renderHeaderCell: () => t('common.description'), renderCell: (p) => <Text size={200}>{tf(t, `server.project.${p.id}.description`, p.description)}</Text> }),
      createTableColumn<Project>({
        columnId: 'quota',
        renderHeaderCell: () => t('customer.tenants.col.quota'),
        renderCell: (p) => (
          <span className={s.num}>
            {L.fmtNumber(p.quotas.rpm)} / {L.fmtNumber(p.quotas.tpm)}
          </span>
        ),
      }),
      createTableColumn<Project>({
        columnId: 'budget',
        compare: (a, b) => a.monthSpendUsd / a.quotas.monthlyBudgetUsd - b.monthSpendUsd / b.quotas.monthlyBudgetUsd,
        renderHeaderCell: () => t('customer.tenant.col.budgetUsed'),
        renderCell: (p) => {
          const ratio = p.quotas.monthlyBudgetUsd ? p.monthSpendUsd / p.quotas.monthlyBudgetUsd : 0;
          return (
            <div className={s.budget}>
              <span className={s.num}>
                {formatUsd(p.monthSpendUsd, 0)} / {formatUsd(p.quotas.monthlyBudgetUsd, 0)}（{Math.round(ratio * 100)}%）
              </span>
              <ProgressBar value={Math.min(1, ratio)} color={ratio > 0.9 ? 'error' : ratio > 0.7 ? 'warning' : 'brand'} aria-label={t('customer.tenant.budgetUsedAria', { pct: Math.round(ratio * 100) })} />
            </div>
          );
        },
      }),
      createTableColumn<Project>({ columnId: 'created', renderHeaderCell: () => t('customer.tenant.col.created'), renderCell: (p) => L.fmtDate(p.createdAt) }),
      createTableColumn<Project>({
        columnId: 'status',
        renderHeaderCell: () => t('common.status'),
        renderCell: (p) => (p.status === 'active' ? <StatusBadge kind="success" label={t('customer.tenants.statusActive')} size="small" /> : <StatusBadge kind="neutral" label={t('common.archived')} size="small" />),
      }),
      createTableColumn<Project>({
        columnId: 'actions',
        renderHeaderCell: () => t('customer.keys.col.actions'),
        renderCell: (p) => {
          const scope = projectScope(p.tenantId, p.id);
          const canDelete = canUi('project.delete', scope);
          return (
            <div style={{ display: 'flex', gap: 4 }}>
              <Tooltip content={t('customer.tenant.viewIamTip')} relationship="label">
                <Button size="small" appearance="subtle" icon={<PersonLockRegular />} aria-label={t('customer.tenant.viewIamAria', { name: p.name })} onClick={(e) => { e.stopPropagation(); navigate(`/iam?scope=${encodeURIComponent(scope)}`); }} />
              </Tooltip>
              <Tooltip content={canDelete ? t('customer.tenant.deleteProject') : t('customer.tenant.needDelete')} relationship="label">
                <Button size="small" appearance="subtle" icon={<DeleteRegular />} aria-label={t('customer.tenant.deleteAria', { name: p.name })} disabled={!canDelete} onClick={(e) => { e.stopPropagation(); setToDelete(p); }} />
              </Tooltip>
            </div>
          );
        },
      }),
    ],
    [s, canUi, navigate, t, L],
  );

  const doDelete = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      const res = await server.deleteProject(session, tenantId, toDelete.id);
      if (res.ok) {
        notify.success(t('customer.tenant.deletedToast', { name: toDelete.name }), `requestId: ${res.requestId}`);
        bump();
        projSt.reload();
      } else notify.apiError(res, t('customer.tenant.deleteProject'));
    } catch (e) {
      notify.apiError(e as Error, t('customer.tenant.deleteProject'));
    } finally {
      setBusy(false);
      setToDelete(null);
    }
  };

  if (tenantSt.apiError?.status === 404) return <NotFoundState what={t('common.tenant')} />;
  const td = tenantSt.data;
  return (
    <>
      <PageHeader
        title={td ? tenantLabel(t, td.id, td.name) : t('common.tenant')}
        subtitle={td ? t('customer.tenant.subtitle', { scope: tenantScope(td.id), plan: tl(t, 'PLAN_LABELS', td.plan, PLAN_LABELS[td.plan]), cc: td.costCenter, contact: td.billingContact.name, email: td.billingContact.email }) : undefined}
        crumbs={[{ label: t('customer.tenants.crumb'), to: '/tenants' }, { label: td ? tenantLabel(t, td.id, td.name) : tenantId }]}
        actions={
          <Button appearance="primary" icon={<PersonLockRegular />} onClick={() => navigate(`/iam?scope=${encodeURIComponent(tenantScope(tenantId))}`)}>
            {t('customer.tenant.iamButton')}
          </Button>
        }
      />
      <AsyncView {...tenantSt} actionLabel={t('customer.tenants.viewAction')}>
        {(tenant) => (
          <>
            {tenant.policyNote && (
              <MessageBar intent={tenant.dataClass === 'public-sector' ? 'warning' : 'info'} style={{ marginBottom: 12 }} data-tour="tenant-policy">
                <MessageBarBody>
                  <MessageBarTitle>
                    {t('customer.tenant.policyTitle', { dataClass: tl(t, 'DATA_CLASS_LABELS', tenant.dataClass, DATA_CLASS_LABELS[tenant.dataClass]), tier: tl(t, 'TIER_POLICY_LABELS', tenant.allowedTiers, TIER_POLICY_LABELS[tenant.allowedTiers]) })}
                    {tenant.dataClass === 'public-sector' ? t('customer.tenant.serverEnforced') : ''}
                  </MessageBarTitle>
                  {tenantPolicyNote(t, tenant)}
                </MessageBarBody>
              </MessageBar>
            )}
            <div className={s.kv} data-tour="tenant-cards">
              <div className={s.card}>
                <span className={s.label}>{t('customer.tenant.costCenter')}</span>
                <Text size={400} weight="semibold">
                  {tenant.costCenter}
                </Text>
                <span className={s.label}>
                  <Link href={`#/usage?tenant=${tenant.id}`}>{t('customer.tenant.viewStatement')}</Link>
                </span>
              </div>
              <div className={s.card}>
                <span className={s.label}>{t('customer.tenant.dataClassTiers')}</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Badge appearance="tint" color={dataClassColor(tenant.dataClass)}>
                    {tl(t, 'DATA_CLASS_LABELS', tenant.dataClass, DATA_CLASS_LABELS[tenant.dataClass])}
                  </Badge>
                  <Badge appearance="outline" color={tenant.allowedTiers === 'local' ? 'danger' : 'informative'}>
                    {tl(t, 'TIER_POLICY_LABELS', tenant.allowedTiers, TIER_POLICY_LABELS[tenant.allowedTiers])}
                  </Badge>
                </div>
              </div>
              <div className={s.card} data-tour="tenant-consent-card">
                <span className={s.label}>{t('customer.tenant.consent')}</span>
                {tenant.crossBorderConsent ? (
                  <>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {tenant.crossBorderConsent.regions.map((r) => (
                        <Badge key={r} appearance="outline" color="informative" size="small" style={{ fontFamily: tokens.fontFamilyMonospace }}>
                          {r}
                        </Badge>
                      ))}
                    </div>
                    <span className={s.label}>
                      {t('customer.tenant.consentSigned', { date: L.fmtDate(tenant.crossBorderConsent.signedAt), by: tf(t, `server.tenant.${tenant.id}.consentBy`, tenant.crossBorderConsent.by) })}
                    </span>
                  </>
                ) : (
                  <>
                    <Badge appearance="tint" color="danger" style={{ alignSelf: 'flex-start' }}>
                      {t('customer.tenant.consentNone')}
                    </Badge>
                    <span className={s.label}>{t('customer.tenant.consentNoneDesc')}</span>
                  </>
                )}
              </div>
              <div className={s.card} data-tour="tenant-plan-card">
                <span className={s.label}>{t('customer.tenant.planBilling')}</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Badge appearance="tint" color={planColor(tenant.plan)}>
                    {tl(t, 'PLAN_LABELS', tenant.plan, PLAN_LABELS[tenant.plan])}
                  </Badge>
                  <Badge appearance="outline" color={tenant.billingMode === 'prepaid' ? 'important' : 'informative'}>
                    {tl(t, 'BILLING_MODE_LABELS', tenant.billingMode, BILLING_MODE_LABELS[tenant.billingMode])}
                  </Badge>
                </div>
                <span className={s.label}>{tenant.commitment ? t('customer.tenant.planCommitted', { amount: formatUsd(tenant.commitment.monthlyUsd, 0), pct: tenant.commitment.discountPct }) : tenant.plan === 'dedicated' ? t('customer.tenant.planDedicated') : t('customer.tenant.planPayg')}</span>
              </div>
              <div className={s.card} data-tour="tenant-credits-card">
                <span className={s.label}>{tenant.billingMode === 'prepaid' ? t('customer.tenant.creditsPrepaid') : t('customer.tenant.creditsPostpaid')}</span>
                {acctSt.data ? (
                  acctSt.data.credits ? (
                    <>
                      <Text size={500} weight="semibold" className={s.num} style={{ color: acctSt.data.credits.lowBalance ? tokens.colorPaletteDarkOrangeForeground1 : undefined }}>
                        {formatUsd(acctSt.data.credits.availableUsd)}
                      </Text>
                      <span className={s.label}>
                        {t('customer.tenant.ledger', { balance: formatUsd(acctSt.data.credits.balanceUsd), spent: formatUsd(acctSt.data.credits.monthSpendUsd) })}
                        {acctSt.data.credits.trial ? t('customer.tenant.trialCredit', { amount: formatUsd(acctSt.data.credits.trial.grantedUsd, 0), date: L.fmtDate(acctSt.data.credits.trial.expiresAt) }) : ''}
                        {acctSt.data.credits.lowBalance ? t('customer.tenant.lowBalance') : ''}
                      </span>
                      <div>
                        <Tooltip content={canTopup ? t('customer.tenant.topupTip') : t('customer.tenant.needTopup')} relationship="description">
                          <Button size="small" appearance="primary" icon={<WalletCreditCardRegular />} disabled={!canTopup} onClick={() => setTopup(true)} data-tour="tenant-topup">
                            {t('customer.tenant.topup')}
                          </Button>
                        </Tooltip>
                      </div>
                    </>
                  ) : (
                    <>
                      <Text size={500} weight="semibold" className={s.num}>
                        {formatUsd(acctSt.data.monthSpendUsd, 0)}
                      </Text>
                      <span className={s.label}>{t('customer.tenant.postpaidNote')}</span>
                    </>
                  )
                ) : (
                  <span className={s.label}>{acctSt.apiError ? t('customer.tenant.needBillingRead') : t('customer.tenant.loading')}</span>
                )}
              </div>
              <div className={s.card} data-tour="tenant-tier-card">
                <span className={s.label}>{t('customer.tenant.rateTier')}</span>
                {acctSt.data ? (
                  <>
                    <Text size={500} weight="semibold" className={s.num}>
                      {acctSt.data.tier.current.name} · {L.fmtNumber(acctSt.data.tier.current.tpm / 1_000_000)}M TPM
                    </Text>
                    <span className={s.label}>
                      {acctSt.data.tier.contract ? t('customer.tenant.tierContract') : t('customer.tenant.tierCumulative', { amount: formatUsd(acctSt.data.tier.cumulativeSpendUsd) }) + (acctSt.data.tier.next && acctSt.data.tier.toNextUsd !== null ? t('customer.tenant.tierNext', { amount: formatUsd(acctSt.data.tier.toNextUsd), tier: acctSt.data.tier.next.name }) : '')}
                    </span>
                    <span className={s.label}>
                      <Link href="#/plan">{t('customer.tenant.planLink')}</Link>
                    </span>
                  </>
                ) : (
                  <span className={s.label}>{acctSt.apiError ? t('customer.tenant.needBillingRead') : t('customer.tenant.loading')}</span>
                )}
              </div>
              <div className={s.card} data-tour="tenant-retention-card">
                <span className={s.label}>{t('customer.tenant.retention')}</span>
                <Badge appearance="tint" color={tenant.retention === 'zero' ? 'success' : 'informative'} style={{ alignSelf: 'flex-start' }}>
                  {tl(t, 'RETENTION_LABELS', tenant.retention, RETENTION_LABELS[tenant.retention])}
                </Badge>
                <Tooltip content={canUpdate ? (tenant.dataClass === 'public-sector' ? t('customer.tenant.retentionForced') : t('customer.tenant.retentionToggleTip')) : t('customer.tenant.needUpdate')} relationship="description">
                  <Switch label={t('customer.tenant.retentionSwitch')} checked={tenant.retention === 'zero'} disabled={!canUpdate || retentionBusy || tenant.dataClass === 'public-sector'} onChange={(_, d) => toggleRetention(d.checked)} data-tour="tenant-retention-toggle" />
                </Tooltip>
              </div>
              <div className={s.card}>
                <span className={s.label}>{t('customer.createKey.modelsLabel')}</span>
                <Text size={400} weight="semibold" className={s.num}>
                  {tenant.allowedModels.length ? t('customer.tenants.modelCount', { n: tenant.allowedModels.length }) : t('customer.tenants.unlimited')}
                </Text>
                <span className={s.label}>{tenant.allowedModels.length ? tenant.allowedModels.join(t('common.listSeparator')) : t('customer.tenant.noModelLimit')}{tenant.excludeOrigins.length ? t('customer.tenant.excludedOrigins', { origins: tenant.excludeOrigins.join(t('common.listSeparator')) }) : ''}</span>
              </div>
              <div className={s.card}>
                <span className={s.label}>{t('customer.tenant.quota')}</span>
                <Text size={500} weight="semibold" className={s.num}>
                  {L.fmtNumber(tenant.quotas.rpm)} / {L.fmtNumber(tenant.quotas.tpm)}
                </Text>
              </div>
              <div className={s.card}>
                <span className={s.label}>{t('customer.tenants.col.budget')}</span>
                <Text size={500} weight="semibold" className={s.num}>
                  {formatUsd(tenant.quotas.monthlyBudgetUsd, 0)}
                </Text>
              </div>
              <div className={s.card}>
                <span className={s.label}>{t('common.status')}</span>
                {tenant.status === 'active' ? <StatusBadge kind="success" label={t('customer.tenants.statusActive')} /> : <StatusBadge kind="danger" label={t('customer.tenants.statusSuspended')} />}
              </div>
            </div>
          </>
        )}
      </AsyncView>
      <Text as="h2" size={500} weight="semibold" style={{ display: 'block', margin: '8px 0' }}>
        {t('customer.tenant.deploymentsTitle')}
      </Text>
      <AsyncView {...depSt} actionLabel={t('customer.tenant.viewDeployments')} isEmpty={(d) => d.filter((x) => x.sharing === 'dedicated' ? x.dedicatedTenantId === tenantId : true).length === 0} empty={<EmptyState title={t('customer.tenant.noDeployments')} />}>
        {(deps) => <DeploymentsTable items={deps.filter((x) => (x.sharing === 'dedicated' ? x.dedicatedTenantId === tenantId : tenantSt.data ? tenantSt.data.allowedModels.length === 0 || tenantSt.data.allowedModels.includes(x.modelId) : true))} onChanged={() => depSt.reload()} showCluster />}
      </AsyncView>
      <Text as="h2" size={500} weight="semibold" style={{ display: 'block', margin: '8px 0' }}>
        {t('customer.tenant.projectsTitle')}{projectId ? t('customer.tenant.currentProject', { id: projectId }) : ''}
      </Text>
      <AsyncView {...projSt} actionLabel={t('customer.tenant.viewProjects')} isEmpty={(d) => d.length === 0} empty={<EmptyState title={t('customer.tenant.noProjects')} description={t('customer.tenant.noProjectsDesc')} />}>
        {(projects) => <SimpleGrid items={projects} columns={columns} getRowId={(p) => p.id} ariaLabel={t('customer.tenant.projectGridAria')} minWidth={1000} />}
      </AsyncView>
      <TopUpDialog open={topup} tenantId={tenantId} tenantName={tenantSt.data ? tenantLabel(t, tenantSt.data.id, tenantSt.data.name) : undefined} onClose={() => setTopup(false)} onDone={() => { acctSt.reload(); tenantSt.reload(); }} />
      <ConfirmDialog open={!!toDelete} title={t('customer.tenant.deleteConfirmTitle')} destructive confirmLabel={t('common.delete')} busy={busy} onCancel={() => setToDelete(null)} onConfirm={doDelete}>
        {t('customer.tenant.deleteConfirmBody', { name: toDelete?.name ?? '' })}
      </ConfirmDialog>
    </>
  );
}
