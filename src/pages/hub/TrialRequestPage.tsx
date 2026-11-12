import { Badge, Button, Checkbox, Dialog, DialogBody, DialogContent, DialogSurface, DialogTitle, Dropdown, Field, Input, MessageBar, MessageBarBody, MessageBarTitle, Option, Radio, RadioGroup, Text, Textarea, makeStyles, shorthands, tokens } from '@fluentui/react-components';
import { AddRegular, CheckmarkCircleRegular, DeleteRegular, SendRegular } from '@fluentui/react-icons';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { CodeBlock } from '../../components/CodeBlock';
import { MODELS, MODALITY_LABELS, isLocalModel, type ModelInfo } from '../../data/models';
import { server, TRIAL_INVOICE_LABELS, TRIAL_ROUTING_LABELS, TRIAL_SCENARIO_LABELS, TRIAL_TERMS, TRIAL_USE_CASE_LABELS, type ApiError, type TrialInvoice, type TrialModelSpec, type TrialRequestInput, type TrialRouting, type TrialScenario, type TrialUseCase } from '../../server/api';
import { apiMessage, tf, tl, useT, type TFunction } from '../../i18n';

const useStyles = makeStyles({
  layout: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(240px, 300px)', columnGap: tokens.spacingHorizontalL, rowGap: tokens.spacingVerticalL, '@media (max-width: 1000px)': { gridTemplateColumns: 'minmax(0, 1fr)' } },
  form: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalL, minWidth: 0 },
  section: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM, padding: tokens.spacingVerticalL, borderRadius: tokens.borderRadiusLarge, ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2), backgroundColor: tokens.colorNeutralBackground1 },
  h2: { fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold, margin: 0, display: 'flex', alignItems: 'center', columnGap: tokens.spacingHorizontalS },
  num: { display: 'inline-flex', width: '24px', height: '24px', borderRadius: '50%', alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.colorBrandBackground, color: tokens.colorNeutralForegroundOnBrand, fontSize: tokens.fontSizeBase200 },
  row: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', columnGap: tokens.spacingHorizontalM, rowGap: tokens.spacingVerticalS, '& .fui-Dropdown': { minWidth: 0, width: '100%' }, '& .fui-Input': { minWidth: 0, width: '100%' } },
  terms: { margin: 0, paddingLeft: '1.2em', color: tokens.colorNeutralForeground2, lineHeight: tokens.lineHeightBase300 },
  modelRow: { display: 'grid', gridTemplateColumns: 'minmax(200px, 2fr) repeat(4, minmax(90px, 1fr)) auto', columnGap: tokens.spacingHorizontalS, rowGap: tokens.spacingVerticalXS, alignItems: 'end', '@media (max-width: 900px)': { gridTemplateColumns: '1fr 1fr' }, '@media (max-width: 600px)': { gridTemplateColumns: 'minmax(0, 1fr)' }, '& .fui-Dropdown': { minWidth: 0, width: '100%' }, '& .fui-Input': { minWidth: 0, width: '100%' } },
  checks: { display: 'flex', flexWrap: 'wrap', columnGap: tokens.spacingHorizontalM },
  aside: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  note: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  actions: { display: 'flex', columnGap: tokens.spacingHorizontalS, alignItems: 'center', flexWrap: 'wrap' },
});


const CATALOG: ModelInfo[] = MODELS.filter((m) => m.status !== 'legacy' && m.status !== 'deprecated');
const SCENARIOS = Object.keys(TRIAL_SCENARIO_LABELS) as TrialScenario[];
const USE_CASES = Object.keys(TRIAL_USE_CASE_LABELS) as TrialUseCase[];

function emptyModel(modelId = 'qwen3.8-27b-vllm'): TrialModelSpec {
  return { modelId, rpm: 60, tpm: 100_000, ttftMs: 800, cacheHitPct: 30 };
}

/** 示範預填值（Demo 可直接送出；正式環境為空白表單） */
function demoDefaults(t: TFunction): TrialRequestInput {
  return {
    accountName: 'acme-eval',
    ipAllowlist: false,
    models: [emptyModel('qwen3.8-27b-vllm'), { ...emptyModel('gpt-oss-120b-vllm'), rpm: 30, tpm: 60_000, ttftMs: 1200, cacheHitPct: 20 }],
    scenarios: ['text', 'tools'],
    useCase: 'customer-service',
    useCaseOther: '',
    routing: 'cost',
    monthlyInputTokens: 50_000_000,
    monthlyOutputTokens: 10_000_000,
    peakConcurrency: 20,
    dataResidencyTw: true,
    publicSector: false,
    invoice: 'twd-einvoice',
    otherNeeds: t('hub.trial.demo.otherNeeds'),
    company: t('hub.trial.demo.company'),
    companyShort: 'ACME',
    contactName: t('hub.trial.demo.contactName'),
    email: 'eval@acme.example',
    phone: '02-1234-5678',
  };
}

const num = (v: string) => (v.trim() === '' ? 0 : Number(v));

/**
 * 申請測試（Testing Questionnaire）：公開表單（不需登入），5 段式問卷；送出後由平台在「試用申請」頁審核。
 * 伺服器端驗證、速率限制並寫入稽核（actor = public），不會建立租戶或金鑰。
 */
export function TrialRequestPage() {
  const s = useStyles();
  const t = useT();
  const navigate = useNavigate();
  const [f, setF] = useState<TrialRequestInput>(() => demoDefaults(t));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [doneId, setDoneId] = useState<string | null>(null);
  const set = <K extends keyof TrialRequestInput>(k: K, v: TrialRequestInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const setModel = (i: number, patch: Partial<TrialModelSpec>) => setF((x) => ({ ...x, models: x.models.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));
  const modelName = (m: ModelInfo) => tf(t, `data.model.${m.id}.displayName`, m.displayName);
  const yes = t('common.yes');
  const no = t('common.no');

  useEffect(() => {
    if (!doneId) return;
    const timer = window.setTimeout(() => navigate('/hub'), 2500);
    return () => window.clearTimeout(timer);
  }, [doneId, navigate]);

  const summary = useMemo(() => {
    const local = f.models.filter((m) => isLocalModel(MODELS.find((x) => x.id === m.modelId) ?? MODELS[0])).length;
    return { total: f.models.length, local, cloud: f.models.length - local };
  }, [f.models]);
  const localOnly = f.dataResidencyTw || f.publicSector;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await server.submitTrialRequest(f);
      if (!res.ok) setErr(res);
      else setDoneId(res.data.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={t('hub.trial.title')}
        subtitle={t('hub.trial.subtitle')}
        crumbs={[{ label: t('hub.trial.crumbHub'), to: '/hub' }, { label: t('hub.trial.crumb') }]}
        actions={
          <Badge appearance="tint" color="brand" size="large">
            {t('hub.page.badgePreview')}
          </Badge>
        }
      />
      <div className={s.layout}>
        <form
          className={s.form}
          data-tour="trial-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          aria-label={t('hub.trial.formAria')}
        >
          <section className={s.section} aria-labelledby="t-s1">
            <h2 id="t-s1" className={s.h2}>
              <span className={s.num}>1</span>
              {t('hub.trial.s1.title')}
            </h2>
            <ul className={s.terms}>
              <li>{t('hub.trial.s1.term1', { usd: TRIAL_TERMS.freeCreditUsd })}</li>
              <li>{t('hub.trial.s1.term2', { days: TRIAL_TERMS.periodBusinessDays })}</li>
              <li>{t('hub.trial.s1.term3', { days: TRIAL_TERMS.extendNoticeDays })}</li>
              <li>{t('hub.trial.s1.term4')}</li>
            </ul>
            <div className={s.row}>
              <Field label={t('hub.trial.s1.account')} hint={t('hub.trial.s1.accountHint')} required>
                <Input value={f.accountName} onChange={(_, d) => set('accountName', d.value)} data-tour="trial-account" />
              </Field>
              <Field label={t('hub.trial.s1.ipAllowlist')}>
                <RadioGroup layout="horizontal" value={f.ipAllowlist ? 'yes' : 'no'} onChange={(_, d) => set('ipAllowlist', d.value === 'yes')}>
                  <Radio value="yes" label={yes} />
                  <Radio value="no" label={no} />
                </RadioGroup>
              </Field>
            </div>
          </section>

          <section className={s.section} aria-labelledby="t-s2">
            <h2 id="t-s2" className={s.h2}>
              <span className={s.num}>2</span>
              {t('hub.trial.s2.title')}
            </h2>
            <Text className={s.note}>{t('hub.trial.s2.note')}</Text>
            {f.models.map((m, i) => {
              const info = CATALOG.find((x) => x.id === m.modelId);
              return (
                <div key={i} className={s.modelRow} data-tour={i === 0 ? 'trial-model-row' : undefined}>
                  <Field label={t('hub.trial.s2.model', { n: i + 1 })} hint={info ? `${isLocalModel(info) ? t('hub.trial.s2.local') : t('hub.trial.s2.cloud')} · ${tl(t, 'MODALITY_LABELS', info.modality, MODALITY_LABELS[info.modality])}` : undefined}>
                    <Dropdown value={info ? modelName(info) : m.modelId} selectedOptions={[m.modelId]} onOptionSelect={(_, d) => d.optionValue && setModel(i, { modelId: d.optionValue })} aria-label={t('hub.trial.s2.model', { n: i + 1 })}>
                      {CATALOG.map((c) => (
                        <Option key={c.id} value={c.id} text={modelName(c)}>
                          {modelName(c)}
                        </Option>
                      ))}
                    </Dropdown>
                  </Field>
                  <Field label={t('hub.trial.s2.rpm')}>
                    <Input type="number" min={0} value={String(m.rpm)} onChange={(_, d) => setModel(i, { rpm: num(d.value) })} />
                  </Field>
                  <Field label={t('hub.trial.s2.tpm')}>
                    <Input type="number" min={0} value={String(m.tpm)} onChange={(_, d) => setModel(i, { tpm: num(d.value) })} />
                  </Field>
                  <Field label={t('hub.trial.s2.ttft')}>
                    <Input type="number" min={0} value={String(m.ttftMs)} onChange={(_, d) => setModel(i, { ttftMs: num(d.value) })} />
                  </Field>
                  <Field label={t('hub.trial.s2.cacheHit')}>
                    <Input type="number" min={0} max={100} value={String(m.cacheHitPct)} onChange={(_, d) => setModel(i, { cacheHitPct: num(d.value) })} />
                  </Field>
                  <Button appearance="subtle" icon={<DeleteRegular />} aria-label={t('hub.trial.s2.remove', { n: i + 1 })} disabled={f.models.length <= 1} onClick={() => set('models', f.models.filter((_, j) => j !== i))} />
                </div>
              );
            })}
            <div>
              <Button icon={<AddRegular />} onClick={() => set('models', [...f.models, emptyModel('llama-3.3-70b-vllm')])} data-tour="trial-add-model">
                {t('hub.trial.s2.addRow')}
              </Button>
            </div>
          </section>

          <section className={s.section} aria-labelledby="t-s3">
            <h2 id="t-s3" className={s.h2}>
              <span className={s.num}>3</span>
              {t('hub.trial.s3.title')}
            </h2>
            <Field label={t('hub.trial.s3.scenarios')} hint={t('hub.trial.s3.scenariosHint')}>
              <div className={s.checks} role="group" aria-label={t('hub.trial.s3.scenariosAria')}>
                {SCENARIOS.map((sc) => (
                  <Checkbox key={sc} label={tl(t, 'TRIAL_SCENARIO_LABELS', sc, TRIAL_SCENARIO_LABELS[sc])} checked={f.scenarios.includes(sc)} onChange={(_, d) => set('scenarios', d.checked ? [...f.scenarios, sc] : f.scenarios.filter((x) => x !== sc))} />
                ))}
              </div>
            </Field>
            <div className={s.row}>
              <Field label={t('hub.trial.s3.useCase')}>
                <Dropdown value={tl(t, 'TRIAL_USE_CASE_LABELS', f.useCase, TRIAL_USE_CASE_LABELS[f.useCase])} selectedOptions={[f.useCase]} onOptionSelect={(_, d) => d.optionValue && set('useCase', d.optionValue as TrialUseCase)} aria-label={t('hub.trial.s3.useCaseAria')}>
                  {USE_CASES.map((u) => (
                    <Option key={u} value={u}>
                      {tl(t, 'TRIAL_USE_CASE_LABELS', u, TRIAL_USE_CASE_LABELS[u])}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
              {f.useCase === 'other' && (
                <Field label={t('hub.trial.s3.useCaseOther')} required>
                  <Input value={f.useCaseOther ?? ''} onChange={(_, d) => set('useCaseOther', d.value)} />
                </Field>
              )}
              <Field label={t('hub.trial.s3.routing')}>
                <RadioGroup layout="horizontal" value={f.routing} onChange={(_, d) => set('routing', d.value as TrialRouting)}>
                  {(Object.keys(TRIAL_ROUTING_LABELS) as TrialRouting[]).map((r) => (
                    <Radio key={r} value={r} label={tl(t, 'TRIAL_ROUTING_LABELS', r, TRIAL_ROUTING_LABELS[r])} />
                  ))}
                </RadioGroup>
              </Field>
            </div>
            <div className={s.row}>
              <Field label={t('hub.trial.s3.monthlyInput')}>
                <Input type="number" min={0} value={String(f.monthlyInputTokens)} onChange={(_, d) => set('monthlyInputTokens', num(d.value))} />
              </Field>
              <Field label={t('hub.trial.s3.monthlyOutput')}>
                <Input type="number" min={0} value={String(f.monthlyOutputTokens)} onChange={(_, d) => set('monthlyOutputTokens', num(d.value))} />
              </Field>
              <Field label={t('hub.trial.s3.peak')}>
                <Input type="number" min={0} value={String(f.peakConcurrency)} onChange={(_, d) => set('peakConcurrency', num(d.value))} />
              </Field>
            </div>
            <Text weight="semibold">{t('hub.trial.s3.localNeeds')}</Text>
            <div className={s.row}>
              <Field label={t('hub.trial.s3.residency')} hint={t('hub.trial.s3.residencyHint')}>
                <RadioGroup layout="horizontal" value={f.dataResidencyTw ? 'yes' : 'no'} onChange={(_, d) => set('dataResidencyTw', d.value === 'yes')} disabled={f.publicSector}>
                  <Radio value="yes" label={yes} />
                  <Radio value="no" label={no} />
                </RadioGroup>
              </Field>
              <Field label={t('hub.trial.s3.publicSector')}>
                <RadioGroup layout="horizontal" value={f.publicSector ? 'yes' : 'no'} onChange={(_, d) => set('publicSector', d.value === 'yes')} data-tour="trial-public-sector">
                  <Radio value="yes" label={yes} />
                  <Radio value="no" label={no} />
                </RadioGroup>
              </Field>
              <Field label={t('hub.trial.s3.invoice')}>
                <RadioGroup layout="horizontal" value={f.invoice} onChange={(_, d) => set('invoice', d.value as TrialInvoice)}>
                  {(Object.keys(TRIAL_INVOICE_LABELS) as TrialInvoice[]).map((v) => (
                    <Radio key={v} value={v} label={tl(t, 'TRIAL_INVOICE_LABELS', v, TRIAL_INVOICE_LABELS[v])} />
                  ))}
                </RadioGroup>
              </Field>
            </div>
            {f.publicSector && (
              <MessageBar intent="warning" data-tour="trial-public-note">
                <MessageBarBody>
                  <MessageBarTitle>{t('hub.trial.s3.publicTitle')}</MessageBarTitle>
                  {t('hub.trial.s3.publicBody')}
                </MessageBarBody>
              </MessageBar>
            )}
          </section>

          <section className={s.section} aria-labelledby="t-s4">
            <h2 id="t-s4" className={s.h2}>
              <span className={s.num}>4</span>
              {t('hub.trial.s4.title')}
            </h2>
            <Field label={t('hub.trial.s4.otherNeeds')}>
              <Textarea value={f.otherNeeds} onChange={(_, d) => set('otherNeeds', d.value)} rows={3} resize="vertical" />
            </Field>
          </section>

          <section className={s.section} aria-labelledby="t-s5">
            <h2 id="t-s5" className={s.h2}>
              <span className={s.num}>5</span>
              {t('hub.trial.s5.title')}
            </h2>
            <div className={s.row}>
              <Field label={t('hub.trial.s5.company')} required>
                <Input value={f.company} onChange={(_, d) => set('company', d.value)} />
              </Field>
              <Field label={t('hub.trial.s5.companyShort')}>
                <Input value={f.companyShort} onChange={(_, d) => set('companyShort', d.value)} />
              </Field>
              <Field label={t('hub.trial.s5.contact')} required>
                <Input value={f.contactName} onChange={(_, d) => set('contactName', d.value)} data-tour="trial-contact" />
              </Field>
              <Field label="Email" required>
                <Input type="email" value={f.email} onChange={(_, d) => set('email', d.value)} />
              </Field>
              <Field label={t('hub.trial.s5.phone')}>
                <Input value={f.phone} onChange={(_, d) => set('phone', d.value)} />
              </Field>
            </div>
          </section>

          {err && (
            <MessageBar intent={err.status === 429 ? 'warning' : 'error'} role="alert">
              <MessageBarBody>
                <MessageBarTitle>
                  {err.status} {err.code}
                </MessageBarTitle>
                {apiMessage(t, err)} requestId: {err.requestId}
              </MessageBarBody>
            </MessageBar>
          )}
          <div className={s.actions}>
            <Button type="submit" appearance="primary" icon={<SendRegular />} disabled={busy} data-tour="trial-submit">
              {t('hub.trial.submit')}
            </Button>
            <Button appearance="secondary" onClick={() => navigate('/hub')}>
              {t('hub.trial.backToHub')}
            </Button>
            <Text className={s.note}>{t('hub.trial.consent')}</Text>
          </div>
        </form>

        <aside className={s.aside} aria-label={t('hub.trial.summaryAria')}>
          <div className={s.section}>
            <Text weight="semibold">{t('hub.trial.summaryTitle')}</Text>
            <Text size={200}>
              {t('hub.trial.summaryModels', { total: summary.total, local: summary.local, cloud: summary.cloud })}
              {f.scenarios.map((x) => tl(t, 'TRIAL_SCENARIO_LABELS', x, TRIAL_SCENARIO_LABELS[x])).join(t('hub.sep.list')) || t('hub.trial.noScenario')}
            </Text>
            <Text size={200}>
              {t('hub.trial.summaryTier', { tier: localOnly ? '@hub.trial.tierLocalOnly' : '@hub.trial.tierSpillover' })} · {tl(t, 'TRIAL_INVOICE_LABELS', f.invoice, TRIAL_INVOICE_LABELS[f.invoice])}
            </Text>
            {localOnly && summary.cloud > 0 && (
              <MessageBar intent="info">
                <MessageBarBody>{t('hub.trial.cloudDropped', { n: summary.cloud })}</MessageBarBody>
              </MessageBar>
            )}
            <Text className={s.note}>{t('hub.trial.afterApproval', { usd: TRIAL_TERMS.freeCreditUsd, days: TRIAL_TERMS.periodBusinessDays })}</Text>
          </div>
          <div className={s.section}>
            <Text weight="semibold">{t('hub.trial.firstCallTitle')}</Text>
            <CodeBlock code={`curl https://api.maas.example/v1/chat/completions \\\n  -H "Authorization: Bearer sk-maas-…" \\\n  -d '{"model":"${f.models[0]?.modelId ?? 'qwen3.8-27b-vllm'}","messages":[{"role":"user","content":"${t('hub.trial.firstCallHello')}"}]}'`} label={t('hub.trial.firstCallLabel')} />
          </div>
        </aside>
      </div>

      <Dialog open={!!doneId} modalType="modal" onOpenChange={() => undefined}>
        <DialogSurface data-tour="trial-done">
          <DialogBody>
            <DialogTitle>
              <CheckmarkCircleRegular style={{ verticalAlign: '-3px', marginRight: 6, color: tokens.colorPaletteGreenForeground1 }} />
              {t('hub.trial.doneTitle')}
            </DialogTitle>
            <DialogContent>
              <Text>
                {t('hub.trial.doneIdPrefix')}
                <code>{doneId}</code>
                {t('hub.trial.doneBody', { usd: TRIAL_TERMS.freeCreditUsd, days: TRIAL_TERMS.periodBusinessDays, email: f.email })}
              </Text>
            </DialogContent>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}
