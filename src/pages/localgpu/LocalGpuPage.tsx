import { Badge, Button, Dropdown, Field, Input, MessageBar, MessageBarBody, MessageBarTitle, Option, Tab, TabList, Text, makeStyles, shorthands, tokens } from '@fluentui/react-components';
import { PlugConnectedRegular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { PermissionDenied } from '../../components/States';
import { CodeBlock } from '../../components/CodeBlock';
import { StatusBadge } from '../../components/StatusBadge';
import { useSession } from '../../app/SessionContext';
import { TopologyTab } from './TopologyTab';
import { tf, useLocale, useT } from '../../i18n';
import { formatUsd } from '../../theme/chartPalette';
import { AGENT_DUTIES, AGENT_NEVER, AGENT_PROTOCOL, FLOW_STEPS, NODE_STACK, PLANNER_GPUS, POC_GATEWAY_DEFAULT, POC_RUN_COMMANDS, POC_SNAPSHOT, POC_STORAGE_LAYOUT, STRATEGIES, modelsThatFit, type PlannerLayout, type PocBenchmark } from '../../data/localGpu';

const border = shorthands.border('1px', 'solid', tokens.colorNeutralStroke2);

const useStyles = makeStyles({
  tabs: { marginBottom: tokens.spacingVerticalM },
  section: { marginBottom: tokens.spacingVerticalXL },
  h2: { fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold, marginTop: 0, marginBottom: tokens.spacingVerticalS },
  muted: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  card: { backgroundColor: tokens.colorNeutralBackground1, ...border, borderRadius: tokens.borderRadiusLarge, padding: tokens.spacingVerticalM },
  // architecture diagram
  arch: { display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) auto minmax(190px, 1.2fr) auto minmax(240px, 1.6fr)', alignItems: 'stretch', columnGap: tokens.spacingHorizontalS, rowGap: tokens.spacingVerticalS, '@media (max-width: 900px)': { gridTemplateColumns: '1fr' } },
  box: { backgroundColor: tokens.colorNeutralBackground1, ...border, borderRadius: tokens.borderRadiusMedium, padding: tokens.spacingVerticalS, display: 'flex', flexDirection: 'column', rowGap: '2px', justifyContent: 'center' },
  boxBrand: { backgroundColor: tokens.colorBrandBackground2, ...shorthands.borderColor(tokens.colorBrandStroke2) },
  boxTitle: { fontWeight: tokens.fontWeightSemibold },
  arrow: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, textAlign: 'center', maxWidth: '150px', '@media (max-width: 900px)': { maxWidth: 'none' } },
  arrowGlyph: { fontSize: tokens.fontSizeBase500, lineHeight: '1' },
  nodeInner: { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: tokens.spacingHorizontalS, rowGap: tokens.spacingVerticalS, marginTop: tokens.spacingVerticalXS, '@media (max-width: 520px)': { gridTemplateColumns: '1fr' } },
  full: { gridColumnStart: '1', gridColumnEnd: '-1' },
  // steps
  steps: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  step: { display: 'grid', gridTemplateColumns: '44px 1fr', columnGap: tokens.spacingHorizontalM },
  stepNum: { width: '36px', height: '36px', borderRadius: '50%', backgroundColor: tokens.colorBrandBackground, color: tokens.colorNeutralForegroundOnBrand, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: tokens.fontWeightSemibold },
  stepHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: tokens.spacingHorizontalS, rowGap: '4px', marginBottom: tokens.spacingVerticalXS },
  stepTitle: { fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold, margin: 0 },
  dl: { display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: tokens.spacingHorizontalM, rowGap: tokens.spacingVerticalXS, margin: 0, marginBottom: tokens.spacingVerticalS, '@media (max-width: 640px)': { gridTemplateColumns: '1fr' } },
  dt: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, whiteSpace: 'nowrap', paddingTop: '2px' },
  dd: { margin: 0, lineHeight: tokens.lineHeightBase300 },
  // tables
  scroll: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: tokens.fontSizeBase300 },
  th: { textAlign: 'left', padding: '8px 10px', color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightRegular, fontSize: tokens.fontSizeBase200, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tokens.colorNeutralStroke2, whiteSpace: 'nowrap' },
  td: { padding: '8px 10px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tokens.colorNeutralStroke3, verticalAlign: 'top', lineHeight: tokens.lineHeightBase300 },
  num: { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
  detail: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3, overflowWrap: 'anywhere' },
  strong: { fontWeight: tokens.fontWeightSemibold, whiteSpace: 'nowrap' },
  // planner
  controls: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', columnGap: tokens.spacingHorizontalM, rowGap: tokens.spacingVerticalS, marginBottom: tokens.spacingVerticalM },
  bar: { display: 'flex', height: '40px', borderRadius: tokens.borderRadiusMedium, overflow: 'hidden', backgroundColor: tokens.colorNeutralBackground3, marginBottom: tokens.spacingVerticalS },
  seg: { display: 'flex', alignItems: 'center', justifyContent: 'center', color: tokens.colorNeutralForegroundOnBrand, fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold, borderRightWidth: '2px', borderRightStyle: 'solid', borderRightColor: tokens.colorNeutralBackground1, overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 },
  segA: { backgroundColor: tokens.colorBrandBackground },
  segB: { backgroundColor: tokens.colorBrandBackgroundPressed },
  free: { display: 'flex', alignItems: 'center', justifyContent: 'center', color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, flexGrow: 1, overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0 },
  chips: { display: 'flex', flexWrap: 'wrap', columnGap: '6px', rowGap: '6px' },
  // tiles
  tiles: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', columnGap: tokens.spacingHorizontalM, rowGap: tokens.spacingVerticalM, marginBottom: tokens.spacingVerticalL },
  tileValue: { fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' },
  list: { margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalS, lineHeight: tokens.lineHeightBase300 },
  two: { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: tokens.spacingHorizontalL, rowGap: tokens.spacingVerticalL, '@media (max-width: 900px)': { gridTemplateColumns: '1fr' } },
  liveRow: { display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) minmax(200px, 1fr) auto', columnGap: tokens.spacingHorizontalM, rowGap: tokens.spacingVerticalS, alignItems: 'end', marginBottom: tokens.spacingVerticalS, '@media (max-width: 760px)': { gridTemplateColumns: '1fr' } },
});

type TabKey = 'flow' | 'partition' | 'install' | 'topology' | 'poc';
const TABS: TabKey[] = ['flow', 'partition', 'install', 'topology', 'poc'];
type Styles = ReturnType<typeof useStyles>;

/**
 * Local GPU onboarding (platform operations): the end-to-end flow for bringing our own GPU machines online,
 * how to partition them, what runs on the node, and the results measured in the validation environment.
 * Read-only reference page; requires cluster.read (our operations roles). Customer roles get a 403 state.
 */
export function LocalGpuPage() {
  const s = useStyles();
  const t = useT();
  const { canUiAnywhere } = useSession();
  const [params, setParams] = useSearchParams();
  const canRead = canUiAnywhere('cluster.read');
  const raw = params.get('tab') as TabKey | null;
  const tab: TabKey = raw && TABS.includes(raw) ? raw : 'flow';
  const setTab = (v: TabKey) =>
    setParams((p) => {
      p.set('tab', v);
      return p;
    });
  return (
    <>
      <PageHeader title={t('localgpu.title')} subtitle={t('localgpu.subtitle')} crumbs={[{ label: t('localgpu.title') }]} />
      {!canRead ? (
        <PermissionDenied actionLabel={t('localgpu.deniedAction')} />
      ) : (
        <>
          <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as TabKey)} className={s.tabs} aria-label={t('localgpu.tabsAria')} data-tour="localgpu-tabs">
            {TABS.map((k) => (
              <Tab key={k} value={k} data-tour={`tab-localgpu-${k}`}>
                {t(`localgpu.tab.${k}`)}
              </Tab>
            ))}
          </TabList>
          {tab === 'flow' && <FlowTab s={s} />}
          {tab === 'partition' && <PartitionTab s={s} />}
          {tab === 'install' && <InstallTab s={s} />}
          {tab === 'topology' && <TopologyTab />}
          {tab === 'poc' && <PocTab s={s} />}
        </>
      )}
    </>
  );
}

function Th({ s, children }: { s: Styles; children: React.ReactNode }) {
  return (
    <th className={s.th} scope="col">
      {children}
    </th>
  );
}

// ---------- flow ----------
function FlowTab({ s }: { s: Styles }) {
  const t = useT();
  return (
    <>
      <MessageBar intent="info" className={s.section}>
        <MessageBarBody>
          <MessageBarTitle style={{ display: "block" }}>{t('localgpu.flow.intro.title')}</MessageBarTitle>
          {t('localgpu.flow.intro.body')}
        </MessageBarBody>
      </MessageBar>

      <section className={s.section} aria-label={t('localgpu.arch.aria')} data-tour="localgpu-arch">
        <h2 className={s.h2}>{t('localgpu.arch.title')}</h2>
        <div className={s.arch}>
          <div className={s.box}>
            <span className={s.boxTitle}>{t('localgpu.arch.customer')}</span>
            <span className={s.muted}>{t('localgpu.arch.customerNote')}</span>
          </div>
          <div className={s.arrow}>
            <span className={s.arrowGlyph} aria-hidden="true">
              →
            </span>
            {t('localgpu.arch.edge.request')}
          </div>
          <div className={`${s.box} ${s.boxBrand}`}>
            <span className={s.boxTitle}>{t('localgpu.arch.gateway')}</span>
            <span className={s.muted}>{t('localgpu.arch.gatewayNote')}</span>
          </div>
          <div className={s.arrow}>
            <span className={s.arrowGlyph} aria-hidden="true">
              ⇄
            </span>
            {t('localgpu.arch.edge.heartbeat')}
          </div>
          <div className={s.box}>
            <span className={s.boxTitle}>{t('localgpu.arch.node')}</span>
            <div className={s.nodeInner}>
              <div className={`${s.box} ${s.boxBrand}`}>
                <span className={s.boxTitle}>{t('localgpu.arch.agent')}</span>
                <span className={s.muted}>{t('localgpu.arch.agentNote')}</span>
              </div>
              <div className={s.box}>
                <span className={s.boxTitle}>{t('localgpu.arch.runtime')}</span>
                <span className={s.muted}>{t('localgpu.arch.runtimeNote')}</span>
              </div>
              <div className={`${s.box} ${s.full}`}>
                <span className={s.boxTitle}>{t('localgpu.arch.slices')}</span>
                <span className={s.muted}>{POC_SNAPSHOT.slices.map((x) => `${x.id} · ${x.publicId}`).join('   |   ')}</span>
              </div>
              <div className={`${s.box} ${s.full}`}>
                <span className={s.boxTitle}>{t('localgpu.arch.storage')}</span>
                <span className={s.muted}>{t('localgpu.arch.storageNote')}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={s.section}>
        <h2 className={s.h2} data-tour="localgpu-steps">
          {t('localgpu.flow.stepsTitle')}
        </h2>
        <ol className={s.steps} style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {FLOW_STEPS.map((step, i) => {
            const title = t(`localgpu.step.${step.id}.title`);
            return (
              <li key={step.id} className={`${s.card} ${s.step}`} data-step={step.id}>
                <div className={s.stepNum} aria-label={t('localgpu.flow.stepLabel', { n: i + 1 })}>
                  {i + 1}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className={s.stepHead}>
                    <h3 className={s.stepTitle}>{title}</h3>
                  </div>
                  <dl className={s.dl}>
                    <dt className={s.dt}>{t('localgpu.flow.what')}</dt>
                    <dd className={s.dd}>{t(`localgpu.step.${step.id}.what`)}</dd>
                    <dt className={s.dt}>{t('localgpu.flow.check')}</dt>
                    <dd className={s.dd}>{t(`localgpu.step.${step.id}.check`)}</dd>
                  </dl>
                  {step.commands && <CodeBlock code={step.commands} label={t('localgpu.flow.commandsAria', { title })} />}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}

// ---------- partitioning ----------
function layoutLabel(t: ReturnType<typeof useT>, l: PlannerLayout): string {
  if (l.strategy === 'whole') return t('localgpu.planner.layout.whole', { gib: l.slices[0].gib });
  if (l.strategy === 'mig') {
    const counts = new Map<string, number>();
    for (const x of l.slices) counts.set(x.profile ?? '', (counts.get(x.profile ?? '') ?? 0) + 1);
    return t('localgpu.planner.layout.mig', { profiles: Array.from(counts, ([p, n]) => `${n} × ${p}`).join(' + ') });
  }
  return t('localgpu.planner.layout.vram', { sizes: l.slices.map((x) => x.gib).join(' + ') });
}

function PartitionTab({ s }: { s: Styles }) {
  const t = useT();
  const [gpuId, setGpuId] = useState(PLANNER_GPUS[0].id);
  const gpu = PLANNER_GPUS.find((g) => g.id === gpuId) ?? PLANNER_GPUS[0];
  const [layoutId, setLayoutId] = useState(gpu.layouts[0].id);
  const layout = gpu.layouts.find((l) => l.id === layoutId) ?? gpu.layouts[0];
  const used = layout.slices.reduce((a, x) => a + x.gib, 0);
  const free = Math.round((gpu.vramGib - used) * 100) / 100;
  const retained = Object.values(POC_SNAPSHOT.interference).map((v) => v.retainedPct ?? 0);
  const low = Math.round(Math.min(...retained));
  const high = Math.round(Math.max(...retained));
  return (
    <>
      <MessageBar intent="warning" className={s.section}>
        <MessageBarBody>
          <MessageBarTitle style={{ display: "block" }}>{t('localgpu.part.principle.title')}</MessageBarTitle>
          {t('localgpu.part.principle.body')}
        </MessageBarBody>
      </MessageBar>

      <section className={s.section} data-tour="localgpu-strategies">
        <h2 className={s.h2}>{t('localgpu.part.tableTitle')}</h2>
        <div className={s.scroll}>
          <table className={s.table} aria-label={t('localgpu.part.tableAria')} style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <Th s={s}>{t('localgpu.part.col.method')}</Th>
                <Th s={s}>{t('localgpu.part.col.isolation')}</Th>
                <Th s={s}>{t('localgpu.part.col.hardware')}</Th>
                <Th s={s}>{t('localgpu.part.col.use')}</Th>
                <Th s={s}>{t('localgpu.part.col.caveat')}</Th>
              </tr>
            </thead>
            <tbody>
              {STRATEGIES.map((st) => (
                <tr key={st.id}>
                  <td className={`${s.td} ${s.strong}`}>{t(`localgpu.strategy.${st.id}.name`)}</td>
                  <td className={s.td}>{t(`localgpu.strategy.${st.id}.isolation`)}</td>
                  <td className={s.td}>{t(`localgpu.strategy.${st.id}.hardware`)}</td>
                  <td className={s.td}>{t(`localgpu.strategy.${st.id}.use`)}</td>
                  <td className={s.td}>{t(`localgpu.strategy.${st.id}.caveat`, { low, high })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`${s.section} ${s.card}`} data-tour="localgpu-planner">
        <h2 className={s.h2}>{t('localgpu.planner.title')}</h2>
        <p className={s.muted} style={{ marginTop: 0 }}>
          {t('localgpu.planner.desc')}
        </p>
        <div className={s.controls}>
          <Field label={t('localgpu.planner.gpu')}>
            <Dropdown
              value={gpu.name}
              selectedOptions={[gpu.id]}
              onOptionSelect={(_, d) => {
                const next = PLANNER_GPUS.find((g) => g.id === d.optionValue);
                if (!next) return;
                setGpuId(next.id);
                setLayoutId(next.layouts[0].id);
              }}
            >
              {PLANNER_GPUS.map((g) => (
                <Option key={g.id} value={g.id}>
                  {g.name}
                </Option>
              ))}
            </Dropdown>
          </Field>
          <Field label={t('localgpu.planner.layout')} hint={gpu.mig ? undefined : t('localgpu.planner.noMig')}>
            <Dropdown value={layoutLabel(t, layout)} selectedOptions={[layout.id]} onOptionSelect={(_, d) => d.optionValue && setLayoutId(d.optionValue)}>
              {gpu.layouts.map((l) => (
                <Option key={l.id} value={l.id}>
                  {layoutLabel(t, l)}
                </Option>
              ))}
            </Dropdown>
          </Field>
        </div>
        <div className={s.bar} role="img" aria-label={t('localgpu.planner.barAria', { gpu: gpu.name })}>
          {layout.slices.map((x, i) => (
            <div key={i} className={`${s.seg} ${i % 2 === 0 ? s.segA : s.segB}`} style={{ width: `${(x.gib / gpu.vramGib) * 100}%` }}>
              {x.gib} GiB
            </div>
          ))}
          {free > 0 && <div className={s.free}>{t('localgpu.planner.unallocated', { gib: free })}</div>}
        </div>
        <div className={s.scroll}>
          <table className={s.table} aria-label={t('localgpu.planner.tableAria')}>
            <thead>
              <tr>
                <Th s={s}>{t('localgpu.planner.col.slice')}</Th>
                <Th s={s}>{t('localgpu.planner.col.size')}</Th>
                {layout.strategy === 'mig' && <Th s={s}>{t('localgpu.planner.col.profile')}</Th>}
                <Th s={s}>{t('localgpu.planner.col.models')}</Th>
              </tr>
            </thead>
            <tbody>
              {layout.slices.map((x, i) => {
                const fits = modelsThatFit(x.gib);
                return (
                  <tr key={i}>
                    <td className={`${s.td} ${s.strong}`}>{t('localgpu.planner.slice', { n: i + 1 })}</td>
                    <td className={`${s.td} ${s.num}`}>{x.gib} GiB</td>
                    {layout.strategy === 'mig' && (
                      <td className={s.td}>
                        <code className={s.mono}>{x.profile}</code>
                      </td>
                    )}
                    <td className={s.td}>
                      {fits.length === 0 ? (
                        <span className={s.muted}>{t('localgpu.planner.none')}</span>
                      ) : (
                        <div className={s.chips}>
                          {fits.map((m) => (
                            <Badge key={m.id} appearance="outline" color={m.measured ? 'success' : 'informative'} size="medium">
                              {m.id} · {m.needGib} GiB · {t(m.measured ? 'localgpu.planner.measured' : 'localgpu.planner.estimate')}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className={s.muted}>{t('localgpu.planner.note')}</p>
      </section>
    </>
  );
}

// ---------- install ----------
function InstallTab({ s }: { s: Styles }) {
  const t = useT();
  return (
    <>
      <section className={s.section} data-tour="localgpu-stack">
        <h2 className={s.h2}>{t('localgpu.install.title')}</h2>
        <p className={s.muted} style={{ marginTop: 0 }}>
          {t('localgpu.install.desc')}
        </p>
        <div className={s.scroll}>
          <table className={s.table} aria-label={t('localgpu.install.tableAria')} style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <Th s={s}>{t('localgpu.install.col.layer')}</Th>
                <Th s={s}>{t('localgpu.install.col.production')}</Th>
                <Th s={s}>{t('localgpu.install.col.purpose')}</Th>
              </tr>
            </thead>
            <tbody>
              {NODE_STACK.map((row) => (
                <tr key={row.id}>
                  <td className={`${s.td} ${s.strong}`}>{t(`localgpu.stack.${row.id}.layer`)}</td>
                  <td className={s.td}>
                    <code className={s.mono}>{row.component}</code>
                  </td>
                  <td className={s.td}>{t(`localgpu.stack.${row.id}.purpose`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className={`${s.section} ${s.two}`} data-tour="localgpu-agent">
        <div className={s.card}>
          <h2 className={s.h2}>{t('localgpu.agent.title')}</h2>
          <ol className={s.list}>
            {AGENT_DUTIES.map((d) => (
              <li key={d}>{t(`localgpu.agent.duty.${d}`)}</li>
            ))}
          </ol>
        </div>
        <div className={s.card}>
          <h2 className={s.h2}>{t('localgpu.agent.neverTitle')}</h2>
          <ul className={s.list}>
            {AGENT_NEVER.map((d) => (
              <li key={d}>{t(`localgpu.agent.never.${d}`)}</li>
            ))}
          </ul>
        </div>
      </section>
      <section className={s.section}>
        <h2 className={s.h2}>{t('localgpu.agent.protocolTitle')}</h2>
        <CodeBlock code={AGENT_PROTOCOL} label={t('localgpu.agent.protocolAria')} />
      </section>
    </>
  );
}

// ---------- POC ----------
interface LiveOverview {
  profile: string;
  nodes: { id: string; name: string; online: boolean; slices: { id: string; publicId: string; state: string; measuredMiB?: number; vramMiB?: number; budgetMiB: number; inflight: number }[] }[];
  tenants: { id: string; name: string; balanceUsd: number; spentUsd: number; tpmLimit: number; tpmUsed: number }[];
  today: { requests: number; revenueUsd: number };
}

function PocTab({ s }: { s: Styles }) {
  const t = useT();
  const L = useLocale();
  const P = POC_SNAPSHOT;
  const mib = (n: number | null | undefined) => (n == null ? '—' : t('localgpu.poc.mib', { n: L.fmtNumber(n) }));
  const allSlices = useMemo(() => [...P.slices, ...(P.dedicated ? [P.dedicated.slice] : [])], [P]);
  const total = P.totals.passed + P.totals.failed;

  const solo = (model: string, c: number) => P.benchmarks.find((b) => b.group === 'solo' && b.concurrency === c && model in b.perModel);
  const firstModel = P.slices[0]?.publicId ?? '';
  const c1 = solo(firstModel, 1);
  const c4 = solo(firstModel, 4);
  const perModel = (b: PocBenchmark | undefined, m: string) => b?.perModel[m];
  const inter = Object.entries(P.interference);
  const ded = P.benchmarks.find((b) => b.group === 'dedicated');
  const dedModel = P.dedicated?.slice.publicId ?? '';

  const scenario = (b: PocBenchmark) => {
    const models = Object.keys(b.perModel);
    if (b.group === 'contended') return t('localgpu.poc.bench.contended');
    return t(b.group === 'dedicated' ? 'localgpu.poc.bench.dedicated' : 'localgpu.poc.bench.solo', { model: models[0] });
  };

  return (
    <>
      <MessageBar intent="success" className={s.section}>
        <MessageBarBody>
          <MessageBarTitle style={{ display: "block" }}>{t('localgpu.poc.intro.title')}</MessageBarTitle>
          {t('localgpu.poc.intro.body', { gpu: P.node.gpuName, runtime: P.node.runtime, time: L.fmtDateTime(P.generatedAt) })}
        </MessageBarBody>
      </MessageBar>

      <div className={s.tiles}>
        <div className={s.card}>
          <div className={s.muted}>{t('localgpu.poc.tile.checks')}</div>
          <div className={s.tileValue} data-testid="poc-checks">
            {P.totals.passed} / {total}
          </div>
        </div>
        <div className={s.card}>
          <div className={s.muted}>{t('localgpu.poc.tile.peak')}</div>
          <div className={s.tileValue}>{t('localgpu.poc.tile.peakValue', { n: P.capacity.peakAggregateTokPerSec })}</div>
        </div>
        <div className={s.card}>
          <div className={s.muted}>{t('localgpu.poc.tile.capacity')}</div>
          <div className={s.tileValue}>{L.fmtNumber(P.capacity.outputTokensPerDayAt.util30)}</div>
        </div>
        <div className={s.card}>
          <div className={s.muted}>{t('localgpu.poc.tile.node')}</div>
          <div className={s.tileValue}>{P.node.gpuName.replace(/^NVIDIA /, '')}</div>
        </div>
      </div>

      <section className={s.section} data-tour="localgpu-findings">
        <h2 className={s.h2}>{t('localgpu.poc.findingsTitle')}</h2>
        <ol className={s.list}>
          {P.node.measurement && <li>{t('localgpu.poc.finding.overhead', { reported: L.fmtNumber(P.node.measurement.runtimeReportedMiB), delta: L.fmtNumber(P.node.measurement.gpuDeltaMiB), overhead: L.fmtNumber(P.node.measurement.overheadMiB) })}</li>}
          {c1 && c4 && <li>{t('localgpu.poc.finding.concurrency', { c1: c1.totalTokPerSec, c4: c4.totalTokPerSec, t1: Math.round(perModel(c1, firstModel)?.ttftMsP50 ?? 0), t4: L.fmtNumber(Math.round(perModel(c4, firstModel)?.ttftMsP50 ?? 0)) })}</li>}
          {inter.length >= 2 && <li>{t('localgpu.poc.finding.interference', { a: inter[0][0], ap: Math.round(inter[0][1].retainedPct ?? 0), b: inter[1][0], bp: Math.round(inter[1][1].retainedPct ?? 0) })}</li>}
          {P.dedicated && ded && <li>{t('localgpu.poc.finding.dedicated', { sec: Math.round(P.dedicated.switchMs / 1000), model: dedModel, mib: L.fmtNumber(P.dedicated.slice.measuredMiB), tps: ded.totalTokPerSec, ttft: Math.round(perModel(ded, dedModel)?.ttftMsP50 ?? 0) })}</li>}
        </ol>
      </section>

      <section className={s.section}>
        <h2 className={s.h2}>{t('localgpu.poc.slicesTitle')}</h2>
        <div className={s.scroll}>
          <table className={s.table} aria-label={t('localgpu.poc.slicesAria')} style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <Th s={s}>{t('localgpu.poc.col.slice')}</Th>
                <Th s={s}>{t('localgpu.poc.col.model')}</Th>
                <Th s={s}>{t('localgpu.poc.col.sharing')}</Th>
                <Th s={s}>{t('localgpu.poc.col.budget')}</Th>
                <Th s={s}>{t('localgpu.poc.col.reported')}</Th>
                <Th s={s}>{t('localgpu.poc.col.measured')}</Th>
                <Th s={s}>{t('localgpu.poc.col.state')}</Th>
              </tr>
            </thead>
            <tbody>
              {allSlices.map((x) => (
                <tr key={x.id}>
                  <td className={s.td}>
                    <code className={s.mono}>{x.id}</code>
                  </td>
                  <td className={s.td}>
                    <code className={s.mono}>{x.publicId}</code>
                  </td>
                  <td className={s.td}>{x.sharing === 'dedicated' ? t('localgpu.poc.sharing.dedicated', { tenant: x.tenantId ?? '' }) : t('localgpu.poc.sharing.shared')}</td>
                  <td className={`${s.td} ${s.num}`}>{mib(x.budgetMiB)}</td>
                  <td className={`${s.td} ${s.num}`}>{mib(x.reportedMiB)}</td>
                  <td className={`${s.td} ${s.num}`}>{mib(x.measuredMiB)}</td>
                  <td className={s.td}>
                    <StatusBadge kind={x.state === 'ready' ? 'success' : 'warning'} label={x.state} size="small" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={s.section}>
        <h2 className={s.h2}>{t('localgpu.poc.benchTitle')}</h2>
        <div className={s.scroll}>
          <table className={s.table} aria-label={t('localgpu.poc.benchAria')} style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <Th s={s}>{t('localgpu.poc.col.scenario')}</Th>
                <Th s={s}>{t('localgpu.poc.col.concurrency')}</Th>
                <Th s={s}>{t('localgpu.poc.col.tps')}</Th>
                <Th s={s}>{t('localgpu.poc.col.ttft')}</Th>
                <Th s={s}>{t('localgpu.poc.col.util')}</Th>
                <Th s={s}>{t('localgpu.poc.col.power')}</Th>
              </tr>
            </thead>
            <tbody>
              {P.benchmarks.map((b, i) => (
                <tr key={i}>
                  <td className={s.td}>{scenario(b)}</td>
                  <td className={`${s.td} ${s.num}`}>{b.concurrency}</td>
                  <td className={`${s.td} ${s.num}`}>{b.totalTokPerSec}</td>
                  <td className={`${s.td} ${s.num}`}>
                    {Object.values(b.perModel)
                      .map((m) => L.fmtNumber(Math.round(m.ttftMsP50)))
                      .join(' / ')}
                  </td>
                  <td className={`${s.td} ${s.num}`}>{b.gpuUtilPct}%</td>
                  <td className={`${s.td} ${s.num}`}>{b.gpuPowerW} W</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={s.section}>
        <h2 className={s.h2}>{t('localgpu.poc.checksTitle')}</h2>
        <div className={s.scroll}>
          <table className={s.table} aria-label={t('localgpu.poc.checksAria')} style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <Th s={s}>{t('localgpu.poc.col.id')}</Th>
                <Th s={s}>{t('localgpu.poc.col.check')}</Th>
                <Th s={s}>{t('localgpu.poc.col.result')}</Th>
                <Th s={s}>{t('localgpu.poc.col.detail')}</Th>
              </tr>
            </thead>
            <tbody>
              {P.checks.map((c) => (
                <tr key={c.id}>
                  <td className={s.td}>
                    <code className={s.mono}>{c.id}</code>
                  </td>
                  <td className={s.td}>{tf(t, `localgpu.poc.check.${c.id}`, c.title)}</td>
                  <td className={s.td}>
                    <StatusBadge kind={c.pass ? 'success' : 'danger'} label={t(c.pass ? 'localgpu.poc.result.pass' : 'localgpu.poc.result.fail')} size="small" />
                  </td>
                  <td className={`${s.td} ${s.detail}`}>{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`${s.section} ${s.two}`}>
        <div style={{ minWidth: 0 }}>
          <h2 className={s.h2}>{t('localgpu.poc.storageTitle')}</h2>
          <CodeBlock code={POC_STORAGE_LAYOUT} label={t('localgpu.poc.storageAria')} />
        </div>
        <div style={{ minWidth: 0 }}>
          <h2 className={s.h2}>{t('localgpu.poc.runTitle')}</h2>
          <CodeBlock code={POC_RUN_COMMANDS} label={t('localgpu.poc.runAria')} />
        </div>
      </section>

      <LivePanel s={s} />
    </>
  );
}

/** Reads live state from the validation gateway when it runs on the same machine. Nothing is fetched until the user clicks Connect. */
function LivePanel({ s }: { s: Styles }) {
  const t = useT();
  const L = useLocale();
  const [url, setUrl] = useState(POC_GATEWAY_DEFAULT);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LiveOverview | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${url.replace(/\/+$/, '')}/admin/v1/overview`, { headers: { authorization: `Bearer ${key}` } });
      if (res.status === 401) {
        setData(null);
        setError(t('localgpu.poc.live.unauthorized'));
      } else if (!res.ok) {
        setData(null);
        setError(t('localgpu.poc.live.error', { message: `HTTP ${res.status}` }));
      } else {
        setData((await res.json()) as LiveOverview);
      }
    } catch (e) {
      setData(null);
      setError(t('localgpu.poc.live.error', { message: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${s.section} ${s.card}`} data-tour="localgpu-live">
      <h2 className={s.h2}>{t('localgpu.poc.live.title')}</h2>
      <p className={s.muted} style={{ marginTop: 0 }}>
        {t('localgpu.poc.live.desc')}
      </p>
      <div className={s.liveRow}>
        <Field label={t('localgpu.poc.live.url')}>
          <Input value={url} onChange={(_, d) => setUrl(d.value)} />
        </Field>
        <Field label={t('localgpu.poc.live.key')}>
          <Input type="password" value={key} onChange={(_, d) => setKey(d.value)} autoComplete="off" />
        </Field>
        <Button appearance="primary" icon={<PlugConnectedRegular />} onClick={connect} disabled={busy || !key || !url}>
          {t(busy ? 'localgpu.poc.live.connecting' : 'localgpu.poc.live.connect')}
        </Button>
      </div>
      <Text className={s.muted} block>
        {t('localgpu.poc.live.keyHint')}
      </Text>
      {error && (
        <MessageBar intent="error" style={{ marginTop: 12 }}>
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {data && (
        <div role="status" style={{ marginTop: 12 }}>
          <MessageBar intent="success" style={{ marginBottom: 12 }}>
            <MessageBarBody>{t('localgpu.poc.live.connected', { profile: data.profile, requests: L.fmtNumber(data.today.requests), revenue: formatUsd(data.today.revenueUsd, 6) })}</MessageBarBody>
          </MessageBar>
          <div className={s.scroll}>
            <table className={s.table} aria-label={t('localgpu.poc.live.nodesAria')} style={{ minWidth: 700 }}>
              <thead>
                <tr>
                  <Th s={s}>{t('localgpu.poc.live.col.node')}</Th>
                  <Th s={s}>{t('localgpu.poc.live.col.status')}</Th>
                  <Th s={s}>{t('localgpu.poc.col.slice')}</Th>
                  <Th s={s}>{t('localgpu.poc.col.model')}</Th>
                  <Th s={s}>{t('localgpu.poc.col.state')}</Th>
                  <Th s={s}>{t('localgpu.poc.live.col.vram')}</Th>
                  <Th s={s}>{t('localgpu.poc.live.col.inflight')}</Th>
                </tr>
              </thead>
              <tbody>
                {data.nodes.flatMap((n) =>
                  (n.slices.length ? n.slices : [null]).map((x, i) => (
                    <tr key={`${n.id}-${x?.id ?? i}`}>
                      <td className={s.td}>
                        <code className={s.mono}>{n.name}</code>
                      </td>
                      <td className={s.td}>
                        <StatusBadge kind={n.online ? 'success' : 'danger'} label={t(n.online ? 'localgpu.poc.live.online' : 'localgpu.poc.live.offline')} size="small" />
                      </td>
                      <td className={s.td}>{x ? <code className={s.mono}>{x.id}</code> : '—'}</td>
                      <td className={s.td}>{x ? <code className={s.mono}>{x.publicId}</code> : '—'}</td>
                      <td className={s.td}>{x ? <StatusBadge kind={x.state === 'ready' ? 'success' : 'warning'} label={x.state} size="small" /> : '—'}</td>
                      <td className={`${s.td} ${s.num}`}>{x ? `${L.fmtNumber(x.measuredMiB ?? x.vramMiB ?? 0)} / ${L.fmtNumber(x.budgetMiB)} MiB` : '—'}</td>
                      <td className={`${s.td} ${s.num}`}>{x ? x.inflight : '—'}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
          <div className={s.scroll} style={{ marginTop: 12 }}>
            <table className={s.table} aria-label={t('localgpu.poc.live.tenantsAria')} style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <Th s={s}>{t('localgpu.poc.live.col.tenant')}</Th>
                  <Th s={s}>{t('localgpu.poc.live.col.balance')}</Th>
                  <Th s={s}>{t('localgpu.poc.live.col.spent')}</Th>
                  <Th s={s}>{t('localgpu.poc.live.col.tpm')}</Th>
                </tr>
              </thead>
              <tbody>
                {data.tenants.map((x) => (
                  <tr key={x.id}>
                    <td className={s.td}>
                      <code className={s.mono}>{x.id}</code> {x.name}
                    </td>
                    <td className={`${s.td} ${s.num}`}>{formatUsd(x.balanceUsd, 6)}</td>
                    <td className={`${s.td} ${s.num}`}>{formatUsd(x.spentUsd, 6)}</td>
                    <td className={`${s.td} ${s.num}`}>
                      {L.fmtNumber(x.tpmUsed)} / {L.fmtNumber(x.tpmLimit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
