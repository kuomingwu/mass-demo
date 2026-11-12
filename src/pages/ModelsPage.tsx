import {
  Badge,
  Button,
  Dropdown,
  Option,
  OverlayDrawer,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  Field,
  SearchBox,
  Tab,
  TabList,
  Text,
  createTableColumn,
  makeStyles,
  tokens,
  type TableColumnDefinition,
} from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { AsyncView, EmptyState } from '../components/States';
import { StatusBadge } from '../components/StatusBadge';
import { SimpleGrid } from '../components/SimpleGrid';
import { CodeBlock } from '../components/CodeBlock';
import { useApi } from '../hooks/useApi';
import { server } from '../server/api';
import { useSession } from '../app/SessionContext';
import { CAPABILITY_LABELS, LICENSE_TYPE_LABELS, MODEL_BY_ID, MODEL_STATUS_LABELS, ORIGIN_LABELS, PLATFORM_BASE_URL, REGION_LABELS, isLocalModel, isQwen3x, type ModelInfo } from '../data/models';
import { PROVIDER_NAMES } from '../theme/chartPalette';
import { TENANTS } from '../server/seed';
import { tenantLabel, tf, tl, useT, type TFunction } from '../i18n';

/** 模型顯示名稱（目前語言） */
function modelDisplayName(t: TFunction, m: ModelInfo): string {
  return tf(t, `data.model.${m.id}.displayName`, m.displayName);
}
/** 基底模型顯示名稱（baseModel 可能是目錄中的模型 ID，也可能只是名稱） */
function baseModelName(t: TFunction, id: string): string {
  const m = MODEL_BY_ID[id];
  return m ? modelDisplayName(t, m).replace(/[（(].*$/, '').trim() : id;
}
/** 模型的來源地：衍生模型隨基底模型（授權與來源地連帶適用） */
function originOf(m: ModelInfo): ModelInfo['origin'] | undefined {
  return m.origin ?? (m.baseModel ? MODEL_BY_ID[m.baseModel]?.origin : undefined) ?? (m.providerId === 'bailian' ? 'cn' : undefined);
}
import { ModelsDeploymentsTabs } from './deployments/DeploymentsPage';
import { LicenseObligationBadges, LicenseObligationList, licenseObligations } from '../components/LicenseObligations';

/** 欄寬（可拖曳調整）：避免授權／來源地等徽章欄過窄導致逐字換行 */
const MODEL_COLUMN_SIZING = {
  model: { minWidth: 220, defaultWidth: 260 },
  provider: { minWidth: 150, defaultWidth: 170 },
  origin: { minWidth: 130, defaultWidth: 150 },
  license: { minWidth: 190, defaultWidth: 210 },
  regions: { minWidth: 110, defaultWidth: 130 },
  ctx: { minWidth: 150, defaultWidth: 180 },
  maxout: { minWidth: 90, defaultWidth: 100 },
  price: { minWidth: 170, defaultWidth: 190 },
  caps: { minWidth: 160, defaultWidth: 180 },
  status: { minWidth: 80, defaultWidth: 90 },
};

const useStyles = makeStyles({
  filters: { display: 'flex', columnGap: tokens.spacingHorizontalM, rowGap: tokens.spacingVerticalS, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: tokens.spacingVerticalM },
  caps: { display: 'flex', flexWrap: 'wrap', gap: '4px' },
  dl: { display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: tokens.spacingHorizontalM, rowGap: tokens.spacingVerticalXS, margin: 0, fontSize: tokens.fontSizeBase300 },
  dt: { color: tokens.colorNeutralForeground3 },
  dd: { margin: 0 },
  section: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalS, marginTop: tokens.spacingVerticalL },
  price: { fontVariantNumeric: 'tabular-nums' },
  note: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
});

function statusKind(s: ModelInfo['status']) {
  return s === 'ga' ? 'success' : s === 'preview' ? 'info' : s === 'legacy' ? 'warning' : 'danger';
}

export function ModelsPage() {
  const s = useStyles();
  const t = useT();
  const { session, principal } = useSession();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [provider, setProvider] = useState<string>('all');
  const [selected, setSelected] = useState<ModelInfo | null>(null);
  const st = useApi(() => server.listModels(session), [session]);
  // 客戶角色：依租戶政策排除的來源地（例如公部門排除中國來源，含以 Qwen 為基底的 MaaS-Assist）不列入目錄
  const tenant = principal?.tenantId ? TENANTS.find((x) => x.id === principal.tenantId) : undefined;
  const excludedOrigins = (tenant?.excludeOrigins ?? []) as string[];
  const isExcluded = (m: ModelInfo) => {
    const o = originOf(m);
    return !!o && excludedOrigins.includes(o);
  };
  const excludedCount = useMemo(() => (st.data ?? []).filter(isExcluded).length, [st.data, excludedOrigins.join(',')]);

  const filtered = useMemo(() => {
    const list = (st.data ?? []).filter((m) => !isExcluded(m));
    const text = q.toLowerCase();
    return list.filter((m) => (provider === 'all' || m.providerId === provider) && (!text || `${m.id} ${m.displayName} ${m.family} ${m.description} ${modelDisplayName(t, m)} ${tf(t, `data.model.${m.id}.description`, m.description)}`.toLowerCase().includes(text)));
  }, [st.data, q, provider, excludedOrigins.join(','), t]);

  const columns: TableColumnDefinition<ModelInfo>[] = useMemo(
    () => [
      createTableColumn<ModelInfo>({
        columnId: 'model',
        compare: (a, b) => a.id.localeCompare(b.id),
        renderHeaderCell: () => t('ops.models.col.model'),
        renderCell: (m) => (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Text weight="semibold">{modelDisplayName(t, m)}</Text>
            <Text size={200} style={{ fontFamily: tokens.fontFamilyMonospace, color: tokens.colorNeutralForeground3 }}>
              {m.id}
            </Text>
          </div>
        ),
      }),
      createTableColumn<ModelInfo>({
        columnId: 'provider',
        compare: (a, b) => a.providerId.localeCompare(b.providerId),
        renderHeaderCell: () => t('ops.models.col.provider'),
        renderCell: (m) => (
          <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {isLocalModel(m) ? (
              <Badge appearance="tint" color="brand" size="small">
                {t('ops.models.selfHosted')}
              </Badge>
            ) : (
              <Badge appearance="outline" size="small">
                {t('ops.models.cloudProxy', { provider: tl(t, 'PROVIDER_NAMES', m.providerId, PROVIDER_NAMES[m.providerId]) })}
              </Badge>
            )}
            {m.hostedBy && <Badge appearance="outline" size="small">{t('ops.models.thirdPartyHosted')}</Badge>}
          </span>
        ),
      }),
      createTableColumn<ModelInfo>({
        columnId: 'origin',
        compare: (a, b) => (originOf(a) ?? '').localeCompare(originOf(b) ?? ''),
        renderHeaderCell: () => t('ops.models.col.origin'),
        renderCell: (m) => {
          const o = originOf(m);
          return (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <Badge appearance="tint" size="small" color={o === 'cn' ? 'warning' : o === 'tw' ? 'success' : 'informative'} style={{ alignSelf: 'flex-start' }} title={m.baseModel ? t('ops.models.originFollowsBase') : undefined}>
                {o ? tl(t, 'ORIGIN_LABELS', o, ORIGIN_LABELS[o]) : '—'}
                {m.baseModel ? t('ops.models.followsBaseSuffix') : ''}
              </Badge>
              {m.baseModel && (
                <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
                  {t('ops.models.basePrefix', { name: baseModelName(t, m.baseModel) })}
                </Text>
              )}
            </div>
          );
        },
      }),
      createTableColumn<ModelInfo>({
        columnId: 'license',
        compare: (a, b) => a.licenseType.localeCompare(b.licenseType),
        renderHeaderCell: () => t('ops.models.col.license'),
        renderCell: (m) => (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <Badge appearance="tint" size="small" color={m.licenseType === 'open-weight' ? 'success' : m.licenseType === 'platform-licensed' ? 'important' : 'informative'} style={{ alignSelf: 'flex-start' }}>
              {m.licenseType === 'open-weight' ? tf(t, `data.model.${m.id}.license`, m.license ?? 'Apache-2.0') : m.licenseType === 'platform-licensed' ? t('ops.models.platformLicensed') : t('ops.models.cloudApi')}
            </Badge>
            <Text size={100} style={{ color: tokens.colorNeutralForeground3 }}>
              {tl(t, 'LICENSE_TYPE_LABELS', m.licenseType, LICENSE_TYPE_LABELS[m.licenseType])}
            </Text>
            <LicenseObligationBadges model={m} size="extra-small" compact />
          </div>
        ),
      }),
      createTableColumn<ModelInfo>({
        columnId: 'regions',
        renderHeaderCell: () => t('ops.models.col.regions'),
        renderCell: (m) => <span>{m.regions.length > 2 ? `${m.regions.slice(0, 2).join(', ')} +${m.regions.length - 2}` : m.regions.join(', ')}</span>,
      }),
      createTableColumn<ModelInfo>({
        columnId: 'ctx',
        compare: (a, b) => a.contextLength - b.contextLength,
        renderHeaderCell: () => t('ops.models.col.ctx'),
        renderCell: (m) => (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span className={s.price}>{(m.maxModelLen ?? m.contextLength).toLocaleString()}</span>
            {m.nativeContextLength && m.nativeContextLength !== (m.maxModelLen ?? m.contextLength) && (
              <Text size={100} style={{ color: tokens.colorNeutralForeground3 }} className={s.price}>
                {t('ops.models.ctxNative', { native: m.nativeContextLength.toLocaleString(), len: (m.maxModelLen ?? m.contextLength).toLocaleString() })}
              </Text>
            )}
          </div>
        ),
      }),
      createTableColumn<ModelInfo>({
        columnId: 'maxout',
        compare: (a, b) => a.maxOutput - b.maxOutput,
        renderHeaderCell: () => t('ops.models.col.maxout'),
        renderCell: (m) => <span className={s.price}>{m.maxOutput ? m.maxOutput.toLocaleString() : '—'}</span>,
      }),
      createTableColumn<ModelInfo>({
        columnId: 'price',
        compare: (a, b) => a.priceInput - b.priceInput,
        renderHeaderCell: () => <span title={t('ops.models.col.priceTip')}>{t('ops.models.col.price')}</span>,
        renderCell: (m) => (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span className={s.price}>
              US${m.priceInput} / {m.priceOutput ? `US$${m.priceOutput}` : '—'}
            </span>
            {m.marketRefUsd && (
              <Text size={100} style={{ color: tokens.colorNeutralForeground3 }} className={s.price} title={tf(t, `data.model.${m.id}.marketRefSource`, m.marketRefUsd.source)}>
                {t('ops.models.marketRef', { input: m.marketRefUsd.input, output: m.marketRefUsd.output ? `US$${m.marketRefUsd.output}` : '—' })}
              </Text>
            )}
          </div>
        ),
      }),
      createTableColumn<ModelInfo>({
        columnId: 'caps',
        renderHeaderCell: () => t('ops.models.col.caps'),
        renderCell: (m) => (
          <div className={s.caps}>
            {m.capabilities.map((c) => (
              <Badge key={c} appearance="tint" color="informative" size="small">
                {tl(t, 'CAPABILITY_LABELS', c, CAPABILITY_LABELS[c])}
              </Badge>
            ))}
          </div>
        ),
      }),
      createTableColumn<ModelInfo>({
        columnId: 'status',
        compare: (a, b) => a.status.localeCompare(b.status),
        renderHeaderCell: () => t('ops.models.col.status'),
        renderCell: (m) => <StatusBadge kind={statusKind(m.status)} label={tl(t, 'MODEL_STATUS_LABELS', m.status, MODEL_STATUS_LABELS[m.status])} size="small" />,
      }),
    ],
    [s, t],
  );

  return (
    <>
      <PageHeader title={t('ops.deployments.title')} subtitle={t('ops.models.subtitle')} crumbs={[{ label: t('ops.deployments.title') }, { label: t('ops.models.crumb') }]} />
      <ModelsDeploymentsTabs value="models" />
      <div className={s.filters}>
        <Field label={t('ops.models.search')}>
          <SearchBox value={q} onChange={(_, d) => setParams(d.value ? { q: d.value } : {})} placeholder={t('ops.models.searchPlaceholder')} style={{ minWidth: 260 }} />
        </Field>
        <Field label={t('common.provider')}>
          <Dropdown value={provider === 'all' ? t('common.all') : tl(t, 'PROVIDER_NAMES', provider, PROVIDER_NAMES[provider])} selectedOptions={[provider]} onOptionSelect={(_, d) => setProvider(d.optionValue ?? 'all')} style={{ minWidth: 160 }}>
            <Option value="all">{t('common.all')}</Option>
            {Object.entries(PROVIDER_NAMES).map(([k, v]) => (
              <Option key={k} value={k}>
                {tl(t, 'PROVIDER_NAMES', k, v)}
              </Option>
            ))}
          </Dropdown>
        </Field>
        <Text className={s.note}>
          {t('ops.models.count', { n: filtered.length })}
          {excludedCount > 0 && tenant
            ? t('ops.models.excluded', {
                tenant: tenantLabel(t, tenant.id, tenant.name),
                n: excludedCount,
                origins: excludedOrigins.map((o) => tl(t, 'ORIGIN_LABELS', o, ORIGIN_LABELS[o as keyof typeof ORIGIN_LABELS] ?? o)).join(t('common.listSeparator')),
              })
            : ''}
        </Text>
      </div>
      <AsyncView {...st} actionLabel={t('ops.models.actionLabel')} isEmpty={() => filtered.length === 0} empty={<EmptyState title={t('ops.models.empty.title')} description={t('ops.models.empty.desc')} />}>
        {() => (
          <SimpleGrid items={filtered} columns={columns} getRowId={(m) => m.id} ariaLabel={t('ops.models.crumb')} onRowClick={setSelected} minWidth={1640} columnSizing={MODEL_COLUMN_SIZING} />
        )}
      </AsyncView>
      <ModelDrawer model={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function ModelDrawer({ model, onClose }: { model: ModelInfo | null; onClose: () => void }) {
  const s = useStyles();
  const t = useT();
  const [tab, setTab] = useState<'card' | 'curl' | 'python'>('card');
  if (!model) return null;
  const displayName = modelDisplayName(t, model);
  const prompt = t('ops.models.snippet.prompt');
  const thinking = isQwen3x(model.id) && model.capabilities.includes('thinking');
  const curl = `curl ${PLATFORM_BASE_URL}/chat/completions \\
  -H "Authorization: Bearer $MAAS_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model.id}",
    "messages": [{"role": "user", "content": "${prompt}"}],
    "stream": true${thinking ? ',\n    "extra_body": {"enable_thinking": true}' : ''}
  }'`;
  const py = `from openai import OpenAI

client = OpenAI(
    api_key=os.environ["MAAS_API_KEY"],  # ${t('ops.models.snippet.keyComment')}
    base_url="${PLATFORM_BASE_URL}",
)

stream = client.chat.completions.create(
    model="${model.id}",
    messages=[{"role": "user", "content": "${prompt}"}],
    stream=True,${thinking ? '\n    extra_body={"enable_thinking": True},' : ''}
)
for chunk in stream:
    delta = chunk.choices[0].delta
    print(delta.content or "", end="", flush=True)`;
  return (
    <OverlayDrawer open={!!model} position="end" size="medium" onOpenChange={(_, d) => !d.open && onClose()} aria-label={t('ops.models.drawer.aria', { name: displayName })}>
      <DrawerHeader>
        <DrawerHeaderTitle action={<Button appearance="subtle" aria-label={t('common.close')} icon={<DismissRegular />} onClick={onClose} />}>{displayName}</DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as typeof tab)} aria-label={t('ops.models.drawer.tabsAria')}>
          <Tab value="card">{t('ops.models.drawer.tab.card')}</Tab>
          <Tab value="curl">{t('ops.models.drawer.tab.curl')}</Tab>
          <Tab value="python">{t('ops.models.drawer.tab.python')}</Tab>
        </TabList>
        {tab === 'card' && (
          <div className={s.section}>
            <Text>{tf(t, `data.model.${model.id}.description`, model.description)}</Text>
            <dl className={s.dl}>
              <dt className={s.dt}>{t('ops.models.drawer.modelId')}</dt>
              <dd className={s.dd}>
                <code>{model.id}</code>
              </dd>
              <dt className={s.dt}>{t('common.provider')}</dt>
              <dd className={s.dd}>
                {tl(t, 'PROVIDER_NAMES', model.providerId, PROVIDER_NAMES[model.providerId])}
                {model.hostedBy ? t('ops.models.drawer.hostedBy', { host: tf(t, `data.model.${model.id}.hostedBy`, model.hostedBy) }) : ''}
              </dd>
              <dt className={s.dt}>{t('ops.models.drawer.family')}</dt>
              <dd className={s.dd}>{model.family}</dd>
              <dt className={s.dt}>{t('ops.models.col.origin')}</dt>
              <dd className={s.dd}>
                {(() => {
                  const o = originOf(model);
                  return o ? tl(t, 'ORIGIN_LABELS', o, ORIGIN_LABELS[o]) : '—';
                })()}
                {model.baseModel ? t('ops.models.drawer.originBase', { name: baseModelName(t, model.baseModel) }) : ''}
              </dd>
              {model.baseModel && (
                <>
                  <dt className={s.dt}>{t('ops.models.drawer.baseModel')}</dt>
                  <dd className={s.dd}>
                    <code>{model.baseModel}</code>
                    {t('ops.models.drawer.baseModelNote')}
                  </dd>
                </>
              )}
              <dt className={s.dt}>{t('ops.models.col.status')}</dt>
              <dd className={s.dd}>
                <StatusBadge kind={statusKind(model.status)} label={tl(t, 'MODEL_STATUS_LABELS', model.status, MODEL_STATUS_LABELS[model.status])} size="small" />
              </dd>
              <dt className={s.dt}>{t('ops.models.drawer.ctxMax')}</dt>
              <dd className={s.dd}>
                {(model.maxModelLen ?? model.contextLength).toLocaleString()} / {model.maxOutput ? model.maxOutput.toLocaleString() : '—'} tokens
                {model.nativeContextLength && model.nativeContextLength !== (model.maxModelLen ?? model.contextLength) ? t('ops.models.drawer.ctxNative', { native: model.nativeContextLength.toLocaleString(), len: (model.maxModelLen ?? model.contextLength).toLocaleString() }) : ''}
              </dd>
              <dt className={s.dt}>{t('ops.models.col.caps')}</dt>
              <dd className={s.dd}>{model.capabilities.map((c) => tl(t, 'CAPABILITY_LABELS', c, CAPABILITY_LABELS[c])).join(t('common.listSeparator'))}</dd>
              <dt className={s.dt}>{t('ops.models.col.license')}</dt>
              <dd className={s.dd}>
                {tl(t, 'LICENSE_TYPE_LABELS', model.licenseType, LICENSE_TYPE_LABELS[model.licenseType])}
                {model.license ? ` · ${tf(t, `data.model.${model.id}.license`, model.license)}` : ''}
                {model.licenseType === 'cloud-api' ? t('ops.models.drawer.licenseProxied') : t('ops.models.drawer.licenseSelfHosted')}
              </dd>
              {licenseObligations(model).length > 0 && (
                <>
                  <dt className={s.dt}>{t('ops.models.drawer.obligations')}</dt>
                  <dd className={s.dd}>
                    <LicenseObligationBadges model={model} max={4} />
                    <LicenseObligationList model={model} />
                  </dd>
                </>
              )}
            </dl>
            <Text weight="semibold">{t('ops.models.col.regions')}</Text>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {model.regions.map((r) => (
                <li key={r}>
                  <code>{r}</code> — {tl(t, 'REGION_LABELS', r, REGION_LABELS[r] ?? r)}
                </li>
              ))}
            </ul>
            <Text weight="semibold">{t('ops.models.drawer.prices')}</Text>
            {model.regionPrices ? (
              <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '4px 8px' }}>{t('ops.models.col.regions')}</th>
                    <th style={{ textAlign: 'right', padding: '4px 8px' }}>{t('common.input')}</th>
                    <th style={{ textAlign: 'right', padding: '4px 8px' }}>{t('common.output')}</th>
                  </tr>
                </thead>
                <tbody>
                  {model.regionPrices.map((rp) => (
                    <tr key={rp.region}>
                      <td style={{ padding: '4px 8px' }}>{tf(t, `data.regionPrice.${rp.region}`, rp.regionLabel)}</td>
                      <td style={{ padding: '4px 8px', textAlign: 'right' }} className={s.price}>
                        {rp.currency === 'USD' ? 'US$' : 'CN¥'}
                        {rp.input}
                      </td>
                      <td style={{ padding: '4px 8px', textAlign: 'right' }} className={s.price}>
                        {rp.currency === 'USD' ? 'US$' : 'CN¥'}
                        {rp.output}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Text className={s.price}>
                {t('ops.models.drawer.priceLine', { input: model.priceInput, output: model.priceOutput ? `US$${model.priceOutput}` : '—' })}
              </Text>
            )}
            {model.marketRefUsd && (
              <Text size={200}>
                {t('ops.models.drawer.marketRef', { input: model.marketRefUsd.input, output: model.marketRefUsd.output ? `US$${model.marketRefUsd.output}` : '—', source: tf(t, `data.model.${model.id}.marketRefSource`, model.marketRefUsd.source) })}
              </Text>
            )}
            <Text className={s.note}>{t('ops.models.drawer.priceNote')}</Text>
          </div>
        )}
        {tab === 'curl' && (
          <div className={s.section}>
            <Text size={200}>
              {t('ops.models.drawer.curlIntro', { url: PLATFORM_BASE_URL })}
              {thinking && t('ops.models.drawer.thinking')}
            </Text>
            <CodeBlock code={curl} label={t('ops.models.drawer.tab.curl')} />
          </div>
        )}
        {tab === 'python' && (
          <div className={s.section}>
            <Text size={200}>{t('ops.models.drawer.pyIntro')}</Text>
            <CodeBlock code={py} label={t('ops.models.drawer.tab.python')} />
          </div>
        )}
      </DrawerBody>
    </OverlayDrawer>
  );
}
