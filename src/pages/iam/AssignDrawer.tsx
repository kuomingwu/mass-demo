import {
  Badge,
  Button,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  OverlayDrawer,
  Radio,
  RadioGroup,
  SearchBox,
  Spinner,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { ArrowLeftRegular, ArrowRightRegular, BotRegular, DismissRegular, PeopleRegular, PersonRegular } from '@fluentui/react-icons';
import { useEffect, useMemo, useState } from 'react';
import { PermissionDenied } from '../../components/States';
import { ScopePicker, scopeDisplayName } from '../../components/ScopePicker';
import { useNotify } from '../../components/Notify';
import { server, type ApiError } from '../../server/api';
import { useSession } from '../../app/SessionContext';
import type { Principal, RoleId, Decision } from '../../auth/types';
import { ALL_ACTIONS } from '../../auth/types';
import { ACTION_LABELS, ROLES, ROLE_IDS } from '../../auth/roles';
import { keyedText, principalLabel, tf, tl, useT, type TParams } from '../../i18n';

/** 預覽回應的 warnings／blockers 可能附帶對應的翻譯鍵（warningKeys／blockerKeys） */
type KeyedItem = { key: string; params?: TParams };
function keyedAt(list: unknown, i: number): KeyedItem | undefined {
  return Array.isArray(list) ? (list[i] as KeyedItem | undefined) : undefined;
}

const useStyles = makeStyles({
  steps: { display: 'flex', columnGap: tokens.spacingHorizontalXS, marginBottom: tokens.spacingVerticalM, flexWrap: 'wrap' },
  step: { display: 'flex', alignItems: 'center', columnGap: '4px', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
  stepActive: { color: tokens.colorBrandForeground1, fontWeight: tokens.fontWeightSemibold },
  stepNum: { display: 'inline-flex', width: '20px', height: '20px', borderRadius: '50%', alignItems: 'center', justifyContent: 'center', border: `1px solid ${tokens.colorNeutralStroke1}`, fontSize: tokens.fontSizeBase100 },
  body: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  list: { display: 'flex', flexDirection: 'column', rowGap: '2px', maxHeight: '360px', overflowY: 'auto', border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, padding: '4px' },
  item: { display: 'flex', alignItems: 'center', columnGap: tokens.spacingHorizontalS, padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`, borderRadius: tokens.borderRadiusMedium, cursor: 'pointer', textAlign: 'left', backgroundColor: 'transparent', border: 'none', color: tokens.colorNeutralForeground1, fontFamily: 'inherit', fontSize: tokens.fontSizeBase300, ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover }, ':focus-visible': { outline: `2px solid ${tokens.colorStrokeFocus2}` } },
  itemSelected: { backgroundColor: tokens.colorBrandBackground2 },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3 },
  summary: { display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: tokens.spacingHorizontalM, rowGap: tokens.spacingVerticalXS, fontSize: tokens.fontSizeBase300 },
  diff: { display: 'flex', flexDirection: 'column', rowGap: '2px', maxHeight: '260px', overflowY: 'auto', border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, padding: tokens.spacingVerticalXS },
  diffRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', columnGap: tokens.spacingHorizontalS, fontSize: tokens.fontSizeBase200, padding: '2px 6px' },
  roleCard: { border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, padding: tokens.spacingVerticalS },
});

const STEPS = ['principal', 'role', 'scope', 'impact', 'confirm'] as const;

interface Props {
  open: boolean;
  initialScope: string;
  onClose: () => void;
  onDone: () => void;
}

export function AssignDrawer({ open, initialScope, onClose, onDone }: Props) {
  const s = useStyles();
  const t = useT();
  const roleLabel = (rid: RoleId) => tf(t, `server.role.${rid}.name`, ROLES[rid].name);
  const { session, principal: me, bump } = useSession();
  const notify = useNotify();
  const [step, setStep] = useState(0);
  const [principals, setPrincipals] = useState<Principal[]>([]);
  const [delegation, setDelegation] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [principalId, setPrincipalId] = useState('');
  const [roleId, setRoleId] = useState<RoleId>('viewer');
  const [scope, setScope] = useState(initialScope);
  const [justification, setJustification] = useState('');
  const [expires, setExpires] = useState('');
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof server.previewRoleAssignment>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setSearch('');
    setPrincipalId('');
    setRoleId('viewer');
    setScope(initialScope);
    setJustification('');
    setExpires('');
    setPreview(null);
    setDenied(null);
    setLoading(true);
    Promise.all([server.getMe(session), server.listPrincipals(session, initialScope)])
      .then(([meRes, pRes]) => {
        if (meRes.ok) setDelegation(meRes.data.delegation);
        if (pRes.ok) setPrincipals(pRes.data);
        else if (pRes.status === 403) setDenied(pRes);
      })
      .catch((e) => notify.apiError(e as Error, t('admin.assign.loadPrincipals')))
      .finally(() => setLoading(false));
  }, [open, initialScope, session, notify]);

  // 範圍變更時依範圍重新載入主體（維持租戶邊界）
  useEffect(() => {
    if (!open || step !== 2) return;
    server.listPrincipals(session, scope).then((r) => {
      if (r.ok) {
        setPrincipals(r.data);
        if (!r.data.find((p) => p.id === principalId)) setPrincipalId('');
      }
    }).catch(() => undefined);
  }, [scope, open, step, session, principalId]);

  useEffect(() => {
    if (!open || step !== 3) return;
    setLoading(true);
    setPreview(null);
    server
      .previewRoleAssignment(session, { principalId, roleId, scope, justification, expiresAt: expires ? new Date(expires).toISOString() : undefined })
      .then(setPreview)
      .catch((e) => notify.apiError(e as Error, t('admin.assign.previewImpact')))
      .finally(() => setLoading(false));
  }, [open, step, session, principalId, roleId, scope, justification, expires, notify]);

  const filtered = useMemo(() => principals.filter((p) => !search || `${p.displayName} ${p.id} ${p.email ?? ''}`.toLowerCase().includes(search.toLowerCase())), [principals, search]);
  const selectedPrincipal = principals.find((p) => p.id === principalId);
  const canNext = step === 0 ? !!principalId : step === 1 ? !!roleId : step === 2 ? !!scope : step === 3 ? !!preview && preview.ok && preview.data.blockers.length === 0 : true;

  const submit = async () => {
    setBusy(true);
    try {
      const res = await server.createRoleAssignment(session, { principalId, roleId, scope, justification: justification || undefined, expiresAt: expires ? new Date(expires).toISOString() : undefined });
      if (res.ok) {
        const status = res.data.outcome === 'active' ? t('admin.assign.statusActive') : t('admin.assign.statusPending');
        (res.data.outcome === 'active' ? notify.success : notify.pending)(t('admin.assign.toastTitle', { status }), t('admin.assign.toastBody', { principal: selectedPrincipal ? principalLabel(t, selectedPrincipal.id, selectedPrincipal.displayName) : '', role: roleLabel(roleId), scope, requestId: res.requestId }));
        bump();
        onDone();
        onClose();
      } else if (res.status === 403) setDenied(res);
      else notify.apiError(res, t('admin.iam.addAssignment'));
    } catch (e) {
      notify.apiError(e as Error, t('admin.iam.addAssignment'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OverlayDrawer open={open} position="end" size="large" onOpenChange={(_, d) => !d.open && !busy && onClose()} aria-label={t('admin.iam.addAssignment')}>
      <DrawerHeader>
        <DrawerHeaderTitle action={<Button appearance="subtle" aria-label={t('common.close')} icon={<DismissRegular />} onClick={onClose} />}>{t('admin.iam.addAssignment')}</DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        <ol className={s.steps} aria-label={t('admin.assign.stepsAria')} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {STEPS.map((key, i) => (
            <li key={key} className={`${s.step} ${i === step ? s.stepActive : ''}`} aria-current={i === step ? 'step' : undefined}>
              <span className={s.stepNum}>{i + 1}</span>
              {t(`admin.assign.step.${key}`)}
              {i < STEPS.length - 1 && <span aria-hidden>›</span>}
            </li>
          ))}
        </ol>
        <div className={s.body} data-tour={`assign-step-${step}`}>
          {denied && <PermissionDenied inline error={denied} actionLabel={t('admin.assign.assignRole')} />}
          {me && delegation.length === 0 && !denied && <PermissionDenied inline actionLabel={t('admin.assign.assignRole')} />}

          {step === 0 && (
            <>
              <Field label={t('admin.assign.searchLabel')}>
                <SearchBox value={search} onChange={(_, d) => setSearch(d.value)} placeholder={t('admin.assign.searchPlaceholder')} />
              </Field>
              {loading ? (
                <Spinner label={t('admin.assign.loadingPrincipals')} />
              ) : (
                <div className={s.list} role="listbox" aria-label={t('admin.assign.principalListAria')}>
                  {filtered.map((p) => (
                    <button key={p.id} type="button" role="option" aria-selected={p.id === principalId} className={`${s.item} ${p.id === principalId ? s.itemSelected : ''}`} onClick={() => setPrincipalId(p.id)}>
                      {p.type === 'group' ? <PeopleRegular /> : p.type === 'servicePrincipal' ? <BotRegular /> : <PersonRegular />}
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span>{principalLabel(t, p.id, p.displayName)}</span>
                        <span className={s.mono}>
                          {p.id}
                          {p.email ? ` · ${p.email}` : ''}
                          {p.tenantId ? t('admin.assign.tenantSuffix', { id: p.tenantId }) : t('admin.assign.platformSuffix')}
                        </span>
                      </div>
                      <Badge appearance="outline" size="small" style={{ marginLeft: 'auto' }}>
                        {p.type === 'group' ? t('admin.principalType.group') : p.type === 'servicePrincipal' ? t('admin.principalType.servicePrincipal') : t('admin.principalType.user')}
                      </Badge>
                    </button>
                  ))}
                  {filtered.length === 0 && <Text size={200}>{t('admin.assign.noMatch')}</Text>}
                </div>
              )}
            </>
          )}

          {step === 1 && (
            <RadioGroup value={roleId} onChange={(_, d) => setRoleId(d.value as RoleId)} aria-label={t('common.role')}>
              {ROLE_IDS.map((rid) => (
                <div key={rid} className={s.roleCard}>
                  <Radio
                    value={rid}
                    label={
                      <span>
                        <strong>{roleLabel(rid)}</strong> <span className={s.mono}>{rid}</span>
                        {ROLES[rid].privileged && (
                          <Badge appearance="tint" color="important" size="small" style={{ marginLeft: 6 }}>
                            {t('admin.assign.privilegedBadge')}
                          </Badge>
                        )}
                        <div>
                          <Text size={200}>{tf(t, `server.role.${rid}.description`, ROLES[rid].description)}</Text>
                        </div>
                      </span>
                    }
                  />
                </div>
              ))}
            </RadioGroup>
          )}

          {step === 2 && (
            <>
              <ScopePicker value={scope} onChange={setScope} allowedRoots={delegation} label={t('admin.assign.scopeLabel')} />
              <MessageBar intent="info">
                <MessageBarBody>{t('admin.assign.scopeInfo')}</MessageBarBody>
              </MessageBar>
              <Field label={t('admin.assign.expiresLabel')} hint={t('admin.assign.expiresHint')}>
                <Input type="date" value={expires} onChange={(_, d) => setExpires(d.value)} />
              </Field>
              <Field label={t('admin.assign.justificationLabel')}>
                <Textarea value={justification} onChange={(_, d) => setJustification(d.value)} rows={2} />
              </Field>
            </>
          )}

          {step === 3 && (
            <>
              {loading && <Spinner label={t('admin.assign.computing')} />}
              {preview && !preview.ok && <PermissionDenied inline error={preview} />}
              {preview?.ok && (
                <>
                  {preview.data.blockers.map((b, i) => (
                    <MessageBar key={b} intent="error">
                      <MessageBarBody>
                        <MessageBarTitle>{t('admin.assign.cannotCreate')}</MessageBarTitle>
                        {keyedText(t, b, keyedAt((preview.data as { blockerKeys?: unknown }).blockerKeys, i)?.key, keyedAt((preview.data as { blockerKeys?: unknown }).blockerKeys, i)?.params)}
                      </MessageBarBody>
                    </MessageBar>
                  ))}
                  {preview.data.warnings.map((w, i) => (
                    <MessageBar key={w} intent="warning">
                      <MessageBarBody>{keyedText(t, w, keyedAt((preview.data as { warningKeys?: unknown }).warningKeys, i)?.key, keyedAt((preview.data as { warningKeys?: unknown }).warningKeys, i)?.params)}</MessageBarBody>
                    </MessageBar>
                  ))}
                  <MessageBar intent={preview.data.needsApproval ? 'warning' : 'success'}>
                    <MessageBarBody>
                      <MessageBarTitle>{preview.data.needsApproval ? t('admin.assign.needsApproval') : t('admin.assign.willActivate')}</MessageBarTitle>
                      {preview.data.needsApproval ? t('admin.assign.needsApprovalDesc') : t('admin.assign.willActivateDesc')}
                    </MessageBarBody>
                  </MessageBar>
                  <Text weight="semibold">{t('admin.assign.diffTitle', { scope })}</Text>
                  <DiffList current={preview.data.current} proposed={preview.data.proposed} />
                </>
              )}
            </>
          )}

          {step === 4 && (
            <>
              <dl className={s.summary}>
                <dt>{t('common.principal')}</dt>
                <dd style={{ margin: 0 }}>{t('admin.assign.nameWithId', { name: selectedPrincipal ? principalLabel(t, selectedPrincipal.id, selectedPrincipal.displayName) : '', id: principalId })}</dd>
                <dt>{t('common.role')}</dt>
                <dd style={{ margin: 0 }}>{t('admin.assign.nameWithId', { name: roleLabel(roleId), id: roleId })}</dd>
                <dt>{t('common.scope')}</dt>
                <dd style={{ margin: 0 }}>
                  {scopeDisplayName(scope, t)} <span className={s.mono}>{scope}</span>
                </dd>
                <dt>{t('admin.assign.sum.expires')}</dt>
                <dd style={{ margin: 0 }}>{expires || t('customer.keys.never')}</dd>
                <dt>{t('admin.requests.col.justification')}</dt>
                <dd style={{ margin: 0 }}>{justification || '—'}</dd>
                <dt>{t('admin.effective.col.result')}</dt>
                <dd style={{ margin: 0 }}>{preview?.ok && preview.data.needsApproval ? t('admin.assign.sum.createRequest') : t('admin.assign.sum.direct')}</dd>
              </dl>
              <MessageBar intent="info">
                <MessageBarBody>{t('admin.assign.confirmInfo')}</MessageBarBody>
              </MessageBar>
            </>
          )}
        </div>
      </DrawerBody>
      <DrawerFooter>
        {step > 0 && (
          <Button icon={<ArrowLeftRegular />} onClick={() => setStep((x) => x - 1)} disabled={busy}>
            {t('common.prev')}
          </Button>
        )}
        {step < STEPS.length - 1 ? (
          <Button data-tour="assign-next" appearance="primary" icon={<ArrowRightRegular />} iconPosition="after" onClick={() => setStep((x) => x + 1)} disabled={!canNext || loading}>
            {t('common.next')}
          </Button>
        ) : (
          <Button data-tour="assign-submit" appearance="primary" onClick={submit} disabled={busy || !canNext}>
            {busy ? t('admin.assign.submitting') : t('common.confirm')}
          </Button>
        )}
        <Button appearance="secondary" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
      </DrawerFooter>
    </OverlayDrawer>
  );
}

function DiffList({ current, proposed }: { current: Decision[]; proposed: Decision[] }) {
  const s = useStyles();
  const t = useT();
  const rows = ALL_ACTIONS.map((a, i) => ({ action: a, before: current[i].allowed, after: proposed[i].allowed }));
  const changed = rows.filter((r) => r.before !== r.after);
  return (
    <div className={s.diff} role="list" aria-label={t('admin.assign.diffAria')}>
      {changed.length === 0 && <Text size={200}>{t('admin.assign.noChange')}</Text>}
      {changed.map((r) => (
        <div key={r.action} className={s.diffRow} role="listitem">
          <span>
            <code>{r.action}</code> <span className={s.mono}>{tl(t, 'ACTION_LABELS', r.action, ACTION_LABELS[r.action])}</span>
          </span>
          <span>
            <Badge appearance="outline" color="subtle" size="small">
              {r.before ? t('common.allow') : t('common.deny')}
            </Badge>{' '}
            →{' '}
            <Badge appearance="tint" color={r.after ? 'success' : 'danger'} size="small">
              {r.after ? t('common.allow') : t('common.deny')}
            </Badge>
          </span>
        </div>
      ))}
      {rows.filter((r) => r.before === r.after && r.after).length > 0 && (
        <Text size={200} style={{ padding: '4px 6px', color: tokens.colorNeutralForeground3 }}>
          {t('admin.assign.unchanged', { n: rows.filter((r) => r.before === r.after && r.after).length })}
        </Text>
      )}
    </div>
  );
}
