import { Badge, Button, MessageBar, MessageBarBody, Text, Tooltip, createTableColumn, makeStyles, tokens, type TableColumnDefinition } from '@fluentui/react-components';
import { CheckmarkRegular, DismissRegular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';
import { AsyncView, EmptyState } from '../../components/States';
import { AssignmentStatusBadge } from '../../components/StatusBadge';
import { SimpleGrid } from '../../components/SimpleGrid';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useNotify } from '../../components/Notify';
import { useApi } from '../../hooks/useApi';
import { principalLabel, tf, useLocale, useT } from '../../i18n';
import { server, type AssignmentView } from '../../server/api';
import { useSession } from '../../app/SessionContext';
import { scopeDisplayName } from '../../components/ScopePicker';

const useStyles = makeStyles({
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
});

export function RequestsTab({ scope, refreshKey, onChanged }: { scope: string; refreshKey: number; onChanged: () => void }) {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const roleName = (a: AssignmentView) => tf(t, `server.role.${a.roleId}.name`, a.roleName);
  const { session, canUi, principal, bump } = useSession();
  const notify = useNotify();
  const st = useApi(() => server.listPendingRequests(session, scope), [session, scope, refreshKey]);
  const [confirm, setConfirm] = useState<{ a: AssignmentView; verb: 'approve' | 'reject' } | null>(null);
  const [busy, setBusy] = useState(false);

  const columns: TableColumnDefinition<AssignmentView>[] = useMemo(
    () => [
      createTableColumn<AssignmentView>({ columnId: 'id', renderHeaderCell: () => t('admin.requests.col.id'), renderCell: (a) => <code className={s.mono}>{a.id}</code> }),
      createTableColumn<AssignmentView>({ columnId: 'principal', renderHeaderCell: () => t('admin.requests.col.beneficiary'), renderCell: (a) => <Text weight="semibold">{principalLabel(t, a.principalId, a.principalName)}</Text> }),
      createTableColumn<AssignmentView>({ columnId: 'role', renderHeaderCell: () => t('common.role'), renderCell: (a) => <Badge appearance="tint" color="important">{roleName(a)}</Badge> }),
      createTableColumn<AssignmentView>({ columnId: 'scope', renderHeaderCell: () => t('common.scope'), renderCell: (a) => <span>{scopeDisplayName(a.scope, t)}<div className={s.mono}>{a.scope}</div></span> }),
      createTableColumn<AssignmentView>({ columnId: 'requester', renderHeaderCell: () => t('admin.requests.col.requester'), renderCell: (a) => <span>{principalLabel(t, a.createdBy, a.createdByName)}<div className={s.mono}>{L.fmtDateTime(a.createdAt)}</div></span> }),
      createTableColumn<AssignmentView>({ columnId: 'just', renderHeaderCell: () => t('admin.requests.col.justification'), renderCell: (a) => <Text size={200}>{a.justification ? tf(t, `server.assignment.${a.id}.justification`, a.justification) : '—'}</Text> }),
      createTableColumn<AssignmentView>({ columnId: 'status', renderHeaderCell: () => t('common.status'), renderCell: (a) => <AssignmentStatusBadge status={a.status} /> }),
      createTableColumn<AssignmentView>({
        columnId: 'actions',
        renderHeaderCell: () => t('admin.col.actions'),
        renderCell: (a) => {
          if (a.status !== 'pending') return <Text size={200}>{a.approvedBy ? t('admin.requests.handledBy', { name: a.approvedBy }) : '—'}</Text>;
          const canApprove = canUi('iam.approve', a.scope);
          const isSelf = a.createdBy === principal?.id || a.principalId === principal?.id;
          const reason = !canApprove ? t('admin.requests.needApprove') : isSelf ? t('admin.requests.sod') : '';
          return (
            <div style={{ display: 'flex', gap: 4 }}>
              <Tooltip content={reason || t('common.approve')} relationship="label">
                <Button size="small" appearance="primary" icon={<CheckmarkRegular />} disabled={!canApprove || isSelf} onClick={() => setConfirm({ a, verb: 'approve' })} aria-label={t('admin.requests.approveAria', { id: a.id })}>
                  {t('common.approve')}
                </Button>
              </Tooltip>
              <Tooltip content={reason || t('common.reject')} relationship="label">
                <Button size="small" icon={<DismissRegular />} disabled={!canApprove || isSelf} onClick={() => setConfirm({ a, verb: 'reject' })} aria-label={t('admin.requests.rejectAria', { id: a.id })}>
                  {t('common.reject')}
                </Button>
              </Tooltip>
            </div>
          );
        },
      }),
    ],
    [s, canUi, principal, t, L],
  );

  const run = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const res = confirm.verb === 'approve' ? await server.approveRequest(session, confirm.a.id) : await server.rejectRequest(session, confirm.a.id);
      if (res.ok) {
        notify.success(confirm.verb === 'approve' ? t('admin.requests.approvedToast') : t('admin.requests.rejectedToast'), `requestId: ${res.requestId}`);
        bump();
        onChanged();
      } else notify.apiError(res, confirm.verb === 'approve' ? t('common.approve') : t('common.reject'));
    } catch (e) {
      notify.apiError(e as Error, t('admin.requests.handleContext'));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <>
      <MessageBar intent="info" style={{ marginBottom: 12 }}>
        <MessageBarBody>{t('admin.requests.introBefore')}<strong>{t('admin.requests.introStrong')}</strong>{t('admin.requests.introAfter')}</MessageBarBody>
      </MessageBar>
      <AsyncView {...st} actionLabel={t('admin.requests.viewAction')} isEmpty={(d) => d.length === 0} empty={<EmptyState title={t('admin.requests.emptyTitle')} description={t('admin.requests.emptyDesc')} />}>
        {(rows) => <SimpleGrid items={rows} columns={columns} getRowId={(a) => a.id} ariaLabel={t('admin.iam.tab.requests')} minWidth={1100} />}
      </AsyncView>
      <ConfirmDialog open={!!confirm} title={confirm?.verb === 'approve' ? t('admin.requests.approveConfirmTitle') : t('admin.requests.rejectConfirmTitle')} destructive={confirm?.verb === 'reject'} confirmLabel={confirm?.verb === 'approve' ? t('common.approve') : t('common.reject')} busy={busy} onCancel={() => setConfirm(null)} onConfirm={run}>
        {confirm?.verb === 'approve'
          ? t('admin.requests.approveConfirmBody', { principal: principalLabel(t, confirm.a.principalId, confirm.a.principalName), scope: confirm.a.scope, role: roleName(confirm.a) })
          : t('admin.requests.rejectConfirmBody', { principal: confirm ? principalLabel(t, confirm.a.principalId, confirm.a.principalName) : '' })}
      </ConfirmDialog>
    </>
  );
}
