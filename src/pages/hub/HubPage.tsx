import { Accordion, AccordionHeader, AccordionItem, AccordionPanel, Badge, Button, Link, MessageBar, MessageBarBody, Tab, TabList, Text, makeStyles, mergeClasses, shorthands, tokens } from '@fluentui/react-components';
import { ArrowRightRegular, BuildingRegular, CodeRegular, DocumentTextRegular, KeyRegular, MoneyRegular, RocketRegular, ShieldCheckmarkRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { AsyncView } from '../../components/States';
import { CodeBlock } from '../../components/CodeBlock';
import { useApi } from '../../hooks/useApi';
import { server, type HubModelView } from '../../server/api';
import { useSession } from '../../app/SessionContext';
import { MODELS, TEXT_MODELS, isLocalModel } from '../../data/models';
import { RATE_LIMIT_TIERS, SLA_TERMS } from '../../data/commercial';
import { ModelHubGrid } from './ModelHubGrid';
import { ModelApiDialog } from './ModelApiDialog';
import { PROVIDER_CHIPS, apiBasics, chipInitials, chipName, demoToProduction, faq, gpuHourlyShowcase, integrations, messagesApiSample, modelsApiSample, notJustRouter, sameModelsBetterEconomics, slaText, tierNote, type FeatureCard } from './hubContent';
import { principalLabel, useLocale, useT } from '../../i18n';

const useStyles = makeStyles({
  hero: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalM,
    padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalXXL}`,
    borderRadius: tokens.borderRadiusXLarge,
    backgroundColor: tokens.colorBrandBackground2,
    ...shorthands.border('1px', 'solid', tokens.colorBrandStroke2),
    '@media (max-width: 700px)': { padding: tokens.spacingVerticalL },
  },
  heroTitle: { fontSize: tokens.fontSizeHero800, lineHeight: tokens.lineHeightHero800, fontWeight: tokens.fontWeightBold, color: tokens.colorNeutralForeground1, margin: 0, '@media (max-width: 700px)': { fontSize: tokens.fontSizeHero700, lineHeight: tokens.lineHeightHero700 } },
  heroSub: { fontSize: tokens.fontSizeBase400, lineHeight: tokens.lineHeightBase400, color: tokens.colorNeutralForeground2, maxWidth: '880px' },
  heroActions: { display: 'flex', flexWrap: 'wrap', columnGap: tokens.spacingHorizontalS, rowGap: tokens.spacingVerticalS, alignItems: 'center' },
  heroKpis: { display: 'flex', flexWrap: 'wrap', columnGap: tokens.spacingHorizontalXL, rowGap: tokens.spacingVerticalS },
  kpi: { display: 'flex', flexDirection: 'column' },
  kpiValue: { fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold, fontVariantNumeric: 'tabular-nums' },
  kpiLabel: { fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
  tabs: { flexWrap: 'wrap', marginTop: tokens.spacingVerticalL },
  section: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM, marginTop: tokens.spacingVerticalXXL },
  h2: { fontSize: tokens.fontSizeBase600, fontWeight: tokens.fontWeightSemibold, margin: 0 },
  lead: { color: tokens.colorNeutralForeground2 },
  strip: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalXS,
    padding: `4px ${tokens.spacingHorizontalS} 4px 4px`,
    borderRadius: '999px',
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground1,
    fontSize: tokens.fontSizeBase200,
  },
  chipLogo: { width: '24px', height: '24px', borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: tokens.fontSizeBase100, fontWeight: tokens.fontWeightSemibold, backgroundColor: tokens.colorNeutralBackground3, color: tokens.colorNeutralForeground2 },
  chipLocal: { backgroundColor: tokens.colorBrandBackground2, color: tokens.colorBrandForeground2 },
  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: tokens.spacingHorizontalM },
  card: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalS, padding: tokens.spacingVerticalL, borderRadius: tokens.borderRadiusLarge, ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2), backgroundColor: tokens.colorNeutralBackground1 },
  cardIcon: { fontSize: '24px', color: tokens.colorBrandForeground1 },
  cardTitle: { fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase400 },
  cardBody: { color: tokens.colorNeutralForeground2, fontSize: tokens.fontSizeBase300, lineHeight: tokens.lineHeightBase300 },
  twoCol: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: tokens.spacingHorizontalL, '@media (max-width: 900px)': { gridTemplateColumns: '1fr' } },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: tokens.fontSizeBase300 },
  th: { textAlign: 'left', padding: '6px 8px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tokens.colorNeutralStroke2, color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightSemibold },
  td: { padding: '6px 8px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tokens.colorNeutralStroke2, verticalAlign: 'top' },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
  gpuRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: tokens.spacingHorizontalM },
  gpuPrice: { fontSize: tokens.fontSizeBase600, fontWeight: tokens.fontWeightSemibold, fontVariantNumeric: 'tabular-nums' },
  footer: { display: 'flex', flexWrap: 'wrap', columnGap: tokens.spacingHorizontalL, rowGap: tokens.spacingVerticalS, paddingTop: tokens.spacingVerticalL, marginTop: tokens.spacingVerticalXXL, borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: tokens.colorNeutralStroke2, color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
});

type HubTab = 'models' | 'integrations' | 'faq';
const HUB_TABS: HubTab[] = ['models', 'integrations', 'faq'];

function FeatureCards({ items, icon }: { items: FeatureCard[]; icon: (i: number) => JSX.Element }) {
  const s = useStyles();
  const t = useT();
  return (
    <div className={s.cards}>
      {items.map((f, i) => (
        <article key={f.title} className={s.card}>
          <span className={s.cardIcon} aria-hidden>
            {icon(i)}
          </span>
          <Text className={s.cardTitle}>{f.title}</Text>
          <Text className={s.cardBody}>{f.body}</Text>
          {f.route && (
            <RouterLink to={f.route} style={{ fontSize: tokens.fontSizeBase200 }}>
              {f.routeLabel ?? t('hub.page.viewInConsole')} <ArrowRightRegular style={{ verticalAlign: '-2px' }} />
            </RouterLink>
          )}
        </article>
      ))}
    </div>
  );
}

/**
 * 模型中心（MaaS 入口）：GMI Cloud 式的客戶入口「預覽」，放在控制台內供所有角色檢視。
 * 我們的情境：自建 GPU 代管開源模型 + 代理閉源／非文字模型，統一 OpenAI 相容 API、單一帳單、SLA。
 * 目錄由伺服器依租戶政策過濾（listHubModels）；UI 只做可用性提示。
 */
export function HubPage() {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const navigate = useNavigate();
  const { session, principal } = useSession();
  const [params, setParams] = useSearchParams();
  const tab = ((params.get('tab') as HubTab) || 'models') as HubTab;
  const setTab = (v: HubTab) => setParams(v === 'models' ? {} : { tab: v });
  const st = useApi(() => server.listHubModels(session), [session]);
  const [apiModel, setApiModel] = useState<HubModelView | null>(null);
  const excludedOrigins = st.data?.excluded.origins ?? [];
  const chips = PROVIDER_CHIPS.filter((c) => !excludedOrigins.includes(c.origin));
  const localCount = st.data?.models.filter((m) => isLocalModel(m)).length ?? 0;
  const total = st.data?.models.length ?? 0;
  const toolModels = TEXT_MODELS.filter((m) => m.toolCalling && m.status !== 'legacy' && !excludedOrigins.includes(m.origin ?? ''));
  const gpuPrices = server.billing.gpuListUsdPerHour;
  const b = server.billing;
  const modelsSample = modelsApiSample(MODELS, { cloudMarkupPct: b.cloudMarkupPct, proxyDiscountPct: b.proxyDiscountPct, negotiatedDiscountPct: b.negotiatedDiscountPct }, b.tokenPrices);
  const API_BASICS = apiBasics(t);
  const sla = slaText(t);

  return (
    <>
      <PageHeader
        title={t('hub.page.title')}
        subtitle={t('hub.page.subtitle')}
        crumbs={[{ label: t('hub.page.title') }]}
        actions={
          <Badge appearance="tint" color="brand" size="large">
            {t('hub.page.badgePreview')}
          </Badge>
        }
      />
      <section className={s.hero} aria-labelledby="hub-hero-title" data-tour="hub-hero">
        <h2 id="hub-hero-title" className={s.heroTitle}>
          {t('hub.hero.title')}
        </h2>
        <Text className={s.heroSub}>{t('hub.hero.body')}</Text>
        <div className={s.heroActions}>
          <Button appearance="primary" size="large" icon={<KeyRegular />} onClick={() => navigate('/keys')} data-tour="hub-start">
            {t('hub.hero.start')}
          </Button>
          <Button size="large" icon={<DocumentTextRegular />} onClick={() => setTab('integrations')} data-tour="hub-docs">
            {t('hub.hero.docs')}
          </Button>
          <Button size="large" appearance="outline" icon={<RocketRegular />} onClick={() => navigate('/hub/trial')} data-tour="hub-trial">
            {t('hub.hero.trial')}
          </Button>
          {principal?.tenantId && (
            <Text size={200} className={s.lead}>
              {t('hub.hero.viewingAs', { name: principalLabel(t, principal.id, principal.displayName) })}
            </Text>
          )}
        </div>
        <div className={s.heroKpis} aria-label={t('hub.kpi.aria')}>
          <div className={s.kpi}>
            <span className={s.kpiValue}>{total}</span>
            <span className={s.kpiLabel}>{t('hub.kpi.models', { n: localCount })}</span>
          </div>
          <div className={s.kpi}>
            <span className={s.kpiValue}>32 × H100/H200</span>
            <span className={s.kpiLabel}>{t('hub.kpi.gpu')}</span>
          </div>
          <div className={s.kpi}>
            <span className={s.kpiValue}>{SLA_TERMS.shared.availabilityPct}%</span>
            <span className={s.kpiLabel}>{t('hub.kpi.sla', { credits: SLA_TERMS.credits.map((c) => c.creditPct).join('/') })}</span>
          </div>
          <div className={s.kpi}>
            <span className={s.kpiValue}>{t('hub.kpi.billValue')}</span>
            <span className={s.kpiLabel}>{t('hub.kpi.bill')}</span>
          </div>
          <div className={s.kpi}>
            <span className={s.kpiValue}>US$20</span>
            <span className={s.kpiLabel}>{t('hub.kpi.trial')}</span>
          </div>
        </div>
      </section>

      <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as HubTab)} aria-label={t('hub.tabs.aria')} className={s.tabs} data-tour="hub-page-tabs">
        {HUB_TABS.map((v) => (
          <Tab key={v} value={v} data-tour={`hub-page-tab-${v}`}>
            {t(`hub.tab.${v}`)}
          </Tab>
        ))}
      </TabList>

      {tab === 'models' && (
        <>
          <section className={s.section} aria-labelledby="hub-providers-title" data-tour="hub-providers">
            <h2 id="hub-providers-title" className={s.h2}>
              {t('hub.providers.title')}
            </h2>
            <Text className={s.lead} size={200}>
              {t('hub.providers.lead')}
              {excludedOrigins.length ? t('hub.providers.hidden', { origins: excludedOrigins.join(t('hub.sep.list')) }) : ''}
            </Text>
            <div className={s.strip}>
              {chips.map((c) => (
                <span key={c.name} className={s.chip}>
                  <span className={mergeClasses(s.chipLogo, c.kind === 'self-hosted' && s.chipLocal)} aria-hidden>
                    {chipInitials(t, c)}
                  </span>
                  {chipName(t, c)}
                </span>
              ))}
            </div>
          </section>

          <div className={s.section}>
            <AsyncView {...st} actionLabel={t('hub.page.viewHub')}>
              {(catalog) => <ModelHubGrid catalog={catalog} onApi={setApiModel} />}
            </AsyncView>
          </div>

          <section className={s.section} aria-labelledby="hub-router-title">
            <h2 id="hub-router-title" className={s.h2}>
              {t('hub.router.title')}
            </h2>
            <Text className={s.lead}>{t('hub.router.lead')}</Text>
            <FeatureCards items={notJustRouter(t)} icon={(i) => [<BuildingRegular key="b" />, <ArrowRightRegular key="a" />, <CodeRegular key="c" />, <MoneyRegular key="m" />][i]} />
          </section>

          <section className={s.section} aria-labelledby="hub-econ-title">
            <h2 id="hub-econ-title" className={s.h2}>
              {t('hub.econ.title')}
            </h2>
            <FeatureCards items={sameModelsBetterEconomics(t)} icon={() => <MoneyRegular />} />
          </section>

          <section className={s.section} aria-labelledby="hub-prod-title">
            <h2 id="hub-prod-title" className={s.h2}>
              {t('hub.prod.title')}
            </h2>
            <FeatureCards items={demoToProduction(t)} icon={() => <ShieldCheckmarkRegular />} />
          </section>

          <section className={s.section} aria-labelledby="hub-sla-title" data-tour="hub-sla">
            <h2 id="hub-sla-title" className={s.h2}>
              {t('hub.sla.title')}
            </h2>
            <div className={s.cards}>
              <article className={s.card}>
                <Text className={s.cardTitle}>{t('hub.sla.cardTitle', { label: sla.sharedLabel, pct: SLA_TERMS.shared.availabilityPct })}</Text>
                <Text className={s.cardBody}>{sla.sharedNote}</Text>
              </article>
              <article className={s.card}>
                <Text className={s.cardTitle}>{t('hub.sla.cardTitleDedicated', { label: sla.dedicatedLabel, pct: SLA_TERMS.dedicated.availabilityPct })}</Text>
                <Text className={s.cardBody}>{sla.dedicatedNote}</Text>
              </article>
              <article className={s.card}>
                <Text className={s.cardTitle}>{t('hub.sla.credits')}</Text>
                <table className={s.table}>
                  <tbody>
                    {sla.credits.map((c) => (
                      <tr key={c.below}>
                        <td className={s.td}>{c.label}</td>
                        <td className={s.td}>
                          <strong>{c.creditPct}%</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Text className={s.cardBody} size={200}>
                  {sla.note}
                </Text>
              </article>
            </div>
          </section>
        </>
      )}

      {tab === 'integrations' && (
        <>
          <section className={s.section} aria-labelledby="hub-docs-title" data-tour="hub-docs-section">
            <h2 id="hub-docs-title" className={s.h2}>
              {t('hub.docs.title')}
            </h2>
            <div className={s.twoCol}>
              <div className={s.card}>
                <Text className={s.cardTitle}>{t('hub.docs.connection')}</Text>
                <CodeBlock code={`OPENAI_BASE_URL=${API_BASICS.baseUrl}\nANTHROPIC_BASE_URL=${API_BASICS.anthropicBaseUrl}\n${API_BASICS.auth}`} label={t('hub.docs.connection')} />
                <Text size={200} className={s.lead}>
                  {t('hub.docs.keysPrefix')}
                  <Link as="a" href="#/keys">
                    {t('hub.docs.keysLink')}
                  </Link>
                  {t('hub.docs.keysSuffix', { headers: API_BASICS.headers.join(t('hub.sep.semicolon')) })}
                </Text>
                <Text className={s.cardTitle}>{t('hub.docs.messagesTitle')}</Text>
                <CodeBlock code={messagesApiSample(t)} label={t('hub.docs.messagesLabel')} />
              </div>
              <div className={s.card}>
                <Text className={s.cardTitle}>{t('hub.docs.endpoints')}</Text>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th className={s.th}>{t('hub.docs.path')}</th>
                      <th className={s.th}>{t('hub.docs.purpose')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {API_BASICS.endpoints.map((e) => (
                      <tr key={e.path}>
                        <td className={mergeClasses(s.td, s.mono)}>{e.path}</td>
                        <td className={s.td}>{e.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className={s.section} aria-labelledby="hub-prices-title" data-tour="hub-price-api">
            <h2 id="hub-prices-title" className={s.h2}>
              {t('hub.prices.title')}
            </h2>
            <Text className={s.lead} size={200}>
              {t('hub.prices.lead')}
            </Text>
            <CodeBlock code={modelsSample} label={t('hub.prices.sampleLabel')} />
            <div className={s.twoCol}>
              <div className={s.card}>
                <Text className={s.cardTitle}>{t('hub.prices.tiersTitle')}</Text>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th className={s.th}>{t('hub.prices.tier')}</th>
                      <th className={s.th}>TPM</th>
                      <th className={s.th}>{t('hub.prices.condition')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {RATE_LIMIT_TIERS.map((r) => (
                      <tr key={r.level}>
                        <td className={s.td}>{r.name}</td>
                        <td className={s.td}>{L.fmtNumber(r.tpm)}</td>
                        <td className={s.td}>{tierNote(t, r)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={s.card}>
                <Text className={s.cardTitle}>{t('hub.prices.billingTitle')}</Text>
                <Text className={s.cardBody}>{t('hub.prices.billingBody', { cacheRead: b.cacheReadMultiplier, cacheWrite: b.cacheWriteMultiplier, markup: b.cloudMarkupPct, discount: b.proxyDiscountPct })}</Text>
                <RouterLink to="/plan" style={{ fontSize: tokens.fontSizeBase200 }}>
                  {t('hub.prices.planLink')} <ArrowRightRegular style={{ verticalAlign: '-2px' }} />
                </RouterLink>
              </div>
            </div>
          </section>

          <section className={s.section} aria-labelledby="hub-int-title" data-tour="hub-integrations">
            <h2 id="hub-int-title" className={s.h2}>
              {t('hub.int.title')}
            </h2>
            <Text className={s.lead}>{t('hub.int.lead')}</Text>
            <Accordion collapsible multiple defaultOpenItems={['claude-code']}>
              {integrations(t).map((it) => (
                <AccordionItem key={it.id} value={it.id}>
                  <AccordionHeader expandIconPosition="end">
                    <Text weight="semibold">{it.title}</Text>
                  </AccordionHeader>
                  <AccordionPanel>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 12 }}>
                      <Text size={300} className={s.lead}>
                        {it.description}
                      </Text>
                      <CodeBlock code={it.code} label={t('hub.int.codeLabel', { title: it.title })} />
                      <Text size={200} className={s.lead}>
                        {t('hub.int.recommended', { models: it.recommendedModels.join(t('hub.sep.list')) })}
                      </Text>
                    </div>
                  </AccordionPanel>
                </AccordionItem>
              ))}
            </Accordion>
          </section>

          <section className={s.section} aria-labelledby="hub-tools-title">
            <h2 id="hub-tools-title" className={s.h2}>
              {t('hub.tools.title')}
            </h2>
            <Text className={s.lead} size={200}>
              {t('hub.tools.lead')}
            </Text>
            <div className={s.strip}>
              {toolModels.map((m) => (
                <Badge key={m.id} appearance={isLocalModel(m) ? 'filled' : 'outline'} color={isLocalModel(m) ? 'brand' : 'informative'}>
                  {m.id}
                </Badge>
              ))}
            </div>
          </section>
        </>
      )}

      {tab === 'faq' && (
        <>
          <section className={s.section} aria-labelledby="hub-faq-title" data-tour="hub-faq">
            <h2 id="hub-faq-title" className={s.h2}>
              {t('hub.faq.title')}
            </h2>
            <Accordion collapsible multiple defaultOpenItems={['0']}>
              {faq(t).map((f, i) => (
                <AccordionItem key={f.q} value={String(i)}>
                  <AccordionHeader expandIconPosition="end">
                    <Text weight="semibold">{f.q}</Text>
                  </AccordionHeader>
                  <AccordionPanel>
                    <Text className={s.cardBody} style={{ display: 'block', paddingBottom: 12 }}>
                      {f.a}
                    </Text>
                  </AccordionPanel>
                </AccordionItem>
              ))}
            </Accordion>
          </section>

          <section className={s.section} aria-labelledby="hub-gpu-title" data-tour="hub-gpu">
            <h2 id="hub-gpu-title" className={s.h2}>
              {t('hub.gpu.title')}
            </h2>
            <Text className={s.lead} size={200}>
              {t('hub.gpu.lead')}
            </Text>
            <div className={s.gpuRow}>
              {gpuHourlyShowcase(t).map((g) => (
                <div key={g.gpuType} className={s.card}>
                  <Text className={s.cardTitle}>{g.label}</Text>
                  <span className={s.gpuPrice}>US${(gpuPrices[g.gpuType] ?? 0).toFixed(2)}</span>
                  <Text size={200} className={s.lead}>
                    {t('hub.gpu.perHour', { note: g.note })}
                  </Text>
                </div>
              ))}
            </div>
            <div className={s.heroActions}>
              <Button onClick={() => navigate('/plan')} icon={<MoneyRegular />}>
                {t('hub.gpu.planButton')}
              </Button>
              <Button onClick={() => navigate('/deployments')} appearance="secondary">
                {t('hub.gpu.dedicatedButton')}
              </Button>
              <Button onClick={() => navigate('/hub/trial')} appearance="primary" icon={<RocketRegular />}>
                {t('hub.gpu.trialButton')}
              </Button>
            </div>
            <MessageBar intent="info">
              <MessageBarBody>{t('hub.gpu.disclaimer')}</MessageBarBody>
            </MessageBar>
          </section>
        </>
      )}

      <footer className={s.footer} aria-label={t('hub.footer.aria')}>
        <Link as="a" href="#/plan">
          {t('hub.footer.plan')}
        </Link>
        <Link as="a" href="#/hub?tab=integrations">
          {t('hub.footer.docs')}
        </Link>
        <Link as="a" href="#/hub?tab=faq">
          {t('hub.footer.faq')}
        </Link>
        <Link as="a" href="#/hub/trial">
          {t('hub.footer.trial')}
        </Link>
        <Link as="a" href="#/guides?guide=hub-first-call">
          {t('hub.footer.guide')}
        </Link>
      </footer>
      <ModelApiDialog model={apiModel} onClose={() => setApiModel(null)} />
    </>
  );
}
