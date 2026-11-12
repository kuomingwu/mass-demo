import { Badge, MessageBar, MessageBarBody, Text, makeStyles, tokens } from '@fluentui/react-components';
import { CheckmarkRegular, DismissRegular, WarningRegular } from '@fluentui/react-icons';
import { ACTION_GROUPS, ACTION_LABELS, ROLES, ROLE_IDS, dangerousComboItems } from '../../auth/roles';
import { keyedText, tf, tl, useT, type TFunction } from '../../i18n';

const useStyles = makeStyles({
  roles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: tokens.spacingHorizontalM, marginBottom: tokens.spacingVerticalL },
  card: { backgroundColor: tokens.colorNeutralBackground1, border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusLarge, padding: tokens.spacingVerticalM, display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalXS },
  wrap: { overflowX: 'auto', backgroundColor: tokens.colorNeutralBackground1, border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium },
  table: { borderCollapse: 'collapse', minWidth: '900px', width: '100%', fontSize: tokens.fontSizeBase200 },
  th: { padding: '8px 10px', borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, textAlign: 'center', fontWeight: tokens.fontWeightSemibold, whiteSpace: 'nowrap', position: 'sticky', top: 0, backgroundColor: tokens.colorNeutralBackground1 },
  thAction: { textAlign: 'left' },
  td: { padding: '6px 10px', borderBottom: `1px solid ${tokens.colorNeutralStroke3}`, textAlign: 'center' },
  tdAction: { textAlign: 'left', whiteSpace: 'nowrap' },
  group: { backgroundColor: tokens.colorNeutralBackground2, textAlign: 'left', padding: '6px 10px', fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground2 },
  yes: { color: tokens.colorStatusSuccessForeground1 },
  no: { color: tokens.colorNeutralForeground4 },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3 },
});

export function RolesTab() {
  const s = useStyles();
  const t = useT();
  return (
    <>
      <MessageBar intent="info" style={{ marginBottom: 12 }}>
        <MessageBarBody>{t('admin.roles.intro')}</MessageBarBody>
      </MessageBar>
      <div className={s.roles}>
        {ROLE_IDS.map((rid) => {
          const r = ROLES[rid];
          const warnings = dangerousComboItems(rid);
          return (
            <section key={rid} className={s.card} aria-labelledby={`role-${rid}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', columnGap: 8 }}>
                <Text weight="semibold" id={`role-${rid}`} as="h3" style={{ margin: 0 }}>
                  {tf(t, `server.role.${rid}.name`, r.name)}
                </Text>
                {r.privileged && <Badge appearance="tint" color="important">{t('admin.roles.privileged')}</Badge>}
              </div>
              <span className={s.mono}>
                {r.id} · {r.nameEn} · {t('admin.roles.actionCount', { n: r.actions.length })}
              </span>
              <Text size={200}>{tf(t, `server.role.${rid}.description`, r.description)}</Text>
              {warnings.map((w) => (
                <MessageBar key={w.key} intent="warning" icon={<WarningRegular />}>
                  <MessageBarBody>{keyedText(t, w.text, w.key, w.params)}</MessageBarBody>
                </MessageBar>
              ))}
            </section>
          );
        })}
      </div>
      <div className={s.wrap}>
        <table className={s.table}>
          <caption style={{ textAlign: 'left', padding: 10, fontWeight: 600 }}>{t('admin.roles.matrixCaption')}</caption>
          <thead>
            <tr>
              <th className={`${s.th} ${s.thAction}`} scope="col">
                {t('common.action')}
              </th>
              {ROLE_IDS.map((rid) => (
                <th key={rid} className={s.th} scope="col">
                  {tf(t, `server.role.${rid}.name`, ROLES[rid].name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ACTION_GROUPS.map((g) => (
              <GroupRows key={g.id} title={tl(t, 'ACTION_GROUPS', g.id, g.title)} actions={g.actions} s={s} t={t} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function GroupRows({ title, actions, s, t }: { title: string; actions: (typeof ACTION_GROUPS)[number]['actions']; s: ReturnType<typeof useStyles>; t: TFunction }) {
  return (
    <>
      <tr>
        <th colSpan={ROLE_IDS.length + 1} scope="colgroup" className={s.group}>
          {title}
        </th>
      </tr>
      {actions.map((a) => (
        <tr key={a}>
          <th scope="row" className={`${s.td} ${s.tdAction}`} style={{ fontWeight: 400 }}>
            <code>{a}</code> <span className={s.mono}>{tl(t, 'ACTION_LABELS', a, ACTION_LABELS[a])}</span>
          </th>
          {ROLE_IDS.map((rid) => {
            const yes = ROLES[rid].actions.includes(a);
            return (
              <td key={rid} className={s.td} aria-label={yes ? t('common.allow') : t('common.deny')}>
                {yes ? <CheckmarkRegular className={s.yes} aria-hidden /> : <DismissRegular className={s.no} aria-hidden />}
                <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{yes ? t('common.allow') : t('common.deny')}</span>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
