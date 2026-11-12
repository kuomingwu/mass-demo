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
  Switch,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { DismissRegular, RocketRegular } from '@fluentui/react-icons';
import { useEffect, useMemo, useState } from 'react';
import { PermissionDenied } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { useNotify } from '../../components/Notify';
import { useSession } from '../../app/SessionContext';
import { useApi } from '../../hooks/useApi';
import { server, type ApiError, type DeploymentView } from '../../server/api';
import { clusterScope, PLATFORM_SCOPE } from '../../auth/scope';
import { PLAN_LABELS, TENANTS } from '../../server/seed';
import { DEPLOYABLE_MODELS, LICENSE_TYPE_LABELS, ORIGIN_LABELS, QUANT_BYTES, type Quantization } from '../../data/models';
import { DEFAULT_MAX_NUM_SEQS, DEPLOYMENT_STATUS_LABELS, ENGINES, vramFit, type InferenceEngine, type PoolSharing } from '../../data/clusters';

const DEFAULT_QUANT: Quantization = 'FP8';
const DEFAULT_NAME = 'qwen3.8-27b-fp8-canary';
import { deploymentKind } from './DeploymentsTable';
import { useCloseOnTourFinish } from '../../components/OnboardingTour';
import { apiMessage, keyedText, tenantLabel, useT, tf, tl } from '../../i18n';

const useStyles = makeStyles({
  form: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: tokens.spacingHorizontalS },
  row3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', columnGap: tokens.spacingHorizontalS },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
  fit: { padding: tokens.spacingVerticalS, borderRadius: tokens.borderRadiusMedium, backgroundColor: tokens.colorNeutralBackground3, fontSize: tokens.fontSizeBase200 },
  section: { fontWeight: tokens.fontWeightSemibold },
  summary: { display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: tokens.spacingHorizontalL, rowGap: tokens.spacingVerticalXS, fontSize: tokens.fontSizeBase300 },
  dt: { color: tokens.colorNeutralForeground3 },
});

export function CreateDeploymentDrawer({ open, defaultClusterId, onClose, onCreated }: { open: boolean; defaultClusterId?: string; onClose: () => void; onCreated: () => void }) {
  const s = useStyles();
  const t = useT();
  const { session, canUi, bump } = useSession();
  const notify = useNotify();
  const clustersSt = useApi(() => server.listClusters(session), [session]);
  const canManageAny = canUi('deployment.manage', PLATFORM_SCOPE) || (clustersSt.data ?? []).some((c) => canUi('deployment.manage', clusterScope(c.id)));
  const canManage = canManageAny;
  const clusters = useMemo(() => (clustersSt.data ?? []).filter((c) => c.status === 'connected'), [clustersSt.data]);
  const [sharing, setSharing] = useState<PoolSharing>('shared');
  const [dedicatedTenantId, setDedicatedTenantId] = useState(TENANTS[0]?.id ?? '');
  /** 專屬部署：專屬節點池不足時是否允許借用共用節點池（預設關閉 → 伺服器 409 DEDICATED_POOL_EXHAUSTED；開啟會寫入稽核） */
  const [allowSharedFallback, setAllowSharedFallback] = useState(false);

  // 預設值要能在 1 × H100 80 GB 放得下（權重 + KV cache）：27B 以 FP8、max_num_seqs 128
  const [modelId, setModelId] = useState('qwen3.8-27b-vllm');
  const [clusterId, setClusterId] = useState(defaultClusterId ?? '');
  const [name, setName] = useState(DEFAULT_NAME);
  const [engine, setEngine] = useState<InferenceEngine>('vLLM');
  const [quant, setQuant] = useState<Quantization>(DEFAULT_QUANT);
  const [gpusPerReplica, setGpusPerReplica] = useState('1');
  const [replicas, setReplicas] = useState('1');
  const [maxNumSeqs, setMaxNumSeqs] = useState(String(DEFAULT_MAX_NUM_SEQS));
  const [priority, setPriority] = useState(true);
  const [cacheSalt, setCacheSalt] = useState(true);
  const [minR, setMinR] = useState('1');
  const [maxR, setMaxR] = useState('2');
  const [metric, setMetric] = useState<'queue-depth' | 'concurrency'>('queue-depth');
  const [scaleToZero, setScaleToZero] = useState(false);
  const [strategy, setStrategy] = useState<'canary' | 'blue-green'>('canary');
  const [canaryPct, setCanaryPct] = useState('10');
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState<ApiError | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<DeploymentView | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setModelId('qwen3.8-27b-vllm');
      setClusterId(defaultClusterId ?? '');
      setSharing('shared');
      setDedicatedTenantId(TENANTS[0]?.id ?? '');
      setAllowSharedFallback(false);
      setName(DEFAULT_NAME);
      setEngine('vLLM');
      setQuant(DEFAULT_QUANT);
      setGpusPerReplica('1');
      setReplicas('1');
      setMaxNumSeqs(String(DEFAULT_MAX_NUM_SEQS));
      setPriority(true);
      setCacheSalt(true);
      setMinR('1');
      setMaxR('2');
      setMetric('queue-depth');
      setScaleToZero(false);
      setStrategy('canary');
      setCanaryPct('10');
      setDenied(null);
      setError(null);
      setResult(null);
      setTouched(false);
    }
  }, [open, defaultClusterId]);

  useEffect(() => {
    if (!clusterId && clusters.length) setClusterId(clusters[0].id);
  }, [clusters, clusterId]);
  // 指引（deploy-model）結束或略過時，自動關閉由指引開啟的抽屜
  useCloseOnTourFinish(open, onClose);

  // 建立後輪詢直到就緒
  useEffect(() => {
    if (!result || result.status !== 'creating') return;
    let active = true;
    const timer = window.setInterval(async () => {
      try {
        const res = await server.listDeployments(session, { clusterId: result.clusterId });
        if (!active || !res.ok) return;
        const d = res.data.find((x) => x.id === result.id);
        if (d) {
          setResult(d);
          if (d.status !== 'creating') {
            window.clearInterval(timer);
            onCreated();
          }
        }
      } catch {
        /* ignore */
      }
    }, 800);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [result, session, onCreated]);

  const cluster = clusters.find((c) => c.id === clusterId);
  const model = DEPLOYABLE_MODELS.find((m) => m.id === modelId);
  const gpus = Math.max(1, Number(gpusPerReplica) || 1);
  // 量化選項依模型的 allowedQuantizations 過濾（gpt-oss 只有原生 MXFP4 → 僅 INT4）；換模型時若目前量化不可用就改為第一個可用選項
  const quantOptions = useMemo<Quantization[]>(() => (Object.keys(QUANT_BYTES) as Quantization[]).filter((q) => !model?.allowedQuantizations || model.allowedQuantizations.includes(q)), [model]);
  useEffect(() => {
    if (!quantOptions.includes(quant)) setQuant(quantOptions[0] ?? DEFAULT_QUANT);
  }, [quantOptions, quant]);
  // 以表單的 max_num_seqs 估算（含 KV cache），與伺服器送出時的檢查一致
  const fit = cluster && model ? vramFit(model.id, quant, cluster.gpuType, gpus, Math.max(1, Number(maxNumSeqs) || DEFAULT_MAX_NUM_SEQS)) : null;
  const needGpus = (Number(replicas) || 0) * gpus;
  const dedicatedTenant = sharing === 'dedicated' ? TENANTS.find((x) => x.id === dedicatedTenantId) : undefined;
  const modelName = (m: { id: string; displayName: string }) => tf(t, `data.model.${m.id}.displayName`, m.displayName);
  // 可用 GPU 依節點池：共用部署只用共用節點池；專屬部署只用該租戶的專屬節點池（勾選「允許借用共用節點池」才加上共用池）
  const sharedFree = cluster ? cluster.pools.filter((p) => p.sharing === 'shared').reduce((a, p) => a + (p.gpuTotal - p.gpuAllocated), 0) : 0;
  const dedicatedFree = cluster ? cluster.pools.filter((p) => p.sharing === 'dedicated' && p.dedicatedTenantId === dedicatedTenantId).reduce((a, p) => a + (p.gpuTotal - p.gpuAllocated), 0) : 0;
  const freeGpus = sharing === 'shared' ? sharedFree : dedicatedFree + (allowSharedFallback ? sharedFree : 0);
  const gpuOk = needGpus <= freeGpus;
  // 專屬池不足且未允許借用：表單仍可送出，由伺服器回 409 DEDICATED_POOL_EXHAUSTED（行內顯示並提示勾選）
  const dedicatedExhausted = sharing === 'dedicated' && !allowSharedFallback && !gpuOk;
  const originBlocked = !!dedicatedTenant && !!model?.origin && (dedicatedTenant.excludeOrigins as string[]).includes(model.origin);
  const gpuListPrice = cluster ? server.billing.gpuListUsdPerHour[cluster.gpuType] ?? 0 : 0;
  const nameError = touched && !name.trim() ? t('ops.createDep.nameRequired') : undefined;
  const canSubmit = !!cluster && !!model && !!fit?.ok && (gpuOk || dedicatedExhausted) && name.trim().length > 0 && Number(minR) <= Number(maxR) && (sharing === 'shared' || !!dedicatedTenant) && !originBlocked;

  const submit = async () => {
    setTouched(true);
    setError(null);
    if (!cluster || !model) return;
    setBusy(true);
    try {
      const res = await server.createDeployment(session, {
        name,
        modelId: model.id,
        clusterId: cluster.id,
        sharing,
        dedicatedTenantId: sharing === 'dedicated' ? dedicatedTenantId : undefined,
        allowSharedFallback: sharing === 'dedicated' ? allowSharedFallback : undefined,
        engine,
        quantization: quant,
        gpusPerReplica: gpus,
        replicas: Number(replicas) || 0,
        maxNumSeqs: Number(maxNumSeqs) || 128,
        priorityScheduling: priority,
        cacheSaltByTenant: cacheSalt,
        autoscaling: { minReplicas: Number(minR) || 0, maxReplicas: Number(maxR) || 1, metric, scaleToZero },
        rollout: { strategy, canaryPercent: strategy === 'canary' ? Number(canaryPct) || 0 : 0 },
      });
      if (res.ok) {
        setResult(res.data);
        notify.success(t('ops.createDep.toastCreating', { name: res.data.name }), `requestId: ${res.requestId}`);
        bump();
        onCreated();
      } else if (res.status === 403) setDenied(res);
      else setError(res);
    } catch (e) {
      notify.apiError(e as Error, t('ops.deployments.create'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OverlayDrawer open={open} position="end" size="medium" onOpenChange={(_, d) => !d.open && !busy && onClose()} aria-label={t('ops.deployments.create')}>
      <DrawerHeader>
        <DrawerHeaderTitle action={<Button appearance="subtle" aria-label={t('common.close')} icon={<DismissRegular />} onClick={onClose} />}>
          <RocketRegular style={{ verticalAlign: '-3px', marginRight: 6 }} />
          {t('ops.deployments.create')}
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        {result ? (
          <div className={s.form} data-tour="deploy-result">
            <MessageBar intent={result.status === 'ready' ? 'success' : result.status === 'error' ? 'error' : 'info'}>
              <MessageBarBody>
                <MessageBarTitle>
                  {t('ops.createDep.result.title', { name: result.name, status: tl(t, 'DEPLOYMENT_STATUS_LABELS', result.status, DEPLOYMENT_STATUS_LABELS[result.status]) })}
                </MessageBarTitle>
                {result.status === 'creating'
                  ? t('ops.createDep.result.creating')
                  : result.status === 'ready'
                    ? result.sharing === 'dedicated'
                      ? t('ops.createDep.result.readyDedicated', { tenant: tenantLabel(t, result.dedicatedTenantId, result.dedicatedTenantName) })
                      : t('ops.createDep.result.readyShared')
                    : result.statusMessage
                      ? keyedText(t, result.statusMessage, result.statusMessageKey, result.statusMessageParams)
                      : result.statusMessage}
              </MessageBarBody>
            </MessageBar>
            <div className={s.summary}>
              <span className={s.dt}>{t('ops.clusterDetail.col.status')}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {result.status === 'creating' && <Spinner size="tiny" />}
                <span data-tour={result.status === 'ready' ? 'deploy-ready' : undefined}>
                  <StatusBadge kind={deploymentKind(result.status)} label={tl(t, 'DEPLOYMENT_STATUS_LABELS', result.status, DEPLOYMENT_STATUS_LABELS[result.status])} size="small" />
                </span>
              </span>
              <span className={s.dt}>{t('ops.createDep.sum.modelCluster')}</span>
              <span>
                {tf(t, `data.model.${result.modelId}.displayName`, result.modelName)} → {result.clusterName}
              </span>
              <span className={s.dt}>{t('ops.depTable.col.sharing')}</span>
              <span>{result.sharing === 'dedicated' ? t('ops.createDep.sum.dedicated', { tenant: tenantLabel(t, result.dedicatedTenantId, result.dedicatedTenantName) }) : t('ops.createDep.sum.shared')}</span>
              <span className={s.dt}>{t('ops.createDep.sum.engine')}</span>
              <span>{t('ops.createDep.sum.engineValue', { engine: result.engine, quant: result.quantization, vram: result.vramGb })}</span>
              <span className={s.dt}>{t('ops.createDep.sum.replicas')}</span>
              <span>{t('ops.createDep.sum.replicasValue', { replicas: result.replicas, gpus: result.gpusPerReplica, min: result.autoscaling.minReplicas, max: result.autoscaling.maxReplicas })}</span>
            </div>
            <Text size={200}>
              {t('ops.createDep.next.a')}
              <Link href="#/routing">{t('ops.createDep.next.routing')}</Link>
              {t('ops.createDep.next.b')}
              <Link href="#/pricing?tab=unit">{t('ops.createDep.next.pricing')}</Link>
              {t('ops.createDep.next.c')}
            </Text>
          </div>
        ) : (
          <div className={s.form} data-tour="deploy-form">
            {!canManage && !clustersSt.loading && <PermissionDenied inline actionLabel={t('ops.createDep.deniedAction')} error={denied} />}
            {canManage && denied && <PermissionDenied inline error={denied} />}
            {error && (
              <MessageBar intent={error.code === 'DEDICATED_POOL_EXHAUSTED' ? 'warning' : 'error'} role="alert" layout="multiline" data-tour="deploy-error">
                <MessageBarBody>
                  <MessageBarTitle>
                    {t('ops.createDep.failed', { status: error.status, code: error.code })}
                  </MessageBarTitle>
                  {apiMessage(t, error)} requestId: {error.requestId}
                  {error.code === 'DEDICATED_POOL_EXHAUSTED' && (
                    <div style={{ marginTop: 6 }}>
                      <Button size="small" appearance="primary" onClick={() => { setAllowSharedFallback(true); setError(null); }} disabled={!canManage} data-tour="deploy-enable-fallback">
                        {t('ops.createDep.retryWithFallback')}
                      </Button>
                    </div>
                  )}
                </MessageBarBody>
              </MessageBar>
            )}
            <Field
              label={t('ops.createDep.field.model')}
              required
              hint={
                model
                  ? t('ops.createDep.field.modelHint', {
                      license: tl(t, 'LICENSE_TYPE_LABELS', model.licenseType, LICENSE_TYPE_LABELS[model.licenseType]),
                      origin: model.origin ? tl(t, 'ORIGIN_LABELS', model.origin, ORIGIN_LABELS[model.origin]) : '—',
                      input: server.billing.tokenPrices[model.id]?.input ?? model.priceInput,
                      output: server.billing.tokenPrices[model.id]?.output ?? model.priceOutput,
                    })
                  : undefined
              }
            >
              <Dropdown value={model ? modelName(model) : ''} selectedOptions={[modelId]} onOptionSelect={(_, d) => d.optionValue && setModelId(d.optionValue)} disabled={!canManage} data-tour="deploy-model">
                {DEPLOYABLE_MODELS.map((m) => (
                  <Option key={m.id} value={m.id} text={modelName(m)}>
                    {t('ops.createDep.field.modelOption', { name: modelName(m), params: m.paramsB, license: tf(t, `data.model.${m.id}.license`, m.license) })}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            <Field label={t('ops.createDep.field.cluster')} required hint={t('ops.createDep.field.clusterHint')}>
              <Dropdown value={cluster ? t('ops.createDep.field.clusterValue', { name: cluster.name, free: freeGpus }) : ''} selectedOptions={[clusterId]} onOptionSelect={(_, d) => d.optionValue && setClusterId(d.optionValue)} disabled={!canManage} data-tour="deploy-cluster">
                {clusters.map((c) => (
                  <Option key={c.id} value={c.id} text={c.name}>
                    {t('ops.createDep.field.clusterOption', { name: c.name, gpu: c.gpuType, free: c.gpuTotal - c.gpuAllocated, total: c.gpuTotal })}
                  </Option>
                ))}
              </Dropdown>
            </Field>
            <Field
              label={t('ops.depTable.col.sharing')}
              required
              hint={sharing === 'shared' ? t('ops.createDep.field.sharedHint') : t('ops.createDep.field.dedicatedHint', { gpus: needGpus, price: gpuListPrice, monthly: (needGpus * gpuListPrice * 24 * 30).toLocaleString('en-US', { maximumFractionDigits: 0 }) })}
            >
              <RadioGroup layout="horizontal" value={sharing} onChange={(_, d) => setSharing(d.value as PoolSharing)} disabled={!canManage} data-tour="deploy-sharing">
                <Radio value="shared" label={t('ops.createDep.field.radioShared')} />
                <Radio value="dedicated" label={t('ops.createDep.field.radioDedicated')} />
              </RadioGroup>
            </Field>
            {sharing === 'dedicated' && (
              <Field label={t('ops.clusterDetail.col.tenant')} required validationState={originBlocked ? 'error' : 'none'} validationMessage={originBlocked && model ? t('ops.createDep.field.originBlocked', { origin: tl(t, 'ORIGIN_LABELS', model.origin!, ORIGIN_LABELS[model.origin!]) }) : undefined}>
                <Dropdown value={dedicatedTenant ? t('ops.createDep.field.tenantOption', { name: dedicatedTenant.name, plan: tl(t, 'PLAN_LABELS', dedicatedTenant.plan, PLAN_LABELS[dedicatedTenant.plan]) }) : ''} selectedOptions={[dedicatedTenantId]} onOptionSelect={(_, d) => d.optionValue && setDedicatedTenantId(d.optionValue)} disabled={!canManage} data-tour="deploy-tenant">
                  {TENANTS.map((tn) => (
                    <Option key={tn.id} value={tn.id} text={tenantLabel(t, tn.id, tn.name)}>
                      {t('ops.createDep.field.tenantOption', { name: tenantLabel(t, tn.id, tn.name), plan: tl(t, 'PLAN_LABELS', tn.plan, PLAN_LABELS[tn.plan]) })}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
            )}
            {sharing === 'dedicated' && (
              <Field
                hint={t('ops.createDep.field.fallbackHint', {
                  dedicated: dedicatedFree,
                  tenant: cluster ? t('ops.createDep.field.fallbackTenant', { tenant: dedicatedTenant?.name ?? t('ops.createDep.field.thatTenant') }) : '',
                  shared: sharedFree,
                })}
              >
                <Checkbox label={t('ops.createDep.field.fallback')} checked={allowSharedFallback} onChange={(_, d) => setAllowSharedFallback(!!d.checked)} disabled={!canManage} data-tour="deploy-fallback" />
              </Field>
            )}
            <Field label={t('ops.createDep.field.name')} required validationState={nameError ? 'error' : 'none'} validationMessage={nameError}>
              <Input value={name} onChange={(_, d) => setName(d.value)} className={s.mono} disabled={!canManage} />
            </Field>
            <div className={s.row3}>
              <Field label={t('ops.createDep.field.engine')}>
                <Dropdown value={engine} selectedOptions={[engine]} onOptionSelect={(_, d) => d.optionValue && setEngine(d.optionValue as InferenceEngine)} disabled={!canManage}>
                  {ENGINES.map((e) => (
                    <Option key={e} value={e}>
                      {e}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
              <Field label={t('ops.createDep.field.quant')} hint={model?.allowedQuantizations ? t('ops.createDep.field.quantHint', { model: modelName(model).replace(/[（(].*$/, '').trim(), allowed: model.allowedQuantizations.join(t('ops.createDep.slash')) }) : undefined}>
                <Dropdown value={quant} selectedOptions={[quant]} onOptionSelect={(_, d) => d.optionValue && setQuant(d.optionValue as Quantization)} disabled={!canManage || quantOptions.length <= 1} data-tour="deploy-quant">
                  {quantOptions.map((q) => (
                    <Option key={q} value={q} text={q}>
                      {t('ops.createDep.field.quantOption', { q, bytes: QUANT_BYTES[q] })}
                    </Option>
                  ))}
                </Dropdown>
              </Field>
              <Field label={t('ops.createDep.field.gpusPerReplica')}>
                <Input type="number" min={1} max={8} value={gpusPerReplica} onChange={(_, d) => setGpusPerReplica(d.value)} disabled={!canManage} />
              </Field>
            </div>
            {fit && (
              <div className={s.fit} role="status" aria-live="polite" data-tour="deploy-vram">
                <StatusBadge kind={fit.ok ? 'success' : 'danger'} label={fit.ok ? t('ops.createDep.fit.ok') : fit.code === 'QUANT_NOT_SUPPORTED' ? t('ops.createDep.fit.quant') : t('ops.createDep.fit.insufficient')} size="small" />{' '}
                {fit.code !== 'QUANT_NOT_SUPPORTED' && (
                  <strong className={s.mono} data-tour="deploy-vram-breakdown">
                    {t('ops.createDep.fit.breakdown', { weights: fit.weightsGb, kv: fit.kvGb, required: fit.requiredGb, available: fit.availableGb })}
                  </strong>
                )}{' '}
                {keyedText(t, fit.message, fit.messageKey, fit.params)}
                {model && <span>{t('ops.createDep.fit.reference', { params: model.paramsB, bytes: QUANT_BYTES[quant], len: (model.maxModelLen ?? model.contextLength).toLocaleString() })}</span>}
              </div>
            )}
            <div className={s.row}>
              <Field
                label={t('ops.scale.replicas')}
                validationState={gpuOk ? 'none' : dedicatedExhausted ? 'warning' : 'error'}
                validationMessage={gpuOk ? undefined : dedicatedExhausted ? t('ops.createDep.field.replicasExhausted', { need: needGpus, free: dedicatedFree }) : t(sharing === 'dedicated' ? 'ops.createDep.field.replicasShortDedicated' : 'ops.createDep.field.replicasShortShared', { need: needGpus, free: freeGpus })}
              >
                <Input type="number" min={0} max={16} value={replicas} onChange={(_, d) => setReplicas(d.value)} disabled={!canManage} />
              </Field>
              <Field label={t('ops.createDep.field.maxNumSeqs')} hint={t('ops.createDep.field.maxNumSeqsHint')}>
                <Input type="number" min={1} max={2048} value={maxNumSeqs} onChange={(_, d) => setMaxNumSeqs(d.value)} disabled={!canManage} />
              </Field>
            </div>
            <Switch label={t('ops.createDep.field.priority')} checked={priority} onChange={(_, d) => setPriority(d.checked)} disabled={!canManage} />
            <Switch label={t('ops.createDep.field.cacheSalt')} checked={cacheSalt} onChange={(_, d) => setCacheSalt(d.checked)} disabled={!canManage} />
            <Text className={s.section}>{t('ops.depTable.col.auto')}</Text>
            <div className={s.row3}>
              <Field label={t('ops.createDep.field.minR')}>
                <Input type="number" min={0} value={minR} onChange={(_, d) => setMinR(d.value)} disabled={!canManage} />
              </Field>
              <Field label={t('ops.createDep.field.maxR')}>
                <Input type="number" min={1} value={maxR} onChange={(_, d) => setMaxR(d.value)} disabled={!canManage} />
              </Field>
              <Field label={t('ops.createDep.field.metric')}>
                <Dropdown value={metric === 'queue-depth' ? t('ops.createDep.metric.queue') : t('ops.createDep.metric.concurrency')} selectedOptions={[metric]} onOptionSelect={(_, d) => d.optionValue && setMetric(d.optionValue as 'queue-depth' | 'concurrency')} disabled={!canManage}>
                  <Option value="queue-depth">{t('ops.createDep.metric.queue')}</Option>
                  <Option value="concurrency">{t('ops.createDep.metric.concurrency')}</Option>
                </Dropdown>
              </Field>
            </div>
            <Checkbox label={t('ops.createDep.field.scaleToZero')} checked={scaleToZero} onChange={(_, d) => setScaleToZero(!!d.checked)} disabled={!canManage} />
            <Text className={s.section}>Rollout</Text>
            <RadioGroup layout="horizontal" value={strategy} onChange={(_, d) => setStrategy(d.value as 'canary' | 'blue-green')} disabled={!canManage}>
              <Radio value="canary" label={t('ops.createDep.field.canary')} />
              <Radio value="blue-green" label={t('ops.createDep.field.blueGreen')} />
            </RadioGroup>
            {strategy === 'canary' && (
              <Field label={t('ops.createDep.field.canaryPct')}>
                <Input type="number" min={1} max={50} value={canaryPct} onChange={(_, d) => setCanaryPct(d.value)} disabled={!canManage} />
              </Field>
            )}
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
            <Button appearance="primary" onClick={submit} disabled={busy || !canManage || !canSubmit} icon={busy ? <Spinner size="tiny" /> : <RocketRegular />} data-tour="deploy-submit">
              {busy ? t('ops.createDep.btn.creating') : t('ops.createDep.btn.deploy')}
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
