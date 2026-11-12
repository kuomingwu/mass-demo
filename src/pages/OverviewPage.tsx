import { Badge, Link, Text, makeStyles, tokens } from '@fluentui/react-components';
import { Fragment, useMemo, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { AsyncView, EmptyState } from '../components/States';
import { StatusBadge, healthKind, DecisionBadge } from '../components/StatusBadge';
import { ChartCard, DataTable, LineChart, StatTile } from '../components/charts/Charts';
import { useApi } from '../hooks/useApi';
import { server } from '../server/api';
import { useSession } from '../app/SessionContext';
import { useThemeMode } from '../theme/ThemeProvider';
import { formatCompact, formatUsd, seriesColor } from '../theme/chartPalette';
import { HEALTH_LABELS } from '../data/providers';
import { CLUSTER_STATUS_LABELS } from '../data/clusters';
import { PLAN_LABELS } from '../server/seed';
import { SLA_TERMS } from '../data/commercial';
import { clusterStatusKind } from './clusters/ClustersPage';
import { principalLabel, tenantLabel, tf, tl, useLocale, useT } from '../i18n';

const useStyles = makeStyles({
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: tokens.spacingHorizontalM, marginBottom: tokens.spacingVerticalL },
  grid: { display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: tokens.spacingHorizontalM, '@media (max-width: 1000px)': { gridTemplateColumns: '1fr' } },
  col: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM, minWidth: 0 },
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    borderTopWidth: '1px',
    borderRightWidth: '1px',
    borderBottomWidth: '1px',
    borderLeftWidth: '1px',
    borderTopStyle: 'solid',
    borderRightStyle: 'solid',
    borderBottomStyle: 'solid',
    borderLeftStyle: 'solid',
    borderTopColor: tokens.colorNeutralStroke2,
    borderRightColor: tokens.colorNeutralStroke2,
    borderBottomColor: tokens.colorNeutralStroke2,
    borderLeftColor: tokens.colorNeutralStroke2,
    borderRadius: tokens.borderRadiusLarge,
    padding: tokens.spacingVerticalM,
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalS,
  },
  cardTitle: { fontWeight: tokens.fontWeightSemibold },
  list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalXS },
  li: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', columnGap: tokens.spacingHorizontalS, padding: `${tokens.spacingVerticalXS} 0`, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tokens.colorNeutralStroke3 },
  meta: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  audit: { display: 'flex', flexDirection: 'column', rowGap: '2px', fontSize: tokens.fontSizeBase200 },
  bar: { display: 'flex', height: '6px', borderRadius: '3px', overflow: 'hidden', backgroundColor: tokens.colorNeutralBackground3, width: '100px' },
  barFill: { backgroundColor: tokens.colorBrandBackground },
  num: { fontVariantNumeric: 'tabular-nums' },
  funnel: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: tokens.spacingHorizontalS, alignItems: 'end' },
  funnelStep: { display: 'flex', flexDirection: 'column', rowGap: '2px', padding: tokens.spacingVerticalS, borderRadius: tokens.borderRadiusMedium, backgroundColor: tokens.colorNeutralBackground2 },
  funnelValue: { fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold, fontVariantNumeric: 'tabular-nums' },
  split: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: tokens.spacingHorizontalS },
});

/** 把含 {name} 的翻譯範本拆成 React 節點（讓 <strong>、<code> 等元素可依語序放在句中） */
function rich(template: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return template.split(/(\{\w+\})/g).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m && m[1] in nodes ? <Fragment key={i}>{nodes[m[1]]}</Fragment> : part;
  });
}

/** 平台營運總覽（我們的角色）：token 事業的 KPI。客戶角色的首頁是模型中心（路由層已導向，此處再保險一次）。 */
export function OverviewPage() {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const { session, principal } = useSession();
  const { isDark } = useThemeMode();
  const st = useApi(() => server.getOverview(session), [session]);
  const hourlyData = useMemo(() => st.data?.hourly.map((h) => ({ label: h.hour, values: [h.requests] })) ?? [], [st.data]);
  if (principal && principal.tenantId !== null) return <Navigate to="/hub" replace />;
  const noPerm = t('common.noPermission');

  return (
    <>
      <PageHeader title={t('nav.overview')} subtitle={t('overview.subtitle', { name: principalLabel(t, principal?.id, principal?.displayName) })} crumbs={[{ label: t('nav.overview') }]} />
      <AsyncView {...st} skeletonRows={8}>
        {(d) => {
          const v = d.vendor;
          if (!v)
            return (
              <EmptyState
                title={t('overview.vendorOnly.title')}
                description={t('overview.vendorOnly.description')}
                action={
                  <Link as="a" href="#/hub">
                    {t('overview.vendorOnly.action')}
                  </Link>
                }
              />
            );
          const rev = d.revenue;
          const hasRev = !!rev && typeof v.monthRevenueUsd === 'number';
          const total = d.tiers.localRequests + d.tiers.cloudRequests;
          const localPct = total ? Math.round((d.tiers.localRequests / total) * 100) : 0;
          const spillPct = total ? Math.round((d.tiers.spilloverRequests / total) * 100) : 0;
          const cloudPct = total ? 100 - localPct - spillPct : 0;
          const weekTotal = v.weekTokens.local + v.weekTokens.proxied;
          const f = v.trialFunnel;
          const requestsLabel = t('overview.hourly.requests');
          return (
            <>
              <div className={s.tiles} data-tour="kpi">
                <StatTile
                  label={t('overview.kpi.weekTokens')}
                  value={formatCompact(weekTotal)}
                  hint={t('overview.kpi.weekTokensHint', { local: formatCompact(v.weekTokens.local), pct: weekTotal ? Math.round((v.weekTokens.local / weekTotal) * 100) : 0, proxied: formatCompact(v.weekTokens.proxied) })}
                />
                <StatTile
                  label={t('overview.kpi.monthRevenue')}
                  value={hasRev ? formatUsd(v.monthRevenueUsd as number, 0) : noPerm}
                  hint={hasRev && v.revenueSplit ? t('overview.kpi.monthRevenueHint', { token: formatUsd(v.revenueSplit.tokenUsd, 0), proxied: formatUsd(v.revenueSplit.proxiedUsd, 0), dedicated: formatUsd(v.revenueSplit.dedicatedUsd, 0) }) : t('overview.kpi.needBillingReadOwner')}
                />
                <StatTile
                  label={t('overview.kpi.grossMargin')}
                  value={typeof v.grossMarginPct === 'number' ? `${v.grossMarginPct.toFixed(1)}%` : noPerm}
                  hint={typeof v.grossMarginPct === 'number' ? (v.grossMarginPct >= 40 ? t('overview.kpi.marginAbove') : t('overview.kpi.marginBelow')) : t('overview.kpi.needBillingRead')}
                />
                <StatTile label={t('overview.kpi.gpuUtil')} value={`${Math.round(v.gpuUtilization * 100)}%`} hint={t('overview.kpi.gpuUtilHint', { allocated: v.gpuAllocated, total: v.gpuTotal, healthy: v.clustersHealthy, clusters: v.clustersTotal })} />
                <StatTile label={t('overview.kpi.activeTenants')} value={String(v.activeTenants)} hint={t('overview.kpi.funnelHint', { submitted: f.submitted, approved: f.approved, converted: f.converted })} />
                <StatTile label={t('overview.kpi.spillover')} value={`${v.spilloverPct.toFixed(1)}%`} hint={t('overview.kpi.spilloverHint')} />
                <StatTile label={t('overview.kpi.sla')} value={`${v.slaAttainmentPct.toFixed(2)}%`} hint={t('overview.kpi.slaHint', { target: SLA_TERMS.shared.availabilityPct })} />
              </div>
              <div className={s.grid}>
                <div className={s.col}>
                  {rev && (
                    <section className={s.card} aria-labelledby="revenue" data-tour="revenue">
                      <Text className={s.cardTitle} id="revenue" as="h3">
                        {t('overview.revenue.title', { month: rev.month, days: rev.daysInPeriod })}
                      </Text>
                      <div className={s.split}>
                        <div>
                          <div className={s.meta}>{t('overview.revenue.total')}</div>
                          <Text size={500} weight="semibold" className={s.num} data-tour="overview-revenue-total">
                            {formatUsd(rev.totalRevenueUsd, 0)}
                          </Text>
                        </div>
                        <div>
                          <div className={s.meta}>{t('overview.revenue.token')}</div>
                          <Text size={500} weight="semibold" className={s.num}>
                            {formatUsd(rev.tokenRevenueUsd, 0)}
                          </Text>
                        </div>
                        <div>
                          <div className={s.meta}>{t('overview.revenue.proxied')}</div>
                          <Text size={500} weight="semibold" className={s.num}>
                            {formatUsd(rev.cloudRevenueUsd, 0)}
                          </Text>
                        </div>
                        <div>
                          <div className={s.meta}>{t('overview.revenue.dedicated')}</div>
                          <Text size={500} weight="semibold" className={s.num}>
                            {formatUsd(rev.dedicatedRevenueUsd, 0)}
                          </Text>
                        </div>
                        <div>
                          <div className={s.meta}>{t('overview.revenue.prepaid')}</div>
                          <Text size={500} weight="semibold" className={s.num}>
                            {formatUsd(rev.prepaidTopupsUsd, 0)}
                          </Text>
                        </div>
                        <div>
                          <div className={s.meta}>{t('overview.revenue.grossProfit')}</div>
                          <Text size={500} weight="semibold" className={s.num}>
                            {formatUsd(rev.grossProfitUsd, 0)} · {rev.grossMarginPct.toFixed(1)}%
                          </Text>
                        </div>
                      </div>
                      <Text size={200}>
                        {t('overview.revenue.costNote', {
                          gpu: formatUsd(rev.gpuCostUsd, 0),
                          cloud: formatUsd(rev.cloudListCostUsd, 0),
                          vendorList: formatUsd(rev.cloudVendorListUsd, 0),
                          discount: server.billing.negotiatedDiscountPct,
                          commitment: formatUsd(rev.commitmentAdjustmentUsd, 0),
                        })}
                      </Text>
                      <ul className={s.list}>
                        {rev.byTenant.map((tn) => (
                          <li key={tn.tenantId} className={s.li}>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span>
                                {tenantLabel(t, tn.tenantId, tn.tenantName)}{' '}
                                <Badge appearance="outline" size="small">
                                  {tl(t, 'PLAN_LABELS', tn.plan, PLAN_LABELS[tn.plan])}
                                </Badge>
                              </span>
                              <span className={s.meta}>
                                {t('overview.revenue.tenantLine', { costCenter: tn.costCenter, token: formatUsd(tn.tokenUsd, 0), dedicated: formatUsd(tn.dedicatedUsd, 0), proxied: formatUsd(tn.cloudUsd, 0) })}
                                {tn.commitmentAdjustmentUsd ? t('overview.revenue.tenantCommitment', { amount: formatUsd(tn.commitmentAdjustmentUsd, 0) }) : ''}
                              </span>
                            </div>
                            <Text weight="semibold" className={s.num}>
                              {formatUsd(tn.revenueUsd, 0)}
                            </Text>
                          </li>
                        ))}
                      </ul>
                      <Link as="a" href="#/pricing?tab=revenue">
                        {t('overview.revenue.link')}
                      </Link>
                    </section>
                  )}
                  <section className={s.card} aria-labelledby="token-mix" data-tour="token-mix">
                    <Text className={s.cardTitle} id="token-mix" as="h3">
                      {t('overview.mix.title')}
                    </Text>
                    <Text size={200}>{t('overview.mix.description')}</Text>
                    <div role="img" aria-label={t('overview.mix.aria', { local: localPct, spill: spillPct, cloud: cloudPct })} style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', background: tokens.colorNeutralBackground3 }}>
                      <div style={{ width: `${localPct}%`, background: tokens.colorBrandBackground }} />
                      <div style={{ width: `${spillPct}%`, background: tokens.colorPaletteMarigoldBackground3 }} />
                      <div style={{ width: `${cloudPct}%`, background: tokens.colorPaletteDarkOrangeBackground3 }} />
                    </div>
                    <ul className={s.list}>
                      <li className={s.li}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span>{t('overview.mix.local')}</span>
                          <span className={s.meta}>{t('overview.mix.localMeta', { pct: localPct, tokens: formatCompact(d.tiers.localTokens), hours: d.tiers.localGpuHours, revenue: formatUsd(d.tiers.localRevenueUsd, 0) })}</span>
                        </div>
                      </li>
                      <li className={s.li}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span>{t('overview.mix.spill')}</span>
                          <span className={s.meta}>{t('overview.mix.spillMeta', { pct: spillPct })}</span>
                        </div>
                      </li>
                      <li className={s.li}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span>{t('overview.mix.cloud')}</span>
                          <span className={s.meta}>{t('overview.mix.cloudMeta', { pct: cloudPct, tokens: formatCompact(d.tiers.cloudTokens), revenue: formatUsd(d.tiers.cloudRevenueUsd, 0) })}</span>
                        </div>
                      </li>
                    </ul>
                    <Link as="a" href="#/usage">
                      {t('overview.mix.link')}
                    </Link>
                  </section>
                  <ChartCard
                    title={t('overview.hourly.title')}
                    subtitle={t('overview.hourly.subtitle')}
                    table={<DataTable columns={[t('overview.hourly.hour'), requestsLabel, t('overview.hourly.errors')]} rows={d.hourly.map((h) => [h.hour, h.requests, h.errors])} />}
                  >
                    <LineChart data={hourlyData} series={[requestsLabel]} colors={[seriesColor(0, isDark)]} height={200} />
                  </ChartCard>
                  <section className={s.card} aria-labelledby="recent-audit">
                    <Text className={s.cardTitle} id="recent-audit" as="h3">
                      {t('overview.audit.title')}
                    </Text>
                    {d.recentAudit.length === 0 ? (
                      <EmptyState title={t('overview.audit.emptyTitle')} description={t('overview.audit.emptyDescription')} />
                    ) : (
                      <ul className={s.list}>
                        {d.recentAudit.map((e) => (
                          <li key={e.id} className={s.li}>
                            <div className={s.audit}>
                              <span>
                                {rich(t('overview.audit.performed'), { actor: <strong>{principalLabel(t, e.actorId, e.actorName)}</strong>, action: <code>{e.action}</code> })}
                                {e.principalId !== e.actorId ? <>{t('overview.audit.onPrincipal', { principal: principalLabel(t, e.principalId, e.principalName) })}</> : null}
                              </span>
                              <span className={s.meta}>
                                {L.fmtDateTime(e.timestamp)} · {e.scope} · {e.requestId}
                              </span>
                            </div>
                            <DecisionBadge decision={e.decision} />
                          </li>
                        ))}
                      </ul>
                    )}
                    <Link as="a" href="#/audit">
                      {t('overview.audit.link')}
                    </Link>
                  </section>
                </div>
                <div className={s.col}>
                  <section className={s.card} aria-labelledby="trial-funnel" data-tour="trial-funnel">
                    <Text className={s.cardTitle} id="trial-funnel" as="h3">
                      {t('overview.funnel.title')}
                    </Text>
                    <div className={s.funnel}>
                      <div className={s.funnelStep}>
                        <span className={s.meta}>{t('overview.funnel.submitted')}</span>
                        <span className={s.funnelValue}>{f.submitted}</span>
                      </div>
                      <div className={s.funnelStep}>
                        <span className={s.meta}>{t('overview.funnel.approved')}</span>
                        <span className={s.funnelValue}>{f.approved}</span>
                      </div>
                      <div className={s.funnelStep}>
                        <span className={s.meta}>{t('overview.funnel.converted')}</span>
                        <span className={s.funnelValue}>{f.converted}</span>
                      </div>
                    </div>
                    <Text size={200}>{t('overview.funnel.note')}</Text>
                    <Link as="a" href="#/trials">
                      {t('overview.funnel.link')}
                    </Link>
                  </section>
                  <section className={s.card} aria-labelledby="cluster-health" data-tour="cluster-health">
                    <Text className={s.cardTitle} id="cluster-health" as="h3">
                      {t('overview.clusters.title')}
                    </Text>
                    {d.clusters.length === 0 ? (
                      <EmptyState title={t('overview.clusters.emptyTitle')} description={t('overview.clusters.emptyDescription')} />
                    ) : (
                      <ul className={s.list}>
                        {d.clusters.map((c) => (
                          <li key={c.id} className={s.li}>
                            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                              <Link as="a" href={`#/clusters/${c.id}`}>
                                {tf(t, `data.cluster.${c.id}.name`, c.name)}
                              </Link>
                              <span className={s.meta}>
                                {t('overview.clusters.meta', { gpuType: c.gpuType, util: Math.round(c.gpuUtil * 100), queue: c.queueDepth, allocated: c.gpuAllocated, free: Math.max(0, c.gpuTotal - c.gpuAllocated) })}
                              </span>
                              <div className={s.bar} role="img" aria-label={t('overview.clusters.utilAria', { util: Math.round(c.gpuUtil * 100) })}>
                                <div className={s.barFill} style={{ width: `${Math.round(c.gpuUtil * 100)}%` }} />
                              </div>
                            </div>
                            <StatusBadge kind={clusterStatusKind(c.status)} label={tl(t, 'CLUSTER_STATUS_LABELS', c.status, CLUSTER_STATUS_LABELS[c.status])} size="small" />
                          </li>
                        ))}
                      </ul>
                    )}
                    <Link as="a" href="#/clusters">
                      {t('overview.clusters.link')}
                    </Link>
                  </section>
                  <section className={s.card} aria-labelledby="provider-health" data-tour="provider-health">
                    <Text className={s.cardTitle} id="provider-health" as="h3">
                      {t('overview.providers.title')}
                    </Text>
                    {d.providers.length === 0 ? (
                      <EmptyState title={t('overview.providers.emptyTitle')} description={t('overview.providers.emptyDescription')} />
                    ) : (
                      <ul className={s.list}>
                        {d.providers
                          .filter((p) => !p.local)
                          .map((p) => (
                            <li key={p.id} className={s.li}>
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span>{tf(t, `data.provider.${p.id}.name`, p.name)}</span>
                                <span className={s.meta}>
                                  {t('overview.providers.meta', { count: p.endpoints.length, min: Math.min(...p.endpoints.map((e) => e.latencyMs)), max: Math.max(...p.endpoints.map((e) => e.latencyMs)) })}
                                </span>
                              </div>
                              <StatusBadge kind={healthKind(p.health)} label={tl(t, 'HEALTH_LABELS', p.health, HEALTH_LABELS[p.health])} />
                            </li>
                          ))}
                      </ul>
                    )}
                    <Link as="a" href="#/providers">
                      {t('overview.providers.link')}
                    </Link>
                  </section>
                  <section className={s.card}>
                    <Text className={s.cardTitle} as="h3">
                      {t('overview.about.title')}
                    </Text>
                    <Text size={200}>{t('overview.about.body')}</Text>
                  </section>
                </div>
              </div>
            </>
          );
        }}
      </AsyncView>
    </>
  );
}
