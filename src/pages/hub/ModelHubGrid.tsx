import { Badge, Button, Dropdown, Field, Option, SearchBox, Tab, TabList, Text, ToggleButton, Tooltip, makeStyles, mergeClasses, shorthands, tokens } from '@fluentui/react-components';
import { CodeRegular, PlayRegular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../../components/States';
import { HUB_BADGE_LABELS, MODALITY_LABELS, ORIGIN_LABELS, UNIT_TYPE_LABELS, isLocalModel, originOfModel, type HubBadge, type Modality, type ModelInfo } from '../../data/models';
import { PROVIDER_NAMES } from '../../theme/chartPalette';
import { server, type HubCatalog, type HubModelView } from '../../server/api';
import { proxiedPriceView } from '../../data/commercial';
import { keyedText, tf, tl, useLocale, useT, type TFunction, tenantLabel } from '../../i18n';

const useStyles = makeStyles({
  tabs: { flexWrap: 'wrap' },
  toolbar: { display: 'flex', flexWrap: 'wrap', columnGap: tokens.spacingHorizontalM, rowGap: tokens.spacingVerticalS, alignItems: 'flex-end', marginTop: tokens.spacingVerticalS, marginBottom: tokens.spacingVerticalM },
  segmented: { display: 'inline-flex', columnGap: '2px', flexWrap: 'wrap' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: tokens.spacingHorizontalM },
  card: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalS,
    padding: tokens.spacingVerticalM,
    borderRadius: tokens.borderRadiusLarge,
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground1,
    minWidth: 0,
    ':hover': { boxShadow: tokens.shadow8 },
  },
  cardLocal: { borderTopColor: tokens.colorBrandStroke2, borderTopWidth: '3px' },
  head: { display: 'flex', alignItems: 'flex-start', columnGap: tokens.spacingHorizontalS },
  logo: {
    width: '40px',
    height: '40px',
    flexShrink: 0,
    borderRadius: tokens.borderRadiusMedium,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground2,
  },
  logoProxied: { backgroundColor: tokens.colorNeutralBackground3, color: tokens.colorNeutralForeground2 },
  title: { fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase400, lineHeight: tokens.lineHeightBase400, overflowWrap: 'anywhere' },
  vendor: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  badges: { display: 'flex', flexWrap: 'wrap', gap: '4px' },
  stats: { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: tokens.spacingHorizontalS, rowGap: tokens.spacingVerticalXS, marginTop: 'auto' },
  stat: { display: 'flex', flexDirection: 'column' },
  statLabel: { fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3 },
  statValue: { fontSize: tokens.fontSizeBase300, fontVariantNumeric: 'tabular-nums', fontWeight: tokens.fontWeightSemibold },
  statSub: { fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3, fontVariantNumeric: 'tabular-nums' },
  actions: { display: 'flex', columnGap: tokens.spacingHorizontalS, alignItems: 'center', flexWrap: 'wrap' },
  desc: { color: tokens.colorNeutralForeground2, fontSize: tokens.fontSizeBase200, lineHeight: tokens.lineHeightBase200, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  note: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
});

type ModalityTab = 'all' | 'text' | 'vision' | 'image' | 'video' | 'audio' | 'embedding';
/** 分頁標籤鍵：hub.grid.modality.<value> */
const MODALITY_TABS: { value: ModalityTab }[] = [{ value: 'all' }, { value: 'text' }, { value: 'vision' }, { value: 'image' }, { value: 'video' }, { value: 'audio' }, { value: 'embedding' }];

type SourceFilter = 'all' | 'local' | 'cloud';
type SortKey = 'name' | 'price-asc' | 'price-desc';
/** 排序標籤鍵 */
const SORT_LABEL_KEYS: Record<SortKey, string> = { name: 'hub.grid.sort.name', 'price-asc': 'hub.grid.sort.priceAsc', 'price-desc': 'hub.grid.sort.priceDesc' };

const BADGE_COLOR: Record<HubBadge, 'brand' | 'informative' | 'success' | 'warning' | 'important' | 'severe' | 'subtle' | 'danger'> = {
  'self-hosted': 'brand',
  proxied: 'informative',
  new: 'important',
  hot: 'severe',
  'gov-ok': 'success',
  'open-weight': 'success',
  commercial: 'subtle',
  fp8: 'subtle',
  int4: 'subtle',
  'tool-calling': 'informative',
  'contract-required': 'warning',
  'proxy-discount': 'important',
};
/** 卡片上顯示的徽章順序（tool-calling 另以圖示表示，不佔徽章位） */
const BADGE_ORDER: HubBadge[] = ['self-hosted', 'proxied', 'hot', 'new', 'gov-ok', 'open-weight', 'commercial', 'fp8', 'int4', 'proxy-discount', 'contract-required'];

function matchModality(m: ModelInfo, tab: ModalityTab): boolean {
  if (tab === 'all') return true;
  if (tab === 'embedding') return m.modality === 'embedding' || m.modality === 'rerank';
  return m.modality === tab;
}

/** 顯示名稱（依語言；只有含中文的顯示名才有字典鍵） */
function displayName(t: TFunction, m: ModelInfo): string {
  return tf(t, `data.model.${m.id}.displayName`, m.displayName);
}
/** 顯示名稱去掉括號補述（卡片標題），副標再顯示 */
function stripNote(name: string): string {
  return name.replace(/[（(].*$/, '').trim();
}
function shortName(m: ModelInfo): string {
  return stripNote(m.displayName);
}
function initials(m: ModelInfo): string {
  const n = shortName(m).replace(/[^A-Za-z0-9\u4e00-\u9fff]/g, '');
  return n.slice(0, 2);
}

/** 卡片價格：自建 ＝ 我們的牌價（＋市場參考）；代理 ＝ 「供應商牌價 → 我們的價格」（開放模型 + 加價、閉源／夥伴 − 代理折扣） */
function priceLine(t: TFunction, m: ModelInfo): { main: string; sub?: string; ours?: string } {
  const b = server.billing;
  if (isLocalModel(m)) {
    const p = server.customerUnitPrice(m);
    if (m.unitType === 'per_1m_tokens') {
      const out = p.output ? `US$${p.output}` : '—';
      return { main: `US$${p.input} / ${out}`, sub: m.marketRefUsd ? t('hub.grid.marketRef', { input: m.marketRefUsd.input, output: m.marketRefUsd.output ? ` / US$${m.marketRefUsd.output}` : '' }) : undefined };
    }
    return { main: `US$${p.input}`, sub: tl(t, 'UNIT_TYPE_LABELS', m.unitType, UNIT_TYPE_LABELS[m.unitType]) };
  }
  const v = proxiedPriceView(m, { cloudMarkupPct: b.cloudMarkupPct, proxyDiscountPct: b.proxyDiscountPct, negotiatedDiscountPct: b.negotiatedDiscountPct });
  if (m.unitType === 'per_1m_tokens') {
    const out = v.ourOutput ? `US$${v.ourOutput}` : '—';
    return { main: `US$${v.ourInput} / ${out}`, ours: t('hub.grid.vendorToOurs', { list: `US$${v.listInput}${v.listOutput ? ` / US$${v.listOutput}` : ''}`, pct: pct(t, v) }) };
  }
  return { main: `US$${v.ourInput}`, sub: tl(t, 'UNIT_TYPE_LABELS', m.unitType, UNIT_TYPE_LABELS[m.unitType]), ours: t('hub.grid.vendorToOurs', { list: `US$${v.listInput}`, pct: pct(t, v) }) };
}

function pct(t: TFunction, v: { pctLabel: string; pctLabelKey?: string; pctLabelParams?: { pct: number } }): string {
  return keyedText(t, v.pctLabel, v.pctLabelKey, v.pctLabelParams);
}

export function ModelHubGrid({ catalog, onApi }: { catalog: HubCatalog; onApi: (m: HubModelView) => void }) {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const navigate = useNavigate();
  const [tab, setTab] = useState<ModalityTab>('all');
  const [source, setSource] = useState<SourceFilter>('all');
  const [origin, setOrigin] = useState<string>('all');
  const [license, setLicense] = useState<'all' | 'open' | 'commercial'>('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('name');

  const counts = useMemo(() => {
    const c: Record<ModalityTab, number> = { all: 0, text: 0, vision: 0, image: 0, video: 0, audio: 0, embedding: 0 };
    for (const m of catalog.models) for (const mt of MODALITY_TABS) if (matchModality(m, mt.value)) c[mt.value] += 1;
    return c;
  }, [catalog.models]);

  const filtered = useMemo(() => {
    const text = q.trim().toLowerCase();
    const list = catalog.models.filter((m) => {
      if (m.status === 'legacy') return false;
      if (!matchModality(m, tab)) return false;
      if (source === 'local' && !isLocalModel(m)) return false;
      if (source === 'cloud' && isLocalModel(m)) return false;
      if (origin !== 'all' && originOfModel(m) !== origin) return false;
      if (license === 'open' && !m.badges.includes('open-weight')) return false;
      if (license === 'commercial' && m.badges.includes('open-weight')) return false;
      if (text && !`${m.id} ${m.displayName} ${displayName(t, m)} ${m.family} ${m.description} ${tf(t, `data.model.${m.id}.description`, m.description)}`.toLowerCase().includes(text)) return false;
      return true;
    });
    const blended = (m: ModelInfo) => {
      const p = server.customerUnitPrice(m);
      return m.unitType === 'per_1m_tokens' ? p.input * 0.7 + p.output * 0.3 : p.input;
    };
    return list.sort((a, b) => (sort === 'name' ? shortName(a).localeCompare(shortName(b), 'zh-Hant') : sort === 'price-asc' ? blended(a) - blended(b) : blended(b) - blended(a)));
  }, [catalog.models, tab, source, origin, license, q, sort, t]);

  return (
    <section aria-labelledby="hub-grid-title" data-tour="hub-grid-section">
      <Text as="h2" id="hub-grid-title" size={600} weight="semibold" block>
        {t('hub.grid.title')}
      </Text>
      <Text className={s.note} block>
        {t('hub.grid.total', { n: catalog.models.length })}
        {catalog.tenantName ? t('hub.grid.filteredBy', { tenant: tenantLabel(t, catalog.tenantId, catalog.tenantName) }) : ''}
        {catalog.excluded.count > 0 ? t('hub.grid.excluded', { n: catalog.excluded.count, origins: catalog.excluded.origins.map((o) => originLabel(t, o)).join(t('hub.sep.list')) }) : ''}
        {catalog.localOnly ? t('hub.grid.localOnly') : ''}
        {t('hub.grid.priceNote')}
      </Text>
      <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as ModalityTab)} aria-label={t('hub.grid.modalityAria')} data-tour="hub-tabs" className={s.tabs} style={{ marginTop: 8 }}>
        {MODALITY_TABS.map((mt) => (
          <Tab key={mt.value} value={mt.value} data-tour={`hub-tab-${mt.value}`}>
            {t('hub.grid.tabCount', { label: `@hub.grid.modality.${mt.value}`, n: counts[mt.value] })}
          </Tab>
        ))}
      </TabList>
      <div className={s.toolbar} data-tour="hub-filters">
        <Field label={t('hub.grid.source')}>
          <div className={s.segmented} role="group" aria-label={t('hub.grid.source')}>
            <ToggleButton size="small" checked={source === 'all'} onClick={() => setSource('all')} data-tour="hub-source-all">
              {t('common.all')}
            </ToggleButton>
            <ToggleButton size="small" checked={source === 'local'} onClick={() => setSource('local')} data-tour="hub-source-local">
              {t('hub.grid.sourceLocal')}
            </ToggleButton>
            <ToggleButton size="small" checked={source === 'cloud'} onClick={() => setSource('cloud')} data-tour="hub-source-cloud">
              {t('hub.grid.sourceCloud')}
            </ToggleButton>
          </div>
        </Field>
        <Field label={t('hub.grid.origin')}>
          <Dropdown size="small" value={origin === 'all' ? t('common.all') : originLabel(t, origin)} selectedOptions={[origin]} onOptionSelect={(_, d) => setOrigin(d.optionValue ?? 'all')} style={{ minWidth: 120 }} aria-label={t('hub.grid.origin')}>
            <Option value="all">{t('common.all')}</Option>
            {(Object.keys(ORIGIN_LABELS) as (keyof typeof ORIGIN_LABELS)[])
              .filter((o) => !catalog.excluded.origins.includes(o))
              .map((o) => (
                <Option key={o} value={o}>
                  {originLabel(t, o)}
                </Option>
              ))}
          </Dropdown>
        </Field>
        <Field label={t('hub.grid.license')}>
          <Dropdown size="small" value={license === 'all' ? t('common.all') : license === 'open' ? t('hub.grid.licenseOpen') : t('hub.grid.licenseCommercial')} selectedOptions={[license]} onOptionSelect={(_, d) => setLicense((d.optionValue as typeof license) ?? 'all')} style={{ minWidth: 120 }} aria-label={t('hub.grid.license')}>
            <Option value="all">{t('common.all')}</Option>
            <Option value="open">{t('hub.grid.licenseOpen')}</Option>
            <Option value="commercial">{t('hub.grid.licenseCommercial')}</Option>
          </Dropdown>
        </Field>
        <Field label={t('hub.grid.searchLabel')}>
          <SearchBox size="small" value={q} onChange={(_, d) => setQ(d.value)} placeholder={t('hub.grid.searchPlaceholder')} style={{ minWidth: 200 }} data-tour="hub-search" />
        </Field>
        <Field label={t('hub.grid.sortLabel')}>
          <Dropdown size="small" value={t(SORT_LABEL_KEYS[sort])} selectedOptions={[sort]} onOptionSelect={(_, d) => setSort((d.optionValue as SortKey) ?? 'name')} style={{ minWidth: 140 }} aria-label={t('hub.grid.sortLabel')}>
            {(Object.keys(SORT_LABEL_KEYS) as SortKey[]).map((k) => (
              <Option key={k} value={k}>
                {t(SORT_LABEL_KEYS[k])}
              </Option>
            ))}
          </Dropdown>
        </Field>
        <Text className={s.note}>{t('hub.grid.results', { n: filtered.length })}</Text>
      </div>
      {filtered.length === 0 ? (
        <EmptyState title={t('hub.grid.emptyTitle')} description={t('hub.grid.emptyDescription')} />
      ) : (
        <div className={s.grid} data-tour="hub-grid" role="list" aria-label={t('hub.grid.cardsAria')}>
          {filtered.map((m, i) => {
            const local = isLocalModel(m);
            const o = originOfModel(m);
            const price = priceLine(t, m);
            const name = displayName(t, m);
            const short = stripNote(name);
            const canTry = m.modality !== 'embedding' && m.modality !== 'rerank';
            const blocked = !m.allowedByPlan || m.tierBlocked;
            const tryLabel = m.tierBlocked ? t('hub.grid.tierBlocked') : !m.allowedByPlan ? t('hub.grid.notInPlan') : '';
            return (
              <article key={m.id} className={mergeClasses(s.card, local && s.cardLocal)} role="listitem" aria-label={name} data-tour={`hub-card-${m.id}`} data-model-id={m.id} data-model-origin={o ?? ''}>
                <div className={s.head}>
                  <span className={mergeClasses(s.logo, !local && s.logoProxied)} aria-hidden>
                    {initials(m)}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className={s.title}>{short}</div>
                    <div className={s.vendor}>
                      {m.family} · {local ? t('hub.grid.ourGpu') : tl(t, 'PROVIDER_NAMES', m.providerId, PROVIDER_NAMES[m.providerId])}
                      {o ? ` · ${originLabel(t, o)}` : ''} · {tl(t, 'MODALITY_LABELS', m.modality, MODALITY_LABELS[m.modality])}
                    </div>
                  </div>
                </div>
                <div className={s.badges}>
                  {BADGE_ORDER.filter((b) => m.badges.includes(b)).map((b) => (
                    <Badge key={b} size="small" appearance={b === 'self-hosted' || b === 'proxied' ? 'filled' : 'tint'} color={BADGE_COLOR[b]}>
                      {tl(t, 'HUB_BADGE_LABELS', b, HUB_BADGE_LABELS[b])}
                    </Badge>
                  ))}
                  {m.toolCalling && (
                    <Badge size="small" appearance="outline" color="informative">
                      {t('hub.grid.toolCalling')}
                    </Badge>
                  )}
                  {blocked && (
                    <Badge size="small" appearance="tint" color="warning">
                      {m.tierBlocked ? t('hub.grid.needsContract') : t('hub.grid.notInPlanBadge')}
                    </Badge>
                  )}
                </div>
                <Text className={s.desc} title={tf(t, `data.model.${m.id}.description`, m.description)}>
                  {tf(t, `data.model.${m.id}.description`, m.description)}
                </Text>
                <div className={s.stats}>
                  <div className={s.stat}>
                    <span className={s.statLabel}>{m.unitType === 'per_1m_tokens' ? t('hub.grid.context') : t('hub.grid.unit')}</span>
                    <span className={s.statValue}>{m.unitType === 'per_1m_tokens' ? L.fmtNumber(m.maxModelLen ?? m.contextLength) : tl(t, 'UNIT_TYPE_LABELS', m.unitType, UNIT_TYPE_LABELS[m.unitType])}</span>
                    {m.speedTokPerSec && m.unitType === 'per_1m_tokens' && <span className={s.statSub}>{t('hub.grid.speed', { n: m.speedTokPerSec })}</span>}
                  </div>
                  <div className={s.stat}>
                    <span className={s.statLabel}>{m.unitType === 'per_1m_tokens' ? (local ? t('hub.grid.ourListPrice') : t('hub.grid.ourPriceTokens')) : t('hub.grid.ourPrice')}</span>
                    <span className={s.statValue}>{price.main}</span>
                    {price.ours && <span className={s.statSub} data-tour={i === 0 ? 'hub-price-proxied' : undefined}>{price.ours}</span>}
                    {price.sub && <span className={s.statSub}>{price.sub}</span>}
                  </div>
                </div>
                <div className={s.actions}>
                  {canTry ? (
                    blocked ? (
                      <Tooltip content={tryLabel} relationship="description">
                        <Button size="small" icon={<PlayRegular />} disabled>
                          {t('hub.grid.try')}
                        </Button>
                      </Tooltip>
                    ) : (
                      <Button size="small" appearance="primary" icon={<PlayRegular />} onClick={() => navigate(`/playground?model=${encodeURIComponent(m.id)}`)} data-tour={i === 0 ? 'hub-try' : undefined}>
                        {t('hub.grid.try')}
                      </Button>
                    )
                  ) : (
                    <Text className={s.note}>{t('hub.grid.embeddingViaApi')}</Text>
                  )}
                  <Button size="small" icon={<CodeRegular />} onClick={() => onApi(m)} data-tour={i === 0 ? 'hub-api' : undefined} aria-label={t('hub.grid.apiAria', { name: short })}>
                    API
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function originLabel(t: TFunction, o: string): string {
  return tl(t, 'ORIGIN_LABELS', o, ORIGIN_LABELS[o as keyof typeof ORIGIN_LABELS] ?? o);
}

export type { Modality };
