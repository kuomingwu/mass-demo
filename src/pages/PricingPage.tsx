import { Badge, Button, Field, Input, MessageBar, MessageBarBody, ProgressBar, Tab, TabList, Text, makeStyles, tokens } from '@fluentui/react-components';
import { SaveRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { AsyncView, EmptyState, PermissionDenied } from '../components/States';
import { CodeBlock } from '../components/CodeBlock';
import { useNotify } from '../components/Notify';
import { useApi } from '../hooks/useApi';
import { server, TARGET_MARGIN_PCT, type RevenueView, type UnitPriceRow } from '../server/api';
import { useSession } from '../app/SessionContext';
import { PLAN_LABELS } from '../server/seed';
import { DEPLOYABLE_MODELS, MODELS, ORIGIN_LABELS, UNIT_TYPE_LABELS, isLocalModel, originOfModel } from '../data/models';
import { GPU_TYPES, SHARING_LABELS } from '../data/clusters';
import { PROXY_KIND_LABELS, proxiedPriceView, proxyKindOf } from '../data/commercial';
import { PROVIDER_NAMES, formatUsd } from '../theme/chartPalette';
import { PLATFORM_SCOPE } from '../auth/scope';
import { tenantLabel, tf, tl, useLocale, useT } from '../i18n';

const useStyles = makeStyles({
  tabs: { marginBottom: tokens.spacingVerticalM },
  card: { backgroundColor: tokens.colorNeutralBackground1, borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px', borderTopStyle: 'solid', borderRightStyle: 'solid', borderBottomStyle: 'solid', borderLeftStyle: 'solid', borderTopColor: tokens.colorNeutralStroke2, borderRightColor: tokens.colorNeutralStroke2, borderBottomColor: tokens.colorNeutralStroke2, borderLeftColor: tokens.colorNeutralStroke2, borderRadius: tokens.borderRadiusLarge, padding: tokens.spacingVerticalM, display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalS, minWidth: 0 },
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: tokens.spacingHorizontalM, marginBottom: tokens.spacingVerticalM },
  tileLabel: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  tileValue: { fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold, fontVariantNumeric: 'tabular-nums' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: tokens.fontSizeBase200 },
  th: { textAlign: 'left', padding: '6px 8px', color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightRegular, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tokens.colorNeutralStroke2, whiteSpace: 'nowrap' },
  td: { padding: '6px 8px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tokens.colorNeutralStroke3, verticalAlign: 'top', fontVariantNumeric: 'tabular-nums' },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: tokens.spacingHorizontalM, rowGap: tokens.spacingVerticalM, '@media (max-width: 900px)': { gridTemplateColumns: '1fr' } },
  row3: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', columnGap: tokens.spacingHorizontalS, rowGap: tokens.spacingVerticalS, alignItems: 'end' },
});

type TabKey = 'revenue' | 'unit' | 'proxy' | 'settings';

function Th({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <th className={className} scope="col">
      {children}
    </th>
  );
}

/**
 * 定價與帳務（平台營運）：平台營收與毛利、每部署單價與毛利、代理模型定價（供應商牌價 → 我們的價格 → 我們的成本 → 毛利）、定價參數。
 * 全部需平台範圍 billing.read（檢視）／billing.configure（修改）：我們的擁有者與財務；客戶角色與平台營運得到 403。
 */
export function PricingPage() {
  const s = useStyles();
  const t = useT();
  const { canUi } = useSession();
  const [params, setParams] = useSearchParams();
  const canRead = canUi('billing.read', PLATFORM_SCOPE);
  const tab = ((params.get('tab') as TabKey) || 'revenue') as TabKey;
  const setTab = (v: TabKey) => setParams((p) => { p.set('tab', v); return p; });
  return (
    <>
      <PageHeader title={t('billing.pricing.title')} subtitle={t('billing.pricing.subtitle')} crumbs={[{ label: t('billing.pricing.title') }]} />
      {!canRead ? (
        <PermissionDenied actionLabel={t('billing.pricing.deniedAction')} />
      ) : (
        <>
          <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as TabKey)} className={s.tabs} aria-label={t('billing.pricing.tabsAria')} data-tour="pricing-tabs">
            <Tab value="revenue" data-tour="tab-revenue">
              {t('billing.pricing.tab.revenue')}
            </Tab>
            <Tab value="unit" data-tour="tab-unit">
              {t('billing.pricing.tab.unit')}
            </Tab>
            <Tab value="proxy" data-tour="tab-proxy">
              {t('billing.pricing.tab.proxy')}
            </Tab>
            <Tab value="settings" data-tour="tab-pricing-settings">
              {t('billing.pricing.tab.settings')}
            </Tab>
          </TabList>
          {tab === 'revenue' && <RevenueTab />}
          {tab === 'unit' && <UnitPricesTab />}
          {tab === 'proxy' && <ProxyPricingTab />}
          {tab === 'settings' && <PricingSettingsTab />}
        </>
      )}
    </>
  );
}

function utilForTargetMarginPct(r: UnitPriceRow): number | null {
  const v = r.utilizationForTargetMargin;
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.round(v * 100);
}

function RevenueTab() {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const { session } = useSession();
  const st = useApi(() => server.getRevenue(session, '2026-11'), [session]);
  return (
    <div data-tour="revenue">
      <AsyncView {...st} actionLabel={t('billing.revenue.actionLabel')}>
        {(r: RevenueView) => (
          <>
            <div className={s.grid3}>
              <div className={s.card}>
                <span className={s.tileLabel}>{t('billing.revenue.totalLabel', { month: r.month, days: r.daysInPeriod })}</span>
                <span className={s.tileValue} data-tour="revenue-total">{formatUsd(r.totalRevenueUsd, 0)}</span>
                <span className={s.tileLabel}>
                  {t('billing.revenue.totalBreakdown', { token: formatUsd(r.tokenRevenueUsd, 0), cloud: formatUsd(r.cloudRevenueUsd, 0), dedicated: formatUsd(r.dedicatedRevenueUsd, 0), commit: formatUsd(r.commitmentAdjustmentUsd, 0) })}
                </span>
                <span className={s.tileLabel}>{t('billing.revenue.prepaid', { amount: formatUsd(r.prepaidTopupsUsd, 0) })}</span>
              </div>
              <div className={s.card}>
                <span className={s.tileLabel}>{t('billing.revenue.gpuCostLabel')}</span>
                <span className={s.tileValue}>{formatUsd(r.gpuCostUsd, 0)}</span>
                <span className={s.tileLabel}>
                  {t('billing.revenue.gpuCostDetail', { gpus: r.fleet.gpuTotal, days: r.daysInPeriod, hours: L.fmtNumber(r.fleet.gpuHours), util: Math.round(r.fleet.utilization * 100), allocated: r.fleet.gpuAllocated })}
                </span>
              </div>
              <div className={s.card}>
                <span className={s.tileLabel}>{t('billing.revenue.proxyLabel')}</span>
                <span className={s.tileValue}>
                  {formatUsd(r.cloudVendorListUsd, 0)} → {formatUsd(r.cloudListCostUsd, 0)} → {formatUsd(r.cloudRevenueUsd, 0)}
                </span>
                <span className={s.tileLabel}>
                  {t('billing.revenue.proxyDetail', { markup: server.billing.cloudMarkupPct, openMargin: r.proxiedOpen.marginPct.toFixed(1), disc: server.billing.proxyDiscountPct, neg: server.billing.negotiatedDiscountPct, closedMargin: r.proxiedClosed.marginPct.toFixed(1), total: r.cloud.marginPct.toFixed(1) })}
                </span>
              </div>
              <div className={s.card}>
                <span className={s.tileLabel}>{t('billing.revenue.marginLabel')}</span>
                <span className={s.tileValue}>
                  {formatUsd(r.grossProfitUsd, 0)} · {r.grossMarginPct.toFixed(1)}%
                </span>
                <ProgressBar value={Math.max(0, Math.min(1, r.grossMarginPct / 100))} color={r.grossMarginPct >= 40 ? 'success' : r.grossMarginPct >= 20 ? 'warning' : 'error'} aria-label={t('billing.revenue.marginAria', { pct: r.grossMarginPct })} />
                <span className={s.tileLabel}>{t('billing.revenue.marginFormula')}</span>
              </div>
            </div>
            <div className={s.card} style={{ marginBottom: 12 }} data-tour="revenue-tenants">
              <Text weight="semibold">{t('billing.revenue.byTenant')}</Text>
              <div style={{ overflowX: 'auto' }}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <Th className={s.th}>{t('billing.revenue.col.customer')}</Th>
                      <Th className={s.th}>{t('billing.revenue.col.plan')}</Th>
                      <Th className={s.th}>{t('billing.revenue.col.localToken')}</Th>
                      <Th className={s.th}>{t('billing.revenue.col.dedicated')}</Th>
                      <Th className={s.th}>{t('billing.revenue.col.proxied')}</Th>
                      <Th className={s.th}>{t('billing.revenue.col.commit')}</Th>
                      <Th className={s.th}>{t('billing.revenue.col.revenue')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.byTenant.map((x) => (
                      <tr key={x.tenantId}>
                        <td className={s.td}>
                          {tenantLabel(t, x.tenantId, x.tenantName)}
                          <div style={{ color: tokens.colorNeutralForeground3 }}>{x.costCenter}</div>
                        </td>
                        <td className={s.td}>{tl(t, 'PLAN_LABELS', x.plan, PLAN_LABELS[x.plan])}</td>
                        <td className={s.td}>{formatUsd(x.tokenUsd)}</td>
                        <td className={s.td}>{formatUsd(x.dedicatedUsd)}</td>
                        <td className={s.td}>{formatUsd(x.cloudUsd)}</td>
                        <td className={s.td}>{formatUsd(x.commitmentAdjustmentUsd)}</td>
                        <td className={s.td}>
                          <strong>{formatUsd(x.revenueUsd)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className={s.card} style={{ marginBottom: 12 }}>
              <Text weight="semibold">{t('billing.revenue.fleetTitle')}</Text>
              <div style={{ overflowX: 'auto' }}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <Th className={s.th}>{t('billing.revenue.col.gpuType')}</Th>
                      <Th className={s.th}>{t('billing.revenue.col.count')}</Th>
                      <Th className={s.th}>GPU-hr</Th>
                      <Th className={s.th}>{t('billing.revenue.col.tcoPerHr')}</Th>
                      <Th className={s.th}>{t('billing.revenue.col.listPerHr')}</Th>
                      <Th className={s.th}>{t('billing.revenue.col.cost')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.fleet.byGpuType.map((g) => (
                      <tr key={g.gpuType}>
                        <td className={s.td}>{g.gpuType}</td>
                        <td className={s.td}>{g.gpus}</td>
                        <td className={s.td}>{L.fmtNumber(g.hours)}</td>
                        <td className={s.td}>US${g.costUsdPerHour}</td>
                        <td className={s.td}>US${g.listUsdPerHour}</td>
                        <td className={s.td}>{formatUsd(g.costUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Text size={200}>{t('billing.revenue.fleetNote')}</Text>
            </div>
            <div className={s.card}>
              <Text weight="semibold">{t('billing.revenue.byModelTitle')}</Text>
              <div style={{ overflowX: 'auto' }}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <Th className={s.th}>{t('billing.revenue.col.model')}</Th>
                      <Th className={s.th}>{t('billing.revenue.col.localTokens')}</Th>
                      <Th className={s.th}>{t('billing.revenue.col.tokenRevenue')}</Th>
                      <Th className={s.th}>{t('billing.revenue.col.internalPerM')}</Th>
                      <Th className={s.th}>{t('billing.revenue.col.blendedPerM')}</Th>
                      <Th className={s.th}>{t('billing.revenue.col.margin')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.byModel.map((m) => (
                      <tr key={m.modelId}>
                        <td className={s.td}>
                          {tf(t, `data.model.${m.modelId}.displayName`, m.modelName)}
                          <div>
                            <code style={{ fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3 }}>{m.modelId}</code>
                          </div>
                        </td>
                        <td className={s.td}>{L.fmtNumber(m.tokens)}</td>
                        <td className={s.td}>
                          {formatUsd(m.revenueUsd)}
                          {m.revenueUsd === 0 ? t('billing.revenue.dedicatedIncluded') : ''}
                        </td>
                        <td className={s.td}>US${m.internalUsdPerMTok.toFixed(3)}</td>
                        <td className={s.td}>US${m.listUsdPerMTok.toFixed(3)}</td>
                        <td className={s.td}>
                          {m.marginPct == null ? (
                            <Badge appearance="outline" size="small">
                              {t('billing.revenue.dedicatedMarginBadge')}
                            </Badge>
                          ) : (
                            <Badge appearance="tint" color={m.marginPct >= 40 ? 'success' : m.marginPct >= 0 ? 'warning' : 'danger'} size="small">
                              {m.marginPct.toFixed(1)}%
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </AsyncView>
    </div>
  );
}

function UnitPricesTab() {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const { session } = useSession();
  const st = useApi(() => server.getUnitPrices(session), [session]);
  const b = server.billing;
  const formula = t('billing.unit.formula', {
    h100Tco: b.gpuCostUsdPerHour['H100 80GB'],
    h100Example: (((b.gpuCostUsdPerHour['H100 80GB'] * 2) / (2400 * 0.71 * 3600)) * 1e6).toFixed(3),
    cacheRead: b.cacheReadMultiplier,
    cacheWrite: b.cacheWriteMultiplier,
    h200List: b.gpuListUsdPerHour['H200 141GB'],
    h200Tco: b.gpuCostUsdPerHour['H200 141GB'],
  });
  return (
    <div data-tour="unit-prices">
      <div className={s.card} style={{ marginBottom: 12 }}>
        <Text weight="semibold">{t('billing.unit.formulaTitle')}</Text>
        <CodeBlock code={formula} label={t('billing.unit.formulaLabel')} />
        <Text size={200}>{t('billing.unit.formulaNote')}</Text>
      </div>
      <AsyncView {...st} actionLabel={t('billing.unit.actionLabel')} isEmpty={(d) => d.length === 0} empty={<EmptyState title={t('billing.unit.empty')} />}>
        {(rows: UnitPriceRow[]) => (
          <div className={s.card}>
            <Text weight="semibold">{t('billing.unit.tableTitle')}</Text>
            <div style={{ overflowX: 'auto' }}>
              <table className={s.table}>
                <caption style={{ textAlign: 'left', padding: '4px 8px', color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 }}>{t('billing.unit.caption')}</caption>
                <thead>
                  <tr>
                    <Th className={s.th}>{t('billing.unit.col.deployment')}</Th>
                    <Th className={s.th}>{t('billing.unit.col.cluster')}</Th>
                    <Th className={s.th}>{t('billing.unit.col.gpuPrice')}</Th>
                    <Th className={s.th}>{t('billing.unit.col.throughput')}</Th>
                    <Th className={s.th}>{t('billing.unit.col.internal')}</Th>
                    <Th className={s.th}>{t('billing.unit.col.floor')}</Th>
                    <Th className={s.th}>{t('billing.unit.col.list')}</Th>
                    <Th className={s.th}>{t('billing.unit.col.margin')}</Th>
                    <Th className={s.th}>{t('billing.unit.col.comparable')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const margin = r.sharing === 'dedicated' ? r.gpuHourMarginPct : r.tokenMarginPct;
                    return (
                      <tr key={r.deploymentId}>
                        <td className={s.td}>
                          <div>{tf(t, `data.model.${r.modelId}.displayName`, r.modelName)}</div>
                          <code style={{ fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3 }}>{r.deploymentId}</code>
                        </td>
                        <td className={s.td}>
                          {r.clusterName}
                          <div style={{ color: tokens.colorNeutralForeground3 }}>
                            {r.replicas} × {r.gpusPerReplica} × {r.gpuType} · {tl(t, 'SHARING_LABELS', r.sharing, SHARING_LABELS[r.sharing])}
                            {r.dedicatedTenantName ? `${t('common.colon')}${tenantLabel(t, r.dedicatedTenantId, r.dedicatedTenantName)}` : ''}
                          </div>
                        </td>
                        <td className={s.td}>
                          US${r.costUsdPerGpuHour} / US${r.listUsdPerGpuHour}
                        </td>
                        <td className={s.td}>
                          {L.fmtNumber(r.tokPerSec)} · {Math.round(r.utilization * 100)}%
                          {(() => {
                            const need = utilForTargetMarginPct(r);
                            if (need == null || r.sharing !== 'shared') return null;
                            return need > 100 ? (
                              <div>
                                <Badge appearance="tint" color="danger" size="small">
                                  {t('billing.unit.unreachableBadge', { need })}
                                </Badge>
                              </div>
                            ) : (
                              <div style={{ color: tokens.colorNeutralForeground3 }}>{t('billing.unit.needUtil', { target: r.targetMarginPct, need })}</div>
                            );
                          })()}
                        </td>
                        <td className={s.td}>
                          <strong>US${r.internalUsdPerMTok.toFixed(3)}</strong>
                        </td>
                        <td className={s.td}>US${r.floorUsdPerMTok.toFixed(3)}</td>
                        <td className={s.td}>
                          {t('billing.unit.listPrices', { input: r.listInputUsdPerMTok, output: r.listOutputUsdPerMTok, blended: r.listBlendedUsdPerMTok.toFixed(3) })}
                          {r.marketRefUsd && (
                            <div style={{ color: tokens.colorNeutralForeground3 }} title={tf(t, `data.model.${r.modelId}.marketRefSource`, r.marketRefUsd.source)}>
                              {t('billing.unit.marketRef', { input: r.marketRefUsd.input, output: r.marketRefUsd.output ? `US$${r.marketRefUsd.output}` : '—' })}
                            </div>
                          )}
                        </td>
                        <td className={s.td}>
                          {margin == null ? (
                            <Badge appearance="outline" size="small">
                              {t('billing.unit.noTokenFee')}
                            </Badge>
                          ) : (
                            <Badge appearance="tint" color={margin >= 40 ? 'success' : margin >= 0 ? 'warning' : 'danger'} size="small">
                              {margin.toFixed(1)}%{r.sharing === 'dedicated' ? t('billing.unit.gpuHrSuffix') : ''}
                            </Badge>
                          )}
                        </td>
                        <td className={s.td}>
                          {r.cloudComparables.length === 0 && '—'}
                          {r.cloudComparables.map((c) => (
                            <div key={c.modelId}>
                              {t('billing.unit.comparable', { name: tf(t, `data.model.${c.modelId}.displayName`, c.displayName), input: c.priceInput, output: c.priceOutput ? `US$${c.priceOutput}` : '—', blended: c.withMarkup.toFixed(3) })}
                            </div>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {(() => {
              const ref = rows.find((r) => r.sharing === 'shared' && /27b/i.test(r.modelId)) ?? rows.find((r) => r.sharing === 'shared');
              const need = ref ? utilForTargetMarginPct(ref) : null;
              const unreachable = rows.filter((r) => r.sharing === 'shared' && (utilForTargetMarginPct(r) ?? 0) > 100).map((r) => tf(t, `data.model.${r.modelId}.displayName`, r.modelName));
              return (
                <Text size={200}>
                  {t('billing.unit.principle', {
                    target: TARGET_MARGIN_PCT,
                    need: need ?? 64,
                    source: need != null ? t('billing.unit.principleSourceApi') : t('billing.unit.principleSourceEst'),
                    unreachable: unreachable.length ? t('billing.unit.principleUnreachable', { models: unreachable.join(t('common.listSeparator')) }) : '',
                  })}
                </Text>
              );
            })()}
          </div>
        )}
      </AsyncView>
    </div>
  );
}

/** 代理模型定價：每個代理模型的供應商牌價 → 我們的價格 → 我們的成本 → 單位毛利 */
function ProxyPricingTab() {
  const s = useStyles();
  const t = useT();
  const b = server.billing;
  const policy = { cloudMarkupPct: b.cloudMarkupPct, proxyDiscountPct: b.proxyDiscountPct, negotiatedDiscountPct: b.negotiatedDiscountPct };
  const rows = MODELS.filter((m) => !isLocalModel(m) && m.status !== 'deprecated' && m.status !== 'legacy').map((m) => ({ m, v: proxiedPriceView(m, policy) }));
  const marginPct = (our: number, cost: number) => (our ? Math.round(((our - cost) / our) * 1000) / 10 : 0);
  return (
    <div data-tour="pricing-proxy">
      <div className={s.card} style={{ marginBottom: 12 }}>
        <Text weight="semibold">{t('billing.proxy.policyTitle')}</Text>
        <CodeBlock
          label={t('billing.proxy.policyLabel')}
          code={t('billing.proxy.policy', {
            markup: b.cloudMarkupPct,
            openMargin: ((b.cloudMarkupPct / (100 + b.cloudMarkupPct)) * 100).toFixed(1),
            disc: b.proxyDiscountPct,
            neg: b.negotiatedDiscountPct,
            closedMargin: (((100 - b.proxyDiscountPct - (100 - b.negotiatedDiscountPct)) / (100 - b.proxyDiscountPct)) * 100).toFixed(1),
          })}
        />
      </div>
      <div className={s.card}>
        <Text weight="semibold">{t('billing.proxy.tableTitle')}</Text>
        <div style={{ overflowX: 'auto' }}>
          <table className={s.table}>
            <thead>
              <tr>
                <Th className={s.th}>{t('billing.proxy.col.model')}</Th>
                <Th className={s.th}>{t('billing.proxy.col.provider')}</Th>
                <Th className={s.th}>{t('billing.proxy.col.unit')}</Th>
                <Th className={s.th}>{t('billing.proxy.col.list')}</Th>
                <Th className={s.th}>{t('billing.proxy.col.ours')}</Th>
                <Th className={s.th}>{t('billing.proxy.col.cost')}</Th>
                <Th className={s.th}>{t('billing.proxy.col.margin')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ m, v }) => {
                const o = originOfModel(m);
                const pctLabel = v.kind === 'proxied-open' ? t('billing.proxy.pctOpen', { pct: b.cloudMarkupPct }) : v.kind === 'proxied-closed' ? t('billing.proxy.pctClosed', { pct: m.proxyDiscountPct ?? b.proxyDiscountPct }) : t('billing.proxy.pctOurs');
                return (
                  <tr key={m.id}>
                    <td className={s.td}>
                      {tf(t, `data.model.${m.id}.displayName`, m.displayName)}
                      <div>
                        <code style={{ fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3 }}>{m.id}</code>
                      </div>
                    </td>
                    <td className={s.td}>
                      {tl(t, 'PROVIDER_NAMES', m.providerId, PROVIDER_NAMES[m.providerId])}
                      {o ? ` · ${tl(t, 'ORIGIN_LABELS', o, ORIGIN_LABELS[o])}` : ''}
                      <div>
                        <Badge size="small" appearance="tint" color={v.kind === 'proxied-open' ? 'informative' : 'important'}>
                          {tl(t, 'PROXY_KIND_LABELS', proxyKindOf(m), PROXY_KIND_LABELS[proxyKindOf(m)])}
                        </Badge>
                      </div>
                    </td>
                    <td className={s.td}>{tl(t, 'UNIT_TYPE_LABELS', m.unitType, UNIT_TYPE_LABELS[m.unitType])}</td>
                    <td className={s.td}>
                      US${v.listInput}
                      {m.unitType === 'per_1m_tokens' ? ` / ${v.listOutput ? `US$${v.listOutput}` : '—'}` : ''}
                    </td>
                    <td className={s.td}>
                      <strong>US${v.ourInput}</strong>
                      {m.unitType === 'per_1m_tokens' ? ` / ${v.ourOutput ? `US$${v.ourOutput}` : '—'}` : ''}
                      <div style={{ color: tokens.colorNeutralForeground3 }}>{pctLabel}</div>
                    </td>
                    <td className={s.td}>
                      US${v.costInput}
                      {m.unitType === 'per_1m_tokens' ? ` / ${v.costOutput ? `US$${v.costOutput}` : '—'}` : ''}
                    </td>
                    <td className={s.td}>
                      <Badge appearance="tint" size="small" color={marginPct(v.ourInput, v.costInput) >= 10 ? 'success' : marginPct(v.ourInput, v.costInput) >= 0 ? 'warning' : 'danger'}>
                        {marginPct(v.ourInput, v.costInput).toFixed(1)}%
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Text size={200}>{t('billing.proxy.note')}</Text>
      </div>
    </div>
  );
}

/** 定價參數（原「設定 → 帳務與定價」）：token 牌價、快取讀寫倍率、GPU 時價與 TCO、代理加價／折扣／議價折扣、匯率 */
function PricingSettingsTab() {
  const s = useStyles();
  const t = useT();
  const { session, canUi, bump } = useSession();
  const notify = useNotify();
  const b = server.billing;
  const [tokenPrices, setTokenPrices] = useState<Record<string, { input: string; output: string }>>(() => Object.fromEntries(DEPLOYABLE_MODELS.map((m) => [m.id, { input: String(b.tokenPrices[m.id]?.input ?? m.priceInput), output: String(b.tokenPrices[m.id]?.output ?? m.priceOutput) }])));
  const [gpuList, setGpuList] = useState<Record<string, string>>(() => Object.fromEntries(GPU_TYPES.map((g) => [g, String(b.gpuListUsdPerHour[g] ?? 0)])));
  const [gpuCost, setGpuCost] = useState<Record<string, string>>(() => Object.fromEntries(GPU_TYPES.map((g) => [g, String(b.gpuCostUsdPerHour[g] ?? 0)])));
  const [markup, setMarkup] = useState(String(b.cloudMarkupPct));
  const [proxyDisc, setProxyDisc] = useState(String(b.proxyDiscountPct));
  const [negotiated, setNegotiated] = useState(String(b.negotiatedDiscountPct));
  const [cacheRead, setCacheRead] = useState(String(b.cacheReadMultiplier));
  const [cacheWrite, setCacheWrite] = useState(String(b.cacheWriteMultiplier));
  const [twd, setTwd] = useState(String(b.twdPerUsd));
  const [saving, setSaving] = useState(false);
  const canBilling = canUi('billing.configure', PLATFORM_SCOPE);

  const save = async () => {
    setSaving(true);
    try {
      const res = await server.updateBillingSettings(session, {
        cloudMarkupPct: Number(markup),
        proxyDiscountPct: Number(proxyDisc),
        negotiatedDiscountPct: Number(negotiated),
        cacheReadMultiplier: Number(cacheRead),
        cacheWriteMultiplier: Number(cacheWrite),
        twdPerUsd: Number(twd),
        tokenPrices: Object.fromEntries(Object.entries(tokenPrices).map(([id, p]) => [id, { input: Number(p.input), output: Number(p.output) }])),
        gpuListUsdPerHour: Object.fromEntries(Object.entries(gpuList).map(([g, v]) => [g, Number(v)])),
        gpuCostUsdPerHour: Object.fromEntries(Object.entries(gpuCost).map(([g, v]) => [g, Number(v)])),
      });
      if (res.ok) {
        notify.success(t('billing.pricingSettings.savedTitle'), t('billing.pricingSettings.savedBody', { markup: res.data.cloudMarkupPct, disc: res.data.proxyDiscountPct, read: res.data.cacheReadMultiplier, write: res.data.cacheWriteMultiplier, requestId: res.requestId }));
        bump();
      } else notify.apiError(res, t('billing.pricingSettings.errContext'));
    } catch (e) {
      notify.apiError(e as Error, t('billing.pricingSettings.errContext'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={s.card} aria-labelledby="pricing-settings-title" data-tour="pricing-settings">
      <Text weight="semibold" id="pricing-settings-title" as="h2" style={{ fontSize: tokens.fontSizeBase400 }}>
        {t('billing.pricingSettings.title')}
      </Text>
      <Text size={200}>{t('billing.pricingSettings.intro')}</Text>
      <div className={s.row3}>
        <Field label={t('billing.pricingSettings.markup.label')} hint={t('billing.pricingSettings.markup.hint')}>
          <Input type="number" min={0} max={100} value={markup} onChange={(_, d) => setMarkup(d.value)} disabled={!canBilling} data-tour="billing-markup" />
        </Field>
        <Field label={t('billing.pricingSettings.proxyDisc.label')} hint={t('billing.pricingSettings.proxyDisc.hint')}>
          <Input type="number" min={0} max={100} value={proxyDisc} onChange={(_, d) => setProxyDisc(d.value)} disabled={!canBilling} data-tour="billing-proxy-discount" />
        </Field>
        <Field label={t('billing.pricingSettings.negotiated.label')} hint={t('billing.pricingSettings.negotiated.hint')}>
          <Input type="number" min={0} max={100} value={negotiated} onChange={(_, d) => setNegotiated(d.value)} disabled={!canBilling} data-tour="billing-negotiated" />
        </Field>
        <Field label={t('billing.pricingSettings.cacheRead.label')} hint={t('billing.pricingSettings.cacheRead.hint')}>
          <Input type="number" min={0} max={1} step={0.05} value={cacheRead} onChange={(_, d) => setCacheRead(d.value)} disabled={!canBilling} data-tour="billing-cache-read" />
        </Field>
        <Field label={t('billing.pricingSettings.cacheWrite.label')} hint={t('billing.pricingSettings.cacheWrite.hint')}>
          <Input type="number" min={0} max={5} step={0.05} value={cacheWrite} onChange={(_, d) => setCacheWrite(d.value)} disabled={!canBilling} data-tour="billing-cache-write" />
        </Field>
        <Field label={t('billing.pricingSettings.fx.label')} hint={t('billing.pricingSettings.fx.hint')}>
          <Input type="number" min={1} step={0.1} value={twd} onChange={(_, d) => setTwd(d.value)} disabled={!canBilling} />
        </Field>
      </div>
      <div className={s.row}>
        <div>
          <Text weight="semibold" size={300}>
            {t('billing.pricingSettings.tokenTitle')}
          </Text>
          <table className={s.table} data-tour="billing-token-prices">
            <thead>
              <tr>
                <Th className={s.th}>{t('billing.pricingSettings.col.model')}</Th>
                <Th className={s.th}>{t('billing.pricingSettings.col.input')}</Th>
                <Th className={s.th}>{t('billing.pricingSettings.col.output')}</Th>
              </tr>
            </thead>
            <tbody>
              {DEPLOYABLE_MODELS.map((m) => (
                <tr key={m.id}>
                  <td className={s.td}>
                    <code style={{ fontSize: tokens.fontSizeBase100 }}>{m.id}</code>
                  </td>
                  <td className={s.td}>
                    <Input size="small" type="number" min={0} step={0.01} value={tokenPrices[m.id]?.input ?? ''} aria-label={t('billing.pricingSettings.inputAria', { id: m.id })} disabled={!canBilling} onChange={(_, d) => setTokenPrices((x) => ({ ...x, [m.id]: { ...x[m.id], input: d.value } }))} />
                  </td>
                  <td className={s.td}>
                    <Input size="small" type="number" min={0} step={0.01} value={tokenPrices[m.id]?.output ?? ''} aria-label={t('billing.pricingSettings.outputAria', { id: m.id })} disabled={!canBilling} onChange={(_, d) => setTokenPrices((x) => ({ ...x, [m.id]: { ...x[m.id], output: d.value } }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <Text weight="semibold" size={300}>
            {t('billing.pricingSettings.gpuTitle')}
          </Text>
          <table className={s.table} data-tour="billing-gpu-prices">
            <thead>
              <tr>
                <Th className={s.th}>{t('billing.pricingSettings.col.gpuType')}</Th>
                <Th className={s.th}>{t('billing.pricingSettings.col.gpuList')}</Th>
                <Th className={s.th}>{t('billing.pricingSettings.col.gpuTco')}</Th>
              </tr>
            </thead>
            <tbody>
              {GPU_TYPES.map((g) => (
                <tr key={g}>
                  <td className={s.td}>{g}</td>
                  <td className={s.td}>
                    <Input size="small" type="number" min={0} step={0.1} value={gpuList[g] ?? ''} aria-label={t('billing.pricingSettings.gpuListAria', { gpu: g })} disabled={!canBilling} onChange={(_, d) => setGpuList((x) => ({ ...x, [g]: d.value }))} />
                  </td>
                  <td className={s.td}>
                    <Input size="small" type="number" min={0} step={0.1} value={gpuCost[g] ?? ''} aria-label={`${g} TCO`} disabled={!canBilling} onChange={(_, d) => setGpuCost((x) => ({ ...x, [g]: d.value }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Text size={200}>{t('billing.pricingSettings.gpuNote')}</Text>
        </div>
      </div>
      <div>
        <Button appearance="primary" icon={<SaveRegular />} onClick={save} disabled={saving || !canBilling} data-tour="billing-save">
          {saving ? t('billing.pricingSettings.saving') : t('billing.pricingSettings.save')}
        </Button>
        {!canBilling && (
          <Text size={200} style={{ marginLeft: 8 }}>
            {t('billing.pricingSettings.needPerm')}
          </Text>
        )}
      </div>
      <MessageBar intent="info">
        <MessageBarBody>{t('billing.pricingSettings.info')}</MessageBarBody>
      </MessageBar>
    </section>
  );
}
