import { Badge, Button, Link, Text, Tooltip, createTableColumn, makeStyles, tokens, type TableColumnDefinition } from '@fluentui/react-components';
import { DeleteRegular, PeopleRegular, PersonRegular, BotRegular } from '@fluentui/react-icons';
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
import { scopeDisplayName, scopeShortName } from '../../components/ScopePicker';

const useStyles = makeStyles({
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
  principal: { display: 'flex', alignItems: 'center', columnGap: tokens.spacingHorizontalS },
});

const TYPE_KEY = { user: 'admin.principalType.user', group: 'admin.principalType.group', servicePrincipal: 'admin.principalType.servicePrincipal' } as const;

export function AssignmentsTab({ scope, refreshKey, onChanged }: { scope: string; refreshKey: number; onChanged: () => void }) {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const roleName = (a: AssignmentView) => tf(t, `server.role.${a.roleId}.name`, a.roleName);
  const { session, canUi, bump } = useSession();
  const notify = useNotify();
  const st = useApi(() => server.listRoleAssignments(session, scope), [session, scope, refreshKey]);
  const [toDelete, setToDelete] = useState<AssignmentView | null>(null);
  const [busy, setBusy] = useState(false);

  const columns: TableColumnDefinition<AssignmentView>[] = useMemo(
    () => [
      createTableColumn<AssignmentView>({
        columnId: 'principal',
        compare: (a, b) => a.principalName.localeCompare(b.principalName),
        renderHeaderCell: () => t('common.principal'),
        renderCell: (a) => (
          <div className={s.principal}>
            {a.principalType === 'group' ? <PeopleRegular aria-hidden /> : a.principalType === 'servicePrincipal' ? <BotRegular aria-hidden /> : <PersonRegular aria-hidden />}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <Text weight="semibold">{principalLabel(t, a.principalId, a.principalName)}</Text>
              <span className={s.mono}>{a.principalId}</span>
            </div>
          </div>
        ),
      }),
      createTableColumn<AssignmentView>({ columnId: 'type', renderHeaderCell: () => t('admin.assignments.col.type'), renderCell: (a) => t(TYPE_KEY[a.principalType]) }),
      createTableColumn<AssignmentView>({ columnId: 'role', compare: (a, b) => a.roleName.localeCompare(b.roleName), renderHeaderCell: () => t('common.role'), renderCell: (a) => <Badge appearance="tint" color={a.roleId === 'platform-owner' || a.roleId === 'tenant-admin' ? 'important' : 'brand'}>{roleName(a)}</Badge> }),
      createTableColumn<AssignmentView>({
        columnId: 'scope',
        compare: (a, b) => a.scope.localeCompare(b.scope),
        renderHeaderCell: () => t('common.scope'),
        renderCell: (a) => (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span>{scopeDisplayName(a.scope, t)}</span>
            <span className={s.mono}>{a.scope}</span>
          </div>
        ),
      }),
      createTableColumn<AssignmentView>({
        columnId: 'inherit',
        compare: (a, b) => Number(a.inherited) - Number(b.inherited),
        renderHeaderCell: () => t('admin.assignments.col.inherit'),
        renderCell: (a) =>
          a.inherited ? (
            <Tooltip content={t('admin.assignments.inheritedTip', { scope: a.scope })} relationship="description">
              <Badge appearance="outline" color="informative">{t('admin.assignments.inheritedFrom', { scope: scopeShortName(a.scope, t) })}</Badge>
            </Tooltip>
          ) : (
            <Badge appearance="outline" color="subtle">{t('admin.assignments.thisScope')}</Badge>
          ),
      }),
      createTableColumn<AssignmentView>({ columnId: 'source', renderHeaderCell: () => t('admin.assignments.col.source'), renderCell: (a) => <Text size={200}>{principalLabel(t, a.createdBy, a.createdByName)} · {L.fmtDate(a.createdAt)}</Text> }),
      createTableColumn<AssignmentView>({ columnId: 'status', compare: (a, b) => a.status.localeCompare(b.status), renderHeaderCell: () => t('common.status'), renderCell: (a) => <AssignmentStatusBadge status={a.status} /> }),
      createTableColumn<AssignmentView>({
        columnId: 'actions',
        renderHeaderCell: () => t('admin.col.actions'),
        renderCell: (a) => {
          if (a.inherited) {
            return (
              <Link as="a" href={`#/iam?scope=${encodeURIComponent(a.scope)}`} style={{ fontSize: 12 }}>
                {t('admin.assignments.goSource')}
              </Link>
            );
          }
          const can = canUi('iam.assign', a.scope);
          return (
            <Tooltip content={can ? t('admin.assignments.removeTip') : t('admin.assignments.needAssign')} relationship="label">
              <Button size="small" appearance="subtle" icon={<DeleteRegular />} aria-label={t('admin.assignments.removeAria', { principal: principalLabel(t, a.principalId, a.principalName), role: roleName(a) })} disabled={!can} onClick={() => setToDelete(a)}>
                {t('admin.assignments.remove')}
              </Button>
            </Tooltip>
          );
        },
      }),
    ],
    [s, canUi, t, L],
  );

  const doDelete = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      const res = await server.deleteRoleAssignment(session, toDelete.id, scope);
      if (res.ok) {
        notify.success(t('admin.assignments.removedToast'), `requestId: ${res.requestId}`);
        bump();
        onChanged();
      } else notify.apiError(res, t('admin.assignments.removeContext'));
    } catch (e) {
      notify.apiError(e as Error, t('admin.assignments.removeContext'));
    } finally {
      setBusy(false);
      setToDelete(null);
    }
  };

  return (
    <>
      <AsyncView {...st} actionLabel={t('admin.assignments.viewAction')} isEmpty={(d) => d.length === 0} empty={<EmptyState title={t('admin.assignments.emptyTitle')} description={t('admin.assignments.emptyDesc')} />}>
        {(rows) => <SimpleGrid items={rows} columns={columns} getRowId={(a) => a.id} ariaLabel={t('admin.iam.tab.assignments')} minWidth={1200} />}
      </AsyncView>
      <ConfirmDialog open={!!toDelete} title={t('admin.assignments.removeConfirmTitle')} destructive confirmLabel={t('admin.assignments.remove')} busy={busy} onCancel={() => setToDelete(null)} onConfirm={doDelete}>
        {t('admin.assignments.removeConfirmBody', { principal: toDelete ? principalLabel(t, toDelete.principalId, toDelete.principalName) : '', scope: toDelete?.scope ?? '', role: toDelete ? roleName(toDelete) : '' })}
      </ConfirmDialog>
    </>
  );
}
