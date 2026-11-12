import { Badge, Button, MessageBar, MessageBarBody, Tab, TabList, Text, Tooltip, createTableColumn, makeStyles, tokens, type TableColumnDefinition } from '@fluentui/react-components';
import { AddRegular, ArrowResetRegular, DismissCircleRegular, RocketRegular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { AsyncView, EmptyState, NotFoundState } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { SimpleGrid } from '../../components/SimpleGrid';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useNotify } from '../../components/Notify';
import { useApi } from '../../hooks/useApi';
import { keyedText, useLocale, useT, tf, tl, tenantLabel } from '../../i18n';
import { server, type NodePoolView } from '../../server/api';
import { useSession } from '../../app/SessionContext';
import { clusterScope } from '../../auth/scope';
import { CLUSTER_STATUS_LABELS, NODE_STATUS_LABELS, SHARING_LABELS, type ClusterEvent, type GpuNode } from '../../data/clusters';
import { clusterStatusKind } from './ClustersPage';
import { ConnectProviderDrawer } from '../providers/ConnectProviderDrawer';
import { DeploymentsTable } from '../deployments/DeploymentsTable';

const useStyles = makeStyles({
  kv: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: tokens.spacingHorizontalM, marginBottom: tokens.spacingVerticalL },
  card: { backgroundColor: tokens.colorNeutralBackground1, borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px', borderTopStyle: 'solid', borderRightStyle: 'solid', borderBottomStyle: 'solid', borderLeftStyle: 'solid', borderTopColor: tokens.colorNeutralStroke2, borderRightColor: tokens.colorNeutralStroke2, borderBottomColor: tokens.colorNeutralStroke2, borderLeftColor: tokens.colorNeutralStroke2, borderRadius: tokens.borderRadiusLarge, padding: tokens.spacingVerticalM, display: 'flex', flexDirection: 'column', rowGap: '4px' },
  label: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  num: { fontVariantNumeric: 'tabular-nums' },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
  tabs: { marginBottom: tokens.spacingVerticalM },
  events: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalXS },
  event: { display: 'grid', gridTemplateColumns: 'max-content max-content 1fr', columnGap: tokens.spacingHorizontalM, alignItems: 'start', padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tokens.colorNeutralStroke3, fontSize: tokens.fontSizeBase200 },
  note: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, marginBottom: tokens.spacingVerticalS },
});

type TabKey = 'nodes' | 'deployments' | 'pools' | 'events';
const TAB_KEYS: TabKey[] = ['nodes', 'deployments', 'pools', 'events'];

function nodeKind(st: GpuNode['status']): 'success' | 'pending' | 'neutral' | 'danger' {
  return st === 'ready' ? 'success' : st === 'draining' ? 'pending' : st === 'drained' ? 'neutral' : 'danger';
}

export function ClusterDetailPage() {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const { clusterId = '' } = useParams();
  const { session, canUi, bump } = useSession();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as TabKey) || 'nodes';
  const setTab = (v: TabKey) => setParams((p) => { p.set('tab', v); return p; });
  const navigate = useNavigate();
  const notify = useNotify();
  const clusterSt = useApi(() => server.getCluster(session, clusterId), [session, clusterId]);
  const nodesSt = useApi(() => server.listNodes(session, clusterId), [session, clusterId]);
  const depSt = useApi(() => server.listDeployments(session, { clusterId }), [session, clusterId]);
  const poolSt = useApi(() => server.listNodePools(session, clusterId), [session, clusterId]);
  const evSt = useApi(() => server.listClusterEvents(session, clusterId), [session, clusterId]);
  const scope = clusterScope(clusterId);
  const canOperate = canUi('cluster.operate', scope);
  const canRegister = canUi('cluster.register', scope);
  const canManage = canUi('deployment.manage', scope);
  const [confirm, setConfirm] = useState<{ node: GpuNode; verb: 'drain' | 'uncordon' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [addingNode, setAddingNode] = useState(false);

  const reloadAll = () => {
    clusterSt.reload();
    nodesSt.reload();
    depSt.reload();
    evSt.reload();
    poolSt.reload();
  };

  const operate = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const res = confirm.verb === 'drain' ? await server.drainNode(session, confirm.node.id) : await server.uncordonNode(session, confirm.node.id);
      if (res.ok) {
        notify.success(t(confirm.verb === 'drain' ? 'ops.clusterDetail.toast.draining' : 'ops.clusterDetail.toast.uncordoned', { name: confirm.node.name }), `requestId: ${res.requestId}`);
        bump();
        reloadAll();
        if (confirm.verb === 'drain') window.setTimeout(() => nodesSt.reload(), 1800);
      } else notify.apiError(res, t(confirm.verb === 'drain' ? 'ops.clusterDetail.ctx.drain' : 'ops.clusterDetail.ctx.uncordon'));
    } catch (e) {
      notify.apiError(e as Error, t('ops.clusterDetail.ctx.nodeOp'));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const nodeColumns: TableColumnDefinition<GpuNode>[] = useMemo(
    () => [
      createTableColumn<GpuNode>({
        columnId: 'name',
        compare: (a, b) => a.name.localeCompare(b.name),
        renderHeaderCell: () => t('ops.clusterDetail.col.node'),
        renderCell: (n) => (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Text weight="semibold" className={s.mono}>
              {n.name}
            </Text>
            <span className={s.label}>agent {n.agentVersion}</span>
          </div>
        ),
      }),
      createTableColumn<GpuNode>({ columnId: 'pool', renderHeaderCell: () => t('ops.clusterDetail.col.pool'), renderCell: (n) => <span className={s.mono}>{n.poolId}</span> }),
      createTableColumn<GpuNode>({ columnId: 'gpu', renderHeaderCell: () => t('ops.clusterDetail.col.gpuType'), renderCell: (n) => n.gpuType }),
      createTableColumn<GpuNode>({ columnId: 'count', compare: (a, b) => a.gpuCount - b.gpuCount, renderHeaderCell: () => t('ops.clusterDetail.col.gpuCount'), renderCell: (n) => <span className={s.num}>{n.gpuCount}</span> }),
      createTableColumn<GpuNode>({
        columnId: 'alloc',
        renderHeaderCell: () => t('ops.clusterDetail.col.alloc'),
        renderCell: (n) => (
          <span className={s.num}>
            {n.gpuAllocated} / {n.gpuCount - n.gpuAllocated}
          </span>
        ),
      }),
      createTableColumn<GpuNode>({
        columnId: 'mem',
        renderHeaderCell: () => t('ops.clusterDetail.col.mem'),
        renderCell: (n) => (
          <span className={s.num}>
            {n.memoryUsedGb} / {n.memoryGbPerGpu * n.gpuCount} GB
          </span>
        ),
      }),
      createTableColumn<GpuNode>({
        columnId: 'sm',
        compare: (a, b) => a.smActive - b.smActive,
        renderHeaderCell: () => (
          <Tooltip content={t('ops.clusterDetail.col.smTip')} relationship="description">
            <span>{t('ops.clusterDetail.col.sm')}</span>
          </Tooltip>
        ),
        renderCell: (n) => <span className={s.num}>{Math.round(n.smActive * 100)}%</span>,
      }),
      createTableColumn<GpuNode>({ columnId: 'idle', compare: (a, b) => a.idleMinutes - b.idleMinutes, renderHeaderCell: () => t('ops.clusterDetail.col.idle'), renderCell: (n) => (n.idleMinutes ? t('ops.clusterDetail.idleMinutes', { n: n.idleMinutes }) : t('ops.clusterDetail.busy')) }),
      createTableColumn<GpuNode>({
        columnId: 'status',
        renderHeaderCell: () => t('ops.clusterDetail.col.status'),
        renderCell: (n) => (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <StatusBadge kind={nodeKind(n.status)} label={tl(t, 'NODE_STATUS_LABELS', n.status, NODE_STATUS_LABELS[n.status])} size="small" />
            {n.mig && (
              <Badge appearance="outline" size="small" color="informative">
                MIG {tf(t, `data.node.${n.id}.mig`, n.mig)}
              </Badge>
            )}
          </div>
        ),
      }),
      createTableColumn<GpuNode>({
        columnId: 'actions',
        renderHeaderCell: () => t('ops.clusterDetail.col.actions'),
        renderCell: (n) => (
          <div style={{ display: 'flex', gap: 4 }}>
            <Tooltip content={canOperate ? t('ops.clusterDetail.drainTip') : t('ops.clusterDetail.needOperate')} relationship="label">
              <Button size="small" appearance="subtle" icon={<DismissCircleRegular />} aria-label={t('ops.clusterDetail.drainAria', { name: n.name })} disabled={!canOperate || n.status !== 'ready'} onClick={() => setConfirm({ node: n, verb: 'drain' })} data-tour={n.status === 'ready' ? 'node-drain' : undefined}>
                {t('ops.clusterDetail.drain')}
              </Button>
            </Tooltip>
            <Tooltip content={canOperate ? t('ops.clusterDetail.uncordonTip') : t('ops.clusterDetail.needOperate')} relationship="label">
              <Button size="small" appearance="subtle" icon={<ArrowResetRegular />} aria-label={t('ops.clusterDetail.uncordonAria', { name: n.name })} disabled={!canOperate || n.status === 'ready' || n.status === 'draining'} onClick={() => setConfirm({ node: n, verb: 'uncordon' })}>
                {t('ops.clusterDetail.uncordon')}
              </Button>
            </Tooltip>
          </div>
        ),
      }),
    ],
    [s, t, canOperate],
  );

  const poolColumns: TableColumnDefinition<NodePoolView>[] = useMemo(
    () => [
      createTableColumn<NodePoolView>({ columnId: 'name', renderHeaderCell: () => t('ops.clusterDetail.col.pool'), renderCell: (p) => <Text weight="semibold">{keyedText(t, p.name, p.nameKey, p.nameParams)}</Text> }),
      createTableColumn<NodePoolView>({
        columnId: 'sharing',
        renderHeaderCell: () => t('ops.clusterDetail.col.sharing'),
        renderCell: (p) => (
          <Badge appearance={p.sharing === 'dedicated' ? 'tint' : 'outline'} color={p.sharing === 'dedicated' ? 'important' : 'informative'} size="small">
            {tl(t, 'SHARING_LABELS', p.sharing, SHARING_LABELS[p.sharing])}
          </Badge>
        ),
      }),
      createTableColumn<NodePoolView>({ columnId: 'tenant', renderHeaderCell: () => t('ops.clusterDetail.col.tenant'), renderCell: (p) => (p.dedicatedTenantName ? tenantLabel(t, p.dedicatedTenantId, p.dedicatedTenantName) : undefined) ?? t('ops.clusterDetail.sharedAllTenants') }),
      createTableColumn<NodePoolView>({ columnId: 'gpu', renderHeaderCell: () => t('ops.clusterDetail.col.gpuType'), renderCell: (p) => p.gpuType }),
      createTableColumn<NodePoolView>({ columnId: 'nodes', renderHeaderCell: () => t('ops.clusterDetail.col.nodeCount'), renderCell: (p) => <span className={s.num}>{p.nodeCount}</span> }),
      createTableColumn<NodePoolView>({
        columnId: 'alloc',
        renderHeaderCell: () => t('ops.clusterDetail.col.allocTotal'),
        renderCell: (p) => (
          <span className={s.num}>
            {p.gpuAllocated} / {p.gpuTotal - p.gpuAllocated} / {p.gpuTotal}
          </span>
        ),
      }),
      createTableColumn<NodePoolView>({
        columnId: 'billing',
        renderHeaderCell: () => t('ops.clusterDetail.col.billing'),
        renderCell: (p) => (p.sharing === 'dedicated' ? t('ops.clusterDetail.billingDedicated', { price: server.billing.gpuListUsdPerHour[p.gpuType] ?? '—' }) : t('ops.clusterDetail.billingShared')),
      }),
    ],
    [s, t],
  );

  if (clusterSt.apiError?.status === 404) return <NotFoundState what={t('ops.clusterDetail.what')} />;
  const c = clusterSt.data;

  return (
    <>
      <PageHeader
        title={c?.name ?? t('ops.clusterDetail.what')}
        subtitle={c ? t('ops.clusterDetail.subtitle', { site: tf(t, `data.cluster.${c.id}.site`, c.site), region: c.region, k8s: c.k8sVersion, engine: c.engine, agent: c.agentVersion, scope }) : undefined}
        crumbs={[{ label: t('ops.clusters.crumb'), to: '/clusters' }, { label: c?.name ?? clusterId }]}
        actions={
          <>
            <Tooltip content={canRegister ? t('ops.clusterDetail.addNodeTip') : t('ops.clusterDetail.addNodeDenied')} relationship="description">
              <Button icon={<AddRegular />} onClick={() => setAddingNode(true)} data-tour="cluster-add-node" disabled={!canRegister}>
                {t('ops.clusterDetail.addNode')}
              </Button>
            </Tooltip>
            <Tooltip content={canManage ? t('ops.clusterDetail.deployTip') : t('ops.clusterDetail.deployDenied')} relationship="description">
              <Button appearance="primary" icon={<RocketRegular />} onClick={() => navigate(`/deployments?cluster=${clusterId}&create=1`)} disabled={!canManage}>
                {t('ops.clusterDetail.deploy')}
              </Button>
            </Tooltip>
          </>
        }
      />
      <AsyncView {...clusterSt} actionLabel={t('ops.clusterDetail.actionLabel')}>
        {(cl) => (
          <>
            {cl.status !== 'connected' && (
              <MessageBar intent={cl.status === 'waiting' ? 'info' : 'warning'} style={{ marginBottom: 12 }}>
                <MessageBarBody>
                  {t('ops.clusterDetail.statusIs', { status: tl(t, 'CLUSTER_STATUS_LABELS', cl.status, CLUSTER_STATUS_LABELS[cl.status]) })}
                  {t(cl.status === 'waiting' ? 'ops.clusterDetail.statusWaiting' : cl.status === 'disconnected' ? 'ops.clusterDetail.statusDisconnected' : 'ops.clusterDetail.statusIssues')}
                </MessageBarBody>
              </MessageBar>
            )}
            <div className={s.kv}>
              <div className={s.card}>
                <span className={s.label}>{t('ops.clusterDetail.col.status')}</span>
                <StatusBadge kind={clusterStatusKind(cl.status)} label={tl(t, 'CLUSTER_STATUS_LABELS', cl.status, CLUSTER_STATUS_LABELS[cl.status])} />
              </div>
              <div className={s.card}>
                <span className={s.label}>{t('ops.clusterDetail.kv.gpu')}</span>
                <Text size={500} weight="semibold" className={s.num}>
                  {cl.gpuAllocated} / {cl.gpuTotal - cl.gpuAllocated} / {cl.gpuTotal}
                </Text>
                <span className={s.label}>{cl.gpuType}</span>
              </div>
              <div className={s.card}>
                <span className={s.label}>{t('ops.clusters.col.util')}</span>
                <Text size={500} weight="semibold" className={s.num}>
                  {Math.round(cl.gpuUtil * 100)}%
                </Text>
              </div>
              <div className={s.card}>
                <span className={s.label}>{t('ops.clusterDetail.kv.queue')}</span>
                <Text size={500} weight="semibold" className={s.num}>
                  {cl.queueDepth}
                </Text>
              </div>
              <div className={s.card}>
                <span className={s.label}>{t('ops.clusters.col.hb')}</span>
                <Text size={300} weight="semibold">
                  {cl.lastHeartbeat ? L.fmtDateTime(cl.lastHeartbeat) : '—'}
                </Text>
                <span className={s.label}>{t('ops.clusterDetail.kv.hbNote')}</span>
              </div>
            </div>
          </>
        )}
      </AsyncView>
      <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as TabKey)} className={s.tabs} aria-label={t('ops.clusterDetail.tabsAria')} data-tour="cluster-tabs">
        {TAB_KEYS.map((k) => (
          <Tab key={k} value={k}>
            {t(`ops.clusterDetail.tab.${k}`)}
          </Tab>
        ))}
      </TabList>
      {tab === 'nodes' && (
        <div data-tour="cluster-nodes">
          <Text className={s.note} as="p">
            {t('ops.clusterDetail.nodesNote')}
          </Text>
          <AsyncView {...nodesSt} actionLabel={t('ops.clusterDetail.nodesAction')} isEmpty={(d) => d.length === 0} empty={<EmptyState title={t('ops.clusterDetail.nodesEmpty.title')} description={t('ops.clusterDetail.nodesEmpty.desc')} />}>
            {(nodes) => <SimpleGrid items={nodes} columns={nodeColumns} getRowId={(n) => n.id} ariaLabel={t('ops.clusterDetail.nodesAria')} minWidth={1300} />}
          </AsyncView>
        </div>
      )}
      {tab === 'deployments' && (
        <AsyncView {...depSt} actionLabel={t('ops.clusterDetail.depsAction')} isEmpty={(d) => d.length === 0} empty={<EmptyState title={t('ops.clusterDetail.depsEmpty.title')} description={t('ops.clusterDetail.depsEmpty.desc')} />}>
          {(deps) => <DeploymentsTable items={deps} onChanged={reloadAll} />}
        </AsyncView>
      )}
      {tab === 'pools' && (
        <div data-tour="cluster-pools">
          <Text className={s.note} as="p">
            {t('ops.clusterDetail.poolsNote')}
          </Text>
          <AsyncView {...poolSt} actionLabel={t('ops.clusterDetail.poolsAction')} isEmpty={(d) => d.length === 0} empty={<EmptyState title={t('ops.clusterDetail.poolsEmpty')} />}>
            {(rows) => <SimpleGrid items={rows} columns={poolColumns} getRowId={(p) => p.id} ariaLabel={t('ops.clusterDetail.tab.pools')} minWidth={1000} />}
          </AsyncView>
        </div>
      )}
      {tab === 'events' && (
        <AsyncView {...evSt} actionLabel={t('ops.clusterDetail.eventsAction')} isEmpty={(d) => d.length === 0} empty={<EmptyState title={t('ops.clusterDetail.eventsEmpty')} />}>
          {(events: ClusterEvent[]) => (
            <ul className={s.events} aria-label={t('ops.clusterDetail.eventsAria')}>
              {events.map((e) => (
                <li key={e.id} className={s.event}>
                  <span className={s.num}>{L.fmtDateTime(e.timestamp)}</span>
                  <StatusBadge kind={e.level === 'error' ? 'danger' : e.level === 'warning' ? 'warning' : 'info'} label={t(`ops.clusterDetail.level.${e.level}`)} size="small" />
                  <span>
                    {keyedText(t, e.message, e.messageKey, e.params)}
                    {e.requestId && <span className={s.label}> · {e.requestId}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </AsyncView>
      )}
      <ConfirmDialog
        open={!!confirm}
        title={t(confirm?.verb === 'drain' ? 'ops.clusterDetail.confirm.drainTitle' : 'ops.clusterDetail.confirm.uncordonTitle')}
        destructive={confirm?.verb === 'drain'}
        confirmLabel={t(confirm?.verb === 'drain' ? 'ops.clusterDetail.drain' : 'ops.clusterDetail.uncordon')}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={operate}
      >
        {confirm?.verb === 'drain'
          ? t('ops.clusterDetail.confirm.drainBody', { name: confirm.node.name, gpus: confirm.node.gpuCount })
          : t('ops.clusterDetail.confirm.uncordonBody', { name: confirm?.node.name })}
      </ConfirmDialog>
      <ConnectProviderDrawer open={addingNode} mode="node" clusterId={clusterId} clusterName={c?.name} onClose={() => setAddingNode(false)} onConnected={reloadAll} />
    </>
  );
}
