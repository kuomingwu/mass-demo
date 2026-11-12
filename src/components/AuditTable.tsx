import { Button, Dropdown, Field, Input, Option, Text, makeStyles, tokens } from '@fluentui/react-components';
import { ChevronDownRegular, ChevronLeftRegular, ChevronRightRegular, ChevronUpRegular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';
import type { AuditEvent } from '../server/audit';
import { DecisionBadge } from './StatusBadge';
import { keyedText, principalLabel, useLocale, useT } from '../i18n';
import { ALL_ACTIONS } from '../auth/types';

const useStyles = makeStyles({
  filters: { display: 'flex', flexWrap: 'wrap', columnGap: tokens.spacingHorizontalM, rowGap: tokens.spacingVerticalS, alignItems: 'flex-end', marginBottom: tokens.spacingVerticalM },
  wrap: { overflowX: 'auto', backgroundColor: tokens.colorNeutralBackground1, border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium },
  table: { width: '100%', minWidth: '1000px', borderCollapse: 'collapse', fontSize: tokens.fontSizeBase200 },
  th: { textAlign: 'left', padding: '8px 10px', borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, color: tokens.colorNeutralForeground2, fontWeight: tokens.fontWeightSemibold, whiteSpace: 'nowrap', position: 'sticky', top: 0, backgroundColor: tokens.colorNeutralBackground1 },
  td: { padding: '8px 10px', borderBottom: `1px solid ${tokens.colorNeutralStroke3}`, verticalAlign: 'top' },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase100, wordBreak: 'break-all' },
  diff: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: tokens.spacingHorizontalS, padding: tokens.spacingVerticalS, backgroundColor: tokens.colorNeutralBackground2 },
  pre: { margin: 0, fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase100, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: '240px', overflow: 'auto' },
  pager: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', columnGap: tokens.spacingHorizontalS, padding: tokens.spacingVerticalS },
  retention: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, marginTop: tokens.spacingVerticalS },
});

export interface AuditFilters {
  decision: '' | 'allow' | 'deny';
  action: string;
  text: string;
}

export function AuditFilterBar({ value, onChange }: { value: AuditFilters; onChange: (f: AuditFilters) => void }) {
  const s = useStyles();
  const t = useT();
  return (
    <div className={s.filters} role="group" aria-label={t('admin.auditTable.filtersAria')}>
      <Field label={t('common.decision')}>
        <Dropdown value={value.decision === '' ? t('common.all') : value.decision === 'allow' ? t('common.allow') : t('common.deny')} selectedOptions={[value.decision || '*']} onOptionSelect={(_, d) => onChange({ ...value, decision: d.optionValue === '*' ? '' : (d.optionValue as 'allow' | 'deny') })} style={{ minWidth: 120 }}>
          <Option value="*" text={t('common.all')}>{t('common.all')}</Option>
          <Option value="allow" text={t('common.allow')}>{t('common.allow')}</Option>
          <Option value="deny" text={t('common.deny')}>{t('common.deny')}</Option>
        </Dropdown>
      </Field>
      <Field label={t('common.action')}>
        <Dropdown value={value.action || t('common.all')} selectedOptions={[value.action || '*']} onOptionSelect={(_, d) => onChange({ ...value, action: d.optionValue === '*' ? '' : d.optionValue ?? '' })} style={{ minWidth: 180 }}>
          <Option value="*" text={t('common.all')}>{t('common.all')}</Option>
          {ALL_ACTIONS.map((a) => (
            <Option key={a} value={a}>
              {a}
            </Option>
          ))}
        </Dropdown>
      </Field>
      <Field label={t('admin.auditTable.keyword')} hint={t('admin.auditTable.keywordHint')}>
        <Input value={value.text} onChange={(_, d) => onChange({ ...value, text: d.value })} placeholder={t('common.search')} style={{ minWidth: 220 }} />
      </Field>
    </div>
  );
}

export function AuditTable({ events, pageSize = 15 }: { events: AuditEvent[]; pageSize?: number }) {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const pages = Math.max(1, Math.ceil(events.length / pageSize));
  const current = Math.min(page, pages - 1);
  const slice = useMemo(() => events.slice(current * pageSize, (current + 1) * pageSize), [events, current, pageSize]);
  return (
    <>
      <div className={s.wrap}>
        <table className={s.table}>
          <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{t('admin.audit.title')}</caption>
          <thead>
            <tr>
              <th className={s.th} scope="col">{t('common.time')}</th>
              <th className={s.th} scope="col">{t('admin.auditTable.col.actor')}</th>
              <th className={s.th} scope="col">{t('admin.auditTable.col.target')}</th>
              <th className={s.th} scope="col">{t('common.action')}</th>
              <th className={s.th} scope="col">{t('common.scope')}</th>
              <th className={s.th} scope="col">{t('common.decision')}</th>
              <th className={s.th} scope="col">requestId</th>
              <th className={s.th} scope="col">{t('common.details')}</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((e) => {
              const hasDiff = e.before !== undefined || e.after !== undefined;
              const expanded = open === e.id;
              return (
                <RowGroup key={e.id}>
                  <tr>
                    <td className={s.td} style={{ whiteSpace: 'nowrap' }}>{L.fmtDateTime(e.timestamp)}</td>
                    <td className={s.td}>{principalLabel(t, e.actorId, e.actorName)}</td>
                    <td className={s.td}>{e.principalId === e.actorId ? <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>{t('admin.auditTable.sameActor')}</Text> : principalLabel(t, e.principalId, e.principalName)}</td>
                    <td className={s.td}><code>{e.action}</code></td>
                    <td className={s.td}><code className={s.mono}>{e.scope}</code></td>
                    <td className={s.td}><DecisionBadge decision={e.decision} /></td>
                    <td className={s.td}><code className={s.mono}>{e.requestId}</code></td>
                    <td className={s.td}>
                      {(hasDiff || e.reason) && (
                        <Button size="small" appearance="subtle" icon={expanded ? <ChevronUpRegular /> : <ChevronDownRegular />} aria-expanded={expanded} aria-controls={`audit-detail-${e.id}`} onClick={() => setOpen(expanded ? null : e.id)}>
                          {expanded ? t('common.collapse') : t('common.expand')}
                        </Button>
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr id={`audit-detail-${e.id}`}>
                      <td className={s.td} colSpan={8} style={{ padding: 0 }}>
                        <div style={{ padding: 10 }}>
                          {e.reason && (
                            <Text size={200}>
                              {t('admin.auditTable.reason', { reason: keyedText(t, e.reason, e.reasonKey, e.reasonParams) })}
                            </Text>
                          )}
                          {hasDiff && (
                            <div className={s.diff}>
                              <div>
                                <Text size={200} weight="semibold">{t('admin.auditTable.before')}</Text>
                                <pre className={s.pre}>{e.before === undefined ? '—' : JSON.stringify(e.before, null, 2)}</pre>
                              </div>
                              <div>
                                <Text size={200} weight="semibold">{t('admin.auditTable.after')}</Text>
                                <pre className={s.pre}>{e.after === undefined ? '—' : JSON.stringify(e.after, null, 2)}</pre>
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </RowGroup>
              );
            })}
          </tbody>
        </table>
        <div className={s.pager}>
          <Text size={200}>
            {t('common.pageOf', { total: events.length, page: current + 1, pages })}
          </Text>
          <Button size="small" icon={<ChevronLeftRegular />} aria-label={t('common.prevPage')} disabled={current === 0} onClick={() => setPage(current - 1)} />
          <Button size="small" icon={<ChevronRightRegular />} aria-label={t('common.nextPage')} disabled={current >= pages - 1} onClick={() => setPage(current + 1)} />
        </div>
      </div>
      <Text className={s.retention} as="p">
        {t('admin.auditTable.retention')}
      </Text>
    </>
  );
}

function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
