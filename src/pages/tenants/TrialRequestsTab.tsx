import { Badge, Button, DrawerBody, DrawerHeader, DrawerHeaderTitle, Field, MessageBar, MessageBarBody, MessageBarTitle, OverlayDrawer, Text, Textarea, createTableColumn, makeStyles, tokens, type TableColumnDefinition } from '@fluentui/react-components';
import { CheckmarkCircleRegular, DismissCircleRegular, DismissRegular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AsyncView, EmptyState, PermissionDenied } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { SimpleGrid } from '../../components/SimpleGrid';
import { useCloseOnTourFinish } from '../../components/OnboardingTour';
import { useNotify } from '../../components/Notify';
import { useApi } from '../../hooks/useApi';
import { server, TRIAL_INVOICE_LABELS, TRIAL_ROUTING_LABELS, TRIAL_SCENARIO_LABELS, TRIAL_STATUS_LABELS, TRIAL_TERMS, TRIAL_USE_CASE_LABELS, type ApiError, type TrialApproveResult, type TrialRequest } from '../../server/api';
import { useSession } from '../../app/SessionContext';
import { PLATFORM_SCOPE } from '../../auth/scope';
import { MODEL_BY_ID, isLocalModel } from '../../data/models';
import { apiMessage, keyedText, tf, tl, useLocale, useT, type TFunction } from '../../i18n';

const useStyles = makeStyles({
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
  dl: { display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: tokens.spacingHorizontalM, rowGap: tokens.spacingVerticalXS, margin: 0, fontSize: tokens.fontSizeBase300 },
  dt: { color: tokens.colorNeutralForeground3 },
  dd: { margin: 0, overflowWrap: 'anywhere' },
  section: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalS, marginTop: tokens.spacingVerticalM },
  h3: { fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold, margin: 0 },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: tokens.fontSizeBase200 },
  th: { textAlign: 'left', padding: '4px 6px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tokens.colorNeutralStroke2, color: tokens.colorNeutralForeground3 },
  td: { padding: '4px 6px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tokens.colorNeutralStroke2, fontVariantNumeric: 'tabular-nums' },
  actions: { display: 'flex', columnGap: tokens.spacingHorizontalS, flexWrap: 'wrap', alignItems: 'center' },
});

type SeedField = 'company' | 'companyShort' | 'contactName' | 'otherNeeds' | 'reviewNote';
/** 種子試用申請的文字欄位（server.seedTrial.<id>.<field>）；使用者送出的申請原樣顯示 */
function seedText(t: TFunction, r: TrialRequest, field: SeedField): string {
  return tf(t, `server.seedTrial.${r.id}.${field}`, r[field] ?? '');
}

function statusKind(s: TrialRequest['status']): 'warning' | 'success' | 'danger' {
  return s === 'pending' ? 'warning' : s === 'approved' ? 'success' : 'danger';
}

function statusLabel(t: TFunction, s: TrialRequest['status']): string {
  return tl(t, 'TRIAL_STATUS_LABELS', s, TRIAL_STATUS_LABELS[s]);
}

/** 租戶頁「試用申請」分頁：平台角色（trial.review）審核公開表單送出的申請；核准即建立試用租戶 */
export function TrialRequestsTab() {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const { session, canUi } = useSession();
  const navigate = useNavigate();
  const canReview = canUi('trial.review', PLATFORM_SCOPE);
  const st = useApi(() => server.listTrialRequests(session), [session]);
  const [selected, setSelected] = useState<TrialRequest | null>(null);
  const columns: TableColumnDefinition<TrialRequest>[] = useMemo(
    () => [
      createTableColumn<TrialRequest>({
        columnId: 'company',
        compare: (a, b) => a.company.localeCompare(b.company),
        renderHeaderCell: () => t('hub.trq.col.company'),
        renderCell: (r) => (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Text weight="semibold">
              {seedText(t, r, 'company')}
              {r.companyShort ? t('hub.trq.paren', { v: seedText(t, r, 'companyShort') }) : ''}
            </Text>
            <span className={s.mono}>{r.accountName}</span>
          </div>
        ),
      }),
      createTableColumn<TrialRequest>({ columnId: 'contact', renderHeaderCell: () => t('hub.trq.col.contact'), renderCell: (r) => (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span>{seedText(t, r, 'contactName')}</span>
          <span className={s.mono}>{r.email}</span>
        </div>
      ) }),
      createTableColumn<TrialRequest>({ columnId: 'models', renderHeaderCell: () => t('hub.trq.col.models'), renderCell: (r) => (
        <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
          {r.models.map((m) => (
            <Badge key={m.modelId} size="small" appearance={MODEL_BY_ID[m.modelId] && isLocalModel(MODEL_BY_ID[m.modelId]) ? 'tint' : 'outline'} color={MODEL_BY_ID[m.modelId] && isLocalModel(MODEL_BY_ID[m.modelId]) ? 'brand' : 'informative'}>
              {m.modelId}
            </Badge>
          ))}
        </span>
      ) }),
      createTableColumn<TrialRequest>({ columnId: 'policy', renderHeaderCell: () => t('hub.trq.col.policy'), renderCell: (r) => (
        <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
          {r.publicSector && <Badge size="small" appearance="tint" color="danger">{t('hub.trq.publicSector')}</Badge>}
          {r.dataResidencyTw && <Badge size="small" appearance="tint" color="warning">{t('hub.trq.residency')}</Badge>}
          <Badge size="small" appearance="outline">{tl(t, 'TRIAL_INVOICE_LABELS', r.invoice, TRIAL_INVOICE_LABELS[r.invoice])}</Badge>
        </span>
      ) }),
      createTableColumn<TrialRequest>({ columnId: 'submitted', compare: (a, b) => a.submittedAt.localeCompare(b.submittedAt), renderHeaderCell: () => t('hub.trq.col.submitted'), renderCell: (r) => L.fmtDateTime(r.submittedAt) }),
      createTableColumn<TrialRequest>({
        columnId: 'status',
        compare: (a, b) => a.status.localeCompare(b.status),
        renderHeaderCell: () => t('hub.trq.col.status'),
        renderCell: (r) => (
          <div style={{ display: 'flex', flexDirection: 'column', rowGap: 2 }}>
            <StatusBadge kind={statusKind(r.status)} label={statusLabel(t, r.status)} size="small" />
            {r.tenantId && <span className={s.mono}>{r.tenantId}</span>}
          </div>
        ),
      }),
    ],
    [s, t, L],
  );

  if (!canReview) return <PermissionDenied inline actionLabel={t('hub.trq.reviewAction')} />;
  return (
    <>
      <Text size={200} style={{ color: tokens.colorNeutralForeground3, display: 'block', marginBottom: 8 }}>
        {t('hub.trq.intro', { usd: TRIAL_TERMS.freeCreditUsd, days: TRIAL_TERMS.periodBusinessDays })}
      </Text>
      <AsyncView {...st} actionLabel={t('hub.trq.viewAction')} isEmpty={(d) => d.length === 0} empty={<EmptyState title={t('hub.trq.emptyTitle')} description={t('hub.trq.emptyDescription')} action={<Button onClick={() => navigate('/hub/trial')}>{t('hub.trq.goToForm')}</Button>} />}>
        {(items) => (
          <div data-tour="trials-table">
            <SimpleGrid items={items} columns={columns} getRowId={(r) => r.id} ariaLabel={t('hub.trq.gridAria')} onRowClick={setSelected} minWidth={1100} />
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {t('hub.trq.counts', { pending: items.filter((r) => r.status === 'pending').length, approved: items.filter((r) => r.status === 'approved').length, rejected: items.filter((r) => r.status === 'rejected').length })}
            </Text>
          </div>
        )}
      </AsyncView>
      <TrialDetailDrawer request={selected} onClose={() => setSelected(null)} onChanged={() => st.reload()} />
    </>
  );
}

function TrialDetailDrawer({ request, onClose, onChanged }: { request: TrialRequest | null; onClose: () => void; onChanged: () => void }) {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const { session, bump } = useSession();
  const notify = useNotify();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<ApiError | null>(null);
  const [result, setResult] = useState<TrialApproveResult | null>(null);
  const open = !!request;
  useCloseOnTourFinish(open, onClose);
  if (!request) return null;
  const r = result?.request ?? request;
  const approve = async () => {
    setBusy(true);
    setErr(null);
    const res = await server.approveTrialRequest(session, request.id);
    setBusy(false);
    if (!res.ok) {
      setErr(res);
      return;
    }
    setResult(res.data);
    bump();
    onChanged();
    notify.success(t('hub.trq.toast.approved'), t('hub.trq.toast.approvedBody', { name: res.data.tenant.name, id: res.data.tenant.id, requestId: res.requestId }));
  };
  const reject = async () => {
    setBusy(true);
    setErr(null);
    const res = await server.rejectTrialRequest(session, request.id, reason);
    setBusy(false);
    if (!res.ok) {
      setErr(res);
      return;
    }
    onChanged();
    notify.success(t('hub.trq.toast.rejected'), `requestId ${res.requestId}`);
    onClose();
  };
  const localTag = (id: string) => (MODEL_BY_ID[id] ? ` · ${isLocalModel(MODEL_BY_ID[id]) ? t('hub.trq.local') : t('hub.trq.proxied')}` : '');
  return (
    <OverlayDrawer open={open} position="end" size="large" onOpenChange={(_, d) => !d.open && onClose()} aria-label={t('hub.trq.drawerTitle', { company: seedText(t, request, 'company') })}>
      <DrawerHeader>
        <DrawerHeaderTitle action={<Button appearance="subtle" aria-label={t('common.close')} icon={<DismissRegular />} onClick={onClose} />}>{t('hub.trq.drawerTitle', { company: seedText(t, request, 'company') })}</DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody data-tour="trial-detail">
        <div className={s.actions}>
          <StatusBadge kind={statusKind(r.status)} label={statusLabel(t, r.status)} />
          <span className={s.mono}>{request.id}</span>
          <span className={s.mono}>{t('hub.trq.submittedAt', { time: L.fmtDateTime(request.submittedAt) })}</span>
        </div>
        {result && (
          <MessageBar intent="success" layout="multiline" style={{ marginTop: 12 }} data-tour="trial-approved">
            <MessageBarBody>
              <MessageBarTitle>{t('hub.trq.approvedTitle', { name: result.tenant.name })}</MessageBarTitle>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {result.nextSteps.map((n, i) => (
                  <li key={i}>{keyedText(t, n, result.nextStepKeys?.[i]?.key, result.nextStepKeys?.[i]?.params)}</li>
                ))}
              </ul>
              <div className={s.actions} style={{ marginTop: 8 }}>
                <Button size="small" appearance="primary" onClick={() => navigate(`/tenants/${result.tenant.id}`)} data-tour="trial-view-tenant">
                  {t('hub.trq.viewTenant')}
                </Button>
                <Button size="small" onClick={() => navigate('/iam')}>
                  {t('hub.trq.assignAdmin')}
                </Button>
              </div>
            </MessageBarBody>
          </MessageBar>
        )}
        {err && (
          <MessageBar intent="error" role="alert" style={{ marginTop: 12 }}>
            <MessageBarBody>
              <MessageBarTitle>
                {err.status} {err.code}
              </MessageBarTitle>
              {apiMessage(t, err)} requestId: {err.requestId}
            </MessageBarBody>
          </MessageBar>
        )}
        <div className={s.section}>
          <h3 className={s.h3}>{t('hub.trq.s1')}</h3>
          <dl className={s.dl}>
            <dt className={s.dt}>{t('hub.trq.account')}</dt>
            <dd className={s.dd}>
              <code>{request.accountName}</code>
            </dd>
            <dt className={s.dt}>{t('hub.trq.ipAllowlist')}</dt>
            <dd className={s.dd}>{request.ipAllowlist ? t('hub.trq.needed') : t('hub.trq.notNeeded')}</dd>
            <dt className={s.dt}>{t('hub.trq.creditPeriod')}</dt>
            <dd className={s.dd}>
              {t('hub.trq.creditPeriodValue', { usd: request.freeCreditUsd, days: TRIAL_TERMS.periodBusinessDays })}
              {r.trialEndsAt ? t('hub.trq.until', { date: r.trialEndsAt.slice(0, 10) }) : ''}
            </dd>
          </dl>
        </div>
        <div className={s.section}>
          <h3 className={s.h3}>{t('hub.trq.s2')}</h3>
          <table className={s.table}>
            <thead>
              <tr>
                <th className={s.th}>{t('common.model')}</th>
                <th className={s.th}>RPM</th>
                <th className={s.th}>TPM</th>
                <th className={s.th}>TTFT &lt; ms</th>
                <th className={s.th}>{t('hub.trq.cacheHit')}</th>
              </tr>
            </thead>
            <tbody>
              {request.models.map((m, i) => (
                <tr key={i}>
                  <td className={s.td}>
                    {m.modelId}
                    {localTag(m.modelId)}
                  </td>
                  <td className={s.td}>{L.fmtNumber(m.rpm)}</td>
                  <td className={s.td}>{L.fmtNumber(m.tpm)}</td>
                  <td className={s.td}>{m.ttftMs}</td>
                  <td className={s.td}>{m.cacheHitPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={s.section}>
          <h3 className={s.h3}>{t('hub.trq.s3')}</h3>
          <dl className={s.dl}>
            <dt className={s.dt}>{t('hub.trq.scenarios')}</dt>
            <dd className={s.dd}>{request.scenarios.map((x) => tl(t, 'TRIAL_SCENARIO_LABELS', x, TRIAL_SCENARIO_LABELS[x])).join(t('hub.sep.list'))}</dd>
            <dt className={s.dt}>{t('hub.trq.useCase')}</dt>
            <dd className={s.dd}>
              {tl(t, 'TRIAL_USE_CASE_LABELS', request.useCase, TRIAL_USE_CASE_LABELS[request.useCase])}
              {request.useCaseOther ? t('hub.trq.colonValue', { v: request.useCaseOther }) : ''}
            </dd>
            <dt className={s.dt}>{t('hub.trq.routing')}</dt>
            <dd className={s.dd}>{tl(t, 'TRIAL_ROUTING_LABELS', request.routing, TRIAL_ROUTING_LABELS[request.routing])}</dd>
            <dt className={s.dt}>{t('hub.trq.monthlyTokens')}</dt>
            <dd className={s.dd}>{t('hub.trq.monthlyTokensValue', { input: L.fmtNumber(request.monthlyInputTokens), output: L.fmtNumber(request.monthlyOutputTokens), peak: request.peakConcurrency })}</dd>
            <dt className={s.dt}>{t('hub.trq.residencyLabel')}</dt>
            <dd className={s.dd}>{request.dataResidencyTw ? t('hub.trq.residencyYes') : t('hub.trq.residencyNo')}</dd>
            <dt className={s.dt}>{t('hub.trq.publicSector')}</dt>
            <dd className={s.dd}>{request.publicSector ? t('hub.trq.publicYes') : t('common.no')}</dd>
            <dt className={s.dt}>{t('hub.trq.invoice')}</dt>
            <dd className={s.dd}>{tl(t, 'TRIAL_INVOICE_LABELS', request.invoice, TRIAL_INVOICE_LABELS[request.invoice])}</dd>
          </dl>
        </div>
        <div className={s.section}>
          <h3 className={s.h3}>{t('hub.trq.s4')}</h3>
          <Text size={300}>{request.otherNeeds ? seedText(t, request, 'otherNeeds') : '—'}</Text>
        </div>
        <div className={s.section}>
          <h3 className={s.h3}>{t('hub.trq.s5')}</h3>
          <dl className={s.dl}>
            <dt className={s.dt}>{t('hub.trq.company')}</dt>
            <dd className={s.dd}>
              {seedText(t, request, 'company')}
              {request.companyShort ? t('hub.trq.paren', { v: seedText(t, request, 'companyShort') }) : ''}
            </dd>
            <dt className={s.dt}>{t('hub.trq.col.contact')}</dt>
            <dd className={s.dd}>
              {seedText(t, request, 'contactName')} · {request.email} · {request.phone || '—'}
            </dd>
          </dl>
        </div>
        {r.status === 'pending' ? (
          <div className={s.section}>
            <h3 className={s.h3}>{t('hub.trq.review')}</h3>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {t('hub.trq.reviewNote', {
                usd: request.freeCreditUsd,
                hosting: request.publicSector || request.dataResidencyTw ? '@hub.trq.localOnly' : '@hub.trq.localOnlyNoConsent',
                excl: request.publicSector ? t('hub.trq.excludeCn') : '',
                days: TRIAL_TERMS.periodBusinessDays,
              })}
            </Text>
            <div className={s.actions}>
              <Button appearance="primary" icon={<CheckmarkCircleRegular />} onClick={approve} disabled={busy} data-tour="trial-approve">
                {t('hub.trq.approve')}
              </Button>
            </div>
            <Field label={t('hub.trq.rejectReason')}>
              <Textarea value={reason} onChange={(_, d) => setReason(d.value)} rows={2} placeholder={t('hub.trq.rejectPlaceholder')} />
            </Field>
            <div>
              <Button icon={<DismissCircleRegular />} onClick={reject} disabled={busy || !reason.trim()} data-tour="trial-reject">
                {t('hub.trq.reject')}
              </Button>
            </div>
          </div>
        ) : (
          <div className={s.section}>
            <h3 className={s.h3}>{t('hub.trq.result')}</h3>
            <dl className={s.dl}>
              <dt className={s.dt}>{t('common.status')}</dt>
              <dd className={s.dd}>{statusLabel(t, r.status)}</dd>
              <dt className={s.dt}>{t('hub.trq.reviewer')}</dt>
              <dd className={s.dd}>
                {r.reviewedBy ?? '—'} · {r.reviewedAt ? L.fmtDateTime(r.reviewedAt) : '—'}
              </dd>
              {r.reviewNote && (
                <>
                  <dt className={s.dt}>{t('hub.trq.reviewNoteLabel')}</dt>
                  <dd className={s.dd}>{seedText(t, r, 'reviewNote')}</dd>
                </>
              )}
              {r.tenantId && (
                <>
                  <dt className={s.dt}>{t('hub.trq.trialTenant')}</dt>
                  <dd className={s.dd}>
                    <Button size="small" appearance="secondary" onClick={() => navigate(`/tenants/${r.tenantId}`)}>
                      {r.tenantId}
                    </Button>
                  </dd>
                </>
              )}
            </dl>
          </div>
        )}
      </DrawerBody>
    </OverlayDrawer>
  );
}
