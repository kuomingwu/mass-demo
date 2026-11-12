import {
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
  Spinner,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { DismissRegular, PersonAddRegular } from '@fluentui/react-icons';
import { useEffect, useMemo, useState } from 'react';
import { PermissionDenied } from '../../components/States';
import { useNotify } from '../../components/Notify';
import { useSession } from '../../app/SessionContext';
import { server, type ApiError } from '../../server/api';
import { PLATFORM_SCOPE } from '../../auth/scope';
import { DATA_CLASS_LABELS, PLAN_DESCRIPTIONS, PLAN_LABELS, PUBLIC_SECTOR_NOTE, TIER_POLICY_LABELS, type DataClass, type Tenant, type TenantPlan, type TierPolicy } from '../../server/seed';
import { DEPLOYABLE_MODELS, ORIGIN_LABELS } from '../../data/models';
import { CN_REGIONS, PROVIDERS, ROUTES } from '../../data/providers';
import { formatUsd } from '../../theme/chartPalette';
import { useCloseOnTourFinish } from '../../components/OnboardingTour';
import { useApi } from '../../hooks/useApi';
import { apiMessage, tf, tl, useLocale, useT } from '../../i18n';

/** 今天（本地日曆）的 YYYY-MM-DD，作為跨境同意簽署日預設值 */
function todayLocalIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const useStyles = makeStyles({
  form: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: tokens.spacingHorizontalS },
  row3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', columnGap: tokens.spacingHorizontalS },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
  section: { fontWeight: tokens.fontWeightSemibold },
  models: { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: tokens.spacingHorizontalS, rowGap: '2px' },
  summary: { display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: tokens.spacingHorizontalL, rowGap: tokens.spacingVerticalXS, fontSize: tokens.fontSizeBase300 },
  dt: { color: tokens.colorNeutralForeground3 },
});

/** 新增租戶（客戶上線）抽屜：方案 → 層級政策 → 允許模型 → 配額與帳務聯絡人；伺服器端 tenant.create（平台範圍）並稽核 */
export function CreateTenantDrawer({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (t: Tenant) => void }) {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const { session, canUi, bump } = useSession();
  const notify = useNotify();
  const canCreate = canUi('tenant.create', PLATFORM_SCOPE);
  const [name, setName] = useState(() => t('customer.createTenant.default.name'));
  const [plan, setPlan] = useState<TenantPlan>('payg');
  const [dataClass, setDataClass] = useState<DataClass>('general');
  const [tiers, setTiers] = useState<TierPolicy>('both');
  const [rpm, setRpm] = useState('1000');
  const [tpm, setTpm] = useState('1500000');
  const [budget, setBudget] = useState('6000');
  const [costCenter, setCostCenter] = useState(() => t('customer.createTenant.default.costCenter'));
  const [contactName, setContactName] = useState(() => t('customer.createTenant.default.contact'));
  const [contactEmail, setContactEmail] = useState('procurement.lin@fareast.example');
  const [commitUsd, setCommitUsd] = useState('8000');
  const [commitPct, setCommitPct] = useState('15');
  const [allowed, setAllowed] = useState<string[]>(['qwen-plus', 'fast-chat', 'embedding-local', 'qwen3.8-27b-vllm', 'qwen3-embedding-8b-vllm']);
  // 跨境資料傳輸同意：預設未簽署 → 層級鎖定「僅自建」（伺服器：選 cloud／both 而未附同意 → 400 CROSS_BORDER_CONSENT_REQUIRED）
  const [consent, setConsent] = useState(false);
  const [consentRegions, setConsentRegions] = useState<string[]>([]);
  const [consentSignedAt, setConsentSignedAt] = useState(todayLocalIso());
  const [consentBy, setConsentBy] = useState(() => t('customer.createTenant.default.contact'));
  const providersSt = useApi(() => server.listProviders(session), [session]);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState<ApiError | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<Tenant | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setName(t('customer.createTenant.default.name'));
      setPlan('payg');
      setDataClass('general');
      setTiers('both');
      setRpm('1000');
      setTpm('1500000');
      setBudget('6000');
      setCostCenter(t('customer.createTenant.default.costCenter'));
      setContactName(t('customer.createTenant.default.contact'));
      setContactEmail('procurement.lin@fareast.example');
      setCommitUsd('8000');
      setCommitPct('15');
      setAllowed(['qwen-plus', 'fast-chat', 'embedding-local', 'qwen3.8-27b-vllm', 'qwen3-embedding-8b-vllm']);
      setConsent(false);
      setConsentRegions([]);
      setConsentSignedAt(todayLocalIso());
      setConsentBy(t('customer.createTenant.default.contact'));
      setDenied(null);
      setError(null);
      setResult(null);
      setTouched(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // 指引（onboard-tenant）結束或略過時，自動關閉由指引開啟的抽屜
  useCloseOnTourFinish(open, onClose);

  const publicSector = dataClass === 'public-sector';
  // 未簽署跨境同意（或公部門）→ 伺服器視同僅自建；UI 同步鎖定選項
  const consentActive = consent && !publicSector;
  const effectiveTiers: TierPolicy = publicSector || !consentActive ? 'local' : tiers;
  /** 可勾選的跨境區域：已連接、非舊版、非中國站的雲端供應商端點（伺服器會驗證區域必須是已連接的雲端區域） */
  const regionOptions = useMemo(() => {
    const src = providersSt.data ?? PROVIDERS;
    const seen = new Set<string>();
    const out: { region: string; label: string }[] = [];
    for (const p of src) {
      if (p.local || !p.enabled) continue;
      for (const e of p.endpoints) {
        if (e.legacy || CN_REGIONS.includes(e.region) || seen.has(e.region)) continue;
        seen.add(e.region);
        out.push({ region: e.region, label: t('customer.createTenant.regionOption', { region: e.region, provider: p.name, label: e.regionLabel }) });
      }
    }
    return out;
  }, [providersSt.data, t]);
  const toggleConsent = (checked: boolean) => {
    setConsent(checked);
    if (checked) {
      if (consentRegions.length === 0 && regionOptions.some((o) => o.region === 'ap-southeast-1')) setConsentRegions(['ap-southeast-1']);
      if (tiers === 'local') setTiers('both');
    }
  };
  const consentRegionsError = touched && consentActive && consentRegions.length === 0 ? t('customer.createTenant.regionRequired') : undefined;
  const consentRequiredError = error?.code === 'CROSS_BORDER_CONSENT_REQUIRED';
  const options = useMemo(() => {
    const fromRoutes = ROUTES.map((r) => {
      const targets = [...r.targets, ...r.fallbackChain];
      return { id: r.alias, label: t('customer.common.aliasOption', { alias: r.alias }), cn: targets.some((t) => t.modelId.startsWith('qwen') || t.modelId.includes('deepseek')), cloud: targets.some((t) => t.providerId !== 'vllm') };
    });
    const fromModels = DEPLOYABLE_MODELS.map((m) => ({ id: m.id, label: t('customer.createTenant.modelOption', { name: tf(t, `data.model.${m.id}.displayName`, m.displayName), origin: m.origin ? tl(t, 'ORIGIN_LABELS', m.origin, ORIGIN_LABELS[m.origin]) : '—' }), cn: m.origin === 'cn', cloud: false }));
    return [...fromRoutes, ...fromModels];
  }, [t]);
  const blocked = (o: { cn: boolean; cloud: boolean }) => (publicSector && o.cn) || (effectiveTiers === 'local' && o.cloud) || (effectiveTiers === 'cloud' && !o.cloud);
  const nameError = touched && !name.trim() ? t('customer.createTenant.nameRequired') : undefined;
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail);
  const canSubmit = name.trim().length > 0 && Number(rpm) > 0 && Number(tpm) > 0 && Number(budget) >= 0 && costCenter.trim().length > 0 && emailOk && (plan !== 'committed' || Number(commitUsd) > 0) && (!consentActive || (consentRegions.length > 0 && !!consentSignedAt));

  const submit = async () => {
    setTouched(true);
    setError(null);
    if (!canSubmit) return;
    setBusy(true);
    try {
      const res = await server.createTenant(session, {
        name,
        plan,
        dataClass,
        allowedTiers: effectiveTiers,
        quotas: { rpm: Number(rpm), tpm: Number(tpm), monthlyBudgetUsd: Number(budget) },
        costCenter,
        billingContact: { name: contactName, email: contactEmail },
        allowedModels: allowed.filter((id) => !blocked(options.find((o) => o.id === id) ?? { cn: false, cloud: false })),
        commitment: plan === 'committed' ? { monthlyUsd: Number(commitUsd), discountPct: Number(commitPct) } : undefined,
        crossBorderConsent: consentActive ? { regions: consentRegions, signedAt: new Date(`${consentSignedAt}T00:00:00`).toISOString(), by: consentBy.trim() || contactName.trim() } : undefined,
      });
      if (res.ok) {
        setResult(res.data);
        notify.success(t('customer.createTenant.onboarded', { name: res.data.name }), `requestId: ${res.requestId}`);
        bump();
        onCreated(res.data);
      } else if (res.status === 403) setDenied(res);
      else setError(res);
    } catch (e) {
      notify.apiError(e as Error, t('customer.tenants.create'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OverlayDrawer open={open} position="end" size="medium" onOpenChange={(_, d) => !d.open && !busy && onClose()} aria-label={t('customer.tenants.create')}>
      <DrawerHeader>
        <DrawerHeaderTitle action={<Button appearance="subtle" aria-label={t('common.close')} icon={<DismissRegular />} onClick={onClose} />}>
          <PersonAddRegular style={{ verticalAlign: '-3px', marginRight: 6 }} />
          {t('customer.createTenant.title')}
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        {result ? (
          <div className={s.form} data-tour="tenant-result">
            <MessageBar intent="success">
              <MessageBarBody>
                <MessageBarTitle>{t('customer.createTenant.onboarded', { name: result.name })}</MessageBarTitle>
                {t('customer.createTenant.resultBody', { id: result.id })}
              </MessageBarBody>
            </MessageBar>
            <div className={s.summary}>
              <span className={s.dt}>{t('customer.createTenant.sum.id')}</span>
              <span className={s.mono}>{result.id}</span>
              <span className={s.dt}>{t('customer.tenants.col.plan')}</span>
              <span>
                {tl(t, 'PLAN_LABELS', result.plan, PLAN_LABELS[result.plan])}
                {result.commitment ? t('customer.createTenant.sum.commitment', { amount: formatUsd(result.commitment.monthlyUsd, 0), pct: result.commitment.discountPct }) : ''}
              </span>
              <span className={s.dt}>{t('customer.tenants.col.tierPolicy')}</span>
              <span>
                {tl(t, 'TIER_POLICY_LABELS', result.allowedTiers, TIER_POLICY_LABELS[result.allowedTiers])}
                {result.excludeOrigins.length ? t('customer.createTenant.sum.excludes', { origins: result.excludeOrigins.map((o) => tl(t, 'ORIGIN_LABELS', o, ORIGIN_LABELS[o])).join(t('common.listSeparator')) }) : ''}
              </span>
              <span className={s.dt}>{t('customer.createTenant.sum.consent')}</span>
              <span>{result.crossBorderConsent ? t('customer.createTenant.sum.consentSigned', { regions: result.crossBorderConsent.regions.join(t('common.listSeparator')), date: L.fmtDate(result.crossBorderConsent.signedAt), by: result.crossBorderConsent.by }) : t('customer.createTenant.sum.consentNone')}</span>
              <span className={s.dt}>{t('customer.keys.col.models')}</span>
              <span>{result.allowedModels.length ? result.allowedModels.join(t('common.listSeparator')) : t('customer.tenants.unlimited')}</span>
              <span className={s.dt}>{t('common.quota')}</span>
              <span>
                {t('customer.createTenant.sum.quota', { rpm: L.fmtNumber(result.quotas.rpm), tpm: L.fmtNumber(result.quotas.tpm), budget: formatUsd(result.quotas.monthlyBudgetUsd, 0) })}
              </span>
              <span className={s.dt}>{t('customer.createTenant.sum.billing')}</span>
              <span>
                {t('customer.createTenant.sum.billingValue', { cc: result.costCenter, name: result.billingContact.name, email: result.billingContact.email })}
              </span>
            </div>
            <Text size={200}>
              {t('customer.createTenant.next1')}<Link href={`#/iam?scope=${encodeURIComponent(`/tenants/${result.id}`)}`}>{t('customer.tenant.iamButton')}</Link>{t('customer.createTenant.next2')}<Link href="#/keys">{t('customer.keys.title')}</Link>{t('customer.createTenant.next3')}<Link href="#/usage?tab=statement">{t('customer.createTenant.usageLink')}</Link>{t('customer.createTenant.next4')}
            </Text>
          </div>
        ) : (
          <div className={s.form} data-tour="tenant-form">
            {!canCreate && <PermissionDenied inline actionLabel={t('customer.tenants.create')} error={denied} />}
            {canCreate && denied && <PermissionDenied inline error={denied} />}
            {error && (
              <MessageBar intent="error" role="alert" data-tour="tenant-error">
                <MessageBarBody>
                  <MessageBarTitle>
                    {t('customer.createTenant.failed', { status: error.status, code: error.code })}
                  </MessageBarTitle>
                  {apiMessage(t, error)} requestId: {error.requestId}
                  {consentRequiredError && t('customer.createTenant.consentFix')}
                </MessageBarBody>
              </MessageBar>
            )}
            <Field label={t('customer.createTenant.nameLabel')} required validationState={nameError ? 'error' : 'none'} validationMessage={nameError}>
              <Input value={name} onChange={(_, d) => setName(d.value)} disabled={!canCreate} data-tour="tenant-name" />
            </Field>
            <Text className={s.section}>{t('customer.createTenant.planSection')}</Text>
            <RadioGroup value={plan} onChange={(_, d) => setPlan(d.value as TenantPlan)} disabled={!canCreate} data-tour="tenant-plan">
              {(Object.keys(PLAN_LABELS) as TenantPlan[]).map((p) => (
                <Radio key={p} value={p} label={`${tl(t, 'PLAN_LABELS', p, PLAN_LABELS[p])} — ${tl(t, 'PLAN_DESCRIPTIONS', p, PLAN_DESCRIPTIONS[p])}`} />
              ))}
            </RadioGroup>
            {plan === 'committed' && (
              <div className={s.row}>
                <Field label={t('customer.createTenant.commitUsd')} required hint={t('customer.createTenant.commitUsdHint')}>
                  <Input type="number" min={1} step={100} value={commitUsd} onChange={(_, d) => setCommitUsd(d.value)} disabled={!canCreate} />
                </Field>
                <Field label={t('customer.createTenant.commitPct')} hint={t('customer.createTenant.commitPctHint')}>
                  <Input type="number" min={0} max={50} value={commitPct} onChange={(_, d) => setCommitPct(d.value)} disabled={!canCreate} />
                </Field>
              </div>
            )}
            {plan === 'dedicated' && (
              <MessageBar intent="info">
                <MessageBarBody>{t('customer.createTenant.dedicatedNote')}</MessageBarBody>
              </MessageBar>
            )}
            <Text className={s.section}>{t('customer.createTenant.classSection')}</Text>
            <div className={s.row}>
              <Field label={t('customer.tenants.col.dataClass')} required>
                <Dropdown value={tl(t, 'DATA_CLASS_LABELS', dataClass, DATA_CLASS_LABELS[dataClass])} selectedOptions={[dataClass]} onOptionSelect={(_, d) => d.optionValue && setDataClass(d.optionValue as DataClass)} disabled={!canCreate} data-tour="tenant-dataclass">
                  {(Object.keys(DATA_CLASS_LABELS) as DataClass[]).map((k) => (
                    <Option key={k} value={k} text={tl(t, 'DATA_CLASS_LABELS', k, DATA_CLASS_LABELS[k])}>
                      {tl(t, 'DATA_CLASS_LABELS', k, DATA_CLASS_LABELS[k])}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
              <Field label={t('customer.tenants.col.tierPolicy')} required hint={publicSector ? t('customer.createTenant.tierHintPublic') : !consentActive ? t('customer.createTenant.tierHintNoConsent') : t('customer.createTenant.tierHintConsent')}>
                <Dropdown value={tl(t, 'TIER_POLICY_LABELS', effectiveTiers, TIER_POLICY_LABELS[effectiveTiers])} selectedOptions={[effectiveTiers]} onOptionSelect={(_, d) => d.optionValue && setTiers(d.optionValue as TierPolicy)} disabled={!canCreate || publicSector || !consentActive} data-tour="tenant-tier">
                  {(Object.keys(TIER_POLICY_LABELS) as TierPolicy[]).map((k) => (
                    <Option key={k} value={k} text={tl(t, 'TIER_POLICY_LABELS', k, TIER_POLICY_LABELS[k])} disabled={k !== 'local' && !consentActive}>
                      {tl(t, 'TIER_POLICY_LABELS', k, TIER_POLICY_LABELS[k])}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
            </div>
            {!publicSector && (
              <div data-tour="tenant-consent" className={s.form}>
                <Text className={s.section}>{t('customer.createTenant.consentSection')}</Text>
                <Field validationState={consentRequiredError ? 'error' : 'none'} validationMessage={consentRequiredError ? t('customer.createTenant.consentRequired') : undefined}>
                  <Checkbox label={t('customer.createTenant.consentCheck')} checked={consent} disabled={!canCreate} onChange={(_, d) => toggleConsent(!!d.checked)} data-tour="tenant-consent-check" />
                </Field>
                {!consent && <Text size={200}>{t('customer.createTenant.noConsentNote')}</Text>}
                {consent && (
                  <>
                    <Field label={t('customer.createTenant.regionsLabel')} required validationState={consentRegionsError ? 'error' : 'none'} validationMessage={consentRegionsError}>
                      <div className={s.models} role="group" aria-label={t('customer.createTenant.regionsAria')}>
                        {regionOptions.map((o) => (
                          <Checkbox key={o.region} label={o.label} checked={consentRegions.includes(o.region)} disabled={!canCreate} onChange={(_, d) => setConsentRegions((r) => (d.checked ? [...r, o.region] : r.filter((x) => x !== o.region)))} />
                        ))}
                        {regionOptions.length === 0 && <Text size={200}>{t('customer.createTenant.noProviders')}</Text>}
                      </div>
                    </Field>
                    <div className={s.row}>
                      <Field label={t('customer.createTenant.signedAt')} required>
                        <Input type="date" value={consentSignedAt} onChange={(_, d) => setConsentSignedAt(d.value)} disabled={!canCreate} />
                      </Field>
                      <Field label={t('customer.createTenant.signedBy')} hint={t('customer.createTenant.signedByHint')}>
                        <Input value={consentBy} onChange={(_, d) => setConsentBy(d.value)} disabled={!canCreate} placeholder={contactName} />
                      </Field>
                    </div>
                  </>
                )}
              </div>
            )}
            {publicSector && (
              <MessageBar intent="warning">
                <MessageBarBody>
                  <MessageBarTitle>{t('customer.createTenant.publicTitle')}</MessageBarTitle>
                  {tf(t, 'server.const.PUBLIC_SECTOR_NOTE', PUBLIC_SECTOR_NOTE)}
                </MessageBarBody>
              </MessageBar>
            )}
            <Text className={s.section}>{t('customer.createTenant.modelsSection')}</Text>
            <div className={s.models} role="group" aria-label={t('customer.createKey.modelsAria')} data-tour="tenant-models">
              {options.map((o) => {
                const b = blocked(o);
                return <Checkbox key={o.id} label={`${o.label}${b ? t('customer.createTenant.blocked') : ''}`} checked={allowed.includes(o.id) && !b} disabled={!canCreate || b} onChange={(_, d) => setAllowed((a) => (d.checked ? [...a, o.id] : a.filter((x) => x !== o.id)))} />;
              })}
            </div>
            <Text className={s.section}>{t('customer.createTenant.quotaSection')}</Text>
            <div className={s.row3}>
              <Field label="RPM" required>
                <Input type="number" min={1} value={rpm} onChange={(_, d) => setRpm(d.value)} disabled={!canCreate} />
              </Field>
              <Field label="TPM" required>
                <Input type="number" min={1} value={tpm} onChange={(_, d) => setTpm(d.value)} disabled={!canCreate} />
              </Field>
              <Field label={t('customer.createTenant.budget')} hint={t('customer.createTenant.budgetHint')}>
                <Input type="number" min={0} value={budget} onChange={(_, d) => setBudget(d.value)} disabled={!canCreate} />
              </Field>
            </div>
            <Field label={t('customer.tenant.costCenter')} required>
              <Input value={costCenter} onChange={(_, d) => setCostCenter(d.value)} disabled={!canCreate} />
            </Field>
            <div className={s.row}>
              <Field label={t('customer.createTenant.contact')} required>
                <Input value={contactName} onChange={(_, d) => setContactName(d.value)} disabled={!canCreate} />
              </Field>
              <Field label={t('customer.createTenant.email')} required validationState={touched && !emailOk ? 'error' : 'none'} validationMessage={touched && !emailOk ? t('customer.createTenant.emailInvalid') : undefined}>
                <Input type="email" value={contactEmail} onChange={(_, d) => setContactEmail(d.value)} disabled={!canCreate} />
              </Field>
            </div>
            <Text size={200}>{t('customer.createTenant.serverNote')}</Text>
          </div>
        )}
      </DrawerBody>
      <DrawerFooter>
        {result ? (
          <Button appearance="primary" onClick={onClose} data-tour="tenant-done">
            {t('common.done')}
          </Button>
        ) : (
          <>
            <Button appearance="primary" onClick={submit} disabled={busy || !canCreate || !canSubmit} icon={busy ? <Spinner size="tiny" /> : <PersonAddRegular />} data-tour="tenant-submit">
              {busy ? t('customer.common.creating') : t('customer.createTenant.submit')}
            </Button>
            <Button appearance="secondary" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
          </>
        )}
      </DrawerFooter>
    </OverlayDrawer>
  );
}
