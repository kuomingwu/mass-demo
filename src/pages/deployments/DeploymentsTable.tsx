import { Badge, Button, Text, Tooltip, createTableColumn, makeStyles, tokens, type TableColumnDefinition } from '@fluentui/react-components';
import { ArrowMaximizeRegular, DeleteRegular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';
import { StatusBadge } from '../../components/StatusBadge';
import { SimpleGrid } from '../../components/SimpleGrid';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useNotify } from '../../components/Notify';
import { useSession } from '../../app/SessionContext';
import { server, type DeploymentView } from '../../server/api';
import { PLATFORM_SCOPE } from '../../auth/scope';
import { DEPLOYMENT_STATUS_LABELS, type DeploymentStatus } from '../../data/clusters';
import { ScaleDeploymentDialog } from './ScaleDeploymentDialog';
import { keyedText, useT, tf, tl, tenantLabel } from '../../i18n';

const useStyles = makeStyles({
  num: { fontVariantNumeric: 'tabular-nums' },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
  chips: { display: 'flex', flexWrap: 'wrap', gap: '4px' },
});

export function deploymentKind(st: DeploymentStatus): 'success' | 'pending' | 'neutral' | 'danger' {
  return st === 'ready' ? 'success' : st === 'creating' ? 'pending' : st === 'scaled-to-zero' ? 'neutral' : 'danger';
}

export function DeploymentsTable({ items, onChanged, showCluster = false }: { items: DeploymentView[]; onChanged: () => void; showCluster?: boolean }) {
  const s = useStyles();
  const t = useT();
  const { session, canUi, bump } = useSession();
  const notify = useNotify();
  const canManage = canUi('deployment.manage', PLATFORM_SCOPE);
  const { principal } = useSession();
  const isVendor = principal?.tenantId === null;
  const [toDelete, setToDelete] = useState<DeploymentView | null>(null);
  const [toScale, setToScale] = useState<DeploymentView | null>(null);
  const [busy, setBusy] = useState(false);

  const del = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      const res = await server.deleteDeployment(session, toDelete.id);
      if (res.ok) {
        notify.success(t('ops.depTable.toastDeleted', { name: toDelete.name }), `requestId: ${res.requestId}`);
        bump();
        onChanged();
      } else notify.apiError(res, t('ops.depTable.deleteAction'));
    } catch (e) {
      notify.apiError(e as Error, t('ops.depTable.deleteAction'));
    } finally {
      setBusy(false);
      setToDelete(null);
    }
  };

  const columns: TableColumnDefinition<DeploymentView>[] = useMemo(
    () => [
      createTableColumn<DeploymentView>({
        columnId: 'name',
        compare: (a, b) => a.name.localeCompare(b.name),
        renderHeaderCell: () => t('ops.depTable.col.name'),
        renderCell: (d) => (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Text weight="semibold">{d.name}</Text>
            <span className={s.mono}>{d.id}</span>
          </div>
        ),
      }),
      createTableColumn<DeploymentView>({
        columnId: 'model',
        renderHeaderCell: () => t('ops.depTable.col.model'),
        renderCell: (d) => (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span>{tf(t, `data.model.${d.modelId}.displayName`, d.modelName)}</span>
            <span className={s.mono}>{d.modelId}</span>
          </div>
        ),
      }),
      ...(showCluster ? [createTableColumn<DeploymentView>({ columnId: 'cluster', renderHeaderCell: () => t('ops.depTable.col.cluster'), renderCell: (d) => d.clusterName })] : []),
      createTableColumn<DeploymentView>({
        columnId: 'sharing',
        compare: (a, b) => a.sharing.localeCompare(b.sharing),
        renderHeaderCell: () => t('ops.depTable.col.sharing'),
        renderCell: (d) => (
          <Badge appearance={d.sharing === 'dedicated' ? 'tint' : 'outline'} color={d.sharing === 'dedicated' ? 'important' : 'informative'} size="small" data-tour={`deployment-sharing-${d.sharing}`}>
            {d.sharing === 'dedicated' ? t('ops.clusters.pool.dedicated', { tenant: tenantLabel(t, d.dedicatedTenantId, d.dedicatedTenantName ?? d.dedicatedTenantId) }) : t('ops.clusters.pool.shared')}
          </Badge>
        ),
      }),
      createTableColumn<DeploymentView>({
        columnId: 'engine',
        renderHeaderCell: () => t('ops.depTable.col.engine'),
        renderCell: (d) => (
          <div className={s.chips}>
            <Badge appearance="outline" size="small">
              {d.engine}
            </Badge>
            <Badge appearance="tint" size="small" color="informative">
              {d.quantization}
            </Badge>
          </div>
        ),
      }),
      createTableColumn<DeploymentView>({
        columnId: 'replicas',
        compare: (a, b) => a.replicas - b.replicas,
        renderHeaderCell: () => t('ops.depTable.col.replicas'),
        renderCell: (d) => <span className={s.num}>{t('ops.depTable.replicasValue', { replicas: d.replicas, gpus: d.gpusPerReplica, vram: d.vramGb })}</span>,
      }),
      createTableColumn<DeploymentView>({
        columnId: 'auto',
        renderHeaderCell: () => t('ops.depTable.col.auto'),
        renderCell: (d) => (
          <span className={s.num}>
            {d.autoscaling.minReplicas}–{d.autoscaling.maxReplicas} · {d.autoscaling.metric === 'queue-depth' ? t('ops.depTable.metric.queue') : t('ops.depTable.metric.concurrency')}
            {d.autoscaling.scaleToZero ? t('ops.depTable.scaleToZeroSuffix') : ''}
          </span>
        ),
      }),
      createTableColumn<DeploymentView>({
        columnId: 'sched',
        renderHeaderCell: () => t('ops.depTable.col.sched'),
        renderCell: (d) => (
          <div className={s.chips}>
            {d.priorityScheduling && (
              <Badge appearance="outline" size="small">
                {t('ops.depTable.priority')}
              </Badge>
            )}
            {d.cacheSaltByTenant && (
              <Badge appearance="outline" size="small">
                cache_salt
              </Badge>
            )}
            <Badge appearance="outline" size="small">
              max_num_seqs {d.maxNumSeqs}
            </Badge>
          </div>
        ),
      }),
      createTableColumn<DeploymentView>({
        columnId: 'rollout',
        renderHeaderCell: () => 'Rollout',
        renderCell: (d) => (d.rollout.strategy === 'canary' ? `Canary ${d.rollout.canaryPercent}%` : 'Blue-green'),
      }),
      createTableColumn<DeploymentView>({
        columnId: 'metrics',
        renderHeaderCell: () => t('ops.depTable.col.metrics'),
        renderCell: (d) => (
          <span className={s.num}>
            {d.tokPerSec.toLocaleString()} · {Math.round(d.utilization * 100)}% · {d.queueDepth}
          </span>
        ),
      }),
      createTableColumn<DeploymentView>({
        columnId: 'status',
        compare: (a, b) => a.status.localeCompare(b.status),
        renderHeaderCell: () => t('ops.clusterDetail.col.status'),
        renderCell: (d) => (
          <Tooltip content={d.statusMessage ? keyedText(t, d.statusMessage, d.statusMessageKey, d.statusMessageParams) : tl(t, 'DEPLOYMENT_STATUS_LABELS', d.status, DEPLOYMENT_STATUS_LABELS[d.status])} relationship="description">
            <span data-tour={`deployment-status-${d.status}`}>
              <StatusBadge kind={deploymentKind(d.status)} label={tl(t, 'DEPLOYMENT_STATUS_LABELS', d.status, DEPLOYMENT_STATUS_LABELS[d.status])} size="small" />
            </span>
          </Tooltip>
        ),
      }),
      ...(isVendor ? [createTableColumn<DeploymentView>({
        columnId: 'actions',
        renderHeaderCell: () => t('ops.clusterDetail.col.actions'),
        renderCell: (d) => (
          <div style={{ display: 'flex', gap: 4 }}>
            <Tooltip content={canManage ? t('ops.depTable.scaleTip') : t('ops.depTable.needManage')} relationship="label">
              <Button size="small" appearance="subtle" icon={<ArrowMaximizeRegular />} aria-label={t('ops.depTable.scaleAria', { name: d.name })} disabled={!canManage || d.status === 'creating'} onClick={() => setToScale(d)}>
                {t('ops.depTable.scale')}
              </Button>
            </Tooltip>
            <Tooltip content={canManage ? t('ops.depTable.deleteAction') : t('ops.depTable.needManage')} relationship="label">
              <Button size="small" appearance="subtle" icon={<DeleteRegular />} aria-label={t('ops.depTable.deleteAria', { name: d.name })} disabled={!canManage} onClick={() => setToDelete(d)} />
            </Tooltip>
          </div>
        ),
      })] : []),
    ],
    [s, t, canManage, showCluster, isVendor],
  );

  return (
    <>
      <div data-tour="deployments-table">
        <SimpleGrid items={items} columns={columns} getRowId={(d) => d.id} ariaLabel={t('ops.depTable.gridAria')} minWidth={1500} />
      </div>
      <ConfirmDialog open={!!toDelete} title={t('ops.depTable.confirm.title')} destructive confirmLabel={t('common.delete')} busy={busy} onCancel={() => setToDelete(null)} onConfirm={del}>
        {t('ops.depTable.confirm.body', {
          name: toDelete?.name,
          gpus: toDelete ? toDelete.replicas * toDelete.gpusPerReplica : 0,
          dedicated: toDelete?.sharing === 'dedicated' ? t('ops.depTable.confirm.dedicated', { tenant: tenantLabel(t, toDelete.dedicatedTenantId, toDelete.dedicatedTenantName) }) : '',
        })}
      </ConfirmDialog>
      <ScaleDeploymentDialog deployment={toScale} onClose={() => setToScale(null)} onScaled={onChanged} />
    </>
  );
}
