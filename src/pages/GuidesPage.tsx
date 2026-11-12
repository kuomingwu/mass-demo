import { Badge, Button, Link, Text, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { ArrowRightRegular, CheckmarkCircleFilled, ClockRegular, PersonSwapRegular, PlayRegular } from '@fluentui/react-icons';
import { useEffect, useMemo } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { ScenarioFlow } from '../components/ScenarioFlow';
import { useTour } from '../components/OnboardingTour';
import { GUIDES, getGuide, type Guide, type GuideJourney, type GuideStep } from '../data/guides';
import { getGuideFlow } from '../data/guideFlows';
import { PERSONAS } from '../server/seed';
import { useSession } from '../app/SessionContext';
import { tf, useT, zh } from '../i18n';

const useStyles = makeStyles({
  layout: { display: 'grid', gridTemplateColumns: 'minmax(260px, 340px) minmax(0, 1fr)', columnGap: tokens.spacingHorizontalL, rowGap: tokens.spacingVerticalL, '@media (max-width: 1000px)': { gridTemplateColumns: '1fr' } },
  list: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalS },
  item: {
    textAlign: 'left',
    display: 'flex',
    flexDirection: 'column',
    rowGap: '4px',
    padding: tokens.spacingVerticalM,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: 'pointer',
    font: 'inherit',
    color: 'inherit',
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
    ':focus-visible': { outline: `2px solid ${tokens.colorStrokeFocus2}`, outlineOffset: '1px' },
  },
  itemActive: { borderTopColor: tokens.colorBrandStroke1, borderRightColor: tokens.colorBrandStroke1, borderBottomColor: tokens.colorBrandStroke1, borderLeftColor: tokens.colorBrandStroke1, boxShadow: `inset 3px 0 0 ${tokens.colorBrandStroke1}` },
  itemHead: { display: 'flex', alignItems: 'center', columnGap: tokens.spacingHorizontalS, flexWrap: 'wrap' },
  itemTitle: { fontWeight: tokens.fontWeightSemibold },
  meta: { display: 'flex', alignItems: 'center', columnGap: tokens.spacingHorizontalM, color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, flexWrap: 'wrap' },
  detail: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalL, minWidth: 0 },
  card: {
    padding: tokens.spacingVerticalL,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalM,
    minWidth: 0,
  },
  cardTitle: { fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold },
  actions: { display: 'flex', columnGap: tokens.spacingHorizontalS, rowGap: tokens.spacingVerticalS, flexWrap: 'wrap', alignItems: 'center' },
  steps: { margin: 0, paddingLeft: '1.4em', display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalS },
  stepTitle: { fontWeight: tokens.fontWeightSemibold },
  stepBody: { display: 'block', color: tokens.colorNeutralForeground2, whiteSpace: 'pre-line', fontSize: tokens.fontSizeBase300, lineHeight: tokens.lineHeightBase300 },
  pages: { display: 'flex', columnGap: tokens.spacingHorizontalS, rowGap: tokens.spacingVerticalXS, flexWrap: 'wrap', alignItems: 'center' },
  h3: { fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold },
  groupTitle: { fontSize: tokens.fontSizeBase300, fontWeight: tokens.fontWeightSemibold, color: tokens.colorNeutralForeground2, margin: `${tokens.spacingVerticalS} 0 ${tokens.spacingVerticalXS}` },
});

const JOURNEY_ORDER: GuideJourney[] = ['customer', 'vendor'];

type CategoryColor = 'brand' | 'informative' | 'important' | 'severe' | 'success';
/** 指引分類：穩定 id → 徽章顏色；標籤在 overview.guides.category.<id>（guides.ts 的 category 可為 id 或 zh-TW 文字） */
const CATEGORY_COLORS: Record<string, CategoryColor> = { intro: 'brand', daily: 'informative', access: 'important', platform: 'severe', billing: 'success' };
const CATEGORY_IDS = Object.keys(CATEGORY_COLORS);

function categoryId(category: string): string | undefined {
  if (CATEGORY_IDS.includes(category)) return category;
  return CATEGORY_IDS.find((id) => zh(`overview.guides.category.${id}`) === category);
}

/** 指引「會經過的頁面」：路由 → 導覽標籤（字典缺 guides.<id>.pages.<i>.label 時的非 zh-TW 備援） */
const ROUTE_NAV_KEYS: Record<string, string> = {
  '/': 'nav.overview',
  '/hub': 'nav.hub',
  '/playground': 'nav.playground',
  '/keys': 'nav.keys',
  '/usage': 'nav.usage',
  '/plan': 'nav.plan',
  '/trials': 'nav.trials',
  '/tenants': 'nav.tenants',
  '/models': 'nav.models',
  '/deployments': 'nav.models',
  '/clusters': 'nav.clusters',
  '/providers': 'nav.providers',
  '/routing': 'nav.routing',
  '/pricing': 'nav.pricing',
  '/iam': 'nav.iam',
  '/audit': 'nav.audit',
  '/settings': 'nav.settings',
  '/guides': 'nav.guides',
};

export function GuidesPage() {
  const s = useStyles();
  const t = useT();
  const tour = useTour();
  const { personaId } = useSession();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('guide');
  const guide = useMemo(() => getGuide(selectedId) ?? GUIDES[0], [selectedId]);

  useEffect(() => {
    if (!selectedId) setParams({ guide: GUIDES[0].id }, { replace: true });
  }, [selectedId, setParams]);

  const flow = getGuideFlow(guide.id);
  const persona = PERSONAS.find((p) => p.id === guide.recommendedPersona);
  const personaLabel = persona ? tf(t, `server.persona.${persona.id}.label`, persona.label) : '';
  const isRecommended = !guide.recommendedPersona || guide.recommendedPersona === personaId;
  const done = tour.completed.includes(guide.id);

  // 資料驅動文字：guides.<guideId>.<field>、guides.<guideId>.step.<stepId>.<field>
  const gText = (g: Guide, field: 'title' | 'summary') => tf(t, `guides.${g.id}.${field}`, g[field]);
  const sText = (g: Guide, st: GuideStep, field: 'title' | 'body') => tf(t, `guides.${g.id}.step.${st.id}.${field}`, st[field]);
  const catLabel = (category: string) => {
    const id = categoryId(category);
    return id ? t(`overview.guides.category.${id}`) : category;
  };
  const catColor = (category: string): CategoryColor => CATEGORY_COLORS[categoryId(category) ?? ''] ?? 'brand';
  const pageLabel = (g: Guide, i: number, p: { label: string; route: string }) => {
    const k = `guides.${g.id}.pages.${i}.label`;
    if (t.has(k)) return t(k);
    const navKey = ROUTE_NAV_KEYS[p.route.split('?')[0]];
    return t.locale !== 'zh-TW' && navKey ? t(navKey) : p.label;
  };

  return (
    <>
      <PageHeader title={t('nav.guides')} subtitle={t('overview.guides.subtitle')} crumbs={[{ label: t('nav.guides') }]} />
      <div className={s.layout}>
        <nav className={s.list} aria-label={t('overview.guides.listAria')}>
          {JOURNEY_ORDER.map((j) => (
            <div key={j} role="group" aria-label={t(`overview.guides.journey.${j}`)} data-tour={`guides-group-${j}`} className={s.list}>
              <div className={s.groupTitle}>
                {t(`overview.guides.journey.${j}`)}
                <Text size={200} block style={{ color: tokens.colorNeutralForeground3, fontWeight: 'normal' }}>
                  {t(`overview.guides.journeyHint.${j}`)}
                </Text>
              </div>
              {GUIDES.filter((g) => g.journey === j).map((g) => {
                const active = g.id === guide.id;
                const finished = tour.completed.includes(g.id);
                return (
                  <button key={g.id} type="button" className={mergeClasses(s.item, active && s.itemActive)} aria-pressed={active} onClick={() => setParams({ guide: g.id })}>
                    <div className={s.itemHead}>
                      <Badge appearance="tint" color={catColor(g.category)} size="small">
                        {catLabel(g.category)}
                      </Badge>
                      <span className={s.itemTitle}>{gText(g, 'title')}</span>
                      {g.interactive && (
                        <Badge appearance="outline" color="brand" size="small">
                          {t('overview.guides.interactive')}
                        </Badge>
                      )}
                      {finished && (
                        <Badge appearance="outline" color="success" size="small" icon={<CheckmarkCircleFilled />}>
                          {t('overview.guides.completed')}
                        </Badge>
                      )}
                    </div>
                    <Text size={200}>{gText(g, 'summary')}</Text>
                    <div className={s.meta}>
                      <span>
                        <ClockRegular style={{ verticalAlign: '-2px' }} /> {t.n('overview.guides.minutes', g.minutes)}
                      </span>
                      <span>{t.n('overview.guides.steps', g.steps.length)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={s.detail} aria-live="polite">
          <section className={s.card} aria-labelledby="guide-title">
            <div className={s.itemHead}>
              <Badge appearance="tint" color={catColor(guide.category)}>
                {catLabel(guide.category)}
              </Badge>
              {guide.interactive && (
                <Badge appearance="outline" color="brand">
                  {t('overview.guides.interactiveLong')}
                </Badge>
              )}
              {done && (
                <Badge appearance="outline" color="success" icon={<CheckmarkCircleFilled />}>
                  {t('overview.guides.completed')}
                </Badge>
              )}
            </div>
            <Text id="guide-title" as="h2" className={s.cardTitle}>
              {gText(guide, 'title')}
            </Text>
            <Text>{gText(guide, 'summary')}</Text>
            <div className={s.pages}>
              <Text size={200} weight="semibold">
                {t('overview.guides.pagesLabel')}
              </Text>
              {guide.pages.map((p, i) => (
                <Link key={p.route} as="a" href={`#${p.route}`}>
                  {pageLabel(guide, i, p)}
                </Link>
              ))}
            </div>
            <div className={s.actions}>
              <Button appearance="primary" icon={<PlayRegular />} onClick={() => tour.start(guide.id)}>
                {t('overview.guides.startTour')}
              </Button>
              {persona && !isRecommended && (
                <Button appearance="secondary" icon={<PersonSwapRegular />} onClick={() => tour.start(guide.id, { persona: persona.id })}>
                  {t('overview.guides.switchAndStart', { persona: personaLabel })}
                </Button>
              )}
              {persona && (
                <Text size={200}>
                  {t('overview.guides.recommended', { persona: personaLabel })}
                  {isRecommended ? t('overview.guides.recommendedCurrent') : ''}
                </Text>
              )}
            </div>
          </section>

          <section className={s.card} aria-labelledby="guide-flow">
            <Text id="guide-flow" as="h3" className={s.h3}>
              {t('overview.guides.flowTitle')}
            </Text>
            {flow ? <ScenarioFlow flow={flow} /> : <Text size={200}>{t('overview.guides.noFlow')}</Text>}
          </section>

          <section className={s.card} aria-labelledby="guide-steps">
            <Text id="guide-steps" as="h3" className={s.h3}>
              {t('overview.guides.stepsTitle')}
            </Text>
            <ol className={s.steps}>
              {guide.steps.map((st) => (
                <li key={st.id}>
                  <div className={s.itemHead}>
                    <span className={s.stepTitle}>{sText(guide, st, 'title')}</span>
                    {st.route && (
                      <RouterLink to={st.route} style={{ fontSize: tokens.fontSizeBase200 }}>
                        {t('overview.guides.goToPage')} <ArrowRightRegular style={{ verticalAlign: '-2px' }} />
                      </RouterLink>
                    )}
                  </div>
                  <Text className={s.stepBody}>{sText(guide, st, 'body')}</Text>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </>
  );
}
