import { Badge, Dropdown, Field, Option, Text, makeStyles, tokens } from '@fluentui/react-components';
import { useEffect, useMemo, useState } from 'react';
import { AsyncView } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { useApi } from '../../hooks/useApi';
import { server, type EffectiveAccess } from '../../server/api';
import { useSession } from '../../app/SessionContext';
import { ACTION_GROUPS, ACTION_LABELS, ROLES } from '../../auth/roles';
import type { Principal } from '../../auth/types';
import { keyedText, principalLabel, tf, tl, useT, type TFunction } from '../../i18n';

const useStyles = makeStyles({
  row: { display: 'flex', columnGap: tokens.spacingHorizontalM, rowGap: tokens.spacingVerticalS, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: tokens.spacingVerticalM },
  summary: { display: 'flex', columnGap: tokens.spacingHorizontalM, marginBottom: tokens.spacingVerticalM, flexWrap: 'wrap' },
  wrap: { overflowX: 'auto', backgroundColor: tokens.colorNeutralBackground1, border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium },
  table: { width: '100%', minWidth: '800px', borderCollapse: 'collapse', fontSize: tokens.fontSizeBase200 },
  th: { textAlign: 'left', padding: '8px 10px', borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, fontWeight: tokens.fontWeightSemibold },
  td: { padding: '6px 10px', borderBottom: `1px solid ${tokens.colorNeutralStroke3}`, verticalAlign: 'top' },
  group: { backgroundColor: tokens.colorNeutralBackground2, padding: '6px 10px', fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground2 },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3 },
});

export function EffectiveAccessTab({ scope, refreshKey }: { scope: string; refreshKey: number }) {
  const s = useStyles();
  const t = useT();
  const { session } = useSession();
  const principalsSt = useApi(() => server.listPrincipals(session, scope), [session, scope, refreshKey]);
  const [principalId, setPrincipalId] = useState('');
  useEffect(() => {
    if (principalsSt.data && !principalsSt.data.find((p) => p.id === principalId)) setPrincipalId(principalsSt.data[0]?.id ?? '');
  }, [principalsSt.data, principalId]);
  const effSt = useApi(() => (principalId ? server.getEffectiveAccess(session, principalId, scope) : Promise.resolve({ ok: true as const, data: null, requestId: '' })), [session, principalId, scope, refreshKey]);
  const principals = principalsSt.data ?? [];
  const selected = principals.find((p) => p.id === principalId);
  const allowedCount = useMemo(() => effSt.data?.decisions.filter((d) => d.decision.allowed).length ?? 0, [effSt.data]);

  return (
    <>
      <div className={s.row}>
        <Field label={t('common.principal')} hint={t('admin.effective.principalHint')}>
          <Dropdown value={selected ? principalLabel(t, selected.id, selected.displayName) : ''} selectedOptions={[principalId]} onOptionSelect={(_, d) => d.optionValue && setPrincipalId(d.optionValue)} style={{ minWidth: 280 }} disabled={principals.length === 0}>
            {principals.map((p) => (
              <Option key={p.id} value={p.id} text={principalLabel(t, p.id, p.displayName)}>
                {t('admin.effective.principalOption', { name: principalLabel(t, p.id, p.displayName), type: typeLabel(t, p) })}
              </Option>
            ))}
          </Dropdown>
        </Field>
        <Field label={t('common.scope')}>
          <Text style={{ fontFamily: tokens.fontFamilyMonospace }}>{scope}</Text>
        </Field>
      </div>
      <AsyncView {...principalsSt} actionLabel={t('admin.effective.viewAction')}>
        {() => (
          <AsyncView {...effSt} actionLabel={t('admin.effective.viewAction')}>
            {(eff) =>
              eff ? (
                <>
                  <div className={s.summary}>
                    <Badge appearance="tint" color="success">
                      {t('admin.effective.allowedCount', { n: allowedCount })}
                    </Badge>
                    <Badge appearance="tint" color="subtle">
                      {t('admin.effective.deniedCount', { n: eff.decisions.length - allowedCount })}
                    </Badge>
                    {eff.principal.groupIds.length > 0 && <Badge appearance="outline">{t('admin.effective.groups', { ids: eff.principal.groupIds.join(', ') })}</Badge>}
                    {eff.principal.tenantId && <Badge appearance="outline">{t('admin.effective.tenant', { id: eff.principal.tenantId })}</Badge>}
                  </div>
                  <div className={s.wrap}>
                    <table className={s.table}>
                      <thead>
                        <tr>
                          <th className={s.th} scope="col">{t('common.action')}</th>
                          <th className={s.th} scope="col">{t('admin.effective.col.result')}</th>
                          <th className={s.th} scope="col">{t('admin.assignments.col.source')}</th>
                          <th className={s.th} scope="col">{t('admin.effective.col.reason')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ACTION_GROUPS.map((g) => (
                          <GroupBlock key={g.id} title={tl(t, 'ACTION_GROUPS', g.id, g.title)} actions={g.actions} eff={eff} s={s} t={t} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null
            }
          </AsyncView>
        )}
      </AsyncView>
    </>
  );
}

function typeLabel(t: TFunction, p: Principal) {
  return p.type === 'group' ? t('admin.principalType.group') : p.type === 'servicePrincipal' ? t('admin.principalType.servicePrincipal') : t('admin.principalType.user');
}

type Eff = EffectiveAccess;

function GroupBlock({ title, actions, eff, s, t }: { title: string; actions: (typeof ACTION_GROUPS)[number]['actions']; eff: Eff; s: ReturnType<typeof useStyles>; t: TFunction }) {
  return (
    <>
      <tr>
        <th colSpan={4} scope="colgroup" className={s.group} style={{ textAlign: 'left' }}>
          {title}
        </th>
      </tr>
      {actions.map((a) => {
        const d = eff.decisions.find((x) => x.action === a)!.decision;
        return (
          <tr key={a}>
            <td className={s.td}>
              <code>{a}</code>
              <div className={s.mono}>{tl(t, 'ACTION_LABELS', a, ACTION_LABELS[a])}</div>
            </td>
            <td className={s.td}>{d.allowed ? <StatusBadge kind="success" label={t('common.allow')} size="small" /> : <StatusBadge kind="danger" label={t('common.deny')} size="small" />}</td>
            <td className={s.td}>{d.source === 'direct' ? <Badge appearance="outline" color="brand">{t('admin.effective.direct')}</Badge> : d.source === 'inherited' ? <Badge appearance="outline" color="informative">{t('admin.assignments.col.inherit')}</Badge> : <Badge appearance="outline" color="subtle">{t('admin.effective.defaultDeny')}</Badge>}</td>
            <td className={s.td}>
              {keyedText(t, d.reason, d.reasonKey, d.reasonParams)}
              {d.assignmentId && (
                <div className={s.mono}>
                  {t('admin.effective.grant', { id: d.assignmentId, role: d.roleId ? tf(t, `server.role.${d.roleId}.name`, ROLES[d.roleId].name) : '', scope: d.grantedAtScope ?? '' })}
                </div>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}
