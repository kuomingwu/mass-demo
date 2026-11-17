import { Button, Dropdown, Field, Input, MessageBar, MessageBarBody, MessageBarTitle, Option, Text, Textarea, makeStyles, shorthands, tokens } from '@fluentui/react-components';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { CodeBlock } from '../../components/CodeBlock';
import { StatusBadge } from '../../components/StatusBadge';
import { useLocale, useT } from '../../i18n';
import { formatUsd } from '../../theme/chartPalette';
import { POC_GATEWAY_DEFAULT } from '../../data/localGpu';
import { PocError, loadConn, pocCall, pocChat, saveConn, type CatalogModel, type ChatResult, type Conn, type Deployment, type PortalAccount, type PortalSite } from '../../data/pocLive';
import { sliceStateLabel } from '../localgpu/TopologyTab';

const border = shorthands.border('1px', 'solid', tokens.colorNeutralStroke2);

const useStyles = makeStyles({
  card: { backgroundColor: tokens.colorNeutralBackground1, ...border, borderRadius: tokens.borderRadiusLarge, padding: tokens.spacingVerticalM, marginBottom: tokens.spacingVerticalL, minWidth: 0 },
  locked: { opacity: 0.55 },
  head: { display: 'flex', alignItems: 'center', columnGap: tokens.spacingHorizontalS, marginBottom: tokens.spacingVerticalXS },
  num: { width: '26px', height: '26px', borderRadius: '50%', backgroundColor: tokens.colorBrandBackground, color: tokens.colorNeutralForegroundOnBrand, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase200, flexShrink: 0 },
  h2: { fontSize: tokens.fontSizeBase400, fontWeight: tokens.fontWeightSemibold, margin: 0 },
  muted: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  row: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', columnGap: tokens.spacingHorizontalM, rowGap: tokens.spacingVerticalS, alignItems: 'end', marginTop: tokens.spacingVerticalS, marginBottom: tokens.spacingVerticalS },
  actions: { display: 'flex', flexWrap: 'wrap', columnGap: tokens.spacingHorizontalS, rowGap: tokens.spacingVerticalS },
  scroll: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: tokens.fontSizeBase300, marginTop: tokens.spacingVerticalS },
  th: { textAlign: 'left', padding: '8px 10px', color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightRegular, fontSize: tokens.fontSizeBase200, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tokens.colorNeutralStroke2, whiteSpace: 'nowrap' },
  td: { padding: '8px 10px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tokens.colorNeutralStroke3, verticalAlign: 'top', fontVariantNumeric: 'tabular-nums' },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
  out: { backgroundColor: tokens.colorNeutralBackground3, borderRadius: tokens.borderRadiusMedium, padding: tokens.spacingVerticalS, minHeight: '48px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: tokens.spacingVerticalS, lineHeight: tokens.lineHeightBase300 },
  dl: { display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: tokens.spacingHorizontalL, rowGap: tokens.spacingVerticalXS, margin: 0, marginTop: tokens.spacingVerticalS },
  dt: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  dd: { margin: 0, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' },
});

const POLL_MS = 2000;
const KIND = { ready: 'success', pending: 'pending', loading: 'pending', verifying: 'pending' } as const;

/**
 * Self-hosted GPU (customer portal): redeem an activation code, receive an API key, choose a site and a model,
 * and call it. Unlike the rest of the demo this page talks to the real validation gateway, so enabling a model
 * here carves a real slice on a real GPU; the operator sees it appear in the admin portal's live topology.
 */
export function LiveGpuPage() {
  const s = useStyles();
  const t = useT();
  const L = useLocale();
  const [url, setUrl] = useState(() => loadConn('customer').url || POC_GATEWAY_DEFAULT);
  const [key, setKey] = useState(() => loadConn('customer').key);
  const [signedIn, setSignedIn] = useState(false);
  const [params] = useSearchParams();
  // `npm run live` opens this page with ?code=...: the activation code is filled in, the customer still presses Activate.
  const [code, setCode] = useState(() => params.get('code') ?? '');
  const [existing, setExisting] = useState('');
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [account, setAccount] = useState<PortalAccount | null>(null);
  const [sites, setSites] = useState<PortalSite[]>([]);
  const [mode, setMode] = useState('on-demand');
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [deps, setDeps] = useState<Deployment[]>([]);
  const [siteId, setSiteId] = useState('');
  const [modelId, setModelId] = useState('');
  const [deployMsg, setDeployMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [chatModel, setChatModel] = useState('');
  const [prompt, setPrompt] = useState(() => t('localgpu.cust.try.defaultPrompt'));
  const [reply, setReply] = useState('');
  const [result, setResult] = useState<ChatResult | null>(null);
  const [sending, setSending] = useState(false);

  const describe = useCallback(
    (e: unknown) => {
      if (e instanceof PocError && e.status === 0) return t('localgpu.topo.unreachable');
      if (e instanceof PocError) return t('localgpu.cust.failed', { status: String(e.status), code: e.code, message: e.message });
      return String(e);
    },
    [t],
  );

  const loadAll = useCallback(async (c: Conn) => {
    const [me, st, md, dp] = await Promise.all([
      pocCall<PortalAccount>(c, '/portal/v1/me'),
      pocCall<{ mode: string; data: PortalSite[] }>(c, '/portal/v1/sites'),
      pocCall<{ data: CatalogModel[] }>(c, '/v1/models'),
      pocCall<{ data: Deployment[] }>(c, '/portal/v1/deployments'),
    ]);
    setAccount(me);
    setSites(st.data);
    setMode(st.mode);
    setModels(md.data);
    setDeps(dp.data);
    setSiteId((cur) => cur || st.data.find((x) => x.onlineNodes > 0)?.id || st.data[0]?.id || '');
    setModelId((cur) => cur || md.data[0]?.id || '');
    setChatModel((cur) => (md.data.some((m) => m.id === cur && m.status === 'ready') ? cur : md.data.find((m) => m.status === 'ready')?.id ?? cur));
  }, []);

  const signIn = useCallback(
    async (c: Conn, freshKey: string | null) => {
      await loadAll(c);
      saveConn('customer', c);
      setKey(c.key);
      setShownKey(freshKey);
      setSignedIn(true);
    },
    [loadAll],
  );

  // A reload of the tab keeps the session.
  useEffect(() => {
    if (key) signIn({ url, key }, null).catch(() => saveConn('customer', null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!signedIn) return;
    const id = window.setInterval(() => void loadAll({ url, key }).catch(() => undefined), POLL_MS);
    return () => window.clearInterval(id);
  }, [signedIn, url, key, loadAll]);

  const activate = async () => {
    setNotice(null);
    try {
      const j = await pocCall<{ apiKey: string; name: string; tenantId: string }>({ url, key: '' }, '/portal/v1/activate', { activationCode: code.trim() });
      await signIn({ url, key: j.apiKey }, j.apiKey);
      setNotice({ ok: true, text: t('localgpu.cust.activate.done', { name: j.name, tenant: j.tenantId }) });
    } catch (e) {
      setNotice({ ok: false, text: describe(e) });
    }
  };
  const useExisting = async () => {
    setNotice(null);
    try {
      await signIn({ url, key: existing.trim() }, null);
      setNotice({ ok: true, text: t('localgpu.cust.activate.signedIn') });
    } catch (e) {
      setNotice({ ok: false, text: e instanceof PocError && e.status === 401 ? t('localgpu.cust.activate.badKey') : describe(e) });
    }
  };
  const signOut = () => {
    saveConn('customer', null);
    setSignedIn(false);
    setKey('');
    setShownKey(null);
    setAccount(null);
    setDeps([]);
    setNotice(null);
    setReply('');
    setResult(null);
  };
  const deploy = async () => {
    setDeployMsg(null);
    try {
      const d = await pocCall<Deployment>({ url, key }, '/portal/v1/deployments', { model: modelId, siteId });
      setDeployMsg({ ok: true, text: t(d.carved ? 'localgpu.cust.deploy.carved' : 'localgpu.cust.deploy.shared', { site: d.siteName ?? d.siteId, model: d.model, mib: L.fmtNumber(d.vramMiB) }) });
      await loadAll({ url, key });
    } catch (e) {
      setDeployMsg({ ok: false, text: describe(e) });
    }
  };
  const remove = async (sliceId: string) => {
    await pocCall({ url, key }, '/portal/v1/deployments/remove', { sliceId }).catch(() => undefined);
    await loadAll({ url, key }).catch(() => undefined);
  };
  const send = async () => {
    setSending(true);
    setReply('');
    setResult(null);
    try {
      setResult(await pocChat({ url, key }, chatModel, prompt, (d) => setReply((r) => r + d)));
      await loadAll({ url, key });
    } catch (e) {
      setReply(describe(e));
    } finally {
      setSending(false);
    }
  };

  const anyReady = models.some((m) => m.status === 'ready');
  const lock = signedIn ? s.card : `${s.card} ${s.locked}`;

  return (
    <>
      <PageHeader title={t('localgpu.cust.title')} subtitle={t('localgpu.cust.subtitle')} crumbs={[{ label: t('localgpu.cust.title') }]} />
      <MessageBar intent="info" style={{ marginBottom: tokens.spacingVerticalL }}>
        <MessageBarBody>
          <MessageBarTitle>{t('localgpu.cust.liveTitle')}</MessageBarTitle>
          {t('localgpu.cust.liveBody')}
        </MessageBarBody>
      </MessageBar>

      <section className={s.card} data-tour="livegpu-activate">
        <div className={s.head}>
          <span className={s.num}>1</span>
          <h2 className={s.h2}>{t('localgpu.cust.activate.title')}</h2>
        </div>
        <Text block className={s.muted}>
          {t('localgpu.cust.activate.desc')}
        </Text>
        <div className={s.row}>
          <Field label={t('localgpu.poc.live.url')}>
            <Input value={url} onChange={(_, d) => setUrl(d.value)} disabled={signedIn} />
          </Field>
          <Field label={t('localgpu.cust.activate.code')}>
            <Input value={code} onChange={(_, d) => setCode(d.value)} disabled={signedIn} autoComplete="off" placeholder="act_…" />
          </Field>
          <Field label={t('localgpu.cust.activate.existing')}>
            <Input type="password" value={existing} onChange={(_, d) => setExisting(d.value)} disabled={signedIn} autoComplete="off" placeholder="sk-maas_…" />
          </Field>
        </div>
        <div className={s.actions}>
          {signedIn ? (
            <Button onClick={signOut}>{t('localgpu.cust.activate.signOut')}</Button>
          ) : (
            <>
              <Button appearance="primary" disabled={!code.trim()} onClick={() => void activate()}>
                {t('localgpu.cust.activate.submit')}
              </Button>
              <Button disabled={!existing.trim()} onClick={() => void useExisting()}>
                {t('localgpu.cust.activate.useExisting')}
              </Button>
            </>
          )}
        </div>
        {notice && (
          <MessageBar intent={notice.ok ? 'success' : 'error'} style={{ marginTop: tokens.spacingVerticalS }}>
            <MessageBarBody>{notice.text}</MessageBarBody>
          </MessageBar>
        )}
      </section>

      <section className={lock} data-tour="livegpu-key">
        <div className={s.head}>
          <span className={s.num}>2</span>
          <h2 className={s.h2}>{t('localgpu.cust.key.title')}</h2>
        </div>
        <Text block className={s.muted} style={{ marginBottom: tokens.spacingVerticalS }}>
          {t('localgpu.cust.key.desc')}
        </Text>
        {shownKey ? <CodeBlock label={t('localgpu.cust.key.label')} code={shownKey} /> : <Text className={s.muted}>{t(signedIn ? 'localgpu.cust.key.hidden' : 'localgpu.cust.key.none')}</Text>}
      </section>

      <section className={lock} data-tour="livegpu-deploy">
        <div className={s.head}>
          <span className={s.num}>3</span>
          <h2 className={s.h2}>{t('localgpu.cust.deploy.title')}</h2>
        </div>
        <Text block className={s.muted}>
          {t('localgpu.cust.deploy.desc')}
        </Text>
        <div className={s.row}>
          <Field label={t('localgpu.cust.deploy.site')}>
            <Dropdown
              disabled={!signedIn || sites.length === 0}
              value={siteLabel(t, L.fmtNumber, sites.find((x) => x.id === siteId))}
              selectedOptions={siteId ? [siteId] : []}
              onOptionSelect={(_, d) => setSiteId(d.optionValue ?? '')}
            >
              {sites.map((x) => (
                <Option key={x.id} value={x.id} text={x.name}>
                  {siteLabel(t, L.fmtNumber, x)}
                </Option>
              ))}
            </Dropdown>
          </Field>
          <Field label={t('localgpu.topo.col.model')}>
            <Dropdown disabled={!signedIn || models.length === 0} value={modelId} selectedOptions={modelId ? [modelId] : []} onOptionSelect={(_, d) => setModelId(d.optionValue ?? '')}>
              {models.map((m) => (
                <Option key={m.id} value={m.id}>
                  {m.id}
                </Option>
              ))}
            </Dropdown>
          </Field>
          <Button appearance="primary" disabled={!signedIn || !siteId || !modelId || mode !== 'on-demand'} onClick={() => void deploy()}>
            {t('localgpu.cust.deploy.submit')}
          </Button>
        </div>
        {signedIn && mode !== 'on-demand' && <Text className={s.muted}>{t('localgpu.cust.deploy.fixedMode')}</Text>}
        {signedIn && sites.length === 0 && <Text className={s.muted}>{t('localgpu.cust.deploy.noSites')}</Text>}
        {deployMsg && (
          <MessageBar intent={deployMsg.ok ? 'success' : 'error'} style={{ marginTop: tokens.spacingVerticalS }}>
            <MessageBarBody>{deployMsg.text}</MessageBarBody>
          </MessageBar>
        )}
        {deps.length > 0 && (
          <div className={s.scroll}>
            <table className={s.table} aria-label={t('localgpu.cust.deploy.listAria')} style={{ minWidth: 620 }}>
              <thead>
                <tr>
                  <th className={s.th}>{t('localgpu.topo.col.model')}</th>
                  <th className={s.th}>{t('localgpu.cust.deploy.site')}</th>
                  <th className={s.th}>{t('localgpu.topo.col.status')}</th>
                  <th className={s.th}>{t('localgpu.topo.col.slice')}</th>
                  <th className={s.th}>{t('localgpu.poc.live.col.vram')}</th>
                  <th className={s.th} />
                </tr>
              </thead>
              <tbody>
                {deps.map((d) => (
                  <tr key={d.sliceId}>
                    <td className={s.td}>{d.model}</td>
                    <td className={s.td}>{d.siteName ?? d.siteId}</td>
                    <td className={s.td}>
                      <StatusBadge kind={KIND[d.state as keyof typeof KIND] ?? 'danger'} label={sliceStateLabel(t, d.state)} size="small" />
                      {d.sharedWith > 0 && <div className={s.muted}>{t('localgpu.cust.deploy.sharedWith', { count: L.fmtNumber(d.sharedWith) })}</div>}
                    </td>
                    <td className={`${s.td} ${s.mono}`}>{d.sliceId}</td>
                    <td className={s.td}>{d.measuredMiB ? `${L.fmtNumber(d.measuredMiB)} / ${L.fmtNumber(d.vramMiB)} MiB` : `${L.fmtNumber(d.vramMiB)} MiB`}</td>
                    <td className={s.td}>
                      <Button size="small" onClick={() => void remove(d.sliceId)}>
                        {t('localgpu.cust.deploy.remove')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={lock} data-tour="livegpu-try">
        <div className={s.head}>
          <span className={s.num}>4</span>
          <h2 className={s.h2}>{t('localgpu.cust.try.title')}</h2>
        </div>
        <Text block className={s.muted}>
          {t('localgpu.cust.try.desc')}
        </Text>
        <div className={s.row}>
          <Field label={t('localgpu.topo.col.model')}>
            <Dropdown disabled={!signedIn || !anyReady} value={chatModel} selectedOptions={chatModel ? [chatModel] : []} onOptionSelect={(_, d) => setChatModel(d.optionValue ?? '')}>
              {models
                .filter((m) => m.status === 'ready')
                .map((m) => (
                  <Option key={m.id} value={m.id}>
                    {m.id}
                  </Option>
                ))}
            </Dropdown>
          </Field>
          <Button appearance="primary" disabled={!signedIn || !anyReady || !chatModel || sending || !prompt.trim()} onClick={() => void send()}>
            {t(sending ? 'localgpu.cust.try.sending' : 'localgpu.cust.try.send')}
          </Button>
        </div>
        <Field label={t('localgpu.cust.try.prompt')}>
          <Textarea value={prompt} onChange={(_, d) => setPrompt(d.value)} disabled={!signedIn} resize="vertical" />
        </Field>
        {signedIn && !anyReady && <Text className={s.muted}>{t('localgpu.cust.try.noneReady')}</Text>}
        <div className={s.out} aria-live="polite">
          {reply}
        </div>
        {result && (
          <dl className={s.dl}>
            <dt className={s.dt}>{t('localgpu.poc.live.col.node')}</dt>
            <dd className={`${s.dd} ${s.mono}`}>{result.nodeId ?? t('common.none')}</dd>
            <dt className={s.dt}>{t('localgpu.topo.col.slice')}</dt>
            <dd className={`${s.dd} ${s.mono}`}>{result.sliceId ?? t('common.none')}</dd>
            <dt className={s.dt}>{t('localgpu.cust.try.ttft')}</dt>
            <dd className={s.dd}>{result.ttftMs === null ? t('common.none') : t('localgpu.cust.try.ms', { ms: L.fmtNumber(Math.round(result.ttftMs)) })}</dd>
            <dt className={s.dt}>{t('localgpu.cust.try.total')}</dt>
            <dd className={s.dd}>{t('localgpu.cust.try.ms', { ms: L.fmtNumber(Math.round(result.totalMs)) })}</dd>
            <dt className={s.dt}>{t('localgpu.cust.try.tokens')}</dt>
            <dd className={s.dd}>{result.promptTokens === null ? t('common.none') : t('localgpu.cust.try.tokensValue', { input: L.fmtNumber(result.promptTokens), output: L.fmtNumber(result.completionTokens ?? 0) })}</dd>
            <dt className={s.dt}>{t('localgpu.cust.try.retention')}</dt>
            <dd className={s.dd}>{t(result.retention === 'none' ? 'localgpu.cust.try.retentionNone' : 'localgpu.cust.try.retentionStandard')}</dd>
          </dl>
        )}
      </section>

      <section className={lock} data-tour="livegpu-usage">
        <div className={s.head}>
          <span className={s.num}>5</span>
          <h2 className={s.h2}>{t('localgpu.cust.usage.title')}</h2>
        </div>
        <Text block className={s.muted}>
          {t('localgpu.cust.usage.desc')}
        </Text>
        {account && (
          <dl className={s.dl}>
            <dt className={s.dt}>{t('localgpu.cust.usage.account')}</dt>
            <dd className={s.dd}>
              {account.name} <span className={s.mono}>{account.tenantId}</span>
            </dd>
            <dt className={s.dt}>{t('localgpu.poc.live.col.balance')}</dt>
            <dd className={s.dd}>{formatUsd(account.balanceUsd, 6)}</dd>
            <dt className={s.dt}>{t('localgpu.poc.live.col.spent')}</dt>
            <dd className={s.dd}>{formatUsd(account.spentUsd, 6)}</dd>
            <dt className={s.dt}>{t('localgpu.cust.usage.requests')}</dt>
            <dd className={s.dd}>{t('localgpu.cust.usage.requestsValue', { total: L.fmtNumber(account.today.requests), ok: L.fmtNumber(account.today.ok) })}</dd>
            <dt className={s.dt}>{t('localgpu.cust.try.tokens')}</dt>
            <dd className={s.dd}>{t('localgpu.cust.try.tokensValue', { input: L.fmtNumber(account.today.promptTokens), output: L.fmtNumber(account.today.completionTokens) })}</dd>
            <dt className={s.dt}>{t('localgpu.cust.usage.limit')}</dt>
            <dd className={s.dd}>{t('localgpu.cust.usage.limitValue', { tpm: L.fmtNumber(account.limits.tpm), used: L.fmtNumber(account.limits.tpmUsed), rpm: L.fmtNumber(account.limits.rpm) })}</dd>
          </dl>
        )}
      </section>
    </>
  );
}

function siteLabel(t: ReturnType<typeof useT>, fmt: (n: number) => string, x: PortalSite | undefined): string {
  if (!x) return '';
  const where = [x.name, x.location].filter(Boolean).join(' · ');
  return x.onlineNodes > 0 ? t('localgpu.cust.deploy.siteFree', { site: where, mib: fmt(x.freeMiB) }) : t('localgpu.cust.deploy.siteOffline', { site: where });
}
