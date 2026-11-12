import {
  Button,
  Checkbox,
  Dropdown,
  DrawerBody,
  DrawerFooter,
  DrawerHeader,
  DrawerHeaderTitle,
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
import { ArrowLeftRegular, ArrowRightRegular, DismissRegular, PlugConnectedRegular, ServerRegular } from '@fluentui/react-icons';
import { useEffect, useMemo, useState } from 'react';
import { PermissionDenied } from '../../components/States';
import { CodeBlock } from '../../components/CodeBlock';
import { useNotify } from '../../components/Notify';
import { useSession } from '../../app/SessionContext';
import { server, type ApiError, type ConnectionTestResult, type LocalNodeMeta } from '../../server/api';
import { PLATFORM_SCOPE } from '../../auth/scope';
import type { ProviderId } from '../../data/models';
import { ENGINES, GPU_TYPES } from '../../data/clusters';
import { useCloseOnTourFinish } from '../../components/OnboardingTour';
import { apiMessage, keyedText, makeT, tf, useT, type TFunction } from '../../i18n';

/** 送往伺服器保存的文字（區域標籤、備註、節點名稱）一律用 zh-TW（伺服器資料的基底語言） */
const zhT = makeT('zh-TW');

/**
 * 連接精靈（示範）
 * - mode="cloud"（雲端供應商頁）：地域／端點 → API Key（只進 KMS）→ 測試連線 → 啟用模型與限額 → 檢視並建立。需 provider.configure。
 * - mode="node"（推論叢集詳情「新增節點」）：我們的 GPU 節點／規格／推論引擎／內網端點 → mTLS 憑證 → 探測節點 → 部署模型與限額 → 加入叢集共用節點池並稽核。需 cluster.register。
 */

const STEP_ANCHORS = ['connect-type', 'connect-endpoint', 'connect-key', 'connect-test', 'connect-models', 'connect-review'] as const;

interface ProviderOption {
  id: ProviderId;
  needsKey: boolean;
}

/** 名稱與說明：ops.connect.provider.<id>.label／.description */
const PROVIDER_OPTIONS: ProviderOption[] = [
  { id: 'vllm', needsKey: false },
  { id: 'bailian', needsKey: true },
  { id: 'openai', needsKey: true },
  { id: 'anthropic', needsKey: true },
  { id: 'google', needsKey: true },
];

const providerLabel = (t: TFunction, id: ProviderId) => t(`ops.connect.provider.${id}.label`);

interface RegionOption {
  region: string;
  /** 國際站／中國站 */
  site: 'intl' | 'cn';
  /** 選單標示「建議」 */
  recommended?: boolean;
  host: (ws: string) => string;
}

/** 標籤：ops.connect.region.<region>（選單另有 ops.connect.regionOption.<region>） */
const BAILIAN_REGIONS: RegionOption[] = [
  { region: 'ap-southeast-1', site: 'intl', recommended: true, host: (ws) => `https://${ws}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` },
  { region: 'us-east-1', site: 'intl', host: (ws) => `https://${ws}.us-east-1.maas.aliyuncs.com/compatible-mode/v1` },
  { region: 'eu-central-1', site: 'intl', host: (ws) => `https://${ws}.eu-central-1.maas.aliyuncs.com/compatible-mode/v1` },
  { region: 'ap-northeast-1', site: 'intl', host: (ws) => `https://${ws}.ap-northeast-1.maas.aliyuncs.com/compatible-mode/v1` },
  { region: 'cn-hongkong', site: 'intl', host: (ws) => `https://${ws}.cn-hongkong.maas.aliyuncs.com/compatible-mode/v1` },
  { region: 'cn-beijing', site: 'cn', host: (ws) => `https://${ws}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` },
  { region: 'legacy-intl', site: 'intl', host: () => 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
];

const regionOptionLabel = (t: TFunction, r: RegionOption) => t(r.recommended ? `ops.connect.regionOption.${r.region}` : `ops.connect.region.${r.region}`);

const DEFAULT_BASE_URL: Record<ProviderId, string> = {
  bailian: '',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  vllm: 'https://gw-node-c.internal.example/v1',
  partner: 'https://partner-adapter.internal.maas.example/v1',
};

const DEFAULT_REGION: Record<ProviderId, { region: string; labelKey: string }> = {
  bailian: { region: 'ap-southeast-1', labelKey: 'ops.connect.region.ap-southeast-1' },
  openai: { region: 'openai-global-2', labelKey: 'ops.connect.globalSecondKey' },
  anthropic: { region: 'anthropic-global-2', labelKey: 'ops.connect.globalSecondKey' },
  google: { region: 'google-global-2', labelKey: 'ops.connect.globalSecondKey' },
  vllm: { region: 'tw-node-new', labelKey: 'ops.connect.newNode' },
  partner: { region: 'partner-global-2', labelKey: 'ops.connect.globalSecondKey' },
};

const useStyles = makeStyles({
  steps: { display: 'flex', flexWrap: 'wrap', columnGap: tokens.spacingHorizontalS, rowGap: tokens.spacingVerticalXS, listStyle: 'none', margin: 0, padding: 0, marginBottom: tokens.spacingVerticalM },
  step: { display: 'inline-flex', alignItems: 'center', columnGap: '6px', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
  stepActive: { color: tokens.colorBrandForeground1, fontWeight: tokens.fontWeightSemibold },
  stepNum: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', borderRadius: '50%', backgroundColor: tokens.colorNeutralBackground3, fontSize: tokens.fontSizeBase100 },
  form: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  option: { display: 'flex', flexDirection: 'column', rowGap: '2px', padding: tokens.spacingVerticalS, border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium },
  optionLocal: { borderTopColor: tokens.colorBrandStroke1, borderRightColor: tokens.colorBrandStroke1, borderBottomColor: tokens.colorBrandStroke1, borderLeftColor: tokens.colorBrandStroke1, backgroundColor: tokens.colorBrandBackground2 },
  desc: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, marginLeft: '28px' },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: tokens.spacingHorizontalS },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, wordBreak: 'break-all' },
  summary: { display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: tokens.spacingHorizontalL, rowGap: tokens.spacingVerticalXS, fontSize: tokens.fontSizeBase300 },
  dt: { color: tokens.colorNeutralForeground3 },
  models: { display: 'flex', flexDirection: 'column', rowGap: '2px' },
  nodeCard: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: tokens.spacingHorizontalS, padding: tokens.spacingVerticalS, borderRadius: tokens.borderRadiusMedium, backgroundColor: tokens.colorNeutralBackground3 },
  metric: { display: 'flex', flexDirection: 'column' },
  metricLabel: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  metricValue: { fontWeight: tokens.fontWeightSemibold },
});

export function ConnectProviderDrawer({
  open,
  onClose,
  onConnected,
  mode = 'cloud',
  clusterId,
  clusterName,
}: {
  open: boolean;
  onClose: () => void;
  onConnected: () => void;
  /** cloud：雲端供應商頁；node：把 GPU 節點註冊到叢集 */
  mode?: 'cloud' | 'node';
  clusterId?: string;
  clusterName?: string;
}) {
  const s = useStyles();
  const t = useT();
  const { session, canUi, bump } = useSession();
  const notify = useNotify();
  const nodeMode = mode === 'node';
  const options = nodeMode ? PROVIDER_OPTIONS.filter((p) => p.id === 'vllm') : PROVIDER_OPTIONS.filter((p) => p.id !== 'vllm');
  const defaultProvider: ProviderId = nodeMode ? 'vllm' : 'bailian';

  const [step, setStep] = useState(0);
  const [providerId, setProviderId] = useState<ProviderId>(defaultProvider);
  const canConfigure = canUi(providerId === 'vllm' ? 'cluster.register' : 'provider.configure', PLATFORM_SCOPE);
  const [region, setRegion] = useState('ap-southeast-1');
  const [workspaceId, setWorkspaceId] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState(DEFAULT_BASE_URL.vllm);
  const [apiKey, setApiKey] = useState('');
  // 自建 GPU 節點
  const [nodeName, setNodeName] = useState('tpe-a-gpu-03');
  const [gpuType, setGpuType] = useState(GPU_TYPES[0]);
  const [gpuCount, setGpuCount] = useState('4');
  const [engine, setEngine] = useState(ENGINES[0]);
  const [certRef, setCertRef] = useState('kms://maas-demo/mtls/vllm-c');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [testError, setTestError] = useState<ApiError | null>(null);
  const [enabledModels, setEnabledModels] = useState<string[]>([]);
  const [rpm, setRpm] = useState('600');
  const [tpm, setTpm] = useState('1000000');
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState<ApiError | null>(null);
  const [result, setResult] = useState<{ requestId: string } | null>(null);

  useEffect(() => {
    if (open) {
      setStep(0);
      setProviderId(defaultProvider);
      setRegion('ap-southeast-1');
      setWorkspaceId('');
      setCustomBaseUrl(DEFAULT_BASE_URL[defaultProvider] || DEFAULT_BASE_URL.openai);
      setApiKey('');
      setNodeName('tpe-a-gpu-03');
      setGpuType(GPU_TYPES[0]);
      setGpuCount('4');
      setEngine(ENGINES[0]);
      setCertRef('kms://maas-demo/mtls/vllm-c');
      setTestResult(null);
      setTestError(null);
      setEnabledModels([]);
      setRpm('600');
      setTpm('1000000');
      setDenied(null);
      setResult(null);
    }
  }, [open, defaultProvider]);
  // 指引（connect-provider-bailian）結束或略過時，自動關閉由指引開啟的精靈
  useCloseOnTourFinish(open, onClose);

  const provider = PROVIDER_OPTIONS.find((p) => p.id === providerId)!;
  const isBailian = providerId === 'bailian';
  const isLocal = providerId === 'vllm';
  const STEPS = (isLocal ? ['nodeType', 'nodeGpu', 'mtls', 'probe', 'deployModels', 'reviewRegister'] : ['provider', 'region', 'apiKey', 'test', 'models', 'reviewCreate']).map((k) => t(`ops.connect.step.${k}`));
  const regionOpt = BAILIAN_REGIONS.find((r) => r.region === region) ?? BAILIAN_REGIONS[0];
  const effectiveRegion = isBailian ? (region === 'legacy-intl' ? 'ap-southeast-1' : region) : DEFAULT_REGION[providerId].region;
  /** 區域標籤（tt：顯示用 t；送往伺服器用 zhT） */
  const regionLabelIn = (tt: TFunction) => (isBailian ? tt(`ops.connect.region.${regionOpt.region}`) : isLocal ? nodeName.trim() || tt(DEFAULT_REGION.vllm.labelKey) : tt(DEFAULT_REGION[providerId].labelKey));
  const regionLabel = regionLabelIn(t);
  const baseUrl = useMemo(() => (isBailian ? regionOpt.host(workspaceId.trim() || '{WorkspaceId}') : customBaseUrl), [isBailian, regionOpt, workspaceId, customBaseUrl]);
  const meta: LocalNodeMeta | undefined = isLocal ? { nodeName: nodeName.trim() || zhT('ops.connect.newNode'), gpuType, gpuCount: Math.max(1, Number(gpuCount) || 1), engine, clusterId } : undefined;
  const modelName = (m: { id: string; displayName: string }) => tf(t, `data.model.${m.id}.displayName`, m.displayName);

  const keyOk = !provider.needsKey || apiKey.trim().length >= 8;
  const canNext =
    step === 0
      ? true
      : step === 1
        ? isBailian
          ? region !== ''
          : isLocal
            ? customBaseUrl.startsWith('https://') && nodeName.trim().length > 0 && Number(gpuCount) > 0
            : customBaseUrl.startsWith('https://')
        : step === 2
          ? isLocal
            ? certRef.trim().length > 0
            : keyOk
          : step === 3
            ? !!testResult
            : step === 4
              ? enabledModels.length > 0 && Number(rpm) > 0 && Number(tpm) > 0
              : true;

  const changeProvider = (id: ProviderId) => {
    setProviderId(id);
    setCustomBaseUrl(DEFAULT_BASE_URL[id] || DEFAULT_BASE_URL.openai);
    setTestResult(null);
    setTestError(null);
    setEnabledModels([]);
  };

  const runTest = async () => {
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      const res = await server.testProviderConnection(session, { providerId, region: effectiveRegion, baseUrl, apiKey: apiKey.trim(), meta });
      if (res.ok) {
        setTestResult(res.data);
        // 已服務的模型預設啟用；自建節點若尚未服務任何模型，預設勾選第一個可部署模型
        const served = res.data.models.filter((m) => m.served).map((m) => m.id);
        setEnabledModels(served.length > 0 ? served : res.data.models.slice(0, 1).map((m) => m.id));
      } else if (res.status === 403) setDenied(res);
      else setTestError(res);
    } catch (e) {
      notify.apiError(e as Error, isLocal ? t('ops.connect.step.probe') : t('ops.connect.step.test'));
    } finally {
      setTesting(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    try {
      const res = await server.connectProvider(session, {
        providerId,
        region: effectiveRegion,
        regionLabel: regionLabelIn(zhT),
        baseUrl,
        rpmLimit: Number(rpm),
        tpmLimit: Number(tpm),
        enabledModels,
        note: isLocal ? `${meta!.gpuCount} × ${meta!.gpuType} · ${meta!.engine}` : region === 'legacy-intl' ? zhT('ops.connect.legacyNote') : undefined,
        meta,
      });
      if (res.ok) {
        setResult({ requestId: res.requestId });
        notify.success(
          isLocal
            ? t('ops.connect.toast.node', { label: regionLabel, target: clusterName ? t('ops.connect.clusterNamed', { name: clusterName }) : t('ops.clusterDetail.what') })
            : t('ops.connect.toast.cloud', { provider: providerLabel(t, providerId), label: regionLabel }),
          `requestId: ${res.requestId}`,
        );
        bump();
        onConnected();
      } else if (res.status === 403) setDenied(res);
      else notify.apiError(res, t('ops.connect.btn.connect'));
    } catch (e) {
      notify.apiError(e as Error, t('ops.connect.btn.connect'));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (!busy) onClose();
  };

  const nodeMetrics = testResult?.node && (
    <div className={s.nodeCard} role="group" aria-label={t('ops.connect.probeAria')}>
      <div className={s.metric}>
        <span className={s.metricLabel}>GPU</span>
        <span className={s.metricValue}>{testResult.node.gpu}</span>
      </div>
      <div className={s.metric}>
        <span className={s.metricLabel}>VRAM</span>
        <span className={s.metricValue}>{testResult.node.vram}</span>
      </div>
      <div className={s.metric}>
        <span className={s.metricLabel}>{t('ops.createDep.field.engine')}</span>
        <span className={s.metricValue}>{testResult.node.engine}</span>
      </div>
      <div className={s.metric}>
        <span className={s.metricLabel}>{t('ops.connect.metric.util')}</span>
        <span className={s.metricValue}>{Math.round(testResult.node.utilization * 100)}%</span>
      </div>
      <div className={s.metric}>
        <span className={s.metricLabel}>{t('ops.clusterDetail.kv.queue')}</span>
        <span className={s.metricValue}>{testResult.node.queueDepth}</span>
      </div>
      <div className={s.metric}>
        <span className={s.metricLabel}>{t('ops.connect.metric.kvHit')}</span>
        <span className={s.metricValue}>{Math.round(testResult.node.kvCacheHitRate * 100)}%</span>
      </div>
    </div>
  );

  return (
    <OverlayDrawer open={open} position="end" size="medium" onOpenChange={(_, d) => !d.open && close()} aria-label={nodeMode ? t('ops.clusterDetail.addNode') : t('ops.connect.titleCloud')}>
      <DrawerHeader>
        <DrawerHeaderTitle action={<Button appearance="subtle" aria-label={t('common.close')} icon={<DismissRegular />} onClick={close} />}>
          {nodeMode ? <ServerRegular style={{ verticalAlign: '-3px', marginRight: 6 }} /> : <PlugConnectedRegular style={{ verticalAlign: '-3px', marginRight: 6 }} />}
          {nodeMode ? (clusterName ? t('ops.connect.titleNodeFor', { name: clusterName }) : t('ops.clusterDetail.addNode')) : t('ops.connect.titleCloud')}
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        {result ? (
          <div className={s.form} data-tour="connect-done">
            <MessageBar intent="success">
              <MessageBarBody>
                <MessageBarTitle>{isLocal ? t('ops.connect.done.nodeTitle') : t('ops.connect.done.cloudTitle')}</MessageBarTitle>
                {isLocal
                  ? t('ops.connect.done.nodeBody', { label: regionLabel, target: clusterName ? t('ops.connect.clusterNamed', { name: clusterName }) : t('ops.clusters.crumb') })
                  : t('ops.connect.done.cloudBody', { provider: providerLabel(t, providerId), label: regionLabel })}{' '}
                requestId: {result.requestId}
              </MessageBarBody>
            </MessageBar>
            <div className={s.summary}>
              <span className={s.dt}>{t('ops.connect.sum.endpoint')}</span>
              <span className={s.mono}>{baseUrl}</span>
              {isLocal && (
                <>
                  <span className={s.dt}>GPU</span>
                  <span>
                    {meta!.gpuCount} × {meta!.gpuType} · {meta!.engine}
                  </span>
                </>
              )}
              <span className={s.dt}>{isLocal ? t('ops.connect.sum.modelsLocal') : t('ops.connect.sum.models')}</span>
              <span>{enabledModels.join(t('common.listSeparator'))}</span>
              <span className={s.dt}>{t('ops.connect.sum.limits')}</span>
              <span>
                RPM {Number(rpm).toLocaleString()} / TPM {Number(tpm).toLocaleString()}
              </span>
            </div>
            <Text size={200}>
              {t('ops.connect.next.prefix')}
              {isLocal ? (
                <>
                  {t('ops.connect.next.localA')}
                  <Link href="#/deployments">{t('ops.deployments.title')}</Link>
                  {t('ops.connect.next.localB')}
                </>
              ) : (
                t('ops.connect.next.cloudA')
              )}
              <Link href="#/routing">{t('ops.createDep.next.routing')}</Link>
              {t(isLocal ? 'ops.connect.next.localC' : 'ops.connect.next.cloudC')}
              <Link href="#/audit">{t('ops.registerCluster.next.audit')}</Link>
              {t('ops.registerCluster.next.d')}
            </Text>
          </div>
        ) : (
          <>
            <ol className={s.steps} aria-label={t('ops.registerCluster.stepsAria')}>
              {STEPS.map((label, i) => (
                <li key={label} className={`${s.step} ${i === step ? s.stepActive : ''}`} aria-current={i === step ? 'step' : undefined}>
                  <span className={s.stepNum}>{i + 1}</span>
                  {label}
                  {i < STEPS.length - 1 && <span aria-hidden>›</span>}
                </li>
              ))}
            </ol>
            <div className={s.form} data-tour={STEP_ANCHORS[step]}>
              {!canConfigure && <PermissionDenied inline actionLabel={nodeMode ? t('ops.clusterDetail.addNode') : t('ops.providers.connect')} error={denied} />}
              {canConfigure && denied && <PermissionDenied inline error={denied} />}

              {step === 0 && (
                <>
                  {nodeMode && (
                    <MessageBar intent="info">
                      <MessageBarBody>
                        {t('ops.connect.nodeIntro', { cluster: clusterName ?? clusterId })}
                      </MessageBarBody>
                    </MessageBar>
                  )}
                  <Field label={nodeMode ? t('ops.connect.step.nodeType') : t('ops.providers.crumb')} required>
                    <RadioGroup value={providerId} onChange={(_, d) => changeProvider(d.value as ProviderId)} disabled={!canConfigure}>
                      {options.map((p) => (
                        <div key={p.id} className={`${s.option} ${p.id === 'vllm' ? s.optionLocal : ''}`}>
                          <Radio value={p.id} label={p.id === 'vllm' ? t('ops.connect.localOption', { label: providerLabel(t, p.id) }) : providerLabel(t, p.id)} />
                          <span className={s.desc}>{t(`ops.connect.provider.${p.id}.description`)}</span>
                        </div>
                      ))}
                    </RadioGroup>
                  </Field>
                  {!nodeMode && (
                    <Text size={200}>
                      {t('ops.connect.ownGpuNote')}
                    </Text>
                  )}
                </>
              )}

              {step === 1 && isLocal && (
                <>
                  <Field label={t('ops.connect.field.nodeName')} required>
                    <Input value={nodeName} onChange={(_, d) => setNodeName(d.value)} placeholder={t('ops.connect.field.nodeNamePlaceholder')} disabled={!canConfigure} />
                  </Field>
                  <div className={s.row}>
                    <Field label={t('ops.registerCluster.field.gpu')} required>
                      <Dropdown value={gpuType} selectedOptions={[gpuType]} onOptionSelect={(_, d) => d.optionValue && setGpuType(d.optionValue)} disabled={!canConfigure}>
                        {GPU_TYPES.map((g) => (
                          <Option key={g} value={g}>
                            {g}
                          </Option>
                        ))}
                      </Dropdown>
                    </Field>
                    <Field label={t('ops.connect.field.gpuCount')} required>
                      <Input type="number" min={1} max={16} value={gpuCount} onChange={(_, d) => setGpuCount(d.value)} disabled={!canConfigure} />
                    </Field>
                  </div>
                  <Field label={t('ops.createDep.field.engine')} required hint={t('ops.connect.field.engineHint')}>
                    <Dropdown value={engine} selectedOptions={[engine]} onOptionSelect={(_, d) => d.optionValue && setEngine(d.optionValue as (typeof ENGINES)[number])} disabled={!canConfigure}>
                      {ENGINES.map((e) => (
                        <Option key={e} value={e}>
                          {e}
                        </Option>
                      ))}
                    </Dropdown>
                  </Field>
                  <Field label={t('ops.connect.field.internalUrl')} required hint={t('ops.connect.field.internalUrlHint')}>
                    <Input value={customBaseUrl} onChange={(_, d) => setCustomBaseUrl(d.value)} className={s.mono} disabled={!canConfigure} />
                  </Field>
                  <Field label={t('ops.connect.field.regionCode')}>
                    <Input value={effectiveRegion} readOnly className={s.mono} />
                  </Field>
                </>
              )}
              {step === 1 && isBailian && (
                <>
                  <Field label={t('ops.connect.field.region')} required hint={t('ops.connect.field.regionHint')}>
                    <Dropdown value={regionOptionLabel(t, regionOpt)} selectedOptions={[region]} onOptionSelect={(_, d) => d.optionValue && setRegion(d.optionValue)} disabled={!canConfigure}>
                      {BAILIAN_REGIONS.map((r) => (
                        <Option key={r.region} value={r.region} text={regionOptionLabel(t, r)}>
                          {regionOptionLabel(t, r)}
                        </Option>
                      ))}
                    </Dropdown>
                  </Field>
                  {region !== 'legacy-intl' && (
                    <Field label={t('ops.connect.field.workspace')} required hint={t('ops.connect.field.workspaceHint')}>
                      <Input value={workspaceId} onChange={(_, d) => setWorkspaceId(d.value)} placeholder={t('ops.connect.field.workspacePlaceholder')} disabled={!canConfigure} />
                    </Field>
                  )}
                  <Field label={t('ops.connect.field.baseUrlAuto')}>
                    <Input value={baseUrl} readOnly className={s.mono} />
                  </Field>
                  {regionOpt.site === 'cn' && (
                    <MessageBar intent="warning">
                      <MessageBarBody>{t('ops.connect.cnWarning')}</MessageBarBody>
                    </MessageBar>
                  )}
                  {region === 'legacy-intl' && (
                    <MessageBar intent="warning">
                      <MessageBarBody>{t('ops.connect.legacyWarning')}</MessageBarBody>
                    </MessageBar>
                  )}
                </>
              )}
              {step === 1 && !isBailian && !isLocal && (
                <>
                  <Field label={t('ops.providers.th.endpoint')} required hint={t('ops.connect.field.baseUrlHint')}>
                    <Input value={customBaseUrl} onChange={(_, d) => setCustomBaseUrl(d.value)} className={s.mono} disabled={!canConfigure} />
                  </Field>
                  <Field label={t('ops.connect.field.regionLabel')}>
                    <Input value={regionLabel} readOnly />
                  </Field>
                </>
              )}

              {step === 2 && isLocal && (
                <>
                  <Field label={t('ops.connect.field.cert')} required hint={t('ops.connect.field.certHint')}>
                    <Input value={certRef} onChange={(_, d) => setCertRef(d.value)} className={s.mono} disabled={!canConfigure} />
                  </Field>
                  <MessageBar intent="info">
                    <MessageBarBody>{t('ops.connect.noKeyNote')}</MessageBarBody>
                  </MessageBar>
                </>
              )}
              {step === 2 && !isLocal && (
                <>
                  <Field label="API Key" required hint={t('ops.connect.field.apiKeyHint')} validationState={apiKey && !keyOk ? 'error' : 'none'} validationMessage={apiKey && !keyOk ? t('ops.connect.field.tooShort') : undefined}>
                    <Input type="password" value={apiKey} onChange={(_, d) => setApiKey(d.value)} placeholder="sk-…" disabled={!canConfigure} autoComplete="off" />
                  </Field>
                  {isBailian && (
                    <MessageBar intent="info">
                      <MessageBarBody>{t('ops.connect.codingPlanNote')}</MessageBarBody>
                    </MessageBar>
                  )}
                </>
              )}

              {step === 3 && (
                <>
                  <Text size={200}>
                    {isLocal ? (
                      <>
                        {t('ops.connect.probe.a')}
                        <code className={s.mono}>{baseUrl.replace(/\/$/, '')}/models</code>
                        {t('ops.connect.probe.b')}
                        <code className={s.mono}>/metrics</code>
                        {t('ops.connect.probe.c')}
                      </>
                    ) : (
                      <>
                        {t('ops.connect.test.a')}
                        <code className={s.mono}>{baseUrl.replace(/\/$/, '')}/models</code>
                        {t('ops.connect.test.b')}
                      </>
                    )}
                  </Text>
                  <div>
                    <Button appearance="primary" icon={testing ? <Spinner size="tiny" /> : isLocal ? <ServerRegular /> : <PlugConnectedRegular />} onClick={runTest} disabled={testing || !canConfigure} data-tour="connect-test-button">
                      {testing ? (isLocal ? t('ops.connect.btn.probing') : t('ops.connect.btn.testing')) : testResult ? (isLocal ? t('ops.connect.btn.reprobe') : t('ops.connect.btn.retest')) : isLocal ? t('ops.connect.step.probe') : t('ops.connect.step.test')}
                    </Button>
                  </div>
                  {testError && (
                    <MessageBar intent="error">
                      <MessageBarBody>
                        <MessageBarTitle>
                          {t('ops.connect.testFailed', { status: testError.status, code: testError.code })}
                        </MessageBarTitle>
                        {apiMessage(t, testError)} requestId: {testError.requestId}
                      </MessageBarBody>
                    </MessageBar>
                  )}
                  {testResult && (
                    <>
                      <MessageBar intent="success">
                        <MessageBarBody>
                          <MessageBarTitle>{isLocal ? t('ops.connect.testOk.nodeTitle') : t('ops.connect.testOk.cloudTitle')}</MessageBarTitle>
                          {isLocal
                            ? t('ops.connect.testOk.nodeBody', { ms: testResult.latencyMs, served: testResult.models.filter((m) => m.served).length, deployable: testResult.models.filter((m) => !m.served).length })
                            : t('ops.connect.testOk.cloudBody', { ms: testResult.latencyMs, n: testResult.models.length })}
                        </MessageBarBody>
                      </MessageBar>
                      {nodeMetrics}
                      {testResult.warnings.map((w, i) => (
                        <MessageBar key={w} intent="warning">
                          <MessageBarBody>{keyedText(t, w, testResult.warningKeys?.[i]?.key, testResult.warningKeys?.[i]?.params)}</MessageBarBody>
                        </MessageBar>
                      ))}
                      <CodeBlock code={testResult.models.filter((m) => m.served).map((m) => `${m.id}  (${modelName(m)})`).join('\n') || t('ops.connect.noServed')} label={t('ops.connect.modelsResponse')} />
                    </>
                  )}
                </>
              )}

              {step === 4 && testResult && (
                <>
                  {isLocal && testResult.models.some((m) => m.served) && (
                    <Field label={t('ops.connect.field.served')}>
                      <div className={s.models} role="group" aria-label={t('ops.connect.field.servedAria')}>
                        {testResult.models
                          .filter((m) => m.served)
                          .map((m) => (
                            <Checkbox key={m.id} label={t('ops.connect.modelOption', { name: modelName(m), id: m.id })} checked={enabledModels.includes(m.id)} onChange={(_, d) => setEnabledModels((a) => (d.checked ? [...a, m.id] : a.filter((x) => x !== m.id)))} disabled={!canConfigure} />
                          ))}
                      </div>
                    </Field>
                  )}
                  {isLocal && (
                    <Field label={t('ops.connect.field.deployNew')} hint={t('ops.connect.field.deployNewHint')}>
                      <div className={s.models} role="group" aria-label={t('ops.connect.field.deployableAria')}>
                        {testResult.models
                          .filter((m) => !m.served)
                          .map((m) => (
                            <Checkbox key={m.id} label={t('ops.connect.modelOption', { name: modelName(m), id: m.id })} checked={enabledModels.includes(m.id)} onChange={(_, d) => setEnabledModels((a) => (d.checked ? [...a, m.id] : a.filter((x) => x !== m.id)))} disabled={!canConfigure} />
                          ))}
                        {testResult.models.filter((m) => !m.served).length === 0 && <Text size={200}>{t('ops.connect.allDeployed')}</Text>}
                      </div>
                    </Field>
                  )}
                  {!isLocal && (
                    <Field label={t('ops.connect.field.enabled')} required hint={t('ops.connect.field.enabledHint')}>
                      <div className={s.models} role="group" aria-label={t('ops.connect.field.enabled')}>
                        {testResult.models.map((m) => (
                          <Checkbox key={m.id} label={t('ops.connect.modelOption', { name: modelName(m), id: m.id })} checked={enabledModels.includes(m.id)} onChange={(_, d) => setEnabledModels((a) => (d.checked ? [...a, m.id] : a.filter((x) => x !== m.id)))} disabled={!canConfigure} />
                        ))}
                      </div>
                    </Field>
                  )}
                  <div className={s.row}>
                    <Field label={t('ops.connect.field.rpm')} required>
                      <Input type="number" min={1} value={rpm} onChange={(_, d) => setRpm(d.value)} disabled={!canConfigure} />
                    </Field>
                    <Field label={t('ops.connect.field.tpm')} required>
                      <Input type="number" min={1000} value={tpm} onChange={(_, d) => setTpm(d.value)} disabled={!canConfigure} />
                    </Field>
                  </div>
                  {isLocal && <Text size={200}>{t('ops.connect.localLimitNote')}</Text>}
                  {isBailian && <Text size={200}>{t('ops.connect.bailianLimitNote')}</Text>}
                </>
              )}

              {step === 5 && (
                <>
                  <div className={s.summary}>
                    <span className={s.dt}>{t('common.provider')}</span>
                    <span>{providerLabel(t, providerId)}</span>
                    <span className={s.dt}>{isLocal ? t('ops.clusterDetail.col.node') : t('ops.connect.field.region')}</span>
                    <span>
                      {regionLabel}
                      {t('ops.connect.paren.open')}
                      <code className={s.mono}>{effectiveRegion}</code>
                      {t('ops.connect.paren.close')}
                    </span>
                    {isLocal && (
                      <>
                        <span className={s.dt}>{t('ops.connect.sum.gpuEngine')}</span>
                        <span>
                          {meta!.gpuCount} × {meta!.gpuType} · {meta!.engine}
                        </span>
                      </>
                    )}
                    <span className={s.dt}>{t('ops.connect.sum.endpoint')}</span>
                    <span className={s.mono}>{baseUrl}</span>
                    <span className={s.dt}>{isLocal ? t('ops.connect.sum.cert') : t('ops.providers.th.key')}</span>
                    <span>{isLocal ? t('ops.connect.sum.mtls', { ref: certRef }) : provider.needsKey ? `•••••••• → kms://maas-demo/${providerId}/${effectiveRegion}` : '—'}</span>
                    <span className={s.dt}>{isLocal ? t('ops.connect.sum.modelsLocal') : t('ops.connect.sum.models')}</span>
                    <span>{enabledModels.join(t('common.listSeparator'))}</span>
                    <span className={s.dt}>{t('ops.connect.sum.limits')}</span>
                    <span>
                      RPM {Number(rpm).toLocaleString()} / TPM {Number(tpm).toLocaleString()}
                    </span>
                    <span className={s.dt}>{isLocal ? t('ops.connect.sum.probeResult') : t('ops.connect.sum.testResult')}</span>
                    <span>{testResult ? t('ops.connect.sum.success', { ms: testResult.latencyMs }) : '—'}</span>
                  </div>
                  <MessageBar intent="info">
                    <MessageBarBody>{t('ops.connect.recheck', { perm: isLocal ? 'cluster.register' : 'provider.configure' })}</MessageBarBody>
                  </MessageBar>
                </>
              )}
            </div>
          </>
        )}
      </DrawerBody>
      <DrawerFooter>
        {result ? (
          <Button appearance="primary" onClick={onClose}>
            {t('common.done')}
          </Button>
        ) : (
          <>
            {step > 0 && (
              <Button icon={<ArrowLeftRegular />} onClick={() => setStep((x) => x - 1)} disabled={busy}>
                {t('common.prev')}
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button appearance="primary" icon={<ArrowRightRegular />} iconPosition="after" onClick={() => setStep((x) => x + 1)} disabled={!canNext || !canConfigure} data-tour="connect-next">
                {t('common.next')}
              </Button>
            ) : (
              <Button appearance="primary" onClick={connect} disabled={busy || !canConfigure} data-tour="connect-submit">
                {busy ? t('ops.createDep.btn.creating') : isLocal ? t('ops.connect.btn.register') : t('ops.connect.btn.connect')}
              </Button>
            )}
            <Button appearance="secondary" onClick={close} disabled={busy}>
              {t('common.cancel')}
            </Button>
          </>
        )}
      </DrawerFooter>
    </OverlayDrawer>
  );
}
