import { Badge, Button, Field, Input, MessageBar, MessageBarBody, MessageBarTitle, Text, makeStyles, mergeClasses, shorthands, tokens } from '@fluentui/react-components';
import { PlugConnectedRegular, PlugDisconnectedRegular } from '@fluentui/react-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CodeBlock } from '../../components/CodeBlock';
import { StatusBadge } from '../../components/StatusBadge';
import { useLocale, useT } from '../../i18n';
import { formatUsd } from '../../theme/chartPalette';
import { PocError, SAMPLE_TOPOLOGY, loadConn, pocCall, saveConn, type Conn, type LiveEvent, type LiveNode, type LiveSlice, type LiveTopology, type SliceState } from '../../data/pocLive';

const border = shorthands.border('1px', 'solid', tokens.colorNeutralStroke2);

const useStyles = makeStyles({
  section: { marginBottom: tokens.spacingVerticalXL },
  h2: { fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold, marginTop: 0, marginBottom: tokens.spacingVerticalS },
  h3: { fontSize: tokens.fontSizeBase300, fontWeight: tokens.fontWeightSemibold, margin: 0 },
  muted: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  card: { backgroundColor: tokens.colorNeutralBackground1, ...border, borderRadius: tokens.borderRadiusLarge, padding: tokens.spacingVerticalM, minWidth: 0 },
  connRow: { display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) minmax(200px, 1fr) auto', columnGap: tokens.spacingHorizontalM, rowGap: tokens.spacingVerticalS, alignItems: 'end', marginBottom: tokens.spacingVerticalS, '@media (max-width: 760px)': { gridTemplateColumns: '1fr' } },
  two: { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: tokens.spacingHorizontalL, rowGap: tokens.spacingVerticalL, '@media (max-width: 900px)': { gridTemplateColumns: '1fr' } },
  formRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', columnGap: tokens.spacingHorizontalS, rowGap: tokens.spacingVerticalS, alignItems: 'end', marginTop: tokens.spacingVerticalS, marginBottom: tokens.spacingVerticalS },
  headRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: tokens.spacingHorizontalM, rowGap: tokens.spacingVerticalXS, marginBottom: tokens.spacingVerticalXS },
  site: { ...border, borderRadius: tokens.borderRadiusMedium, padding: tokens.spacingVerticalM, marginTop: tokens.spacingVerticalM },
  siteHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: tokens.spacingHorizontalM, rowGap: '2px' },
  node: { marginTop: tokens.spacingVerticalM, paddingTop: tokens.spacingVerticalM, borderTopWidth: '1px', borderTopStyle: 'dashed', borderTopColor: tokens.colorNeutralStroke2 },
  bar: { display: 'flex', height: '44px', borderRadius: tokens.borderRadiusMedium, overflow: 'hidden', backgroundColor: tokens.colorNeutralBackground3, marginTop: tokens.spacingVerticalS, ...border },
  seg: { display: 'flex', alignItems: 'center', justifyContent: 'center', color: tokens.colorNeutralForegroundOnBrand, fontSize: tokens.fontSizeBase200, fontWeight: tokens.fontWeightSemibold, overflow: 'hidden', whiteSpace: 'nowrap', minWidth: '2px', flexBasis: 0, flexShrink: 0, transitionProperty: 'flex-grow', transitionDuration: '400ms' },
  segReserve: { backgroundImage: `repeating-linear-gradient(135deg, ${tokens.colorNeutralStroke1} 0 6px, transparent 6px 12px)`, color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightRegular },
  segFree: { color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightRegular },
  segPending: { opacity: 0.55 },
  c0: { backgroundColor: tokens.colorBrandBackground },
  c1: { backgroundColor: tokens.colorPaletteDarkOrangeBackground3 },
  c2: { backgroundColor: tokens.colorPaletteBerryBackground3 },
  c3: { backgroundColor: tokens.colorPaletteGreenBackground3 },
  c4: { backgroundColor: tokens.colorPaletteRedBackground3 },
  scale: { display: 'flex', justifyContent: 'space-between', columnGap: tokens.spacingHorizontalS, color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200, marginTop: '2px', fontVariantNumeric: 'tabular-nums' },
  swatch: { display: 'inline-block', width: '11px', height: '11px', borderRadius: '3px', marginRight: '6px', verticalAlign: '-1px' },
  scroll: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: tokens.fontSizeBase300, marginTop: tokens.spacingVerticalS },
  th: { textAlign: 'left', padding: '8px 10px', color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightRegular, fontSize: tokens.fontSizeBase200, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tokens.colorNeutralStroke2, whiteSpace: 'nowrap' },
  td: { padding: '8px 10px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tokens.colorNeutralStroke3, verticalAlign: 'top' },
  num: { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
  chips: { display: 'flex', flexWrap: 'wrap', columnGap: '6px', rowGap: '6px' },
  events: { listStyleType: 'none', margin: 0, padding: 0 },
  event: { display: 'flex', columnGap: tokens.spacingHorizontalM, padding: '6px 0', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tokens.colorNeutralStroke3, fontSize: tokens.fontSizeBase200 },
  time: { color: tokens.colorNeutralForeground3, fontVariantNumeric: 'tabular-nums', flexShrink: 0 },
  empty: { color: tokens.colorNeutralForeground3, marginTop: tokens.spacingVerticalS, marginBottom: 0 },
});
type Styles = ReturnType<typeof useStyles>;

const SLICE_KIND: Record<SliceState, 'success' | 'pending' | 'danger'> = {
  ready: 'success',
  pending: 'pending',
  loading: 'pending',
  verifying: 'pending',
  'rejected-no-capacity': 'danger',
  'over-budget': 'danger',
  'cpu-offload': 'danger',
  'model-missing': 'danger',
  failed: 'danger',
  'not-loaded': 'danger',
};
const POLL_MS = 2000;

/**
 * Live topology of the validation environment: sites -> GPU machines -> slices -> customers.
 * Not connected: a labelled sample from a real run. Connected: polls the gateway and lets the operator add a site
 * (one-time enrollment token) and open a customer account (one-time activation code).
 */
export function TopologyTab() {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const [params, setParams] = useSearchParams();
  // `npm run live` opens this tab with ?key=...: connect straight away, then drop the key from the address bar.
  const [conn, setConn] = useState<Conn>(() => {
    const stored = loadConn('admin');
    const fromUrl = params.get('key');
    return fromUrl ? { ...stored, key: fromUrl } : stored;
  });
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LiveTopology>(SAMPLE_TOPOLOGY);
  const colors = useRef(new Map<string, number>());

  const describe = useCallback(
    (e: unknown) => {
      if (e instanceof PocError && e.status === 401) return t('localgpu.poc.live.unauthorized');
      if (e instanceof PocError && e.status === 0) return t('localgpu.topo.unreachable');
      return t('localgpu.poc.live.error', { message: e instanceof Error ? e.message : String(e) });
    },
    [t],
  );
  const refresh = useCallback(
    async (c: Conn) => {
      setData(await pocCall<LiveTopology>(c, '/admin/v1/topology'));
    },
    [],
  );
  const connect = useCallback(
    async (c: Conn) => {
      setBusy(true);
      setError(null);
      try {
        await refresh(c);
        saveConn('admin', c);
        setLive(true);
      } catch (e) {
        setLive(false);
        setError(describe(e));
      } finally {
        setBusy(false);
      }
    },
    [refresh, describe],
  );
  const disconnect = () => {
    saveConn('admin', null);
    setLive(false);
    setData(SAMPLE_TOPOLOGY);
    setConn((c) => ({ ...c, key: '' }));
  };

  // A reload of the tab keeps the connection.
  useEffect(() => {
    if (conn.key) void connect(conn);
    if (params.has('key'))
      setParams(
        (p) => {
          p.delete('key');
          return p;
        },
        { replace: true },
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => {
      refresh(conn).catch((e) => {
        setLive(false);
        setError(describe(e));
      });
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [live, conn, refresh, describe]);

  const colorOf = (sliceId: string) => {
    if (!colors.current.has(sliceId)) colors.current.set(sliceId, colors.current.size % 5);
    return [s.c0, s.c1, s.c2, s.c3, s.c4][colors.current.get(sliceId) ?? 0];
  };
  const groups = [...data.sites, ...(data.unassigned.length ? [{ id: '-', name: t('localgpu.topo.unassigned'), region: '', location: '', enrollmentTokenPending: false, nodes: data.unassigned }] : [])];

  return (
    <>
      <section className={`${s.section} ${s.card}`} data-tour="localgpu-topo-connect">
        <h2 className={s.h2}>{t('localgpu.topo.connect.title')}</h2>
        <Text block className={s.muted} style={{ marginBottom: tokens.spacingVerticalS }}>
          {t('localgpu.topo.connect.desc')}
        </Text>
        <div className={s.connRow}>
          <Field label={t('localgpu.poc.live.url')}>
            <Input value={conn.url} onChange={(_, d) => setConn((c) => ({ ...c, url: d.value }))} disabled={live} />
          </Field>
          <Field label={t('localgpu.poc.live.key')}>
            <Input type="password" value={conn.key} onChange={(_, d) => setConn((c) => ({ ...c, key: d.value }))} disabled={live} autoComplete="off" />
          </Field>
          {live ? (
            <Button icon={<PlugDisconnectedRegular />} onClick={disconnect}>
              {t('localgpu.topo.disconnect')}
            </Button>
          ) : (
            <Button appearance="primary" icon={<PlugConnectedRegular />} disabled={busy || !conn.key.trim()} onClick={() => void connect({ url: conn.url.trim(), key: conn.key.trim() })}>
              {t(busy ? 'localgpu.poc.live.connecting' : 'localgpu.poc.live.connect')}
            </Button>
          )}
        </div>
        <Text block className={s.muted}>
          {t('localgpu.topo.connect.keyHint')}
        </Text>
        {error && (
          <MessageBar intent="error" style={{ marginTop: tokens.spacingVerticalS }}>
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}
      </section>

      <MessageBar intent={live ? 'success' : 'info'} style={{ marginBottom: tokens.spacingVerticalL }}>
        <MessageBarBody>
          <MessageBarTitle>{t(live ? 'localgpu.topo.liveTitle' : 'localgpu.topo.sampleTitle')}</MessageBarTitle>
          {live ? t('localgpu.topo.liveBody', { mode: data.mode, generation: L.fmtNumber(data.generation) }) : t('localgpu.topo.sampleBody')}
        </MessageBarBody>
      </MessageBar>

      <div className={`${s.section} ${s.two}`}>
        <AddSite s={s} conn={conn} live={live} onDone={() => void refresh(conn).catch(() => undefined)} />
        <OpenAccount s={s} conn={conn} live={live} catalog={data.catalog.map((m) => m.id)} onDone={() => void refresh(conn).catch(() => undefined)} />
      </div>

      <section className={`${s.section} ${s.card}`} data-tour="localgpu-topo-map">
        <div className={s.headRow}>
          <h2 className={s.h2} style={{ marginBottom: 0 }}>
            {t('localgpu.topo.map.title')}
          </h2>
          {live && data.mode !== 'on-demand' && (
            <Button size="small" onClick={() => void pocCall(conn, '/admin/v1/profile', { profile: 'on-demand' }).then(() => refresh(conn)).catch((e) => setError(describe(e)))}>
              {t('localgpu.topo.switchOnDemand')}
            </Button>
          )}
        </div>
        <Text block className={s.muted}>
          {t('localgpu.topo.map.desc')}
        </Text>
        {groups.length === 0 && <p className={s.empty}>{t('localgpu.topo.noSites')}</p>}
        {groups.map((site) => (
          <div key={site.id} className={s.site}>
            <div className={s.siteHead}>
              <h3 className={s.h3}>{site.name}</h3>
              <span className={s.muted}>{[site.id !== '-' ? site.id : '', site.region, site.location].filter(Boolean).join(' · ')}</span>
              {site.enrollmentTokenPending && (
                <Badge appearance="outline" size="small">
                  {t('localgpu.topo.tokenPending')}
                </Badge>
              )}
            </div>
            {site.nodes.length === 0 && <p className={s.empty}>{t('localgpu.topo.noNodes')}</p>}
            {site.nodes.map((n) => (
              <NodeView key={n.id} s={s} n={n} colorOf={colorOf} />
            ))}
          </div>
        ))}
      </section>

      <div className={`${s.section} ${s.two}`}>
        <section className={s.card}>
          <h2 className={s.h2}>{t('localgpu.topo.tenants.title')}</h2>
          <div className={s.scroll}>
            <table className={s.table} aria-label={t('localgpu.topo.tenants.title')} style={{ minWidth: 420 }}>
              <thead>
                <tr>
                  <th className={s.th}>{t('localgpu.topo.col.tenant')}</th>
                  <th className={s.th}>{t('localgpu.topo.col.status')}</th>
                  <th className={s.th}>{t('localgpu.topo.col.enabled')}</th>
                  <th className={s.th}>{t('localgpu.poc.live.col.balance')}</th>
                </tr>
              </thead>
              <tbody>
                {data.tenants
                  .slice(-8)
                  .reverse()
                  .map((x) => (
                    <tr key={x.id}>
                      <td className={s.td}>{x.name}</td>
                      <td className={s.td}>
                        <StatusBadge kind={x.status === 'active' ? 'success' : 'pending'} label={t(x.status === 'active' ? 'localgpu.topo.tenant.active' : 'localgpu.topo.tenant.pending')} size="small" />
                      </td>
                      <td className={`${s.td} ${s.num}`}>{L.fmtNumber(x.deployments)}</td>
                      <td className={`${s.td} ${s.num}`}>{formatUsd(x.balanceUsd, 6)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {data.tenants.length === 0 && <p className={s.empty}>{t('localgpu.topo.noTenants')}</p>}
        </section>
        <section className={s.card}>
          <h2 className={s.h2}>{t('localgpu.topo.events.title')}</h2>
          <ul className={s.events}>
            {data.events.slice(0, 10).map((e, i) => (
              <li key={`${e.ts}-${i}`} className={s.event}>
                <span className={s.time}>{L.fmtDateTime(e.ts)}</span>
                <span>{eventText(t, e)}</span>
              </li>
            ))}
          </ul>
          {data.events.length === 0 && <p className={s.empty}>{t('localgpu.topo.noEvents')}</p>}
        </section>
      </div>
    </>
  );
}

type T = ReturnType<typeof useT>;

function eventText(t: T, e: LiveEvent): string {
  const p = { name: e.name ?? '', site: e.siteId ?? '', tenant: e.tenant ?? '', model: e.model ?? '', slice: e.sliceId ?? '', mib: String(e.vramMiB ?? ''), mode: e.mode ?? '', count: String(e.count ?? '') };
  switch (e.type) {
    case 'site-added':
      return t('localgpu.topo.event.siteAdded', p);
    case 'node-enrolled':
      return t('localgpu.topo.event.nodeEnrolled', p);
    case 'tenant-created':
      return t('localgpu.topo.event.tenantCreated', p);
    case 'tenant-activated':
      return t('localgpu.topo.event.tenantActivated', p);
    case 'slice-carved':
      return t('localgpu.topo.event.sliceCarved', p);
    case 'slice-shared':
      return t('localgpu.topo.event.sliceShared', p);
    case 'slice-left':
      return t('localgpu.topo.event.sliceLeft', p);
    case 'slice-released':
      return t('localgpu.topo.event.sliceReleased', p);
    case 'slices-cleared':
      return t('localgpu.topo.event.slicesCleared', p);
    case 'mode-changed':
      return t('localgpu.topo.event.modeChanged', p);
    default:
      return e.type;
  }
}

export function sliceStateLabel(t: T, state: SliceState): string {
  switch (state) {
    case 'ready':
      return t('localgpu.topo.state.ready');
    case 'pending':
      return t('localgpu.topo.state.pending');
    case 'loading':
      return t('localgpu.topo.state.loading');
    case 'verifying':
      return t('localgpu.topo.state.verifying');
    case 'rejected-no-capacity':
      return t('localgpu.topo.state.rejected');
    case 'over-budget':
      return t('localgpu.topo.state.overBudget');
    case 'cpu-offload':
      return t('localgpu.topo.state.cpuOffload');
    case 'model-missing':
      return t('localgpu.topo.state.modelMissing');
    case 'failed':
      return t('localgpu.topo.state.failed');
    default:
      return t('localgpu.topo.state.notLoaded');
  }
}

function NodeView({ s, n, colorOf }: { s: Styles; n: LiveNode; colorOf: (id: string) => string }) {
  const t = useT();
  const L = useLocale();
  const liveSlices = n.slices.filter((x) => x.state !== 'rejected-no-capacity');
  const total = n.gpu?.totalMiB ?? 0;
  const label = (mib: number, text: string) => (total > 0 && mib / total > 0.08 ? text : '');
  const seg = (key: string, mib: number, text: string, cls: string) => (
    <div key={key} className={mergeClasses(s.seg, cls)} style={{ flexGrow: mib }} title={`${text} · ${L.fmtNumber(mib)} MiB`}>
      {label(mib, text)}
    </div>
  );
  return (
    <div className={s.node}>
      <div className={s.siteHead}>
        <StatusBadge kind={n.online ? 'success' : 'danger'} label={t(n.online ? 'localgpu.poc.live.online' : 'localgpu.poc.live.offline')} size="small" />
        <span className={s.h3}>{n.name}</span>
        <span className={s.mono}>{n.id}</span>
        {n.gpu && <span className={s.muted}>{[n.gpu.name, n.strategy === 'mig' ? t('localgpu.topo.strategy.mig') : t('localgpu.topo.strategy.vramBudget'), n.runtime ?? ''].filter(Boolean).join(' · ')}</span>}
      </div>
      {!n.gpu ? (
        <p className={s.empty}>{t('localgpu.topo.noReport')}</p>
      ) : (
        <>
          <div className={s.bar} role="img" aria-label={t('localgpu.topo.barAria', { used: L.fmtNumber(liveSlices.reduce((a, x) => a + x.budgetMiB, 0)), budget: L.fmtNumber(n.gpu.sliceBudgetMiB) })}>
            {seg('reserve', n.gpu.reserveMiB, t('localgpu.topo.reserve'), s.segReserve)}
            {liveSlices.map((x) => seg(x.id, x.budgetMiB, x.model, mergeClasses(colorOf(x.id), x.state !== 'ready' && s.segPending)))}
            {n.freeMiB > 0 && seg('free', n.freeMiB, t('localgpu.topo.free', { mib: L.fmtNumber(n.freeMiB) }), s.segFree)}
          </div>
          <div className={s.scale}>
            <span>0</span>
            <span>{t('localgpu.topo.carved', { used: L.fmtNumber(liveSlices.reduce((a, x) => a + x.budgetMiB, 0)), budget: L.fmtNumber(n.gpu.sliceBudgetMiB) })}</span>
            <span>{L.fmtNumber(total)} MiB</span>
          </div>
          {n.slices.length === 0 ? (
            <p className={s.empty}>{t('localgpu.topo.noSlices')}</p>
          ) : (
            <div className={s.scroll}>
              <table className={s.table} aria-label={t('localgpu.topo.slicesAria', { node: n.name })} style={{ minWidth: 640 }}>
                <thead>
                  <tr>
                    <th className={s.th}>{t('localgpu.topo.col.slice')}</th>
                    <th className={s.th}>{t('localgpu.topo.col.model')}</th>
                    <th className={s.th}>{t('localgpu.topo.col.status')}</th>
                    <th className={s.th}>{t('localgpu.topo.col.budget')}</th>
                    <th className={s.th}>{t('localgpu.topo.col.measured')}</th>
                    <th className={s.th}>{t('localgpu.poc.live.col.inflight')}</th>
                    <th className={s.th}>{t('localgpu.topo.col.customers')}</th>
                  </tr>
                </thead>
                <tbody>
                  {n.slices.map((x) => (
                    <SliceRow key={x.id} s={s} x={x} color={colorOf(x.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SliceRow({ s, x, color }: { s: Styles; x: LiveSlice; color: string }) {
  const t = useT();
  const L = useLocale();
  return (
    <tr>
      <td className={`${s.td} ${s.mono}`}>
        <span className={mergeClasses(s.swatch, color)} />
        {x.id}
      </td>
      <td className={s.td}>{x.model}</td>
      <td className={s.td}>
        <StatusBadge kind={SLICE_KIND[x.state] ?? 'pending'} label={sliceStateLabel(t, x.state)} size="small" />
        {x.detail && <div className={s.muted}>{x.detail}</div>}
      </td>
      <td className={`${s.td} ${s.num}`}>{L.fmtNumber(x.budgetMiB)} MiB</td>
      <td className={`${s.td} ${s.num}`}>{x.measuredMiB === null ? t('common.none') : `${L.fmtNumber(x.measuredMiB)} MiB`}</td>
      <td className={`${s.td} ${s.num}`}>{L.fmtNumber(x.inflight)}</td>
      <td className={s.td}>
        {x.tenants.length === 0 ? (
          <span className={s.muted}>{t(x.sharing === 'dedicated' ? 'localgpu.topo.dedicated' : 'localgpu.topo.allCustomers')}</span>
        ) : (
          <div className={s.chips}>
            {x.tenants.map((c) => (
              <Badge key={c.id} appearance="outline" size="small">
                {c.name}
              </Badge>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
}

function AddSite({ s, conn, live, onDone }: { s: Styles; conn: Conn; live: boolean; onDone: () => void }) {
  const t = useT();
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [location, setLocation] = useState('');
  const [out, setOut] = useState<{ siteId: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    try {
      const j = await pocCall<{ siteId: string; enrollmentToken: string }>(conn, '/admin/v1/sites', { name, region, location });
      setOut({ siteId: j.siteId, token: j.enrollmentToken });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <section className={s.card} data-tour="localgpu-topo-site">
      <h2 className={s.h2}>{t('localgpu.topo.site.title')}</h2>
      <Text block className={s.muted}>
        {t('localgpu.topo.site.desc')}
      </Text>
      <div className={s.formRow}>
        <Field label={t('localgpu.topo.site.name')}>
          <Input value={name} onChange={(_, d) => setName(d.value)} disabled={!live} />
        </Field>
        <Field label={t('localgpu.topo.site.region')}>
          <Input value={region} onChange={(_, d) => setRegion(d.value)} disabled={!live} placeholder="tw-north" />
        </Field>
        <Field label={t('localgpu.topo.site.location')}>
          <Input value={location} onChange={(_, d) => setLocation(d.value)} disabled={!live} />
        </Field>
      </div>
      <Button appearance="primary" disabled={!live || !name.trim()} onClick={() => void submit()}>
        {t('localgpu.topo.site.submit')}
      </Button>
      {!live && (
        <Text block className={s.muted} style={{ marginTop: tokens.spacingVerticalS }}>
          {t('localgpu.topo.needLive')}
        </Text>
      )}
      {error && (
        <MessageBar intent="error" style={{ marginTop: tokens.spacingVerticalS }}>
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {out && (
        <div style={{ marginTop: tokens.spacingVerticalS }}>
          <Text block className={s.muted} style={{ marginBottom: tokens.spacingVerticalXS }}>
            {t('localgpu.topo.site.done', { site: out.siteId })}
          </Text>
          <CodeBlock label={t('localgpu.topo.site.commandLabel')} code={`MAAS_BOOTSTRAP_TOKEN='${out.token}' node agent.mjs`} />
        </div>
      )}
    </section>
  );
}

function OpenAccount({ s, conn, live, catalog, onDone }: { s: Styles; conn: Conn; live: boolean; catalog: string[]; onDone: () => void }) {
  const t = useT();
  const [name, setName] = useState('');
  const [credit, setCredit] = useState('1');
  const [out, setOut] = useState<{ tenantId: string; code: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    try {
      const j = await pocCall<{ tenantId: string; activationCode: string }>(conn, '/admin/v1/tenants', { name, creditUsd: Number(credit) || 1, models: catalog.length ? catalog : '*' });
      setOut({ tenantId: j.tenantId, code: j.activationCode });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <section className={s.card} data-tour="localgpu-topo-account">
      <h2 className={s.h2}>{t('localgpu.topo.account.title')}</h2>
      <Text block className={s.muted}>
        {t('localgpu.topo.account.desc')}
      </Text>
      <div className={s.formRow}>
        <Field label={t('localgpu.topo.account.name')}>
          <Input value={name} onChange={(_, d) => setName(d.value)} disabled={!live} />
        </Field>
        <Field label={t('localgpu.topo.account.credit')}>
          <Input value={credit} onChange={(_, d) => setCredit(d.value)} disabled={!live} inputMode="decimal" />
        </Field>
      </div>
      <Button appearance="primary" disabled={!live || !name.trim()} onClick={() => void submit()}>
        {t('localgpu.topo.account.submit')}
      </Button>
      {!live && (
        <Text block className={s.muted} style={{ marginTop: tokens.spacingVerticalS }}>
          {t('localgpu.topo.needLive')}
        </Text>
      )}
      {error && (
        <MessageBar intent="error" style={{ marginTop: tokens.spacingVerticalS }}>
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {out && (
        <div style={{ marginTop: tokens.spacingVerticalS }}>
          <Text block className={s.muted} style={{ marginBottom: tokens.spacingVerticalXS }}>
            {t('localgpu.topo.account.done', { tenant: out.tenantId })}
          </Text>
          <CodeBlock label={t('localgpu.topo.account.codeLabel')} code={out.code} />
        </div>
      )}
    </section>
  );
}
