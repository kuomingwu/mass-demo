import { Badge, Button, Dropdown, Field, Input, Link, MessageBar, MessageBarBody, MessageBarTitle, Option, Slider, Switch, Text, Textarea, makeStyles, tokens } from '@fluentui/react-components';
import { SendRegular, StopRegular } from '@fluentui/react-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { PermissionDenied } from '../components/States';
import { CodeBlock } from '../components/CodeBlock';
import { useNotify } from '../components/Notify';
import { server, type ApiError, type PlaygroundResult } from '../server/api';
import { useSession } from '../app/SessionContext';
import { MODELS, MODEL_BY_ID, MODALITY_LABELS, PLATFORM_BASE_URL, REGION_LABELS, UNIT_TYPE_LABELS, isLocalModel, isMediaModality, isQwen3x } from '../data/models';
import { ImageRegular, MicRegular, VideoClipRegular } from '@fluentui/react-icons';
import { apiMessage, tenantLabel, tf, tl, useLocale, useT, type TFunction } from '../i18n';

/** x-maas-deny-reason（429 local_capacity_exhausted）的說明：值 → 字典鍵 */
export const DENY_REASON_LABELS: Record<string, string> = {
  no_cross_border_consent: 'customer.pg.deny.no_cross_border_consent',
  tenant_local_only: 'customer.pg.deny.tenant_local_only',
  route_local_only: 'customer.pg.deny.route_local_only',
  region_not_allowed: 'customer.pg.deny.region_not_allowed',
};
/** x-maas-policy（400／429 時）的說明：值 → 字典鍵 */
const POLICY_LABELS: Record<string, string> = {
  'local-only': 'customer.pg.policy.localOnly',
  'origin-excluded': 'customer.pg.policy.originExcluded',
  no_cross_border_consent: 'customer.pg.policy.noConsent',
};
/** 回應標頭的註解（實際服務者揭露） */
function headerNote(t: TFunction, key: string, value: string): string | null {
  switch (key) {
    case 'x-maas-model':
      return MODEL_BY_ID[value] ? tf(t, `data.model.${value}.displayName`, MODEL_BY_ID[value].displayName) : null;
    case 'x-maas-region':
      return REGION_LABELS[value] ? tl(t, 'REGION_LABELS', value, REGION_LABELS[value]) : value.startsWith('tw-') ? t('customer.pg.note.twDc') : null;
    case 'x-maas-deny-reason':
      return DENY_REASON_LABELS[value] ? t(DENY_REASON_LABELS[value]) : null;
    case 'x-maas-policy':
      return POLICY_LABELS[value] ? t(POLICY_LABELS[value]) : null;
    case 'x-maas-tier':
      return value === 'local' ? t('customer.pg.note.tierLocal') : value === 'spillover' ? t('customer.pg.note.tierSpillover') : value === 'external' ? t('customer.pg.note.tierExternal') : null;
    case 'x-maas-retention':
      return value === 'zero' ? t('customer.pg.note.retentionZero') : value === '30d' ? t('customer.pg.note.retention30d') : null;
    case 'x-maas-balance':
      return value === 'postpaid' ? t('customer.pg.note.balancePostpaid') : t('customer.pg.note.balancePrepaid');
    default:
      return null;
  }
}
import { PROJECTS, TENANTS, DATA_CLASS_LABELS, TIER_POLICY_LABELS } from '../server/seed';
import { projectScope } from '../auth/scope';
import { PROVIDER_NAMES } from '../theme/chartPalette';
import { LicenseObligationBadges, LicenseObligationList, licenseObligations } from '../components/LicenseObligations';

const useStyles = makeStyles({
  layout: { display: 'grid', gridTemplateColumns: 'minmax(260px, 320px) minmax(0, 1fr) minmax(260px, 380px)', gap: tokens.spacingHorizontalM, '@media (max-width: 1200px)': { gridTemplateColumns: 'minmax(240px, 300px) minmax(0, 1fr)' }, '@media (max-width: 800px)': { gridTemplateColumns: '1fr' } },
  panel: { backgroundColor: tokens.colorNeutralBackground1, borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px', borderTopStyle: 'solid', borderRightStyle: 'solid', borderBottomStyle: 'solid', borderLeftStyle: 'solid', borderTopColor: tokens.colorNeutralStroke2, borderRightColor: tokens.colorNeutralStroke2, borderBottomColor: tokens.colorNeutralStroke2, borderLeftColor: tokens.colorNeutralStroke2, borderRadius: tokens.borderRadiusLarge, padding: tokens.spacingVerticalM, display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM, minWidth: 0 },
  chat: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalS, minHeight: '320px', maxHeight: '60vh', overflowY: 'auto', padding: tokens.spacingVerticalS, backgroundColor: tokens.colorNeutralBackground2, borderRadius: tokens.borderRadiusMedium },
  msg: { padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`, borderRadius: tokens.borderRadiusLarge, maxWidth: '85%', whiteSpace: 'pre-wrap', fontSize: tokens.fontSizeBase300, lineHeight: tokens.lineHeightBase300 },
  user: { alignSelf: 'flex-end', backgroundColor: tokens.colorBrandBackground2, color: tokens.colorNeutralForeground1 },
  assistant: { alignSelf: 'flex-start', backgroundColor: tokens.colorNeutralBackground1, borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px', borderTopStyle: 'solid', borderRightStyle: 'solid', borderBottomStyle: 'solid', borderLeftStyle: 'solid', borderTopColor: tokens.colorNeutralStroke2, borderRightColor: tokens.colorNeutralStroke2, borderBottomColor: tokens.colorNeutralStroke2, borderLeftColor: tokens.colorNeutralStroke2 },
  role: { fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3, marginBottom: '2px' },
  composer: { display: 'flex', columnGap: tokens.spacingHorizontalS, alignItems: 'flex-end' },
  stats: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: tokens.spacingHorizontalS },
  stat: { display: 'flex', flexDirection: 'column', padding: tokens.spacingVerticalS, backgroundColor: tokens.colorNeutralBackground2, borderRadius: tokens.borderRadiusMedium },
  statLabel: { fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3 },
  statValue: { fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold, fontVariantNumeric: 'tabular-nums' },
  thirdCol: { '@media (max-width: 1200px)': { gridColumn: '1 / -1' } },
  headers: { margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: tokens.spacingHorizontalS, rowGap: '2px', fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
  hk: { color: tokens.colorNeutralForeground3 },
  hv: { margin: 0, wordBreak: 'break-all' },
  media: { alignSelf: 'flex-start', maxWidth: '85%', display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalS, padding: tokens.spacingVerticalM, borderRadius: tokens.borderRadiusLarge, backgroundColor: tokens.colorNeutralBackground1, borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px', borderTopStyle: 'solid', borderRightStyle: 'solid', borderBottomStyle: 'solid', borderLeftStyle: 'solid', borderTopColor: tokens.colorNeutralStroke2, borderRightColor: tokens.colorNeutralStroke2, borderBottomColor: tokens.colorNeutralStroke2, borderLeftColor: tokens.colorNeutralStroke2 },
  mediaArt: { display: 'flex', alignItems: 'center', justifyContent: 'center', columnGap: tokens.spacingHorizontalS, minHeight: '120px', borderRadius: tokens.borderRadiusMedium, backgroundColor: tokens.colorNeutralBackground3, color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, padding: tokens.spacingVerticalM },
});

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

export function PlaygroundPage() {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const modalityLabel = (m: keyof typeof MODALITY_LABELS) => tl(t, 'MODALITY_LABELS', m, MODALITY_LABELS[m]);
  const unitLabel = (u: keyof typeof UNIT_TYPE_LABELS) => tl(t, 'UNIT_TYPE_LABELS', u, UNIT_TYPE_LABELS[u]);
  const modelName = (m: { id: string; displayName: string }) => tf(t, `data.model.${m.id}.displayName`, m.displayName);
  const { session, canUi, principal, version } = useSession();
  const notify = useNotify();
  const [params] = useSearchParams();
  const requestedModel = params.get('model');
  const projects = useMemo(() => PROJECTS.filter((p) => p.status === 'active' && canUi('playground.invoke', projectScope(p.tenantId, p.id))), [canUi, principal]);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  // 可在 Playground 呼叫的模型：文字／視覺（串流）與圖像／影片／語音（模擬產物卡）；嵌入／重排以 API 呼叫
  const chatModels = useMemo(() => MODELS.filter((m) => m.modality !== 'embedding' && m.modality !== 'rerank' && m.status !== 'deprecated'), []);
  const [modelId, setModelId] = useState(() => (requestedModel && chatModels.some((m) => m.id === requestedModel) ? requestedModel : 'qwen3.8-27b-vllm'));
  // 來自模型中心「試用」的 ?model= 預選
  useEffect(() => {
    if (requestedModel && chatModels.some((m) => m.id === requestedModel)) setModelId(requestedModel);
  }, [requestedModel, chatModels]);
  const [system, setSystem] = useState(() => t('customer.pg.defaultSystem'));
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [thinking, setThinking] = useState(false);
  const [input, setInput] = useState(() => t('customer.pg.defaultInput'));
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState<ApiError | null>(null);
  const [apiErr, setApiErr] = useState<ApiError | null>(null);
  const [last, setLast] = useState<PlaygroundResult | null>(null);
  /** 回應標頭在串流開始前就到達（如同真實 HTTP 回應），不必等串流結束 */
  const [liveHeaders, setLiveHeaders] = useState<Record<string, string> | null>(null);
  const [liveTtft, setLiveTtft] = useState<number | null>(null);
  const [liveTokens, setLiveTokens] = useState(0);
  const timer = useRef<number | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projects.find((p) => p.id === projectId)) setProjectId(projects[0]?.id ?? '');
  }, [projects, projectId]);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    const el = chatRef.current;
    if (el && typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight });
  }, [messages]);
  // 設定頁切換模擬開關後清除舊錯誤
  useEffect(() => setApiErr(null), [version]);

  const project = projects.find((p) => p.id === projectId);
  const tenant = project ? TENANTS.find((x) => x.id === project.tenantId) : undefined;
  const tenantLocalOnly = !!tenant && (tenant.dataClass === 'public-sector' || tenant.allowedTiers === 'local');
  const model = chatModels.find((m) => m.id === modelId) ?? chatModels[0];
  const isMedia = isMediaModality(model.modality);
  const canInvoke = !!project;

  const curlPreview = useMemo(() => {
    const body: Record<string, unknown> = {
      model: model.id,
      messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages.filter((m) => !m.streaming).map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: input }],
      temperature,
      max_tokens: maxTokens,
      stream: true,
    };
    if (isQwen3x(model.id)) body.extra_body = { enable_thinking: thinking };
    return `curl -i ${PLATFORM_BASE_URL}/chat/completions \\\n  -H "Authorization: Bearer $MAAS_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body, null, 2)}'`;
  }, [model.id, system, messages, input, temperature, maxTokens, thinking]);

  const stop = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setBusy(false);
    setMessages((ms) => ms.map((m) => ({ ...m, streaming: false })));
  };

  const send = async () => {
    if (!project || !input.trim() || busy) return;
    const userMsg: Msg = { role: 'user', content: input.trim() };
    const history = [...messages.filter((m) => !m.streaming), userMsg];
    setMessages([...history, { role: 'assistant', content: '', streaming: true }]);
    setInput('');
    setBusy(true);
    setDenied(null);
    setApiErr(null);
    setLast(null);
    setLiveHeaders(null);
    setLiveTtft(null);
    setLiveTokens(0);
    const t0 = performance.now();
    try {
      const res = await server.invokePlayground(session, {
        modelId: model.id,
        tenantId: project.tenantId,
        projectId: project.id,
        system,
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        temperature,
        maxTokens,
        enableThinking: thinking,
      });
      if (!res.ok) {
        setMessages(history);
        setBusy(false);
        if (res.status === 403) setDenied(res);
        else if (res.status === 429 || res.status === 503 || res.status === 402 || res.code === 'TIER_NOT_ALLOWED') setApiErr(res);
        else notify.apiError(res, t('customer.pg.invokeContext'));
        return;
      }
      const data = res.data;
      setLiveHeaders(data.headers);
      setLiveTtft(Math.round(performance.now() - t0 + data.ttftMs));
      if (data.media) {
        // 非文字模態：不串流，直接放上模擬產物卡
        timer.current = window.setTimeout(() => {
          setMessages((ms) => ms.map((m) => ({ ...m, streaming: false, content: m.streaming ? `[${modalityLabel(data.requestedModel.modality)}] ${data.media!.artifact}` : m.content })));
          setLast(data);
          setBusy(false);
        }, Math.min(data.ttftMs, 900));
        return;
      }
      // 模擬逐 token 串流
      let i = 0;
      const step = () => {
        i += 1;
        setLiveTokens(i);
        setMessages((ms) => ms.map((m, idx) => (idx === ms.length - 1 ? { ...m, content: data.tokens.slice(0, i).join('') } : m)));
        if (i < data.tokens.length) {
          timer.current = window.setTimeout(step, 18 + Math.random() * 30);
        } else {
          setMessages((ms) => ms.map((m) => ({ ...m, streaming: false })));
          setLast(data);
          setBusy(false);
        }
      };
      timer.current = window.setTimeout(step, data.ttftMs);
    } catch (e) {
      setMessages(history);
      setBusy(false);
      notify.apiError(e as Error, t('customer.pg.invokeContext'));
    }
  };

  const headers = last?.headers ?? liveHeaders ?? apiErr?.headers ?? null;

  return (
    <>
      <PageHeader title="Playground" subtitle={t('customer.pg.subtitle')} crumbs={[{ label: 'Playground' }]} />
      {projects.length === 0 && <PermissionDenied actionLabel={t('customer.pg.invokeAction')} />}
      {projects.length > 0 && (
        <div className={s.layout}>
          <aside className={s.panel} aria-label={t('customer.pg.paramsAria')}>
            <Field label={t('customer.pg.projectLabel')} hint={tenant ? `${tenantLabel(t, tenant.id, tenant.name)} · ${tl(t, 'DATA_CLASS_LABELS', tenant.dataClass, DATA_CLASS_LABELS[tenant.dataClass])} · ${tl(t, 'TIER_POLICY_LABELS', tenant.allowedTiers, TIER_POLICY_LABELS[tenant.allowedTiers])}` : undefined}>
              <Dropdown data-tour="pg-project" value={project ? t('customer.common.projectOption', { project: project.name, tenant: tenantLabel(t, tenant?.id, tenant?.name) }) : ''} selectedOptions={[projectId]} onOptionSelect={(_, d) => d.optionValue && setProjectId(d.optionValue)}>
                {projects.map((p) => (
                  <Option key={p.id} value={p.id} text={t('customer.common.projectOption', { project: p.name, tenant: TENANTS.find((x) => x.id === p.tenantId)?.name ?? '' })}>
                    {t('customer.common.projectOption', { project: p.name, tenant: TENANTS.find((x) => x.id === p.tenantId)?.name ?? '' })}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            {tenantLocalOnly && (
              <MessageBar intent="warning">
                <MessageBarBody>{t('customer.pg.localOnly')}</MessageBarBody>
              </MessageBar>
            )}
            <Field label={t('common.model')} hint={`${isLocalModel(model) ? t('customer.pg.modelHintLocal') : t('customer.pg.modelHintCloud', { provider: tl(t, 'PROVIDER_NAMES', model.providerId, PROVIDER_NAMES[model.providerId]) })} · ${isMedia ? t('customer.pg.modelHintMedia', { modality: modalityLabel(model.modality), unit: unitLabel(model.unitType), price: model.priceInput }) : t('customer.pg.modelHintContext', { n: L.fmtNumber(model.contextLength) })}`}>
              <Dropdown data-tour="pg-model" value={modelName(model)} selectedOptions={[model.id]} onOptionSelect={(_, d) => d.optionValue && setModelId(d.optionValue)} aria-label={t('common.model')}>
                {chatModels.map((m) => (
                  <Option key={m.id} value={m.id} text={modelName(m)}>
                    {modelName(m)}
                    {isLocalModel(m) ? '' : tenantLocalOnly ? t('customer.pg.cloudWillReject') : ''}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            {isMedia && (
              <MessageBar intent="info" data-tour="pg-modality" layout="multiline">
                <MessageBarBody>
                  <MessageBarTitle>{t('customer.pg.mediaTitle', { modality: modalityLabel(model.modality) })}</MessageBarTitle>
                  {t('customer.pg.mediaBody', { unit: unitLabel(model.unitType), price: model.priceInput, endpoint: model.modality === 'image' ? '/v1/images/generations' : model.modality === 'video' ? '/v1/videos' : '/v1/audio/*' })}
                </MessageBarBody>
              </MessageBar>
            )}
            {licenseObligations(model).length > 0 && (
              <MessageBar intent="info" data-tour="pg-license" layout="multiline">
                <MessageBarBody>
                  <MessageBarTitle>
                    {t('customer.pg.license')} <LicenseObligationBadges model={model} />
                  </MessageBarTitle>
                  <LicenseObligationList model={model} />
                </MessageBarBody>
              </MessageBar>
            )}
            <Field label="System prompt">
              <Textarea value={system} onChange={(_, d) => setSystem(d.value)} rows={4} resize="vertical" />
            </Field>
            <Field label={t('customer.pg.temperature', { v: temperature.toFixed(1) })}>
              <Slider min={0} max={2} step={0.1} value={temperature} onChange={(_, d) => setTemperature(d.value)} aria-label="temperature" />
            </Field>
            <Field label="max_tokens">
              <Input type="number" min={1} max={model.maxOutput || 4096} value={String(maxTokens)} onChange={(_, d) => setMaxTokens(Number(d.value) || 1)} />
            </Field>
            {isQwen3x(model.id) && <Switch label={t('customer.pg.thinking')} checked={thinking} onChange={(_, d) => setThinking(d.checked)} />}
          </aside>
          <section className={s.panel} aria-label={t('customer.pg.chatAria')}>
            {denied && <PermissionDenied inline error={denied} />}
            {apiErr && (
              <MessageBar intent={apiErr.status === 429 ? 'warning' : 'error'} role="alert" data-tour="pg-error">
                <MessageBarBody>
                  <MessageBarTitle>
                    {apiErr.status} {apiErr.code}
                    {apiErr.retryAfterSec ? t('customer.pg.retryAfter', { sec: apiErr.retryAfterSec }) : ''}
                  </MessageBarTitle>
                  {apiMessage(t, apiErr)} requestId: {apiErr.requestId}
                  {apiErr.status === 402 && (
                    <>
                      {' '}
                      <Link as="a" href="#/plan" data-tour="pg-topup-link">
                        {t('customer.pg.goTopup')}
                      </Link>
                    </>
                  )}
                </MessageBarBody>
              </MessageBar>
            )}
            <div className={s.chat} ref={chatRef} role="log" aria-live="polite" aria-label={t('customer.pg.logAria')}>
              {messages.length === 0 && (
                <Text size={200} style={{ color: tokens.colorNeutralForeground3, alignSelf: 'center', marginTop: 'auto', marginBottom: 'auto' }}>
                  {t('customer.pg.noMessages')}
                </Text>
              )}
              {messages.map((m, i) =>
                m.role === 'assistant' && !m.streaming && last?.media && i === messages.length - 1 ? (
                  <div key={i} className={s.media} data-tour="pg-media" role="group" aria-label={t('customer.pg.mediaAria', { modality: modalityLabel(last.requestedModel.modality) })}>
                    <div className={s.role}>{modelName(last.model)}</div>
                    <div className={s.mediaArt} aria-label={last.media.altText}>
                      {last.media.kind === 'image' ? <ImageRegular fontSize={28} /> : last.media.kind === 'video' ? <VideoClipRegular fontSize={28} /> : <MicRegular fontSize={28} />}
                      <span>{last.media.artifact}</span>
                    </div>
                    <Text size={200}>{last.media.altText}</Text>
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                      {t('customer.pg.mediaUsage', { url: `${PLATFORM_BASE_URL}${last.media.endpoint}`, units: last.media.units, unit: last.media.unitLabel, price: last.media.unitPriceUsd.toFixed(4) })}
                    </Text>
                  </div>
                ) : (
                <div key={i} className={`${s.msg} ${m.role === 'user' ? s.user : s.assistant}`}>
                  <div className={s.role}>{m.role === 'user' ? t('customer.pg.user') : modelName(last?.model ?? model)}</div>
                  {m.content || (m.streaming ? '…' : '')}
                  {m.streaming && <span aria-hidden>▍</span>}
                </div>
                ),
              )}
            </div>
            <div className={s.composer}>
              <Field label={t('customer.pg.message')} style={{ flexGrow: 1 }}>
                <Textarea
                  value={input}
                  onChange={(_, d) => setInput(d.value)}
                  rows={2}
                  resize="vertical"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.ctrlKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                />
              </Field>
              {busy ? (
                <Button icon={<StopRegular />} onClick={stop}>
                  {t('customer.pg.stop')}
                </Button>
              ) : (
                <Button data-tour="pg-send" appearance="primary" icon={<SendRegular />} onClick={send} disabled={!canInvoke || !input.trim()}>
                  {t('customer.pg.send')}
                </Button>
              )}
            </div>
          </section>
          <aside className={`${s.panel} ${s.thirdCol}`} aria-label={t('customer.pg.metricsAria')} data-tour="pg-metrics">
            <Text weight="semibold">{t('customer.pg.metrics')}</Text>
            <div className={s.stats}>
              <div className={s.stat}>
                <span className={s.statLabel}>TTFT</span>
                <span className={s.statValue}>{liveTtft !== null ? `${liveTtft} ms` : '—'}</span>
              </div>
              <div className={s.stat}>
                <span className={s.statLabel}>{last?.media ? t('customer.pg.usageUnit', { unit: last.media.unitLabel }) : t('customer.pg.outputTokens')}</span>
                <span className={s.statValue}>{last?.media ? last.media.units : last ? last.outputTokens : liveTokens || '—'}</span>
              </div>
              <div className={s.stat}>
                <span className={s.statLabel}>{t('customer.pg.inputTokens')}</span>
                <span className={s.statValue}>{last ? last.inputTokens : '—'}</span>
              </div>
              <div className={s.stat}>
                <span className={s.statLabel}>{t('customer.pg.costEstimate', { basis: last ? (last.billingBasis === 'token' ? t('customer.pg.basisToken') : last.billingBasis === 'dedicated' ? t('customer.pg.basisDedicated') : t('customer.pg.basisProxy')) : t('customer.pg.basisIllustrative') })}</span>
                <span className={s.statValue}>{last ? `US$${last.estimatedCostUsd.toFixed(6)}` : '—'}</span>
              </div>
            </div>
            <Text weight="semibold">{t('customer.pg.headersTitle')}</Text>
            <div data-tour="pg-headers">
              {last && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                  <Badge appearance="tint" color={last.servedBy === 'local' ? 'brand' : 'warning'}>
                    {last.servedBy === 'local' ? (last.billingBasis === 'dedicated' ? t('customer.pg.servedLocalDedicated') : t('customer.pg.servedLocalShared')) : last.tier === 'spillover' ? t('customer.pg.servedSpillover') : t('customer.pg.servedProxy')}
                  </Badge>
                  {last.deploymentId && <Badge appearance="outline">{t('customer.pg.badgeDeployment', { id: last.deploymentId })}</Badge>}
                  <Badge appearance="outline" color={last.model.id === last.requestedModel.id ? 'informative' : 'warning'} data-tour="pg-served-model">
                    {t('customer.pg.badgeModel', { name: modelName(last.model) })}
                    {last.model.id !== last.requestedModel.id ? t('customer.pg.badgeRequested', { id: last.requestedModel.id }) : ''}
                  </Badge>
                  {headers?.['x-maas-region'] && (
                    <Badge appearance="outline" data-tour="pg-region">
                      {t('customer.pg.badgeRegion', { region: headers['x-maas-region'] })}
                    </Badge>
                  )}
                  {last.spilloverFrom && (
                    <Badge appearance="outline" color="warning">
                      {t('customer.pg.badgeSpilloverFrom', { from: last.spilloverFrom })}
                    </Badge>
                  )}
                </div>
              )}
              {apiErr && headers?.['x-maas-deny-reason'] && (
                <MessageBar intent="warning" style={{ marginBottom: 8 }} data-tour="pg-deny-reason">
                  <MessageBarBody>
                    <MessageBarTitle>x-maas-deny-reason: {headers['x-maas-deny-reason']}</MessageBarTitle>
                    {DENY_REASON_LABELS[headers['x-maas-deny-reason']] ? t(DENY_REASON_LABELS[headers['x-maas-deny-reason']]) : t('customer.pg.denyFallback')}
                  </MessageBarBody>
                </MessageBar>
              )}
              {headers ? (
                <dl className={s.headers}>
                  {Object.entries(headers).map(([k, v]) => {
                    const note = headerNote(t, k, v);
                    return (
                      <div key={k} style={{ display: 'contents' }}>
                        <dt className={s.hk}>{k}:</dt>
                        <dd className={s.hv}>
                          {v}
                          {note && <span style={{ color: tokens.colorNeutralForeground3, fontFamily: tokens.fontFamilyBase }}>　{note}</span>}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              ) : (
                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                  {t('customer.pg.headersPlaceholder')}
                </Text>
              )}
            </div>
            <Text weight="semibold">{t('customer.pg.curlTitle')}</Text>
            <CodeBlock code={last?.curl ?? curlPreview} label={t('customer.pg.curlLabel')} />
          </aside>
        </div>
      )}
    </>
  );
}
