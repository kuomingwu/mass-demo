import { Badge, Button, MessageBar, MessageBarBody, Text, Tooltip, createTableColumn, makeStyles, tokens, type TableColumnDefinition } from '@fluentui/react-components';
import { AddCircleRegular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { AsyncView, EmptyState } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { SimpleGrid } from '../../components/SimpleGrid';
import { useApi } from '../../hooks/useApi';
import { useLocale, useT, tf, tl, tenantLabel } from '../../i18n';
import { server, type ClusterView } from '../../server/api';
import { useSession } from '../../app/SessionContext';
import { PLATFORM_SCOPE } from '../../auth/scope';
import { CLUSTER_STATUS_LABELS, type ClusterStatus } from '../../data/clusters';
import { RegisterClusterDrawer } from './RegisterClusterDrawer';

const useStyles = makeStyles({
  num: { fontVariantNumeric: 'tabular-nums' },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
  bar: { display: 'flex', height: '6px', borderRadius: '3px', overflow: 'hidden', backgroundColor: tokens.colorNeutralBackground3, width: '120px' },
  barFill: { backgroundColor: tokens.colorBrandBackground },
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: tokens.spacingHorizontalM, marginBottom: tokens.spacingVerticalM },
  tile: { backgroundColor: tokens.colorNeutralBackground1, borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px', borderTopStyle: 'solid', borderRightStyle: 'solid', borderBottomStyle: 'solid', borderLeftStyle: 'solid', borderTopColor: tokens.colorNeutralStroke2, borderRightColor: tokens.colorNeutralStroke2, borderBottomColor: tokens.colorNeutralStroke2, borderLeftColor: tokens.colorNeutralStroke2, borderRadius: tokens.borderRadiusLarge, padding: tokens.spacingVerticalM, display: 'flex', flexDirection: 'column', rowGap: '2px' },
  tileLabel: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  tileValue: { fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold, fontVariantNumeric: 'tabular-nums' },
  chips: { display: 'flex', flexWrap: 'wrap', gap: '4px' },
});

export function clusterStatusKind(st: ClusterStatus): 'success' | 'pending' | 'danger' | 'warning' | 'neutral' {
  switch (st) {
    case 'connected':
      return 'success';
    case 'waiting':
      return 'pending';
    case 'disconnected':
      return 'danger';
    case 'service-issues':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function ClustersPage() {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const { session, canUi } = useSession();
  const navigate = useNavigate();
  const st = useApi(() => server.listClusters(session), [session]);
  const [registering, setRegistering] = useState(false);
  const canRegister = canUi('cluster.register', PLATFORM_SCOPE);

  const totals = useMemo(() => {
    const list = st.data ?? [];
    const connected = list.filter((c) => c.status === 'connected');
    const gpuTotal = connected.reduce((a, c) => a + c.gpuTotal, 0);
    const gpuAllocated = connected.reduce((a, c) => a + c.gpuAllocated, 0);
    // 與總覽 KPI（VendorKpis.gpuUtilization）同一個定義：已連線機房的加權 DCGM 使用率（服務異常／中斷的機房不計入分母）
    const weighted = connected.reduce((a, c) => a + c.gpuUtil * c.gpuTotal, 0);
    const util = gpuTotal ? weighted / gpuTotal : 0;
    // 參考：把服務異常／中斷機房的 GPU 也放進分母（其使用率計 0）的機隊整體數字
    const gpuTotalAll = list.reduce((a, c) => a + c.gpuTotal, 0);
    const utilAll = gpuTotalAll ? weighted / gpuTotalAll : 0;
    const dedicated = list.flatMap((c) => c.pools).filter((p) => p.sharing === 'dedicated').reduce((a, p) => a + p.gpuTotal, 0);
    return { clusters: list.length, connected: connected.length, gpuTotal, gpuTotalAll, gpuAllocated, util, utilAll, queue: connected.reduce((a, c) => a + c.queueDepth, 0), dedicated };
  }, [st.data]);

  const columns: TableColumnDefinition<ClusterView>[] = useMemo(
    () => [
      createTableColumn<ClusterView>({
        columnId: 'name',
        compare: (a, b) => a.name.localeCompare(b.name),
        renderHeaderCell: () => t('ops.clusters.col.name'),
        renderCell: (c) => (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Text weight="semibold">{c.name}</Text>
            <span className={s.mono}>
              {c.id} · {c.region}
            </span>
          </div>
        ),
      }),
      createTableColumn<ClusterView>({ columnId: 'site', renderHeaderCell: () => t('ops.clusters.col.site'), renderCell: (c) => tf(t, `data.cluster.${c.id}.site`, c.site) }),
      createTableColumn<ClusterView>({ columnId: 'status', compare: (a, b) => a.status.localeCompare(b.status), renderHeaderCell: () => t('ops.clusters.col.status'), renderCell: (c) => <StatusBadge kind={clusterStatusKind(c.status)} label={tl(t, 'CLUSTER_STATUS_LABELS', c.status, CLUSTER_STATUS_LABELS[c.status])} size="small" /> }),
      createTableColumn<ClusterView>({ columnId: 'gpu', renderHeaderCell: () => t('ops.clusters.col.gpu'), renderCell: (c) => (c.gpuTotal ? `${c.gpuType} × ${c.gpuTotal}` : t('ops.clusters.gpuWaiting', { type: c.gpuType })) }),
      createTableColumn<ClusterView>({
        columnId: 'pools',
        renderHeaderCell: () => t('ops.clusters.col.pools'),
        renderCell: (c) => (
          <div className={s.chips}>
            {c.pools.map((p) => (
              <Badge key={p.id} appearance={p.sharing === 'dedicated' ? 'tint' : 'outline'} color={p.sharing === 'dedicated' ? 'important' : 'informative'} size="small">
                {p.sharing === 'dedicated' ? t('ops.clusters.pool.dedicated', { tenant: tenantLabel(t, p.dedicatedTenantId, p.dedicatedTenantName ?? p.dedicatedTenantId) }) : t('ops.clusters.pool.shared')} {p.gpuAllocated}/{p.gpuTotal}
              </Badge>
            ))}
          </div>
        ),
      }),
      createTableColumn<ClusterView>({
        columnId: 'alloc',
        compare: (a, b) => a.gpuAllocated / Math.max(1, a.gpuTotal) - b.gpuAllocated / Math.max(1, b.gpuTotal),
        renderHeaderCell: () => t('ops.clusters.col.alloc'),
        renderCell: (c) => (
          <span className={s.num}>
            {c.gpuAllocated} / {Math.max(0, c.gpuTotal - c.gpuAllocated)}
          </span>
        ),
      }),
      createTableColumn<ClusterView>({
        columnId: 'util',
        compare: (a, b) => a.gpuUtil - b.gpuUtil,
        renderHeaderCell: () => t('ops.clusters.col.util'),
        renderCell: (c) => (
          <div style={{ display: 'flex', alignItems: 'center', columnGap: 8 }}>
            <div className={s.bar} role="img" aria-label={t('ops.clusters.utilAria', { pct: Math.round(c.gpuUtil * 100) })}>
              <div className={s.barFill} style={{ width: `${Math.round(c.gpuUtil * 100)}%` }} />
            </div>
            <span className={s.num}>{Math.round(c.gpuUtil * 100)}%</span>
          </div>
        ),
      }),
      createTableColumn<ClusterView>({ columnId: 'queue', compare: (a, b) => a.queueDepth - b.queueDepth, renderHeaderCell: () => t('ops.clusters.col.queue'), renderCell: (c) => <span className={s.num}>{c.queueDepth}</span> }),
      createTableColumn<ClusterView>({ columnId: 'engine', renderHeaderCell: () => t('ops.clusters.col.engine'), renderCell: (c) => c.engine }),
      createTableColumn<ClusterView>({ columnId: 'agent', renderHeaderCell: () => t('ops.clusters.col.agent'), renderCell: (c) => <code className={s.mono}>{c.agentVersion}</code> }),
      createTableColumn<ClusterView>({ columnId: 'hb', compare: (a, b) => (a.lastHeartbeat ?? '').localeCompare(b.lastHeartbeat ?? ''), renderHeaderCell: () => t('ops.clusters.col.hb'), renderCell: (c) => (c.lastHeartbeat ? L.fmtDateTime(c.lastHeartbeat) : '—') }),
    ],
    [s, t, L],
  );

  return (
    <>
      <PageHeader
        title={t('ops.clusters.title')}
        subtitle={t('ops.clusters.subtitle')}
        crumbs={[{ label: t('ops.clusters.crumb') }]}
        actions={
          <Tooltip content={canRegister ? t('ops.clusters.registerTip') : t('ops.clusters.registerDenied')} relationship="description">
            <Button data-tour="clusters-register" appearance="primary" icon={<AddCircleRegular />} onClick={() => setRegistering(true)} disabled={!canRegister}>
              {t('ops.clusters.register')}
            </Button>
          </Tooltip>
        }
      />
      <AsyncView {...st} actionLabel={t('ops.clusters.actionLabel')} isEmpty={(d) => d.length === 0} empty={<EmptyState title={t('ops.clusters.empty.title')} description={t('ops.clusters.empty.desc')} />}>
        {(clusters) => (
          <>
            <div className={s.tiles} data-tour="clusters-health" role="group" aria-label={t('ops.clusters.tilesAria')}>
              <div className={s.tile}>
                <span className={s.tileLabel}>{t('ops.clusters.tile.clusters')}</span>
                <span className={s.tileValue}>
                  {totals.connected} / {totals.clusters}
                </span>
              </div>
              <div className={s.tile}>
                <span className={s.tileLabel}>{t('ops.clusters.tile.alloc')}</span>
                <span className={s.tileValue}>
                  {totals.gpuAllocated} / {totals.gpuTotal - totals.gpuAllocated}
                </span>
              </div>
              <div className={s.tile}>
                <span className={s.tileLabel}>{t('ops.clusters.tile.dedicated')}</span>
                <span className={s.tileValue}>{totals.dedicated}</span>
              </div>
              <div className={s.tile}>
                <span className={s.tileLabel}>{t('ops.clusters.tile.util', { gpus: totals.gpuTotal })}</span>
                <span className={s.tileValue}>{Math.round(totals.util * 100)}%</span>
                {totals.gpuTotalAll !== totals.gpuTotal && <span className={s.tileLabel}>{t('ops.clusters.tile.utilAll', { gpus: totals.gpuTotalAll, pct: Math.round(totals.utilAll * 100) })}</span>}
              </div>
              <div className={s.tile}>
                <span className={s.tileLabel}>{t('ops.clusters.tile.queue')}</span>
                <span className={s.tileValue}>{totals.queue}</span>
              </div>
            </div>
            {clusters.some((c) => c.status === 'disconnected' || c.status === 'missing-prereqs' || c.status === 'service-issues') && (
              <MessageBar intent="warning" style={{ marginBottom: 12 }}>
                <MessageBarBody>{t('ops.clusters.unhealthyWarning')}</MessageBarBody>
              </MessageBar>
            )}
            <div data-tour="clusters-table">
              <SimpleGrid items={clusters} columns={columns} getRowId={(c) => c.id} ariaLabel={t('ops.clusters.gridAria')} onRowClick={(c) => navigate(`/clusters/${c.id}`)} minWidth={1500} />
            </div>
          </>
        )}
      </AsyncView>
      <RegisterClusterDrawer open={registering} onClose={() => setRegistering(false)} onRegistered={() => st.reload()} />
    </>
  );
}
