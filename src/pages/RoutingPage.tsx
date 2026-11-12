import {
  Badge,
  Button,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
  Dropdown,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  OverlayDrawer,
  Switch,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { ArrowRightRegular, DismissRegular, EditRegular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { AsyncView, PermissionDenied } from '../components/States';
import { CodeBlock } from '../components/CodeBlock';
import { useApi } from '../hooks/useApi';
import { server, type ApiError } from '../server/api';
import { useSession } from '../app/SessionContext';
import { useNotify } from '../components/Notify';
import { PLACEMENT_POLICY_LABELS, REGION_POLICY_LABELS, type ModelRoute, type RouteTarget } from '../data/providers';
import { MODELS } from '../data/models';
import { PROVIDER_NAMES } from '../theme/chartPalette';
import { PLATFORM_SCOPE } from '../auth/scope';
import { apiMessage, tf, tl, useLocale, useT, type TFunction } from '../i18n';

const useStyles = makeStyles({
  list: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    borderTopWidth: '1px',
    borderRightWidth: '1px',
    borderBottomWidth: '1px',
    borderLeftWidth: '1px',
    borderTopStyle: 'solid',
    borderRightStyle: 'solid',
    borderBottomStyle: 'solid',
    borderLeftStyle: 'solid',
    borderTopColor: tokens.colorNeutralStroke2,
    borderRightColor: tokens.colorNeutralStroke2,
    borderBottomColor: tokens.colorNeutralStroke2,
    borderLeftColor: tokens.colorNeutralStroke2,
    borderRadius: tokens.borderRadiusLarge,
    padding: tokens.spacingVerticalM,
    display: 'grid',
    gridTemplateColumns: 'minmax(180px, 1fr) minmax(0, 2fr) minmax(0, 2fr) minmax(160px, 1fr)',
    gap: tokens.spacingHorizontalM,
    '@media (max-width: 1000px)': { gridTemplateColumns: '1fr 1fr' },
    '@media (max-width: 600px)': { gridTemplateColumns: '1fr' },
  },
  alias: { fontFamily: tokens.fontFamilyMonospace, fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase400 },
  label: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, marginBottom: '4px' },
  chain: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' },
  target: { display: 'inline-flex', flexDirection: 'column', padding: '4px 8px', borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px', borderTopStyle: 'solid', borderRightStyle: 'solid', borderBottomStyle: 'solid', borderLeftStyle: 'solid', borderTopColor: tokens.colorNeutralStroke2, borderRightColor: tokens.colorNeutralStroke2, borderBottomColor: tokens.colorNeutralStroke2, borderLeftColor: tokens.colorNeutralStroke2, borderRadius: tokens.borderRadiusMedium, backgroundColor: tokens.colorNeutralBackground2, fontSize: tokens.fontSizeBase200 },
  targetLocal: { backgroundColor: tokens.colorBrandBackground2 },
  mono: { fontFamily: tokens.fontFamilyMonospace },
  meta: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
  form: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  row: { display: 'grid', gridTemplateColumns: '2fr 1fr', columnGap: tokens.spacingHorizontalS, alignItems: 'end' },
  row3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', columnGap: tokens.spacingHorizontalS },
  docs: { marginTop: tokens.spacingVerticalL, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: tokens.spacingHorizontalM },
  docCard: { backgroundColor: tokens.colorNeutralBackground1, borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px', borderTopStyle: 'solid', borderRightStyle: 'solid', borderBottomStyle: 'solid', borderLeftStyle: 'solid', borderTopColor: tokens.colorNeutralStroke2, borderRightColor: tokens.colorNeutralStroke2, borderBottomColor: tokens.colorNeutralStroke2, borderLeftColor: tokens.colorNeutralStroke2, borderRadius: tokens.borderRadiusLarge, padding: tokens.spacingVerticalM, display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalS },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: tokens.fontSizeBase200 },
  th: { textAlign: 'left', padding: '4px 6px', color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightRegular, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tokens.colorNeutralStroke2 },
  td: { padding: '4px 6px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tokens.colorNeutralStroke3, verticalAlign: 'top' },
});

const isLocalTarget = (rt: RouteTarget) => rt.providerId === 'vllm';

/** 目標的供應商名稱（自建 GPU 或雲端供應商） */
const targetProviderName = (t: TFunction, rt: RouteTarget) => (isLocalTarget(rt) ? t('ops.routing.selfHostedGpu') : tl(t, 'PROVIDER_NAMES', rt.providerId, PROVIDER_NAMES[rt.providerId]));

function TargetChip({ t: target, weight }: { t: RouteTarget; weight?: boolean }) {
  const s = useStyles();
  const t = useT();
  return (
    <span className={`${s.target} ${isLocalTarget(target) ? s.targetLocal : ''}`}>
      <span>
        {targetProviderName(t, target)} · {target.region}
      </span>
      <span className={s.mono}>
        {target.modelId}
        {weight ? ` (${target.weight}%)` : ''}
      </span>
    </span>
  );
}

/** 回應標頭範例（註解與錯誤訊息依語言） */
const headerDoc = (t: TFunction) => `HTTP/1.1 200 OK
x-maas-served-by: cloud                 # local | cloud
x-maas-deployment: bailian:ap-southeast-1   # ${t('ops.routing.doc.deploymentComment')}
x-maas-spillover-from: dep-qwen27b-a    # ${t('ops.routing.doc.spilloverComment')}
x-maas-spillover-reason: queue_depth>8
x-maas-route: qwen-plus

HTTP/1.1 429 Too Many Requests          # ${t('ops.routing.doc.429Comment')}
Retry-After: 15
x-maas-served-by: local
x-maas-policy: local-only
{"error":{"code":"local_capacity_exhausted","type":"rate_limit_error",
  "message":"${t('ops.routing.doc.429Message')}"}}`;

export function RoutingPage() {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const { session, canUi } = useSession();
  const st = useApi(() => server.listRoutes(session), [session]);
  const [editing, setEditing] = useState<ModelRoute | null>(null);
  const canEdit = canUi('model.route.update', PLATFORM_SCOPE);
  return (
    <>
      <PageHeader
        title={t('ops.createDep.next.routing')}
        subtitle={t('ops.routing.subtitle')}
        crumbs={[{ label: t('ops.createDep.next.routing') }]}
      />
      <AsyncView {...st} actionLabel={t('ops.routing.actionLabel')}>
        {(routes) => (
          <>
            <div className={s.list} data-tour="routing-list">
              {routes.map((r) => (
                <section key={r.id} className={s.card} aria-label={t('ops.routing.routeAria', { alias: r.alias })} data-tour={`route-${r.alias}`}>
                  <div>
                    <div className={s.alias}>{r.alias}</div>
                    <Text size={200}>{tf(t, `data.route.${r.alias}.description`, r.description)}</Text>
                    <div className={s.meta} style={{ marginTop: 8 }}>
                      {t('ops.routing.regionPolicyLabel')}
                      <Badge appearance="outline" size="small">{tl(t, 'REGION_POLICY_LABELS', r.regionPolicy, REGION_POLICY_LABELS[r.regionPolicy])}</Badge>
                    </div>
                    <div className={s.meta}>
                      {t('ops.routing.placementPolicyLabel')}
                      <Badge appearance="outline" size="small" color={r.placementPolicy === 'local-first' || r.placementPolicy === 'local-only' ? 'success' : 'informative'}>
                        {tl(t, 'PLACEMENT_POLICY_LABELS', r.placementPolicy, PLACEMENT_POLICY_LABELS[r.placementPolicy])}
                      </Badge>
                    </div>
                    <div className={s.meta} style={{ flexWrap: 'wrap', rowGap: 4 }} data-tour={`route-regions-${r.alias}`}>
                      {t('ops.routing.allowedRegions')}
                      {r.allowedRegions.map((reg) => (
                        <Badge key={reg} appearance="outline" size="small" color={reg.startsWith('tw-') ? 'success' : 'informative'} style={{ fontFamily: tokens.fontFamilyMonospace }}>
                          {reg}
                        </Badge>
                      ))}
                    </div>
                    <div className={s.meta}>{t('ops.routing.updated', { time: L.fmtDateTime(r.updatedAt) })}</div>
                  </div>
                  <div>
                    <div className={s.label}>{t('ops.routing.primaryTargets')}</div>
                    <div className={s.chain}>
                      {r.targets.map((tg, i) => (
                        <TargetChip key={i} t={tg} weight />
                      ))}
                    </div>
                    <div className={s.label} style={{ marginTop: 8 }}>
                      {t('ops.routing.fallbackChain')}
                    </div>
                    <div className={s.chain}>
                      {r.fallbackChain.length === 0 && <Text size={200}>{t('ops.routing.noFallback')}</Text>}
                      {r.fallbackChain.map((tg, i) => (
                        <span key={i} className={s.chain}>
                          <ArrowRightRegular aria-hidden />
                          <TargetChip t={tg} />
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className={s.label}>{t('ops.routing.spillover')}</div>
                    {r.spillover.enabled && r.spillover.target ? (
                      <div style={{ display: 'flex', flexDirection: 'column', rowGap: 6 }}>
                        <Badge appearance="tint" color="warning" size="small" style={{ alignSelf: 'flex-start' }}>
                          {t('ops.routing.spillEnabled', { queue: r.spillover.threshold.queueDepth, kv: Math.round((r.spillover.threshold.kvCacheUsage ?? r.spillover.threshold.gpuUtil ?? 0.85) * 100) })}
                        </Badge>
                        <div className={s.chain}>
                          <span className={s.meta}>{t('ops.routing.selfHostedDeployment')}</span>
                          <ArrowRightRegular aria-hidden />
                          <TargetChip t={r.spillover.target} />
                        </div>
                        <Text size={200}>{t('ops.routing.spillHeaders')}</Text>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', rowGap: 6 }}>
                        <Badge appearance="outline" size="small" color={r.placementPolicy === 'local-only' ? 'danger' : 'subtle'} style={{ alignSelf: 'flex-start' }}>
                          {r.placementPolicy === 'local-only' ? t('ops.routing.noSpillLocalOnly') : t('ops.routing.notEnabled')}
                        </Badge>
                        {r.placementPolicy === 'local-only' && <Text size={200}>{t('ops.routing.localOnlyNote')}</Text>}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', rowGap: 6 }}>
                    <div className={s.label}>{t('ops.routing.retryCb')}</div>
                    <Text size={200}>{t('ops.routing.retryValue', { n: r.retry.maxAttempts, ms: r.retry.backoffMs })}</Text>
                    <Text size={200}>{t('ops.routing.cbValue', { pct: Math.round(r.circuitBreaker.errorRateThreshold * 100), win: r.circuitBreaker.windowSec, cool: r.circuitBreaker.cooldownSec })}</Text>
                    <Tooltip content={canEdit ? t('ops.routing.editTip') : t('ops.routing.needUpdate')} relationship="description">
                      <Button icon={<EditRegular />} size="small" onClick={() => setEditing(r)} style={{ alignSelf: 'flex-start' }} data-tour={`route-edit-${r.alias}`}>
                        {t('common.edit')}
                      </Button>
                    </Tooltip>
                  </div>
                </section>
              ))}
            </div>
            <div className={s.docs} data-tour="routing-docs">
              <section className={s.docCard} aria-labelledby="routing-headers">
                <Text weight="semibold" id="routing-headers" as="h3" style={{ margin: 0 }}>
                  {t('ops.routing.doc.title')}
                </Text>
                <Text size={200}>{t('ops.routing.doc.intro')}</Text>
                <CodeBlock code={headerDoc(t)} label={t('ops.routing.doc.example')} />
              </section>
              <section className={s.docCard} aria-labelledby="routing-errors">
                <Text weight="semibold" id="routing-errors" as="h3" style={{ margin: 0 }}>
                  {t('ops.routing.err.title')}
                </Text>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th className={s.th} scope="col">
                        HTTP
                      </th>
                      <th className={s.th} scope="col">
                        error.code
                      </th>
                      <th className={s.th} scope="col">
                        {t('ops.routing.err.meaning')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className={s.td}>429</td>
                      <td className={s.td}>
                        <code>local_capacity_exhausted</code>
                      </td>
                      <td className={s.td}>{t('ops.routing.err.localCapacity')}</td>
                    </tr>
                    <tr>
                      <td className={s.td}>429</td>
                      <td className={s.td}>
                        <code>rate_limit_error</code> / <code>quota_error</code>
                      </td>
                      <td className={s.td}>{t('ops.routing.err.rateLimit')}</td>
                    </tr>
                    <tr>
                      <td className={s.td}>503</td>
                      <td className={s.td}>
                        <code>DEPLOYMENT_SCALING_UP</code>
                      </td>
                      <td className={s.td}>{t('ops.routing.err.scalingUp')}</td>
                    </tr>
                    <tr>
                      <td className={s.td}>400</td>
                      <td className={s.td}>
                        <code>TIER_NOT_ALLOWED</code>
                      </td>
                      <td className={s.td}>{t('ops.routing.err.tier')}</td>
                    </tr>
                    <tr>
                      <td className={s.td}>200</td>
                      <td className={s.td}>{t('ops.routing.err.noneHeader')}</td>
                      <td className={s.td}>{t('ops.routing.err.spilled')}</td>
                    </tr>
                  </tbody>
                </table>
              </section>
            </div>
          </>
        )}
      </AsyncView>
      <RouteDrawer route={editing} onClose={() => setEditing(null)} onSaved={st.reload} />
    </>
  );
}

const CLOUD_TARGETS: RouteTarget[] = [
  { providerId: 'bailian', region: 'ap-southeast-1', modelId: 'qwen3.7-plus', weight: 100 },
  { providerId: 'bailian', region: 'ap-southeast-1', modelId: 'qwen3.8-flash', weight: 100 },
  { providerId: 'bailian', region: 'ap-southeast-1', modelId: 'qwen3.8-max', weight: 100 },
  { providerId: 'openai', region: 'openai-global', modelId: 'gpt-5-mini', weight: 100 },
  { providerId: 'anthropic', region: 'anthropic-global', modelId: 'claude-haiku-4.5', weight: 100 },
  { providerId: 'google', region: 'google-global', modelId: 'gemini-2.5-flash', weight: 100 },
];

function RouteDrawer({ route, onClose, onSaved }: { route: ModelRoute | null; onClose: () => void; onSaved: () => void }) {
  const s = useStyles();
  const t = useT();
  const { session, canUi, bump } = useSession();
  const notify = useNotify();
  const canEdit = canUi('model.route.update', PLATFORM_SCOPE);
  const [targets, setTargets] = useState<RouteTarget[]>([]);
  const [policy, setPolicy] = useState<ModelRoute['regionPolicy']>('prefer-intl');
  const [placement, setPlacement] = useState<ModelRoute['placementPolicy']>('cloud-first');
  const [spillEnabled, setSpillEnabled] = useState(false);
  const [spillQueue, setSpillQueue] = useState('8');
  /** KV-cache 水位門檻 %（舊資料的 gpuUtil 以相容方式讀入） */
  const [spillKv, setSpillKv] = useState('85');
  const [spillTarget, setSpillTarget] = useState<string>('');
  const [retry, setRetry] = useState({ maxAttempts: 3, backoffMs: 400 });
  const [cb, setCb] = useState({ errorRateThreshold: 0.2, windowSec: 60, cooldownSec: 30 });
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState<ApiError | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (route) {
      setTargets(route.targets.map((tg) => ({ ...tg })));
      setPolicy(route.regionPolicy);
      setPlacement(route.placementPolicy);
      setSpillEnabled(route.spillover.enabled);
      setSpillQueue(String(route.spillover.threshold.queueDepth));
      setSpillKv(String(Math.round((route.spillover.threshold.kvCacheUsage ?? route.spillover.threshold.gpuUtil ?? 0.85) * 100)));
      setSpillTarget(route.spillover.target ? `${route.spillover.target.providerId}:${route.spillover.target.region}:${route.spillover.target.modelId}` : '');
      setRetry({ ...route.retry });
      setCb({ ...route.circuitBreaker });
      setDenied(null);
      setError(null);
    }
  }, [route]);
  if (!route) return null;
  const total = targets.reduce((a, tg) => a + tg.weight, 0);
  const valid = total === 100;
  const hasLocal = targets.some(isLocalTarget);
  const localOnly = placement === 'local-only';
  const targetObj = CLOUD_TARGETS.find((tg) => `${tg.providerId}:${tg.region}:${tg.modelId}` === spillTarget) ?? null;
  const spillValid = !spillEnabled || (!localOnly && !!targetObj);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await server.updateRouting(session, route.id, {
        targets,
        regionPolicy: policy,
        placementPolicy: placement,
        spillover: { enabled: spillEnabled && !localOnly, threshold: { queueDepth: Number(spillQueue) || 4, kvCacheUsage: (Number(spillKv) || 85) / 100 }, target: spillEnabled && !localOnly ? targetObj : null },
        retry,
        circuitBreaker: cb,
      });
      if (res.ok) {
        notify.success(t('ops.routing.toastUpdated', { alias: route.alias }), `requestId: ${res.requestId}`);
        bump();
        onSaved();
        onClose();
      } else if (res.status === 403) setDenied(res);
      else setError(res);
    } catch (e) {
      notify.apiError(e as Error, t('ops.routing.updateAction'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <OverlayDrawer open position="end" size="medium" onOpenChange={(_, d) => !d.open && onClose()} aria-label={t('ops.routing.drawer.aria', { alias: route.alias })}>
      <DrawerHeader>
        <DrawerHeaderTitle action={<Button appearance="subtle" aria-label={t('common.close')} icon={<DismissRegular />} onClick={onClose} />}>
          {t('ops.routing.drawer.title', { alias: route.alias })}
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        <div className={s.form} data-tour="route-form">
          {!canEdit && <PermissionDenied inline actionLabel={t('ops.routing.updateAction')} error={denied} />}
          {canEdit && denied && <PermissionDenied inline error={denied} />}
          {error && (
            <MessageBar intent="error" role="alert">
              <MessageBarBody>
                <MessageBarTitle>
                  {t('ops.routing.saveFailed', { status: error.status, code: error.code })}
                </MessageBarTitle>
                {apiMessage(t, error)}
              </MessageBarBody>
            </MessageBar>
          )}
          <Text weight="semibold">{t('ops.routing.drawer.weights')}</Text>
          {targets.map((tg, i) => (
            <div className={s.row} key={i}>
              <Field label={`${targetProviderName(t, tg)} · ${tg.region}`} hint={tg.modelId}>
                <Input value={tg.modelId} readOnly />
              </Field>
              <Field label={t('ops.routing.drawer.weight')} validationState={valid ? 'none' : 'error'} validationMessage={!valid && i === targets.length - 1 ? t('ops.routing.drawer.total', { total }) : undefined}>
                <Input type="number" min={0} max={100} value={String(tg.weight)} disabled={!canEdit} onChange={(_, d) => setTargets((ts) => ts.map((x, j) => (j === i ? { ...x, weight: Number(d.value) || 0 } : x)))} />
              </Field>
            </div>
          ))}
          <Field label={t('ops.routing.drawer.regionPolicy')}>
            <Dropdown value={tl(t, 'REGION_POLICY_LABELS', policy, REGION_POLICY_LABELS[policy])} selectedOptions={[policy]} disabled={!canEdit} onOptionSelect={(_, d) => d.optionValue && setPolicy(d.optionValue as ModelRoute['regionPolicy'])}>
              {(Object.keys(REGION_POLICY_LABELS) as ModelRoute['regionPolicy'][]).map((k) => (
                <Option key={k} value={k}>
                  {tl(t, 'REGION_POLICY_LABELS', k, REGION_POLICY_LABELS[k])}
                </Option>
              ))}
            </Dropdown>
          </Field>
          <Field label={t('ops.routing.drawer.placement')} hint={t('ops.routing.drawer.placementHint')}>
            <Dropdown data-tour="route-placement" value={tl(t, 'PLACEMENT_POLICY_LABELS', placement, PLACEMENT_POLICY_LABELS[placement])} selectedOptions={[placement]} disabled={!canEdit} onOptionSelect={(_, d) => d.optionValue && setPlacement(d.optionValue as ModelRoute['placementPolicy'])}>
              {(Object.keys(PLACEMENT_POLICY_LABELS) as ModelRoute['placementPolicy'][]).map((k) => (
                <Option key={k} value={k}>
                  {tl(t, 'PLACEMENT_POLICY_LABELS', k, PLACEMENT_POLICY_LABELS[k])}
                </Option>
              ))}
            </Dropdown>
          </Field>
          <Text weight="semibold">{t('ops.routing.spillover')}</Text>
          <Switch label={t('ops.routing.drawer.spillSwitch')} checked={spillEnabled && !localOnly} disabled={!canEdit || localOnly || !hasLocal} onChange={(_, d) => setSpillEnabled(d.checked)} data-tour="route-spillover" />
          {localOnly && (
            <MessageBar intent="info">
              <MessageBarBody>{t('ops.routing.drawer.localOnlyInfo')}</MessageBarBody>
            </MessageBar>
          )}
          {!hasLocal && !localOnly && <Text size={200}>{t('ops.routing.drawer.noLocal')}</Text>}
          {spillEnabled && !localOnly && hasLocal && (
            <>
              <div className={s.row3}>
                <Field label={t('ops.routing.drawer.queueThreshold')} hint={t('ops.routing.drawer.queueHint')}>
                  <Input type="number" min={1} value={spillQueue} disabled={!canEdit} onChange={(_, d) => setSpillQueue(d.value)} />
                </Field>
                <Field label={t('ops.routing.drawer.kvThreshold')} hint={t('ops.routing.drawer.kvHint')}>
                  <Input type="number" min={1} max={100} value={spillKv} disabled={!canEdit} onChange={(_, d) => setSpillKv(d.value)} />
                </Field>
              </div>
              <Field label={t('ops.routing.drawer.spillTarget')} required validationState={targetObj ? 'none' : 'error'} validationMessage={targetObj ? undefined : t('ops.routing.drawer.chooseTarget')}>
                <Dropdown value={targetObj ? `${targetProviderName(t, targetObj)} · ${targetObj.region} · ${targetObj.modelId}` : ''} selectedOptions={[spillTarget]} disabled={!canEdit} onOptionSelect={(_, d) => d.optionValue && setSpillTarget(d.optionValue)}>
                  {CLOUD_TARGETS.map((tg) => {
                    const m = MODELS.find((x) => x.id === tg.modelId);
                    return (
                      <Option key={`${tg.providerId}:${tg.region}:${tg.modelId}`} value={`${tg.providerId}:${tg.region}:${tg.modelId}`} text={`${targetProviderName(t, tg)} · ${tg.region} · ${tg.modelId}`}>
                        {targetProviderName(t, tg)} · {tg.region} · {m ? tf(t, `data.model.${m.id}.displayName`, m.displayName) : tg.modelId}
                      </Option>
                    );
                  })}
                </Dropdown>
              </Field>
            </>
          )}
          <Text weight="semibold">{t('ops.routing.drawer.retry')}</Text>
          <div className={s.row3}>
            <Field label={t('ops.routing.drawer.maxAttempts')}>
              <Input type="number" min={1} max={5} value={String(retry.maxAttempts)} disabled={!canEdit} onChange={(_, d) => setRetry((r) => ({ ...r, maxAttempts: Number(d.value) || 1 }))} />
            </Field>
            <Field label={t('ops.routing.drawer.backoff')}>
              <Input type="number" min={0} value={String(retry.backoffMs)} disabled={!canEdit} onChange={(_, d) => setRetry((r) => ({ ...r, backoffMs: Number(d.value) || 0 }))} />
            </Field>
          </div>
          <Text weight="semibold">{t('ops.routing.drawer.cb')}</Text>
          <div className={s.row3}>
            <Field label={t('ops.routing.drawer.errorRate')}>
              <Input type="number" min={1} max={100} value={String(Math.round(cb.errorRateThreshold * 100))} disabled={!canEdit} onChange={(_, d) => setCb((c) => ({ ...c, errorRateThreshold: (Number(d.value) || 0) / 100 }))} />
            </Field>
            <Field label={t('ops.routing.drawer.window')}>
              <Input type="number" min={5} value={String(cb.windowSec)} disabled={!canEdit} onChange={(_, d) => setCb((c) => ({ ...c, windowSec: Number(d.value) || 5 }))} />
            </Field>
            <Field label={t('ops.routing.drawer.cooldown')}>
              <Input type="number" min={5} value={String(cb.cooldownSec)} disabled={!canEdit} onChange={(_, d) => setCb((c) => ({ ...c, cooldownSec: Number(d.value) || 5 }))} />
            </Field>
          </div>
          <MessageBar intent="info">
            <MessageBarBody>{t('ops.routing.drawer.fallbackNote')}</MessageBarBody>
          </MessageBar>
        </div>
      </DrawerBody>
      <DrawerFooter>
        <Button appearance="primary" onClick={save} disabled={busy || !canEdit || !valid || !spillValid} data-tour="route-save">
          {busy ? t('ops.providers.drawer.saving') : t('ops.routing.drawer.saveChanges')}
        </Button>
        <Button appearance="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </DrawerFooter>
    </OverlayDrawer>
  );
}
