import {
  Button,
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
  Spinner,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { AddCircleRegular, ArrowLeftRegular, ArrowRightRegular, DismissRegular, ServerRegular } from '@fluentui/react-icons';
import { useEffect, useRef, useState } from 'react';
import { PermissionDenied } from '../../components/States';
import { CodeBlock } from '../../components/CodeBlock';
import { StatusBadge } from '../../components/StatusBadge';
import { useNotify } from '../../components/Notify';
import { useSession } from '../../app/SessionContext';
import { server, type ApiError, type ClusterView } from '../../server/api';
import { PLATFORM_SCOPE } from '../../auth/scope';
import { TENANTS } from '../../server/seed';
import { CLUSTER_STATUS_LABELS, CONTROL_PLANE_HOST, ENGINES, GPU_SPECS, GPU_TYPES, type InferenceEngine } from '../../data/clusters';
import { LOCALE_TAGS, keyedText, tenantLabel, useLocale, useT, tl } from '../../i18n';

/**
 * 註冊叢集精靈（我們的新機房加入控制面；仿 Run:ai「Waiting to connect → Connected」與 ACK One「複製 agent.yaml → kubectl apply」）
 * 1. 基本資訊（機房名稱／位置／Kubernetes 版本／GPU 型號／共用或專屬節點池）
 * 2. 加入指令（kubectl apply + 一次性 token，只顯示一次）
 * 3. 等待加入（機房內的代理程式連回控制面；示範約 2 秒後加入）
 * 4. 完成（檢視節點）
 */
const STEP_KEYS = ['ops.registerCluster.step.basics', 'ops.registerCluster.step.command', 'ops.registerCluster.step.waiting', 'ops.registerCluster.step.done'];
/** 伺服器要求 Kubernetes ≥ 1.32（與 api.ts registerCluster 一致） */
export const K8S_MIN_RE = /^v?1\.(3[2-9]|[4-9]\d)\./;
const STEP_ANCHORS = ['register-form', 'register-command', 'register-waiting', 'register-done'] as const;

const useStyles = makeStyles({
  steps: { display: 'flex', flexWrap: 'wrap', columnGap: tokens.spacingHorizontalS, rowGap: tokens.spacingVerticalXS, listStyle: 'none', margin: 0, padding: 0, marginBottom: tokens.spacingVerticalM },
  step: { display: 'inline-flex', alignItems: 'center', columnGap: '6px', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
  stepActive: { color: tokens.colorBrandForeground1, fontWeight: tokens.fontWeightSemibold },
  stepNum: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', borderRadius: '50%', backgroundColor: tokens.colorNeutralBackground3, fontSize: tokens.fontSizeBase100 },
  form: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: tokens.spacingHorizontalS },
  summary: { display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: tokens.spacingHorizontalL, rowGap: tokens.spacingVerticalXS, fontSize: tokens.fontSizeBase300 },
  dt: { color: tokens.colorNeutralForeground3 },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, wordBreak: 'break-all' },
  waiting: { display: 'flex', alignItems: 'center', columnGap: tokens.spacingHorizontalM, padding: tokens.spacingVerticalM, borderRadius: tokens.borderRadiusMedium, backgroundColor: tokens.colorNeutralBackground3 },
});

export function RegisterClusterDrawer({ open, onClose, onRegistered }: { open: boolean; onClose: () => void; onRegistered: (cluster: ClusterView) => void }) {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const { session, canUi, bump } = useSession();
  const notify = useNotify();
  const canRegister = canUi('cluster.register', PLATFORM_SCOPE);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(() => t('ops.registerCluster.defaultName'));
  const [site, setSite] = useState(() => t('ops.registerCluster.defaultSite'));
  const [k8s, setK8s] = useState('v1.32.4');
  const [gpuType, setGpuType] = useState(GPU_TYPES[1]);
  const [nodeCount, setNodeCount] = useState('2');
  const [gpusPerNode, setGpusPerNode] = useState('8');
  const [engine, setEngine] = useState<InferenceEngine>('vLLM');
  const [poolKind, setPoolKind] = useState<'shared' | string>('shared');
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState<ApiError | null>(null);
  const [cluster, setCluster] = useState<ClusterView | null>(null);
  const [touched, setTouched] = useState(false);
  const poll = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      setStep(0);
      setName(t('ops.registerCluster.defaultName'));
      setSite(t('ops.registerCluster.defaultSite'));
      setK8s('v1.32.4');
      setGpuType(GPU_TYPES[1]);
      setNodeCount('2');
      setGpusPerNode('8');
      setEngine('vLLM');
      setPoolKind('shared');
      setDenied(null);
      setCluster(null);
      setTouched(false);
    }
    // 只在開啟時重設（切換語言不應把精靈重設回第一步）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 等待加入：輪詢叢集狀態直到「已連線」
  useEffect(() => {
    if (step !== 2 || !cluster || cluster.status !== 'waiting') return;
    let active = true;
    const tick = async () => {
      try {
        const res = await server.getCluster(session, cluster.id);
        if (!active) return;
        if (res.ok) {
          setCluster(res.data);
          if (res.data.status === 'connected') {
            bump();
            onRegistered(res.data);
            window.setTimeout(() => setStep(3), 400);
            return;
          }
        }
      } catch {
        /* 模擬錯誤時持續重試 */
      }
      poll.current = window.setTimeout(tick, 700);
    };
    poll.current = window.setTimeout(tick, 700);
    return () => {
      active = false;
      if (poll.current) window.clearTimeout(poll.current);
    };
  }, [step, cluster, session, bump, onRegistered]);

  const nameError = touched && !name.trim() ? t('ops.registerCluster.nameRequired') : undefined;
  // 與伺服器 registerCluster 相同的版本檢查：1.32 以上（代理程式、GPU Operator 與 DRA 前置條件）
  const k8sOk = K8S_MIN_RE.test(k8s);
  const k8sError = touched && !k8sOk ? t('ops.registerCluster.k8sError') : undefined;
  const canNext = step === 0 ? !!name.trim() && k8sOk && Number(nodeCount) > 0 && Number(gpusPerNode) > 0 : true;
  const spec = GPU_SPECS[gpuType];
  const totalGpus = (Number(nodeCount) || 0) * (Number(gpusPerNode) || 0);
  const dedicatedTenant = poolKind === 'shared' ? undefined : TENANTS.find((x) => x.id === poolKind);

  const register = async () => {
    setTouched(true);
    if (!canNext) return;
    setBusy(true);
    try {
      const res = await server.registerCluster(session, { name, site, k8sVersion: k8s, gpuType, nodeCount: Number(nodeCount), gpusPerNode: Number(gpusPerNode), engine, dedicatedTenantId: dedicatedTenant?.id });
      if (res.ok) {
        setCluster(res.data);
        notify.success(t('ops.registerCluster.toastRegistered', { name: res.data.name }), `requestId: ${res.requestId}`);
        bump();
        setStep(1);
      } else if (res.status === 403) setDenied(res);
      else notify.apiError(res, t('ops.registerCluster.action'));
    } catch (e) {
      notify.apiError(e as Error, t('ops.registerCluster.action'));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (!busy) onClose();
  };

  return (
    <OverlayDrawer open={open} position="end" size="medium" onOpenChange={(_, d) => !d.open && close()} aria-label={t('ops.registerCluster.action')}>
      <DrawerHeader>
        <DrawerHeaderTitle action={<Button appearance="subtle" aria-label={t('common.close')} icon={<DismissRegular />} onClick={close} />}>
          <AddCircleRegular style={{ verticalAlign: '-3px', marginRight: 6 }} />
          {t('ops.registerCluster.title')}
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        <ol className={s.steps} aria-label={t('ops.registerCluster.stepsAria')}>
          {STEP_KEYS.map((key, i) => (
            <li key={key} className={`${s.step} ${i === step ? s.stepActive : ''}`} aria-current={i === step ? 'step' : undefined}>
              <span className={s.stepNum}>{i + 1}</span>
              {t(key)}
              {i < STEP_KEYS.length - 1 && <span aria-hidden>›</span>}
            </li>
          ))}
        </ol>
        <div className={s.form} data-tour={STEP_ANCHORS[step]}>
          {!canRegister && <PermissionDenied inline actionLabel={t('ops.registerCluster.action')} error={denied} />}
          {canRegister && denied && <PermissionDenied inline error={denied} />}

          {step === 0 && (
            <>
              <MessageBar intent="info">
                <MessageBarBody>
                  <MessageBarTitle>{t('ops.registerCluster.intro.title')}</MessageBarTitle>
                  {t('ops.registerCluster.intro.body', { host: CONTROL_PLANE_HOST.replace('https://', '') })}
                </MessageBarBody>
              </MessageBar>
              <Field label={t('ops.registerCluster.field.name')} required validationState={nameError ? 'error' : 'none'} validationMessage={nameError}>
                <Input value={name} onChange={(_, d) => setName(d.value)} placeholder={t('ops.registerCluster.field.namePlaceholder')} disabled={!canRegister} />
              </Field>
              <Field label={t('ops.registerCluster.field.site')}>
                <Input value={site} onChange={(_, d) => setSite(d.value)} placeholder={t('ops.registerCluster.field.sitePlaceholder')} disabled={!canRegister} />
              </Field>
              <div className={s.row}>
                <Field label={t('ops.registerCluster.field.k8s')} required validationState={k8sError ? 'error' : 'none'} validationMessage={k8sError} hint={t('ops.registerCluster.field.k8sHint')}>
                  <Input value={k8s} onChange={(_, d) => setK8s(d.value)} className={s.mono} disabled={!canRegister} />
                </Field>
                <Field label={t('ops.registerCluster.field.gpu')} required hint={spec ? t(spec.mig ? 'ops.registerCluster.field.gpuHintMig' : 'ops.registerCluster.field.gpuHintNoMig', { vram: spec.vramGb, price: server.billing.gpuListUsdPerHour[gpuType] ?? '—' }) : undefined}>
                  <Dropdown value={gpuType} selectedOptions={[gpuType]} onOptionSelect={(_, d) => d.optionValue && setGpuType(d.optionValue)} disabled={!canRegister}>
                    {GPU_TYPES.map((g) => (
                      <Option key={g} value={g}>
                        {g}
                      </Option>
                    ))}
                  </Dropdown>
                </Field>
              </div>
              <div className={s.row}>
                <Field label={t('ops.registerCluster.field.nodes')} hint={t('ops.registerCluster.field.nodesHint')}>
                  <Input type="number" min={1} max={32} value={nodeCount} onChange={(_, d) => setNodeCount(d.value)} disabled={!canRegister} />
                </Field>
                <Field label={t('ops.registerCluster.field.gpusPerNode')}>
                  <Input type="number" min={1} max={16} value={gpusPerNode} onChange={(_, d) => setGpusPerNode(d.value)} disabled={!canRegister} />
                </Field>
              </div>
              <div className={s.row}>
                <Field label={t('ops.registerCluster.field.engine')} hint={t('ops.registerCluster.field.engineHint')}>
                  <Dropdown value={engine} selectedOptions={[engine]} onOptionSelect={(_, d) => d.optionValue && setEngine(d.optionValue as InferenceEngine)} disabled={!canRegister}>
                    {ENGINES.map((e) => (
                      <Option key={e} value={e}>
                        {e}
                      </Option>
                    ))}
                  </Dropdown>
                </Field>
                <Field label={t('ops.clusterDetail.col.pool')} hint={dedicatedTenant ? t('ops.registerCluster.field.poolHintDedicated', { tenant: dedicatedTenant.name }) : t('ops.registerCluster.field.poolHintShared')}>
                  <Dropdown value={dedicatedTenant ? t('ops.clusters.pool.dedicated', { tenant: dedicatedTenant.name }) : t('ops.clusters.pool.shared')} selectedOptions={[poolKind]} onOptionSelect={(_, d) => d.optionValue && setPoolKind(d.optionValue)} disabled={!canRegister} data-tour="register-pool">
                    <Option value="shared">{t('ops.clusters.pool.shared')}</Option>
                    {TENANTS.map((tn) => (
                      <Option key={tn.id} value={tn.id} text={t('ops.clusters.pool.dedicated', { tenant: tenantLabel(t, tn.id, tn.name) })}>
                        {t('ops.clusters.pool.dedicated', { tenant: tenantLabel(t, tn.id, tn.name) })}
                      </Option>
                    ))}
                  </Dropdown>
                </Field>
              </div>
              <Text size={200}>
                {t('ops.registerCluster.expected', { total: totalGpus, gpu: gpuType, vram: spec ? totalGpus * spec.vramGb : 0 })}
              </Text>
            </>
          )}

          {step === 1 && cluster && (
            <>
              <MessageBar intent="success">
                <MessageBarBody>
                  <MessageBarTitle>{t('ops.registerCluster.registered.title', { name: cluster.name, status: tl(t, 'CLUSTER_STATUS_LABELS', cluster.status, CLUSTER_STATUS_LABELS[cluster.status]) })}</MessageBarTitle>
                  {t('ops.registerCluster.registered.body')}
                </MessageBarBody>
              </MessageBar>
              <Field label={t('ops.registerCluster.token.label')} hint={t('ops.registerCluster.token.hint', { time: cluster.tokenExpiresAt ? new Date(cluster.tokenExpiresAt).toLocaleTimeString(LOCALE_TAGS[L.locale], { hour: '2-digit', minute: '2-digit' }) : '—' })}>
                <div data-tour="register-token">
                  <CodeBlock code={cluster.oneTimeToken ?? ''} label={t('ops.registerCluster.token.code')} />
                </div>
              </Field>
              <Field label={t('ops.registerCluster.cmd.label')}>
                <CodeBlock code={cluster.agentInstallCommand ?? ''} label={t('ops.registerCluster.cmd.code')} />
              </Field>
              <div className={s.summary}>
                <span className={s.dt}>{t('ops.registerCluster.sum.idRegion')}</span>
                <span className={s.mono}>
                  {cluster.id} · {cluster.region}
                </span>
                <span className={s.dt}>{t('ops.registerCluster.sum.agent')}</span>
                <span>{t('ops.registerCluster.sum.agentBody')}</span>
                <span className={s.dt}>{t('ops.clusterDetail.col.pool')}</span>
                <span>{cluster.nodePools.map((p) => keyedText(t, p.name, p.nameKey, p.nameParams)).join(t('common.listSeparator'))}</span>
              </div>
              <Text size={200}>{t('ops.registerCluster.cmd.after')}</Text>
            </>
          )}

          {step === 2 && cluster && (
            <>
              <div className={s.waiting} role="status" aria-live="polite">
                {cluster.status === 'waiting' ? <Spinner size="small" /> : <ServerRegular />}
                <div>
                  <Text weight="semibold" as="p" style={{ margin: 0 }}>
                    {cluster.status === 'waiting' ? t('ops.registerCluster.waiting.title') : t('ops.registerCluster.waiting.connected')}
                  </Text>
                  <Text size={200}>
                    {t('ops.registerCluster.waiting.status')}
                    <StatusBadge kind={cluster.status === 'connected' ? 'success' : 'pending'} label={tl(t, 'CLUSTER_STATUS_LABELS', cluster.status, CLUSTER_STATUS_LABELS[cluster.status])} size="small" />
                    {t('ops.registerCluster.waiting.hb', { id: cluster.id })}
                  </Text>
                </div>
              </div>
              <Text size={200}>{t('ops.registerCluster.waiting.note')}</Text>
            </>
          )}

          {step === 3 && cluster && (
            <>
              <MessageBar intent="success">
                <MessageBarBody>
                  <MessageBarTitle>{t('ops.registerCluster.done.title', { name: cluster.name })}</MessageBarTitle>
                  {t('ops.registerCluster.done.body', { agent: cluster.agentVersion, nodes: cluster.nodeCount, gpus: cluster.gpuTotal, gpu: cluster.gpuType })}
                </MessageBarBody>
              </MessageBar>
              <div className={s.summary}>
                <span className={s.dt}>{t('ops.clusterDetail.col.status')}</span>
                <span>
                  <StatusBadge kind="success" label={tl(t, 'CLUSTER_STATUS_LABELS', cluster.status, CLUSTER_STATUS_LABELS[cluster.status])} size="small" />
                </span>
                <span className={s.dt}>{t('ops.registerCluster.sum.nodesGpu')}</span>
                <span>{t('ops.registerCluster.sum.nodesGpuValue', { nodes: cluster.nodeCount, gpus: cluster.gpuTotal, gpu: cluster.gpuType, alloc: cluster.gpuAllocated })}</span>
                <span className={s.dt}>{t('ops.clusterDetail.col.pool')}</span>
                <span>{cluster.nodePools.map((p) => keyedText(t, p.name, p.nameKey, p.nameParams)).join(t('common.listSeparator'))}</span>
              </div>
              <Text size={200}>
                {t('ops.registerCluster.next.a')}
                <Link href={`#/clusters/${cluster.id}`}>{t('ops.registerCluster.next.nodes')}</Link>
                {t('ops.registerCluster.next.b')}
                <Link href="#/deployments">{t('ops.registerCluster.next.deployments')}</Link>
                {t('ops.registerCluster.next.c')}
                <Link href="#/audit">{t('ops.registerCluster.next.audit')}</Link>
                {t('ops.registerCluster.next.d')}
              </Text>
            </>
          )}
        </div>
      </DrawerBody>
      <DrawerFooter>
        {step === 0 && (
          <Button appearance="primary" icon={busy ? <Spinner size="tiny" /> : <ArrowRightRegular />} iconPosition="after" onClick={register} disabled={busy || !canRegister} data-tour="register-submit">
            {busy ? t('ops.registerCluster.btn.registering') : t('ops.registerCluster.btn.generate')}
          </Button>
        )}
        {step === 1 && (
          <>
            <Button icon={<ArrowLeftRegular />} disabled>
              {t('common.prev')}
            </Button>
            <Button appearance="primary" icon={<ArrowRightRegular />} iconPosition="after" onClick={() => setStep(2)} data-tour="register-next">
              {t('ops.registerCluster.btn.ran')}
            </Button>
          </>
        )}
        {step === 2 && (
          <Button appearance="primary" disabled={cluster?.status !== 'connected'} onClick={() => setStep(3)}>
            {cluster?.status === 'connected' ? t('ops.registerCluster.btn.continue') : t('ops.registerCluster.btn.waiting')}
          </Button>
        )}
        {step === 3 && cluster && (
          <>
            <Button appearance="primary" as="a" href={`#/clusters/${cluster.id}`} onClick={onClose} data-tour="register-view-nodes">
              {t('ops.clusterDetail.nodesAction')}
            </Button>
            <Button appearance="secondary" onClick={onClose}>
              {t('common.done')}
            </Button>
          </>
        )}
        {step < 3 && (
          <Button appearance="secondary" onClick={close} disabled={busy}>
            {step === 0 ? t('common.cancel') : t('common.close')}
          </Button>
        )}
      </DrawerFooter>
    </OverlayDrawer>
  );
}
