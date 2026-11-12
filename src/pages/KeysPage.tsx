import {
  Badge,
  Button,
  Checkbox,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  Dropdown,
  Field,
  Input,
  Link,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  OverlayDrawer,
  Radio,
  RadioGroup,
  Switch,
  Text,
  Tooltip,
  createTableColumn,
  makeStyles,
  tokens,
  type TableColumnDefinition,
} from '@fluentui/react-components';
import { AddRegular, DismissRegular, DeleteRegular, DataUsageRegular } from '@fluentui/react-icons';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { AsyncView, EmptyState, PermissionDenied } from '../components/States';
import { StatusBadge } from '../components/StatusBadge';
import { SimpleGrid } from '../components/SimpleGrid';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CodeBlock } from '../components/CodeBlock';
import { useNotify } from '../components/Notify';
import { useApi } from '../hooks/useApi';
import { apiMessage, tenantLabel, tf, tl, useLocale, useT } from '../i18n';
import { server, EPHEMERAL_MAX_MINUTES, KEY_MAX_EXPIRY_DAYS, type ApiError, type KeyView } from '../server/api';
import { useSession } from '../app/SessionContext';
import { PROJECTS, TENANTS, TIER_POLICY_LABELS, type TierPolicy } from '../server/seed';
import { ROUTES } from '../data/providers';
import { MODELS } from '../data/models';
import { projectScope } from '../auth/scope';
import { formatUsd } from '../theme/chartPalette';
import { LAW_CITATION } from '../data/guides';
import { useCloseOnTourFinish } from '../components/OnboardingTour';

const useStyles = makeStyles({
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
  num: { fontVariantNumeric: 'tabular-nums' },
  form: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: tokens.spacingHorizontalS },
  row3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', columnGap: tokens.spacingHorizontalS },
  models: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', maxHeight: '220px', overflowY: 'auto', borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px', borderTopStyle: 'solid', borderRightStyle: 'solid', borderBottomStyle: 'solid', borderLeftStyle: 'solid', borderTopColor: tokens.colorNeutralStroke2, borderRightColor: tokens.colorNeutralStroke2, borderBottomColor: tokens.colorNeutralStroke2, borderLeftColor: tokens.colorNeutralStroke2, borderRadius: tokens.borderRadiusMedium, padding: tokens.spacingVerticalXS },
  chips: { display: 'flex', flexWrap: 'wrap', gap: '4px' },
  section: { fontWeight: tokens.fontWeightSemibold },
});

const TIER_BADGE: Record<TierPolicy, 'danger' | 'informative' | 'brand'> = { local: 'danger', cloud: 'informative', both: 'brand' };

/** 本地日期 yyyy-mm-dd（避免 toISOString 在 UTC+8 的凌晨回到前一天） */
function plusDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 預設到期：89 天後的當日結束（< 90 天），確保與伺服器的 90 天 + 1 秒上限一致 */
const DEFAULT_EXPIRY_DAYS = KEY_MAX_EXPIRY_DAYS - 1;

/** 送給伺服器的到期時刻：所選日期的當日 23:59:59（本地時間）；伺服器以此時刻與現在的差距檢查上限 */
function expiryInstant(dateStr: string): Date | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T23:59:59`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function KeysPage() {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const { session, canUi, canUiAnywhere, tenantId, bump } = useSession();
  const notify = useNotify();
  const st = useApi(() => server.listKeys(session, tenantId ? { tenantId } : undefined), [session, tenantId]);
  const [creating, setCreating] = useState(false);
  const [toRevoke, setToRevoke] = useState<KeyView | null>(null);
  const [busy, setBusy] = useState(false);
  const canCreateAnywhere = canUiAnywhere('key.create');

  const columns: TableColumnDefinition<KeyView>[] = useMemo(
    () => [
      createTableColumn<KeyView>({
        columnId: 'name',
        compare: (a, b) => a.name.localeCompare(b.name),
        renderHeaderCell: () => t('common.name'),
        renderCell: (k) => (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Text weight="semibold">{k.name}</Text>
            {k.ephemeral && (
              <Badge appearance="tint" color="warning" size="small" style={{ alignSelf: 'flex-start' }}>
                {t('customer.keys.ephemeralBadge')}
              </Badge>
            )}
          </div>
        ),
      }),
      createTableColumn<KeyView>({
        columnId: 'project',
        compare: (a, b) => a.projectName.localeCompare(b.projectName),
        renderHeaderCell: () => t('common.project'),
        renderCell: (k) => (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span>{k.projectName}</span>
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              {tenantLabel(t, k.tenantId, k.tenantName)}
            </Text>
          </div>
        ),
      }),
      createTableColumn<KeyView>({
        columnId: 'hint',
        renderHeaderCell: () => t('customer.keys.col.hint'),
        renderCell: (k) => (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <code className={s.mono}>{k.hint}</code>
            <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
              {t('customer.keys.hashOnly', { hash: k.hash })}
            </Text>
          </div>
        ),
      }),
      createTableColumn<KeyView>({
        columnId: 'tier',
        renderHeaderCell: () => t('customer.keys.col.tier'),
        renderCell: (k) => (
          <Badge appearance="outline" size="small" color={TIER_BADGE[k.tierRestriction]}>
            {tl(t, 'TIER_POLICY_LABELS', k.tierRestriction, TIER_POLICY_LABELS[k.tierRestriction])}
          </Badge>
        ),
      }),
      createTableColumn<KeyView>({
        columnId: 'models',
        renderHeaderCell: () => t('customer.keys.col.models'),
        renderCell: (k) => (
          <div className={s.chips}>
            {k.allowedModels.map((m) => (
              <Badge key={m} appearance="outline" size="small">
                {m}
              </Badge>
            ))}
          </div>
        ),
      }),
      createTableColumn<KeyView>({
        columnId: 'limits',
        renderHeaderCell: () => t('customer.keys.col.limits'),
        renderCell: (k) => (
          <span className={s.num}>
            {L.fmtNumber(k.rpmLimit)} / {L.fmtNumber(k.tpmLimit)} / {k.maxParallelRequests}
          </span>
        ),
      }),
      createTableColumn<KeyView>({
        columnId: 'budget',
        compare: (a, b) => a.monthlyBudgetUsd - b.monthlyBudgetUsd,
        renderHeaderCell: () => t('customer.keys.col.budget'),
        renderCell: (k) => (
          <span className={s.num}>
            {formatUsd(k.monthlyBudgetUsd, 0)} / {k.budgetDuration}
          </span>
        ),
      }),
      createTableColumn<KeyView>({
        columnId: 'expires',
        compare: (a, b) => (a.expiresAt ?? '').localeCompare(b.expiresAt ?? ''),
        renderHeaderCell: () => t('customer.keys.col.expires'),
        renderCell: (k) => (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span>{k.expiresAt ? (k.ephemeral ? L.fmtDateTime(k.expiresAt) : L.fmtDate(k.expiresAt)) : t('customer.keys.never')}</span>
            {k.autoRotate.enabled && (
              <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
                {t('customer.keys.autoRotate', { days: k.autoRotate.intervalDays, hours: k.autoRotate.gracePeriodHours })}
              </Text>
            )}
          </div>
        ),
      }),
      createTableColumn<KeyView>({
        columnId: 'status',
        compare: (a, b) => a.status.localeCompare(b.status),
        renderHeaderCell: () => t('common.status'),
        renderCell: (k) => (k.status === 'active' ? <StatusBadge kind="success" label={t('common.active')} size="small" /> : k.status === 'expired' ? <StatusBadge kind="warning" label={t('common.expired')} size="small" /> : <StatusBadge kind="danger" label={t('common.revoked')} size="small" />),
      }),
      createTableColumn<KeyView>({ columnId: 'lastUsed', renderHeaderCell: () => t('customer.keys.col.lastUsed'), renderCell: (k) => (k.lastUsedAt ? L.fmtDateTime(k.lastUsedAt) : '—') }),
      createTableColumn<KeyView>({
        columnId: 'actions',
        renderHeaderCell: () => t('customer.keys.col.actions'),
        renderCell: (k) => {
          const can = canUi('key.revoke', `${projectScope(k.tenantId, k.projectId)}/keys/${k.id}`);
          const disabled = !can || k.status === 'revoked';
          return (
            <div style={{ display: 'flex', gap: 4 }}>
              <Tooltip content={t('customer.keys.viewUsageTip')} relationship="label">
                <Button size="small" appearance="subtle" icon={<DataUsageRegular />} aria-label={t('customer.keys.viewUsageAria', { name: k.name })} as="a" href={`#/usage?tenant=${k.tenantId}&project=${k.projectId}`} />
              </Tooltip>
              <Tooltip content={k.status === 'revoked' ? t('common.revoked') : can ? t('customer.keys.revokeKey') : t('customer.keys.needRevoke')} relationship="label">
                <Button size="small" appearance="subtle" icon={<DeleteRegular />} aria-label={t('customer.keys.revokeAria', { name: k.name })} disabled={disabled} onClick={() => setToRevoke(k)}>
                  {t('customer.keys.revoke')}
                </Button>
              </Tooltip>
            </div>
          );
        },
      }),
    ],
    [s, canUi, t, L],
  );

  const revoke = async () => {
    if (!toRevoke) return;
    setBusy(true);
    try {
      const res = await server.revokeKey(session, toRevoke.id);
      if (res.ok) {
        notify.success(t('customer.keys.revokedToast', { name: toRevoke.name }), `requestId: ${res.requestId}`);
        bump();
        st.reload();
      } else notify.apiError(res, t('customer.keys.revokeKey'));
    } catch (e) {
      notify.apiError(e as Error, t('customer.keys.revokeKey'));
    } finally {
      setBusy(false);
      setToRevoke(null);
    }
  };

  return (
    <>
      <PageHeader
        title={t('customer.keys.title')}
        subtitle={t('customer.keys.subtitle', { maxDays: KEY_MAX_EXPIRY_DAYS, maxMinutes: EPHEMERAL_MAX_MINUTES })}
        crumbs={[{ label: t('customer.keys.title') }]}
        actions={
          <Tooltip content={canCreateAnywhere ? t('customer.keys.createTip') : t('customer.keys.needCreate')} relationship="description">
            <Button data-tour="keys-create" appearance="primary" icon={<AddRegular />} onClick={() => setCreating(true)} disabled={!canCreateAnywhere}>
              {t('customer.keys.create')}
            </Button>
          </Tooltip>
        }
      />
      <AsyncView {...st} actionLabel={t('customer.keys.viewAction')} isEmpty={(d) => d.length === 0} empty={<EmptyState title={t('customer.keys.emptyTitle')} description={t('customer.keys.emptyDesc')} />}>
        {(keys) => (
          <div data-tour="keys-table">
            <SimpleGrid items={keys} columns={columns} getRowId={(k) => k.id} ariaLabel={t('customer.keys.gridAria')} minWidth={1700} />
          </div>
        )}
      </AsyncView>
      <CreateKeyDrawer open={creating} onClose={() => setCreating(false)} onCreated={st.reload} />
      <ConfirmDialog open={!!toRevoke} title={t('customer.keys.revokeConfirmTitle')} destructive confirmLabel={t('customer.keys.revoke')} busy={busy} onCancel={() => setToRevoke(null)} onConfirm={revoke}>
        {t('customer.keys.revokeConfirmBody', { name: toRevoke?.name ?? '', hint: toRevoke?.hint ?? '' })}
      </ConfirmDialog>
    </>
  );
}

function CreateKeyDrawer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const { session, canUi, principal, bump } = useSession();
  const notify = useNotify();
  const projects = useMemo(() => PROJECTS.filter((p) => p.status === 'active' && canUi('key.create', projectScope(p.tenantId, p.id))), [canUi, principal]);
  const [projectId, setProjectId] = useState('');
  const [name, setName] = useState('');
  const [allowed, setAllowed] = useState<string[]>([]);
  const [kind, setKind] = useState<'standard' | 'ephemeral'>('standard');
  const [tier, setTier] = useState<TierPolicy>('both');
  const [rpm, setRpm] = useState('60');
  const [tpm, setTpm] = useState('100000');
  const [parallel, setParallel] = useState('8');
  const [budget, setBudget] = useState('500');
  const [budgetDuration, setBudgetDuration] = useState<'1d' | '7d' | '30d'>('30d');
  const [expires, setExpires] = useState(plusDays(DEFAULT_EXPIRY_DAYS));
  const [ephemeralMinutes, setEphemeralMinutes] = useState('60');
  const [rotate, setRotate] = useState(true);
  const [rotateDays, setRotateDays] = useState('60');
  const [grace, setGrace] = useState('48');
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState<ApiError | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<{ plaintext: string; name: string; requestId: string; hint: string; expiresAt: string | null } | null>(null);
  const [touched, setTouched] = useState(false);

  // 只在「開啟」時重設表單；開啟期間（例如建立成功後 bump() 造成 projects 重算）絕不重設，否則一次性明文會被清掉
  useEffect(() => {
    if (open) {
      setProjectId(projects[0]?.id ?? '');
      setName('');
      setAllowed(['qwen-plus']);
      setKind('standard');
      setTier('both');
      setRpm('60');
      setTpm('100000');
      setParallel('8');
      setBudget('500');
      setBudgetDuration('30d');
      setExpires(plusDays(DEFAULT_EXPIRY_DAYS));
      setEphemeralMinutes('60');
      setRotate(true);
      setRotateDays('60');
      setGrace('48');
      setDenied(null);
      setError(null);
      setResult(null);
      setTouched(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // 開啟中若可用專案清單改變而目前選項失效，才改選第一個（不碰其他欄位）
  useEffect(() => {
    if (open && projectId && !projects.some((p) => p.id === projectId)) setProjectId(projects[0]?.id ?? '');
  }, [open, projects, projectId]);
  useCloseOnTourFinish(open, onClose);

  const project = projects.find((p) => p.id === projectId);
  const tenant = project ? TENANTS.find((x) => x.id === project.tenantId) : undefined;
  const tenantLocalOnly = !!tenant && (tenant.dataClass === 'public-sector' || tenant.allowedTiers === 'local');
  useEffect(() => {
    if (tenantLocalOnly) setTier('local');
    else if (tenant && tenant.allowedTiers !== 'both') setTier(tenant.allowedTiers);
  }, [tenantLocalOnly, tenant]);

  const nameError = touched && !name.trim() ? t('customer.createKey.nameRequired') : undefined;
  const modelError = touched && allowed.length === 0 ? t('customer.createKey.modelRequired') : undefined;
  // 與伺服器同一種算法：以實際送出的到期時刻（當日 23:59:59）減現在，換算成天數；超過 90 天即會被 400 KEY_EXPIRY_TOO_LONG 拒絕
  const expiryAt = expiryInstant(expires);
  const daysUntil = expiryAt ? (expiryAt.getTime() - Date.now()) / 86_400_000 : 0;
  const expiryError =
    kind === 'standard'
      ? !expiryAt
        ? t('customer.createKey.expiryRequired')
        : daysUntil <= 0
          ? t('customer.createKey.expiryPast')
          : daysUntil > KEY_MAX_EXPIRY_DAYS
            ? t('customer.createKey.expiryTooLong', { max: KEY_MAX_EXPIRY_DAYS, days: daysUntil.toFixed(1), latest: plusDays(DEFAULT_EXPIRY_DAYS) })
            : undefined
      : Number(ephemeralMinutes) > EPHEMERAL_MAX_MINUTES || Number(ephemeralMinutes) <= 0
        ? t('customer.createKey.ephemeralTooLong', { max: EPHEMERAL_MAX_MINUTES })
        : undefined;
  const options = useMemo(() => {
    const aliasTier = (alias: string) => server.modelOrAliasTier(alias);
    return [
      ...ROUTES.map((r) => ({ id: r.alias, label: t('customer.common.aliasOption', { alias: r.alias }), tier: aliasTier(r.alias) })),
      ...MODELS.filter((m) => m.status !== 'legacy').map((m) => ({ id: m.id, label: m.id, tier: aliasTier(m.id) })),
    ];
  }, [t]);
  const disallowed = (x: TierPolicy) => (tier === 'local' && x !== 'local') || (tier === 'cloud' && x === 'local');

  const submit = async () => {
    setTouched(true);
    setError(null);
    if (!project || !name.trim() || allowed.length === 0 || expiryError) return;
    setBusy(true);
    try {
      const expiresAt = kind === 'ephemeral' ? new Date(Date.now() + Number(ephemeralMinutes) * 60_000).toISOString() : (expiryAt ?? new Date()).toISOString();
      const res = await server.createKey(session, {
        tenantId: project.tenantId,
        projectId: project.id,
        name,
        allowedModels: allowed,
        tierRestriction: tier,
        rpmLimit: Number(rpm) || 0,
        tpmLimit: Number(tpm) || 0,
        maxParallelRequests: Number(parallel) || 1,
        monthlyBudgetUsd: Number(budget) || 0,
        budgetDuration,
        ephemeral: kind === 'ephemeral',
        expiresAt,
        autoRotate: { enabled: kind === 'standard' && rotate, intervalDays: Number(rotateDays) || 90, gracePeriodHours: Number(grace) || 48 },
      });
      if (res.ok) {
        setResult({ plaintext: res.data.plaintext, name: res.data.key.name, requestId: res.requestId, hint: res.data.key.hint, expiresAt: res.data.key.expiresAt });
        notify.success(t('customer.createKey.createdToast'), `requestId: ${res.requestId}`);
        bump();
        onCreated();
      } else if (res.status === 403) setDenied(res);
      else setError(res);
    } catch (e) {
      notify.apiError(e as Error, t('customer.keys.create'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OverlayDrawer open={open} position="end" size="medium" onOpenChange={(_, d) => !d.open && onClose()} aria-label={t('customer.createKey.title')}>
      <DrawerHeader>
        <DrawerHeaderTitle action={<Button appearance="subtle" aria-label={t('common.close')} icon={<DismissRegular />} onClick={onClose} />}>{t('customer.createKey.title')}</DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        {result ? (
          <div className={s.form} data-tour="keys-result">
            <MessageBar intent="success">
              <MessageBarBody>
                <MessageBarTitle>{t('customer.createKey.resultTitle', { name: result.name })}</MessageBarTitle>
                {t('customer.createKey.resultBody', { hint: result.hint, expires: result.expiresAt ? L.fmtDateTime(result.expiresAt) : '—', requestId: result.requestId })}
              </MessageBarBody>
            </MessageBar>
            <CodeBlock code={result.plaintext} label={t('customer.createKey.plaintextLabel')} />
            <Text size={200}>{t('customer.createKey.kmsNote')}</Text>
          </div>
        ) : (
          <div className={s.form} data-tour="keys-form">
            {denied && <PermissionDenied inline error={denied} />}
            {projects.length === 0 && <PermissionDenied inline actionLabel={t('customer.keys.create')} />}
            {error && (
              <MessageBar intent="error" role="alert">
                <MessageBarBody>
                  <MessageBarTitle>
                    {t('customer.createKey.serverRejected', { status: error.status, code: error.code })}
                  </MessageBarTitle>
                  {apiMessage(t, error)} requestId: {error.requestId}
                </MessageBarBody>
              </MessageBar>
            )}
            <Field label={t('common.project')} required>
              <Dropdown value={project ? t('customer.common.projectOption', { project: project.name, tenant: tenantLabel(t, tenant?.id, tenant?.name) }) : ''} selectedOptions={[projectId]} onOptionSelect={(_, d) => d.optionValue && setProjectId(d.optionValue)} disabled={projects.length === 0}>
                {projects.map((p) => (
                  <Option key={p.id} value={p.id} text={t('customer.common.projectOption', { project: p.name, tenant: TENANTS.find((x) => x.id === p.tenantId)?.name ?? '' })}>
                    {t('customer.common.projectOption', { project: p.name, tenant: TENANTS.find((x) => x.id === p.tenantId)?.name ?? '' })}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            {tenantLocalOnly && tenant && (
              <MessageBar intent="warning">
                <MessageBarBody>
                  <MessageBarTitle>{t('customer.createKey.localOnlyTitle', { reason: tenant.dataClass === 'public-sector' ? t('customer.createKey.reasonPublic') : t('customer.createKey.reasonDataClass') })}</MessageBarTitle>
                  {t('customer.createKey.localOnlyBody')}{tenant.dataClass === 'public-sector' ? t('customer.createKey.lawBasis', { law: tf(t, 'guides.const.LAW_CITATION', LAW_CITATION) }) : ''}
                </MessageBarBody>
              </MessageBar>
            )}
            <Field label={t('customer.createKey.nameLabel')} required validationState={nameError ? 'error' : 'none'} validationMessage={nameError}>
              <Input value={name} onChange={(_, d) => setName(d.value)} placeholder={t('customer.createKey.namePlaceholder')} />
            </Field>
            <Field label={t('customer.createKey.kindLabel')} required>
              <RadioGroup layout="horizontal" value={kind} onChange={(_, d) => setKind(d.value as 'standard' | 'ephemeral')}>
                <Radio value="standard" label={t('customer.createKey.kindStandard', { max: KEY_MAX_EXPIRY_DAYS })} />
                <Radio value="ephemeral" label={t('customer.createKey.kindEphemeral', { max: EPHEMERAL_MAX_MINUTES })} />
              </RadioGroup>
            </Field>
            <Field label={t('customer.keys.col.tier')} required hint={t('customer.createKey.tierHint')}>
              <Dropdown value={tl(t, 'TIER_POLICY_LABELS', tier, TIER_POLICY_LABELS[tier])} selectedOptions={[tier]} onOptionSelect={(_, d) => d.optionValue && setTier(d.optionValue as TierPolicy)} disabled={tenantLocalOnly} data-tour="keys-tier">
                {(Object.keys(TIER_POLICY_LABELS) as TierPolicy[]).map((x) => (
                  <Option key={x} value={x} text={tl(t, 'TIER_POLICY_LABELS', x, TIER_POLICY_LABELS[x])} disabled={!!tenant && tenant.allowedTiers !== 'both' && x !== tenant.allowedTiers}>
                    {tl(t, 'TIER_POLICY_LABELS', x, TIER_POLICY_LABELS[x])}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            <Field label={t('customer.createKey.modelsLabel')} required validationState={modelError ? 'error' : 'none'} validationMessage={modelError} hint={t('customer.createKey.modelsHint')}>
              <div className={s.models} role="group" aria-label={t('customer.createKey.modelsAria')}>
                {options.map((o) => (
                  <Checkbox
                    key={o.id}
                    label={
                      <span>
                        {o.label}
                        {disallowed(o.tier) && (
                          <Badge appearance="tint" color="danger" size="small" style={{ marginLeft: 4 }}>
                            {tl(t, 'TIER_POLICY_LABELS', o.tier, TIER_POLICY_LABELS[o.tier])}
                          </Badge>
                        )}
                      </span>
                    }
                    checked={allowed.includes(o.id)}
                    onChange={(_, d) => setAllowed((a) => (d.checked ? [...a, o.id] : a.filter((x) => x !== o.id)))}
                  />
                ))}
              </div>
            </Field>
            <div className={s.row3}>
              <Field label={t('customer.createKey.rpm')}>
                <Input type="number" min={1} value={rpm} onChange={(_, d) => setRpm(d.value)} />
              </Field>
              <Field label={t('customer.createKey.tpm')}>
                <Input type="number" min={1000} value={tpm} onChange={(_, d) => setTpm(d.value)} />
              </Field>
              <Field label="max_parallel_requests">
                <Input type="number" min={1} value={parallel} onChange={(_, d) => setParallel(d.value)} />
              </Field>
            </div>
            <div className={s.row}>
              <Field label={t('customer.createKey.budget')}>
                <Input type="number" min={0} value={budget} onChange={(_, d) => setBudget(d.value)} />
              </Field>
              <Field label={t('customer.createKey.budgetDuration')}>
                <Dropdown value={budgetDuration} selectedOptions={[budgetDuration]} onOptionSelect={(_, d) => d.optionValue && setBudgetDuration(d.optionValue as '1d' | '7d' | '30d')}>
                  <Option value="1d" text={t('customer.createKey.duration1d')}>{t('customer.createKey.duration1d')}</Option>
                  <Option value="7d" text={t('customer.createKey.duration7d')}>{t('customer.createKey.duration7d')}</Option>
                  <Option value="30d" text={t('customer.createKey.duration30d')}>{t('customer.createKey.duration30d')}</Option>
                </Dropdown>
              </Field>
            </div>
            {kind === 'standard' ? (
              <Field label={t('customer.createKey.expiryLabel')} required validationState={expiryError ? 'error' : 'none'} validationMessage={expiryError} hint={t('customer.createKey.expiryHint', { max: KEY_MAX_EXPIRY_DAYS, def: DEFAULT_EXPIRY_DAYS })}>
                <Input type="date" value={expires} onChange={(_, d) => setExpires(d.value)} data-tour="keys-expiry" />
              </Field>
            ) : (
              <Field label={t('customer.createKey.minutesLabel')} required validationState={expiryError ? 'error' : 'none'} validationMessage={expiryError} hint={t('customer.createKey.minutesHint', { max: EPHEMERAL_MAX_MINUTES })}>
                <Input type="number" min={1} max={EPHEMERAL_MAX_MINUTES} value={ephemeralMinutes} onChange={(_, d) => setEphemeralMinutes(d.value)} />
              </Field>
            )}
            {kind === 'standard' && (
              <>
                <Switch label={t('customer.createKey.rotate')} checked={rotate} onChange={(_, d) => setRotate(d.checked)} />
                {rotate && (
                  <div className={s.row}>
                    <Field label={t('customer.createKey.rotateDays')}>
                      <Input type="number" min={7} max={KEY_MAX_EXPIRY_DAYS} value={rotateDays} onChange={(_, d) => setRotateDays(d.value)} />
                    </Field>
                    <Field label={t('customer.createKey.grace')}>
                      <Input type="number" min={1} max={168} value={grace} onChange={(_, d) => setGrace(d.value)} />
                    </Field>
                  </div>
                )}
              </>
            )}
            <Text size={200}>
              {t('customer.createKey.footBefore')}<Link href="#/guides?guide=create-key-playground">{t('customer.createKey.footLink')}</Link>{t('customer.createKey.footAfter')}
            </Text>
          </div>
        )}
      </DrawerBody>
      <DrawerFooter>
        {result ? (
          <Button appearance="primary" onClick={onClose}>
            {t('common.done')}
          </Button>
        ) : (
          <>
            <Button data-tour="keys-submit" appearance="primary" onClick={submit} disabled={busy || projects.length === 0}>
              {busy ? t('customer.common.creating') : t('common.create')}
            </Button>
            <Button appearance="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
          </>
        )}
      </DrawerFooter>
    </OverlayDrawer>
  );
}
