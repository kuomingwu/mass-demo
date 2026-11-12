import { Badge, Button, Dropdown, Field, Input, Link, MessageBar, MessageBarBody, MessageBarTitle, Option, ProgressBar, Tab, TabList, Text, Tooltip, createTableColumn, makeStyles, tokens, type TableColumnDefinition } from '@fluentui/react-components';
import { ArrowDownloadRegular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { AsyncView, EmptyState } from '../components/States';
import { SimpleGrid } from '../components/SimpleGrid';
import { ChartCard, DataTable, HBarChart, Legend, StackedBarChart } from '../components/charts/Charts';
import { useNotify } from '../components/Notify';
import { useApi, downloadText } from '../hooks/useApi';
import { server, type BillingStatement } from '../server/api';
import { TIER_LABELS, type UsageRecord, type UsageTier } from '../server/usage';
import { useSession } from '../app/SessionContext';
import { useThemeMode } from '../theme/ThemeProvider';
import { DATA_CLASS_LABELS, PLAN_LABELS, PROJECTS, TENANTS, TIER_POLICY_LABELS } from '../server/seed';
import { MODELS } from '../data/models';
import { BILLING_MODE_LABELS, PROXY_KIND_LABELS, RETENTION_LABELS } from '../data/commercial';
import { PROVIDER_NAMES, PROVIDER_SERIES_INDEX, STATUS_COLORS, formatCompact, formatUsd, seriesColor } from '../theme/chartPalette';
import { projectScope, tenantScope, PLATFORM_SCOPE } from '../auth/scope';
import { tenantLabel, tf, tl, useLocale, useT } from '../i18n';

const useStyles = makeStyles({
  filters: { display: 'flex', flexWrap: 'wrap', columnGap: tokens.spacingHorizontalM, rowGap: tokens.spacingVerticalS, alignItems: 'flex-end', marginBottom: tokens.spacingVerticalM },
  charts: { display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: tokens.spacingHorizontalM, marginBottom: tokens.spacingVerticalM, '@media (max-width: 1000px)': { gridTemplateColumns: '1fr' } },
  num: { fontVariantNumeric: 'tabular-nums' },
  note: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, marginBottom: tokens.spacingVerticalS },
  tabs: { marginBottom: tokens.spacingVerticalM },
  card: { backgroundColor: tokens.colorNeutralBackground1, borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px', borderTopStyle: 'solid', borderRightStyle: 'solid', borderBottomStyle: 'solid', borderLeftStyle: 'solid', borderTopColor: tokens.colorNeutralStroke2, borderRightColor: tokens.colorNeutralStroke2, borderBottomColor: tokens.colorNeutralStroke2, borderLeftColor: tokens.colorNeutralStroke2, borderRadius: tokens.borderRadiusLarge, padding: tokens.spacingVerticalM, display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalS, minWidth: 0 },
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: tokens.spacingHorizontalM, marginBottom: tokens.spacingVerticalM },
  tileLabel: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  tileValue: { fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold, fontVariantNumeric: 'tabular-nums' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: tokens.fontSizeBase200 },
  th: { textAlign: 'left', padding: '6px 8px', color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightRegular, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tokens.colorNeutralStroke2, whiteSpace: 'nowrap' },
  td: { padding: '6px 8px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tokens.colorNeutralStroke3, verticalAlign: 'top', fontVariantNumeric: 'tabular-nums' },
});

const PROVIDER_ORDER = ['vllm', 'bailian', 'openai', 'anthropic', 'google'];
const TIER_ORDER: UsageTier[] = ['local', 'spillover', 'cloud'];
type TabKey = 'usage' | 'statement';

function Th({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <th className={className} scope="col">
      {children}
    </th>
  );
}

export function UsagePage() {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const { session, canUi, tenantId: ctxTenant } = useSession();
  const { isDark } = useThemeMode();
  const notify = useNotify();
  const [params, setParams] = useSearchParams();
  const isVendorFinance = canUi('billing.read', PLATFORM_SCOPE);
  const requested = (params.get('tab') as string) || 'usage';
  const tab: TabKey = requested === 'statement' ? 'statement' : 'usage';
  const setTab = (v: TabKey) => setParams((p) => { p.set('tab', v); return p; });
  const [tenantId, setTenantId] = useState<string>(params.get('tenant') ?? ctxTenant ?? '');
  const [projectId, setProjectId] = useState(params.get('project') ?? '');
  const [modelId, setModelId] = useState('');
  const [tier, setTier] = useState<UsageTier | ''>('');
  const [from, setFrom] = useState('2026-10-25');
  const [to, setTo] = useState('2026-11-08');
  const [exporting, setExporting] = useState(false);
  const query = useMemo(() => ({ tenantId: tenantId || undefined, projectId: projectId || undefined, modelId: modelId || undefined, tier: tier || undefined, from, to }), [tenantId, projectId, modelId, tier, from, to]);
  const st = useApi(() => server.getUsage(session, query), [session, query]);
  const exportScope = projectId && tenantId ? projectScope(tenantId, projectId) : tenantId ? tenantScope(tenantId) : PLATFORM_SCOPE;
  const canExport = canUi('billing.export', exportScope);
  const tierLabel = (x: UsageTier) => tl(t, 'TIER_LABELS', x, TIER_LABELS[x]);
  const providerName = (p: string) => tl(t, 'PROVIDER_NAMES', p, PROVIDER_NAMES[p]);

  const agg = useMemo(() => {
    const rows = st.data ?? [];
    const days = Array.from(new Set(rows.map((r) => r.date))).sort();
    const providers = PROVIDER_ORDER.filter((p) => rows.some((r) => r.providerId === p));
    const daily = days.map((d) => ({
      label: d.slice(5),
      values: providers.map((p) => rows.filter((r) => r.date === d && r.providerId === p).reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0)),
    }));
    const tiers = TIER_ORDER.filter((x) => rows.some((r) => r.tier === x));
    const dailyTier = days.map((d) => ({ label: d.slice(5), values: tiers.map((x) => rows.filter((r) => r.date === d && r.tier === x).reduce((sum, r) => sum + r.requests, 0)) }));
    const byModel = Object.entries(
      rows.reduce<Record<string, number>>((m, r) => {
        m[r.modelId] = (m[r.modelId] ?? 0) + server.usageCharge(r).usd;
        return m;
      }, {}),
    )
      .map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
    const status = days.map((d) => {
      const dr = rows.filter((r) => r.date === d);
      const req = dr.reduce((a, r) => a + r.requests, 0);
      const err = dr.reduce((a, r) => a + r.errors, 0);
      return { label: d.slice(5), values: [req - err, err] };
    });
    const totals = {
      requests: rows.reduce((a, r) => a + r.requests, 0),
      localRequests: rows.filter((r) => r.tier === 'local').reduce((a, r) => a + r.requests, 0),
      tokens: rows.reduce((a, r) => a + r.inputTokens + r.outputTokens, 0),
      gpuHours: Math.round(rows.reduce((a, r) => a + r.gpuHours, 0) * 10) / 10,
      cost: byModel.reduce((a, r) => a + r.value, 0),
    };
    return { daily, providers, tiers, dailyTier, byModel, status, totals };
  }, [st.data]);

  const providerColors = agg.providers.map((p) => seriesColor(PROVIDER_SERIES_INDEX[p], isDark));
  const tierColors = agg.tiers.map((x) => (x === 'local' ? seriesColor(4, isDark) : x === 'spillover' ? seriesColor(3, isDark) : seriesColor(0, isDark)));

  const columns: TableColumnDefinition<UsageRecord>[] = useMemo(
    () => [
      createTableColumn<UsageRecord>({ columnId: 'date', compare: (a, b) => a.date.localeCompare(b.date), renderHeaderCell: () => t('common.date'), renderCell: (r) => r.date }),
      createTableColumn<UsageRecord>({ columnId: 'tenant', renderHeaderCell: () => t('common.tenant'), renderCell: (r) => TENANTS.find((x) => x.id === r.tenantId)?.name ?? r.tenantId }),
      createTableColumn<UsageRecord>({ columnId: 'project', renderHeaderCell: () => t('common.project'), renderCell: (r) => PROJECTS.find((p) => p.id === r.projectId)?.name ?? r.projectId }),
      createTableColumn<UsageRecord>({ columnId: 'model', compare: (a, b) => a.modelId.localeCompare(b.modelId), renderHeaderCell: () => t('common.model'), renderCell: (r) => <code>{r.modelId}</code> }),
      createTableColumn<UsageRecord>({
        columnId: 'tier',
        compare: (a, b) => a.tier.localeCompare(b.tier),
        renderHeaderCell: () => t('billing.usage.tier'),
        renderCell: (r) => (
          <Badge appearance="tint" size="small" color={r.tier === 'local' ? 'brand' : r.tier === 'spillover' ? 'warning' : 'informative'}>
            {tl(t, 'TIER_LABELS', r.tier, TIER_LABELS[r.tier])}
          </Badge>
        ),
      }),
      createTableColumn<UsageRecord>({ columnId: 'provider', renderHeaderCell: () => t('common.provider'), renderCell: (r) => tl(t, 'PROVIDER_NAMES', r.providerId, PROVIDER_NAMES[r.providerId]) }),
      createTableColumn<UsageRecord>({ columnId: 'req', compare: (a, b) => a.requests - b.requests, renderHeaderCell: () => t('billing.usage.col.requests'), renderCell: (r) => <span className={s.num}>{L.fmtNumber(r.requests)}</span> }),
      createTableColumn<UsageRecord>({ columnId: 'err', compare: (a, b) => a.errors - b.errors, renderHeaderCell: () => t('billing.usage.col.errors'), renderCell: (r) => <span className={s.num}>{L.fmtNumber(r.errors)}</span> }),
      createTableColumn<UsageRecord>({ columnId: 'in', compare: (a, b) => a.inputTokens - b.inputTokens, renderHeaderCell: () => t('billing.usage.col.inputTokens'), renderCell: (r) => <span className={s.num}>{L.fmtNumber(r.inputTokens)}{r.cachedInputTokens || r.cacheWriteTokens ? t('billing.usage.cachePair', { read: L.fmtNumber(r.cachedInputTokens), write: L.fmtNumber(r.cacheWriteTokens) }) : ''}</span> }),
      createTableColumn<UsageRecord>({ columnId: 'out', compare: (a, b) => a.outputTokens - b.outputTokens, renderHeaderCell: () => t('billing.usage.col.outputTokens'), renderCell: (r) => <span className={s.num}>{L.fmtNumber(r.outputTokens)}</span> }),
      createTableColumn<UsageRecord>({ columnId: 'gpuh', compare: (a, b) => a.gpuHours - b.gpuHours, renderHeaderCell: () => t('billing.usage.col.gpuHours'), renderCell: (r) => <span className={s.num}>{r.tier === 'local' ? r.gpuHours : '—'}</span> }),
      createTableColumn<UsageRecord>({
        columnId: 'cost',
        compare: (a, b) => server.usageCharge(a).usd - server.usageCharge(b).usd,
        renderHeaderCell: () => t('billing.usage.col.charge'),
        renderCell: (r) => {
          const ch = server.usageCharge(r);
          return (
            <span className={s.num}>
              {ch.basis === 'dedicated' ? t('billing.usage.includedDedicated') : formatUsd(ch.usd)}
            </span>
          );
        },
      }),
    ],
    [s, t, L],
  );

  const doExport = async () => {
    setExporting(true);
    try {
      const res = await server.exportUsageCsv(session, query);
      if (res.ok) {
        downloadText(`maas-usage-${from}_${to}.csv`, res.data);
        notify.success(t('billing.usage.exported'), `requestId: ${res.requestId}`);
      } else notify.apiError(res, t('common.exportCsv'));
    } catch (e) {
      notify.apiError(e as Error, t('common.exportCsv'));
    } finally {
      setExporting(false);
    }
  };

  const tenantOptions = TENANTS.filter((x) => canUi('usage.read', tenantScope(x.id)) || PROJECTS.some((p) => p.tenantId === x.id && canUi('usage.read', projectScope(x.id, p.id))));
  const projectOptions = PROJECTS.filter((p) => (!tenantId || p.tenantId === tenantId) && canUi('usage.read', projectScope(p.tenantId, p.id)));

  // 舊路由：單價與營收分頁已移到「定價與帳務」
  if (requested === 'unit' || requested === 'revenue') return <Navigate to={`/pricing?tab=${requested}`} replace />;

  const okLabel = t('billing.usage.chart.success');
  const errLabel = t('billing.usage.chart.error');

  return (
    <>
      <PageHeader
        title={t('billing.usage.title')}
        subtitle={isVendorFinance ? t('billing.usage.subtitleVendor') : t('billing.usage.subtitleCustomer')}
        crumbs={[{ label: t('billing.usage.title') }]}
        actions={
          <Tooltip content={canExport ? t('billing.usage.exportTip') : t('billing.usage.exportDenied', { scope: exportScope })} relationship="description">
            <Button data-tour="usage-export" appearance="primary" icon={<ArrowDownloadRegular />} onClick={doExport} disabled={exporting}>
              {exporting ? t('billing.usage.exporting') : t('common.exportCsv')}
            </Button>
          </Tooltip>
        }
      />
      <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as TabKey)} className={s.tabs} aria-label={t('billing.usage.tabsAria')} data-tour="usage-tabs">
        <Tab value="usage">{t('billing.usage.tab.usage')}</Tab>
        <Tab value="statement" data-tour="tab-statement">
          {t('billing.usage.tab.statement')}
        </Tab>
      </TabList>
      {isVendorFinance && (
        <Text size={200} className={s.note}>
          {t('billing.usage.pricingNoteBefore')}<Link as="a" href="#/pricing">{t('billing.pricing.title')}</Link>{t('billing.usage.pricingNoteAfter')}
        </Text>
      )}

      {tab === 'usage' && (
        <>
          <div className={s.filters} role="group" aria-label={t('billing.usage.filtersAria')} data-tour="usage-filters">
            <Field label={t('common.tenant')}>
              <Dropdown value={tenantId ? TENANTS.find((x) => x.id === tenantId)?.name ?? '' : t('common.all')} selectedOptions={[tenantId || '*']} onOptionSelect={(_, d) => { setTenantId(d.optionValue === '*' ? '' : d.optionValue ?? ''); setProjectId(''); }} style={{ minWidth: 150 }}>
                <Option value="*">{t('common.all')}</Option>
                {tenantOptions.map((x) => (
                  <Option key={x.id} value={x.id}>
                    {x.name}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            <Field label={t('common.project')}>
              <Dropdown value={projectId ? PROJECTS.find((p) => p.id === projectId)?.name ?? '' : t('common.all')} selectedOptions={[projectId || '*']} onOptionSelect={(_, d) => setProjectId(d.optionValue === '*' ? '' : d.optionValue ?? '')} style={{ minWidth: 150 }}>
                <Option value="*">{t('common.all')}</Option>
                {projectOptions.map((p) => (
                  <Option key={p.id} value={p.id}>
                    {p.name}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            <Field label={t('billing.usage.tier')}>
              <Dropdown value={tier ? tierLabel(tier) : t('common.all')} selectedOptions={[tier || '*']} onOptionSelect={(_, d) => setTier(d.optionValue === '*' ? '' : ((d.optionValue ?? '') as UsageTier))} style={{ minWidth: 150 }}>
                <Option value="*">{t('common.all')}</Option>
                {TIER_ORDER.map((x) => (
                  <Option key={x} value={x}>
                    {tierLabel(x)}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            <Field label={t('common.model')}>
              <Dropdown value={modelId || t('common.all')} selectedOptions={[modelId || '*']} onOptionSelect={(_, d) => setModelId(d.optionValue === '*' ? '' : d.optionValue ?? '')} style={{ minWidth: 180 }}>
                <Option value="*">{t('common.all')}</Option>
                {MODELS.map((m) => (
                  <Option key={m.id} value={m.id}>
                    {m.id}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            <Field label={t('billing.usage.from')}>
              <Input type="date" value={from} onChange={(_, d) => setFrom(d.value)} />
            </Field>
            <Field label={t('billing.usage.to')}>
              <Input type="date" value={to} onChange={(_, d) => setTo(d.value)} />
            </Field>
          </div>
          <AsyncView {...st} actionLabel={t('billing.usage.actionLabel')} isEmpty={(d) => d.length === 0} empty={<EmptyState title={t('billing.usage.emptyTitle')} description={t('billing.usage.emptyDescription')} />}>
            {(rows) => (
              <>
                <Text className={s.note}>
                  {t('billing.usage.totals', {
                    requests: formatCompact(agg.totals.requests),
                    localPct: agg.totals.requests ? Math.round((agg.totals.localRequests / agg.totals.requests) * 100) : 0,
                    tokens: formatCompact(agg.totals.tokens),
                    gpuHours: agg.totals.gpuHours,
                    cost: formatUsd(agg.totals.cost, 0),
                  })}
                </Text>
                <div className={s.charts} data-tour="usage-charts">
                  <ChartCard
                    title={t('billing.usage.chart.byTier.title')}
                    subtitle={t('billing.usage.chart.byTier.subtitle')}
                    legend={<Legend items={agg.tiers.map((x, i) => ({ label: tierLabel(x), color: tierColors[i] }))} />}
                    table={<DataTable columns={[t('common.date'), ...agg.tiers.map((x) => tierLabel(x))]} rows={agg.dailyTier.map((d) => [d.label, ...d.values])} />}
                  >
                    <StackedBarChart data={agg.dailyTier} series={agg.tiers.map((x) => tierLabel(x))} colors={tierColors} />
                  </ChartCard>
                  <ChartCard title={t('billing.usage.chart.byModel.title')} subtitle={t('billing.usage.chart.byModel.subtitle')} table={<DataTable columns={[t('common.model'), t('billing.usage.chart.costUsd')]} rows={agg.byModel.map((m) => [m.label, m.value])} />}>
                    <HBarChart data={agg.byModel} color={seriesColor(0, isDark)} valueFormat={(n) => formatUsd(n, 0)} />
                  </ChartCard>
                  <ChartCard
                    title={t('billing.usage.chart.byProvider.title')}
                    subtitle={t('billing.usage.chart.byProvider.subtitle')}
                    legend={<Legend items={agg.providers.map((p, i) => ({ label: providerName(p), color: providerColors[i] }))} />}
                    table={<DataTable columns={[t('common.date'), ...agg.providers.map((p) => providerName(p))]} rows={agg.daily.map((d) => [d.label, ...d.values])} />}
                  >
                    <StackedBarChart data={agg.daily} series={agg.providers.map((p) => providerName(p))} colors={providerColors} />
                  </ChartCard>
                  <ChartCard
                    title={t('billing.usage.chart.byStatus.title')}
                    subtitle={t('billing.usage.chart.byStatus.subtitle')}
                    legend={<Legend items={[{ label: okLabel, color: STATUS_COLORS.good }, { label: errLabel, color: STATUS_COLORS.critical }]} />}
                    table={<DataTable columns={[t('common.date'), okLabel, errLabel]} rows={agg.status.map((d) => [d.label, ...d.values])} />}
                  >
                    <StackedBarChart data={agg.status} series={[okLabel, errLabel]} colors={[STATUS_COLORS.good, STATUS_COLORS.critical]} height={180} />
                  </ChartCard>
                </div>
                <SimpleGrid items={rows} columns={columns} getRowId={(r) => `${r.date}-${r.projectId}-${r.modelId}`} ariaLabel={t('billing.usage.gridAria')} minWidth={1500} />
              </>
            )}
          </AsyncView>
        </>
      )}

      {tab === 'statement' && <StatementTab tenantOptions={tenantOptions.map((x) => x.id)} initialTenant={tenantId || tenantOptions[0]?.id || ''} />}
    </>
  );
}

function StatementTab({ tenantOptions, initialTenant }: { tenantOptions: string[]; initialTenant: string }) {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const { session } = useSession();
  const [tenantId, setTenantId] = useState(initialTenant);
  const [month, setMonth] = useState('2026-11');
  const st = useApi(() => (tenantId ? server.getBillingStatement(session, tenantId, month) : Promise.resolve({ ok: false as const, status: 404 as const, code: 'NOT_FOUND', message: t('billing.statement.selectTenant'), requestId: '-' })), [session, tenantId, month]);
  const modelName = (id: string, fallback: string) => tf(t, `data.model.${id}.displayName`, fallback);
  return (
    <div data-tour="statement">
      <div className={s.filters} role="group" aria-label={t('billing.statement.filtersAria')}>
        <Field label={t('billing.statement.customer')}>
          <Dropdown value={TENANTS.find((x) => x.id === tenantId)?.name ?? ''} selectedOptions={[tenantId]} onOptionSelect={(_, d) => d.optionValue && setTenantId(d.optionValue)} style={{ minWidth: 200 }}>
            {tenantOptions.map((id) => (
              <Option key={id} value={id}>
                {TENANTS.find((x) => x.id === id)?.name ?? id}
              </Option>
            ))}
          </Dropdown>
        </Field>
        <Field label={t('billing.statement.month')}>
          <Dropdown value={month}selectedOptions={[month]} onOptionSelect={(_, d) => d.optionValue && setMonth(d.optionValue)}>
            <Option value="2026-11">{t('billing.statement.monthToDate', { month: '2026-11' })}</Option>
            <Option value="2026-10">2026-10</Option>
          </Dropdown>
        </Field>
      </div>
      <AsyncView {...st} actionLabel={t('billing.statement.actionLabel')}>
        {(b: BillingStatement) => (
          <>
            {b.budget.alert !== 'ok' && (
              <MessageBar intent={b.budget.alert === 'critical' ? 'error' : 'warning'} style={{ marginBottom: 12 }} role="alert">
                <MessageBarBody>
                  <MessageBarTitle>{t('billing.statement.budgetAlert.title')}</MessageBarTitle>
                  {t('billing.statement.budgetAlert.body', { spent: formatUsd(b.budget.spentUsd, 0), budget: formatUsd(b.budget.monthlyBudgetUsd, 0), pct: Math.round(b.budget.pct * 100) })}
                  {b.budget.alert === 'critical' ? t('billing.statement.budgetAlert.critical') : t('billing.statement.budgetAlert.warning')}
                </MessageBarBody>
              </MessageBar>
            )}
            <div className={s.grid3} data-tour="statement-charges">
              <div className={s.card}>
                <span className={s.tileLabel}>{t('billing.statement.customerTile')}</span>
                <span style={{ fontWeight: 600 }}>{tenantLabel(t, b.tenantId, b.tenantName)}</span>
                <span className={s.tileLabel}>
                  {b.costCenter} · {b.billingContact.name}{t('billing.statement.contactEmail', { email: b.billingContact.email })}
                </span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <Badge appearance="tint" color="brand" size="small">
                    {tl(t, 'PLAN_LABELS', b.plan, PLAN_LABELS[b.plan])}
                  </Badge>
                  <Badge appearance="outline" size="small">
                    {tl(t, 'DATA_CLASS_LABELS', b.dataClass, DATA_CLASS_LABELS[b.dataClass])}
                  </Badge>
                  <Badge appearance="outline" size="small">
                    {tl(t, 'TIER_POLICY_LABELS', b.allowedTiers, TIER_POLICY_LABELS[b.allowedTiers])}
                  </Badge>
                  <Badge appearance="outline" size="small" color={b.billingMode === 'prepaid' ? 'important' : 'informative'}>
                    {tl(t, 'BILLING_MODE_LABELS', b.billingMode, BILLING_MODE_LABELS[b.billingMode])}
                  </Badge>
                  <Badge appearance="outline" size="small" color={b.retention === 'zero' ? 'success' : 'informative'}>
                    {tl(t, 'RETENTION_LABELS', b.retention, RETENTION_LABELS[b.retention])}
                  </Badge>
                </div>
              </div>
              <div className={s.card}>
                <span className={s.tileLabel}>{t('billing.statement.totalLabel', { month: b.month, days: b.daysInPeriod })}</span>
                <span className={s.tileValue}>{formatUsd(b.charges.totalUsd, 0)}</span>
                <ProgressBar value={Math.min(1, b.budget.pct)} color={b.budget.alert === 'critical' ? 'error' : b.budget.alert === 'warning' ? 'warning' : 'brand'} aria-label={t('billing.statement.budgetAria', { pct: Math.round(b.budget.pct * 100) })} />
                <span className={s.tileLabel}>
                  {t('billing.statement.budgetDetail', { budget: formatUsd(b.budget.monthlyBudgetUsd, 0), pct: Math.round(b.budget.pct * 100), twd: L.fmtTwd(b.charges.totalTwd), rate: b.rates.twdPerUsd })}
                </span>
              </div>
              {b.credits && (
                <div className={s.card} data-tour="statement-credits">
                  <span className={s.tileLabel}>{t('billing.statement.credits.label')}</span>
                  <span className={s.tileValue} style={{ color: b.credits.lowBalance ? tokens.colorPaletteDarkOrangeForeground1 : undefined }}>
                    {formatUsd(b.credits.availableUsd)}
                  </span>
                  <span className={s.tileLabel}>
                    {t('billing.statement.credits.detail', { balance: formatUsd(b.credits.balanceUsd), deducted: formatUsd(b.credits.deductedUsd), low: b.credits.lowBalance ? t('billing.statement.credits.low') : '' })}
                    <Link as="a" href="#/plan">{t('billing.statement.credits.topUp')}</Link>
                  </span>
                </div>
              )}
              <div className={s.card}>
                <span className={s.tileLabel}>{t('billing.statement.local.label')}</span>
                <span className={s.tileValue}>{formatUsd(b.charges.localTokens.usd, 0)}</span>
                <span className={s.tileLabel}>
                  {t('billing.statement.local.detail', { tokens: formatCompact(b.charges.localTokens.tokens), cached: formatCompact(b.charges.localTokens.cachedTokens), readMul: b.rates.cacheReadMultiplier, written: formatCompact(b.charges.localTokens.cacheWriteTokens), writeMul: b.rates.cacheWriteMultiplier, gpuHours: b.local.gpuHours })}
                </span>
              </div>
              <div className={s.card}>
                <span className={s.tileLabel}>{t('billing.statement.dedicated.label')}</span>
                <span className={s.tileValue}>{formatUsd(b.charges.dedicated.usd, 0)}</span>
                <span className={s.tileLabel}>{b.charges.dedicated.items.length ? `${L.fmtNumber(b.charges.dedicated.gpuHours)} GPU-hr · ${b.charges.dedicated.items.map((i) => modelName(i.modelId, i.modelName)).join(t('common.listSeparator'))}` : t('billing.statement.dedicated.none')}</span>
              </div>
              <div className={s.card}>
                <span className={s.tileLabel}>{t('billing.statement.proxied.label', { markup: b.rates.cloudMarkupPct, disc: b.rates.proxyDiscountPct })}</span>
                <span className={s.tileValue}>{formatUsd(b.charges.cloud.usd, 0)}</span>
                <span className={s.tileLabel}>
                  {t('billing.statement.proxied.detail', { list: formatUsd(b.charges.cloud.listUsd, 0), markup: formatUsd(b.charges.cloud.markupUsd, 0), discount: formatUsd(b.charges.cloud.discountUsd, 0), spill: formatCompact(b.charges.cloud.spilloverRequests), direct: formatCompact(b.cloud.requests) })}
                </span>
              </div>
              <div className={s.card}>
                <span className={s.tileLabel}>{t('billing.statement.commit.label')}</span>
                {b.charges.commitment ? (
                  <>
                    <span className={s.tileValue}>
                      −{formatUsd(b.charges.commitment.discountUsd, 0)}
                      {b.charges.commitment.shortfallUsd ? ` / +${formatUsd(b.charges.commitment.shortfallUsd, 0)}` : ''}
                    </span>
                    <span className={s.tileLabel}>
                      {t('billing.statement.commit.detail', { monthly: formatUsd(b.charges.commitment.monthlyUsd, 0), prorated: formatUsd(b.charges.commitment.proratedUsd, 0), pct: b.charges.commitment.discountPct, overage: formatUsd(b.charges.commitment.overageUsd, 0) })}
                      {b.charges.commitment.shortfallUsd ? t('billing.statement.commit.shortfall', { amount: formatUsd(b.charges.commitment.shortfallUsd, 0) }) : ''}
                    </span>
                  </>
                ) : (
                  <>
                    <span className={s.tileValue}>—</span>
                    <span className={s.tileLabel}>{t('billing.statement.commit.none', { plan: tl(t, 'PLAN_LABELS', b.plan, PLAN_LABELS[b.plan]) })}</span>
                  </>
                )}
              </div>
            </div>
            <div className={s.card} style={{ marginBottom: 12 }} data-tour="statement-models">
              <Text weight="semibold">{t('billing.statement.models.title')}</Text>
              <div style={{ overflowX: 'auto' }}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <Th className={s.th}>{t('common.model')}</Th>
                    <Th className={s.th}>tokens</Th>
                    <Th className={s.th}>{t('billing.statement.models.cacheRead', { mul: b.rates.cacheReadMultiplier })}</Th>
                    <Th className={s.th}>{t('billing.statement.models.cacheWrite', { mul: b.rates.cacheWriteMultiplier })}</Th>
                    <Th className={s.th}>{t('billing.statement.models.listPrice')}</Th>
                    <Th className={s.th}>{t('billing.statement.models.basis')}</Th>
                    <Th className={s.th}>{t('billing.statement.col.charge')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {b.charges.localTokens.byModel.length === 0 && (
                    <tr>
                      <td className={s.td} colSpan={7}>
                        {t('billing.statement.models.empty')}
                      </td>
                    </tr>
                  )}
                  {b.charges.localTokens.byModel.map((m, i) => {
                    // 伺服器現在依「部署」拆列（同一模型可能有共用 + 專屬兩列）：鍵要含 deploymentId
                    const dep = (m as typeof m & { deploymentId?: string; deploymentName?: string }).deploymentId;
                    const depName = (m as typeof m & { deploymentName?: string }).deploymentName;
                    return (
                    <tr key={`${m.modelId}-${dep ?? i}`}>
                      <td className={s.td}>
                        {modelName(m.modelId, m.modelName)}
                        <div>
                          <code style={{ fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3 }}>{m.modelId}</code>
                          {dep ? (
                            <code style={{ fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3 }}>
                              {' · '}
                              {depName ?? dep}
                            </code>
                          ) : null}
                        </div>
                      </td>
                      <td className={s.td}>{L.fmtNumber(m.tokens)}</td>
                      <td className={s.td}>{L.fmtNumber(m.cachedTokens)}</td>
                      <td className={s.td}>{L.fmtNumber(m.cacheWriteTokens)}</td>
                      <td className={s.td}>
                        US${m.inputUsdPerMTok} / US${m.outputUsdPerMTok}
                      </td>
                      <td className={s.td}>{m.basis === 'dedicated' ? t('billing.statement.models.basisDedicated') : t('billing.statement.models.basisToken')}</td>
                      <td className={s.td}>{formatUsd(m.usd)}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
            {b.charges.dedicated.items.length > 0 && (
              <div className={s.card} style={{ marginBottom: 12 }} data-tour="statement-dedicated">
                <Text weight="semibold">{t('billing.statement.dedicatedTable.title')}</Text>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <Th className={s.th}>{t('common.deployment')}</Th>
                      <Th className={s.th}>{t('billing.statement.dedicatedTable.cluster')}</Th>
                      <Th className={s.th}>{t('billing.statement.dedicatedTable.gpus')}</Th>
                      <Th className={s.th}>GPU-hr</Th>
                      <Th className={s.th}>{t('billing.statement.dedicatedTable.unitPrice')}</Th>
                      <Th className={s.th}>{t('billing.statement.col.charge')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.charges.dedicated.items.map((i) => (
                      <tr key={i.deploymentId}>
                        <td className={s.td}>
                          {modelName(i.modelId, i.modelName)}
                          <div>
                            <code style={{ fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3 }}>{i.deploymentName}</code>
                          </div>
                        </td>
                        <td className={s.td}>
                          {i.clusterName} · {i.gpuType}
                        </td>
                        <td className={s.td}>{i.gpus}</td>
                        <td className={s.td}>{L.fmtNumber(i.hours)}</td>
                        <td className={s.td}>US${i.unitUsd}/GPU-hr</td>
                        <td className={s.td}>{formatUsd(i.usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Text size={200}>{t('billing.statement.dedicatedTable.note')}</Text>
              </div>
            )}
            {b.charges.cloud.byModel.length > 0 && (
              <div className={s.card} style={{ marginBottom: 12 }} data-tour="statement-proxied">
                <Text weight="semibold">{t('billing.statement.proxiedTable.title')}</Text>
                <div style={{ overflowX: 'auto' }}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <Th className={s.th}>{t('common.model')}</Th>
                      <Th className={s.th}>{t('billing.statement.proxiedTable.kind')}</Th>
                      <Th className={s.th}>tokens</Th>
                      <Th className={s.th}>{t('billing.statement.proxiedTable.list')}</Th>
                      <Th className={s.th}>{t('billing.statement.proxiedTable.ours')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.charges.cloud.byModel.map((m) => (
                      <tr key={m.modelId}>
                        <td className={s.td}>{modelName(m.modelId, m.modelName)}</td>
                        <td className={s.td}>
                          <Badge size="small" appearance="tint" color={m.kind === 'proxied-open' ? 'informative' : 'important'}>
                            {m.kind === 'proxied-open' ? t('billing.statement.proxiedTable.open', { pct: b.rates.cloudMarkupPct }) : t('billing.statement.proxiedTable.closed', { pct: b.rates.proxyDiscountPct })}
                          </Badge>
                        </td>
                        <td className={s.td}>{L.fmtNumber(m.tokens)}</td>
                        <td className={s.td}>{formatUsd(m.listUsd)}</td>
                        <td className={s.td}>{formatUsd(m.usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                <Text size={200}>{t('billing.statement.proxiedTable.note', { open: tl(t, 'PROXY_KIND_LABELS', 'proxied-open', PROXY_KIND_LABELS['proxied-open']), closed: tl(t, 'PROXY_KIND_LABELS', 'proxied-closed', PROXY_KIND_LABELS['proxied-closed']) })}</Text>
              </div>
            )}
            <div className={s.card}>
              <Text weight="semibold">{t('billing.statement.projects.title')}</Text>
              <table className={s.table}>
                <thead>
                  <tr>
                    <Th className={s.th}>{t('common.project')}</Th>
                    <Th className={s.th}>{t('billing.statement.projects.localTokens')}</Th>
                    <Th className={s.th}>{t('billing.statement.projects.tokenFee')}</Th>
                    <Th className={s.th}>{t('billing.statement.projects.proxied')}</Th>
                    <Th className={s.th}>{t('common.spillover')}</Th>
                    <Th className={s.th}>{t('common.total')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {b.projects.map((p) => (
                    <tr key={p.projectId}>
                      <td className={s.td}>{p.projectName}</td>
                      <td className={s.td}>{L.fmtNumber(p.localTokens)}</td>
                      <td className={s.td}>{formatUsd(p.localTokenUsd)}</td>
                      <td className={s.td}>{formatUsd(p.cloudUsd)}</td>
                      <td className={s.td}>{formatUsd(p.spilloverUsd)}</td>
                      <td className={s.td}>
                        <strong>{formatUsd(p.totalUsd)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Text size={200}>{t('billing.statement.projects.note')}</Text>
            </div>
          </>
        )}
      </AsyncView>
    </div>
  );
}
