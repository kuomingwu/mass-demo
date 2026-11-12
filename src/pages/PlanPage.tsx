import { Badge, Button, Dropdown, Field, Link, MessageBar, MessageBarBody, MessageBarTitle, Option, ProgressBar, Text, Tooltip, makeStyles, tokens } from '@fluentui/react-components';
import { WalletCreditCardRegular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { AsyncView } from '../components/States';
import { TopUpDialog } from '../components/TopUpDialog';
import { useApi } from '../hooks/useApi';
import { server, TRIAL_TERMS, type TenantAccount } from '../server/api';
import { useSession } from '../app/SessionContext';
import { tenantScope } from '../auth/scope';
import { PLAN_DESCRIPTIONS, PLAN_LABELS, TENANTS } from '../server/seed';
import { BILLING_MODE_LABELS, RATE_LIMIT_TIERS, RETENTION_LABELS, SLA_TERMS } from '../data/commercial';
import { formatUsd } from '../theme/chartPalette';
import { tenantLabel, tl, useLocale, useT } from '../i18n';
import { slaText, tierNote } from './hub/hubContent';

const useStyles = makeStyles({
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: tokens.spacingHorizontalM, marginBottom: tokens.spacingVerticalL },
  card: { backgroundColor: tokens.colorNeutralBackground1, borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px', borderTopStyle: 'solid', borderRightStyle: 'solid', borderBottomStyle: 'solid', borderLeftStyle: 'solid', borderTopColor: tokens.colorNeutralStroke2, borderRightColor: tokens.colorNeutralStroke2, borderBottomColor: tokens.colorNeutralStroke2, borderLeftColor: tokens.colorNeutralStroke2, borderRadius: tokens.borderRadiusLarge, padding: tokens.spacingVerticalM, display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalS, minWidth: 0 },
  label: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  value: { fontSize: tokens.fontSizeBase600, fontWeight: tokens.fontWeightSemibold, fontVariantNumeric: 'tabular-nums' },
  num: { fontVariantNumeric: 'tabular-nums' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: tokens.fontSizeBase200 },
  th: { textAlign: 'left', padding: '6px 8px', color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightRegular, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tokens.colorNeutralStroke2 },
  td: { padding: '6px 8px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tokens.colorNeutralStroke3, verticalAlign: 'top', fontVariantNumeric: 'tabular-nums' },
  rowActive: { backgroundColor: tokens.colorBrandBackground2 },
  h2: { fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold, margin: `${tokens.spacingVerticalM} 0 ${tokens.spacingVerticalS}` },
});

/**
 * 試用與方案（客戶入口）：計費模式（預付儲值／月結合約）、餘額與本月扣抵、儲值、試用狀態、限流層級（依累計消費自動升級）、SLA 與留存政策。
 * 資料全部來自伺服器 getTenantAccount（需該租戶的 billing.read）；我們的角色可切換檢視任一租戶。
 */
export function PlanPage() {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const sla = slaText(t);
  const { session, principal, canUi, tenantId: ctxTenant } = useSession();
  const tenantOptions = useMemo(() => TENANTS.filter((x) => canUi('billing.read', tenantScope(x.id))), [canUi, principal]);
  const [tenantId, setTenantId] = useState(principal?.tenantId ?? ctxTenant ?? tenantOptions[0]?.id ?? '');
  const effectiveTenant = tenantOptions.some((x) => x.id === tenantId) ? tenantId : tenantOptions[0]?.id ?? '';
  const st = useApi(() => (effectiveTenant ? server.getTenantAccount(session, effectiveTenant) : Promise.resolve({ ok: false as const, status: 403 as const, code: 'FORBIDDEN', message: t('hub.plan.noTenant'), messageKey: 'hub.plan.noTenant', requestId: '-' })), [session, effectiveTenant, t]);
  const [topup, setTopup] = useState(false);
  const canTopup = !!effectiveTenant && canUi('billing.topup', tenantScope(effectiveTenant));
  const isVendor = principal?.tenantId === null;
  const mtpm = (tpm: number) => L.fmtNumber(tpm / 1_000_000);

  return (
    <>
      <PageHeader
        title={t('hub.plan.title')}
        subtitle={t('hub.plan.subtitle')}
        crumbs={[{ label: t('hub.plan.title') }]}
        actions={
          isVendor && tenantOptions.length > 1 ? (
            <Field label={t('hub.plan.viewTenant')} orientation="horizontal">
              <Dropdown size="small" value={TENANTS.find((x) => x.id === effectiveTenant)?.name ?? ''} selectedOptions={[effectiveTenant]} onOptionSelect={(_, d) => d.optionValue && setTenantId(d.optionValue)} style={{ minWidth: 200 }} aria-label={t('hub.plan.viewTenant')}>
                {tenantOptions.map((x) => (
                  <Option key={x.id} value={x.id}>
                    {x.name}
                  </Option>
                ))}
              </Dropdown>
            </Field>
          ) : undefined
        }
      />
      <AsyncView {...st} actionLabel={t('hub.plan.actionLabel')}>
        {(a: TenantAccount) => (
          <>
            {a.credits?.trial && (
              <MessageBar intent={a.credits.trial.expired ? 'warning' : 'info'} style={{ marginBottom: 12 }} data-tour="plan-trial">
                <MessageBarBody>
                  <MessageBarTitle>{t(a.credits.trial.expired ? 'hub.plan.trialTitleExpired' : 'hub.plan.trialTitle', { usd: formatUsd(a.credits.trial.grantedUsd, 0) })}</MessageBarTitle>
                  {t('hub.plan.trialBody', { date: L.fmtDate(a.credits.trial.expiresAt), days: TRIAL_TERMS.periodBusinessDays, notice: TRIAL_TERMS.extendNoticeDays })}
                </MessageBarBody>
              </MessageBar>
            )}
            {a.credits?.lowBalance && (
              <MessageBar intent="warning" role="alert" style={{ marginBottom: 12 }} data-tour="plan-low-balance">
                <MessageBarBody>
                  <MessageBarTitle>{t('hub.plan.lowBalanceTitle')}</MessageBarTitle>
                  {t('hub.plan.lowBalanceBody', { available: formatUsd(a.credits.availableUsd), threshold: formatUsd(a.credits.lowBalanceThresholdUsd, 0) })}
                  {a.credits.autoReload ? t('hub.plan.autoReload', { threshold: formatUsd(a.credits.autoReload.thresholdUsd, 0), amount: formatUsd(a.credits.autoReload.amountUsd, 0) }) : t('hub.plan.noAutoReload')}
                </MessageBarBody>
              </MessageBar>
            )}
            <div className={s.grid} data-tour="plan-cards">
              <div className={s.card} data-tour="plan-mode">
                <span className={s.label}>{t('hub.plan.modeLabel')}</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Badge appearance="tint" color="brand">
                    {tl(t, 'PLAN_LABELS', a.plan, PLAN_LABELS[a.plan])}
                  </Badge>
                  <Badge appearance="outline" color={a.billingMode === 'prepaid' ? 'important' : 'informative'}>
                    {tl(t, 'BILLING_MODE_LABELS', a.billingMode, BILLING_MODE_LABELS[a.billingMode])}
                  </Badge>
                </div>
                <span className={s.label}>{tl(t, 'PLAN_DESCRIPTIONS', a.plan, PLAN_DESCRIPTIONS[a.plan])}</span>
                {a.commitment && <span className={s.label}>{t('hub.plan.commitment', { usd: formatUsd(a.commitment.monthlyUsd, 0), pct: a.commitment.discountPct })}</span>}
              </div>
              {a.credits ? (
                <div className={s.card} data-tour="plan-balance">
                  <span className={s.label}>{t('hub.plan.availableLabel')}</span>
                  <span className={s.value} style={{ color: a.credits.lowBalance ? tokens.colorPaletteDarkOrangeForeground1 : undefined }}>
                    {formatUsd(a.credits.availableUsd)}
                  </span>
                  <span className={s.label}>{t('hub.plan.ledger', { balance: formatUsd(a.credits.balanceUsd), spend: formatUsd(a.credits.monthSpendUsd), topups: formatUsd(a.credits.monthTopupsUsd, 0) })}</span>
                  <ProgressBar value={a.credits.balanceUsd ? Math.min(1, a.credits.monthSpendUsd / a.credits.balanceUsd) : 0} color={a.credits.lowBalance ? 'warning' : 'brand'} aria-label={t('hub.plan.usedAria', { pct: a.credits.balanceUsd ? Math.round((a.credits.monthSpendUsd / a.credits.balanceUsd) * 100) : 0 })} />
                  <div>
                    <Tooltip content={canTopup ? t('hub.plan.topupTip') : t('hub.plan.topupDenied')} relationship="description">
                      <Button appearance="primary" icon={<WalletCreditCardRegular />} onClick={() => setTopup(true)} disabled={!canTopup} data-tour="plan-topup">
                        {t('hub.plan.topup')}
                      </Button>
                    </Tooltip>
                  </div>
                </div>
              ) : (
                <div className={s.card} data-tour="plan-balance">
                  <span className={s.label}>{t('hub.plan.postpaidLabel')}</span>
                  <span className={s.value}>{formatUsd(a.monthSpendUsd, 0)}</span>
                  <span className={s.label}>{t('hub.plan.postpaidNote')}</span>
                  <Link as="a" href="#/usage?tab=statement">
                    {t('hub.plan.viewStatement')}
                  </Link>
                </div>
              )}
              <div className={s.card} data-tour="plan-tier">
                <span className={s.label}>{t('hub.plan.tierLabel')}</span>
                <span className={s.value}>
                  {a.tier.current.name} · {mtpm(a.tier.current.tpm)}M TPM
                </span>
                <span className={s.label}>
                  {a.tier.contract
                    ? t('hub.plan.tierContract')
                    : t('hub.plan.tierSpend', { spend: formatUsd(a.tier.cumulativeSpendUsd) }) + (a.tier.next && a.tier.toNextUsd !== null ? t('hub.plan.tierNext', { usd: formatUsd(a.tier.toNextUsd), tier: a.tier.next.name, tpm: mtpm(a.tier.next.tpm) }) : t('hub.plan.tierMax'))}
                </span>
              </div>
              <div className={s.card} data-tour="plan-retention">
                <span className={s.label}>{t('hub.plan.retentionLabel')}</span>
                <Badge appearance="tint" color={a.retention === 'zero' ? 'success' : 'informative'} style={{ alignSelf: 'flex-start' }}>
                  {tl(t, 'RETENTION_LABELS', a.retention, RETENTION_LABELS[a.retention])}
                </Badge>
                <span className={s.label}>{a.retention === 'zero' ? t('hub.plan.retentionZero') : t('hub.plan.retention30d')}</span>
                <Link as="a" href={`#/tenants/${a.tenantId}`}>
                  {t('hub.plan.tenantDetail')}
                </Link>
              </div>
            </div>

            <h2 className={s.h2}>{t('hub.plan.tiersTitle')}</h2>
            <div className={s.card} data-tour="plan-tiers">
              <table className={s.table}>
                <thead>
                  <tr>
                    <th className={s.th} scope="col">
                      {t('hub.prices.tier')}
                    </th>
                    <th className={s.th} scope="col">
                      {t('hub.plan.tpmLimit')}
                    </th>
                    <th className={s.th} scope="col">
                      {t('hub.prices.condition')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {RATE_LIMIT_TIERS.map((r) => (
                    <tr key={r.level} className={r.level === a.tier.current.level ? s.rowActive : undefined} aria-current={r.level === a.tier.current.level ? 'true' : undefined}>
                      <td className={s.td}>
                        {r.name}
                        {r.level === a.tier.current.level ? (
                          <Badge size="small" appearance="filled" color="brand" style={{ marginLeft: 6 }}>
                            {t('hub.plan.current')}
                          </Badge>
                        ) : null}
                      </td>
                      <td className={s.td}>{L.fmtNumber(r.tpm)}</td>
                      <td className={s.td}>{tierNote(t, r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Text size={200} className={s.label}>
                {t('hub.plan.tiersNote')}
              </Text>
            </div>

            <h2 className={s.h2}>{t('hub.sla.title')}</h2>
            <div className={s.grid} data-tour="plan-sla">
              <div className={s.card}>
                <span className={s.label}>{sla.sharedLabel}</span>
                <span className={s.value}>{SLA_TERMS.shared.availabilityPct}%</span>
                <span className={s.label}>{sla.sharedNote}</span>
              </div>
              <div className={s.card}>
                <span className={s.label}>{sla.dedicatedLabel}</span>
                <span className={s.value}>{t('hub.plan.slaThroughput', { pct: SLA_TERMS.dedicated.availabilityPct })}</span>
                <span className={s.label}>{sla.dedicatedNote}</span>
              </div>
              <div className={s.card}>
                <span className={s.label}>{t('hub.sla.credits')}</span>
                <table className={s.table}>
                  <tbody>
                    {sla.credits.map((c) => (
                      <tr key={c.below}>
                        <td className={s.td}>{c.label}</td>
                        <td className={s.td}>
                          <strong>{c.creditPct}%</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <span className={s.label}>{sla.note}</span>
              </div>
            </div>
            <TopUpDialog open={topup} tenantId={a.tenantId} tenantName={tenantLabel(t, a.tenantId, a.tenantName)} onClose={() => setTopup(false)} onDone={() => st.reload()} />
          </>
        )}
      </AsyncView>
    </>
  );
}
