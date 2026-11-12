import {
  Button,
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
  OverlayDrawer,
  Switch,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { DismissRegular, PlugConnectedRegular, ServerRegular, SettingsRegular } from '@fluentui/react-icons';
import { ConnectProviderDrawer } from './providers/ConnectProviderDrawer';
import { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { AsyncView, PermissionDenied } from '../components/States';
import { StatusBadge, healthKind } from '../components/StatusBadge';
import { useApi } from '../hooks/useApi';
import { server, type ApiError } from '../server/api';
import { useSession } from '../app/SessionContext';
import { useNotify } from '../components/Notify';
import { HEALTH_LABELS, type ProviderInfo } from '../data/providers';
import { PLATFORM_SCOPE } from '../auth/scope';
import { tf, tl, useT } from '../i18n';

const useStyles = makeStyles({
  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: tokens.spacingHorizontalM, '@media (max-width: 900px)': { gridTemplateColumns: '1fr' } },
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    borderTopWidth: '1px',
    borderRightWidth: '1px',
    borderBottomWidth: '1px',
    borderLeftWidth: '1px',
    borderTopStyle: 'solid',
    borderRightStyle: 'solid',
    borderBottomStyle: 'solid',
    borderLeftStyle: 'solid',
    borderTopColor: tokens.colorNeutralStroke2,
    borderRightColor: tokens.colorNeutralStroke2,
    borderBottomColor: tokens.colorNeutralStroke2,
    borderLeftColor: tokens.colorNeutralStroke2,
    borderRadius: tokens.borderRadiusLarge,
    padding: tokens.spacingVerticalM,
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalS,
    minWidth: 0,
  },
  localCard: { backgroundColor: tokens.colorBrandBackground2, borderTopColor: tokens.colorBrandStroke1, borderRightColor: tokens.colorBrandStroke1, borderBottomColor: tokens.colorBrandStroke1, borderLeftColor: tokens.colorBrandStroke1 },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', columnGap: tokens.spacingHorizontalS },
  type: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: tokens.fontSizeBase200 },
  th: { textAlign: 'left', padding: '4px 6px', color: tokens.colorNeutralForeground3, fontWeight: tokens.fontWeightRegular, borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tokens.colorNeutralStroke2 },
  td: { padding: '6px 6px', borderBottomWidth: '1px', borderBottomStyle: 'solid', borderBottomColor: tokens.colorNeutralStroke3, verticalAlign: 'top' },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase100, wordBreak: 'break-all' },
  hints: { margin: 0, paddingLeft: '18px', fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 },
  legacy: { color: tokens.colorNeutralForeground3 },
  form: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', columnGap: tokens.spacingHorizontalS, alignItems: 'end' },
});

/** 雲端供應商角色說明的字典鍵（文案見 dict/<locale>/ops.ts） */
export const CLOUD_PROXY_NOTE_KEY = 'ops.providers.cloudNote';

export function ProvidersPage() {
  const s = useStyles();
  const t = useT();
  const { session, canUi } = useSession();
  const st = useApi(() => server.listProviders(session), [session]);
  const [editing, setEditing] = useState<ProviderInfo | null>(null);
  const [connecting, setConnecting] = useState(false);
  const canConfigure = canUi('provider.configure', PLATFORM_SCOPE);

  return (
    <>
      <PageHeader
        title={t('ops.providers.title')}
        subtitle={t('ops.providers.subtitle')}
        crumbs={[{ label: t('ops.providers.crumb') }]}
        actions={
          <Tooltip content={canConfigure ? t('ops.providers.connectTip') : t('ops.providers.needConfigure')} relationship="description">
            <Button data-tour="prov-connect" appearance="primary" icon={<PlugConnectedRegular />} onClick={() => setConnecting(true)}>
              {t('ops.providers.connect')}
            </Button>
          </Tooltip>
        }
      />
      <MessageBar intent="info" style={{ marginBottom: 12 }} data-tour="prov-cloud-note">
        <MessageBarBody>
          <MessageBarTitle>{t('ops.providers.cloudNoteTitle')}</MessageBarTitle>
          {t(CLOUD_PROXY_NOTE_KEY)}
        </MessageBarBody>
      </MessageBar>
      <AsyncView {...st} actionLabel={t('ops.providers.actionLabel')}>
        {(providers) => (
          <div className={s.cards}>
            {providers
              .filter((p) => p.local)
              .map((p) => (
                <section key={p.id} className={`${s.card} ${s.localCard}`} aria-labelledby={`prov-${p.id}`} data-tour={`prov-${p.id}`}>
                  <div className={s.head}>
                    <div>
                      <Text weight="semibold" size={400} id={`prov-${p.id}`} as="h3" style={{ margin: 0 }}>
                        <ServerRegular style={{ verticalAlign: '-3px', marginRight: 6 }} />
                        {tf(t, `data.provider.${p.id}.name`, p.name)}
                      </Text>
                      <div className={s.type}>{t('ops.providers.localSummary', { gpus: p.capacity ? tf(t, `data.provider.${p.id}.capacity.gpus`, p.capacity.gpus) : '' })}</div>
                    </div>
                    <StatusBadge kind={healthKind(p.health)} label={tl(t, 'HEALTH_LABELS', p.health, HEALTH_LABELS[p.health])} />
                  </div>
                  <Text size={200}>
                    {t('ops.providers.localStats', {
                      nodes: p.capacity?.nodes ?? '',
                      util: Math.round((p.capacity?.utilization ?? 0) * 100),
                      queue: p.capacity?.queueDepth ?? '',
                      models: p.capacity?.models.join(t('common.listSeparator')) ?? '',
                    })}
                  </Text>
                  <Text size={200}>
                    {t('ops.providers.localLinks.a')}
                    <Link href="#/clusters">{t('ops.clusters.crumb')}</Link>
                    {t('ops.providers.localLinks.b')}
                    <Link href="#/deployments">{t('ops.deployments.title')}</Link>
                    {t('ops.providers.localLinks.c')}
                    <Link href="#/usage?tab=unit">{t('ops.providers.localLinks.usage')}</Link>
                    {t('ops.providers.localLinks.d')}
                  </Text>
                </section>
              ))}
            {providers
              .filter((p) => !p.local)
              .map((p) => (
                <section key={p.id} className={s.card} aria-labelledby={`prov-${p.id}`} data-tour={`prov-${p.id}`}>
                  <div className={s.head}>
                    <div>
                      <Text weight="semibold" size={400} id={`prov-${p.id}`} as="h3" style={{ margin: 0 }}>
                        {tf(t, `data.provider.${p.id}.name`, p.name)}
                      </Text>
                      <div className={s.type}>{t('ops.providers.typeLabel', { type: tf(t, `data.provider.${p.id}.type`, p.type) })}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', columnGap: 8 }}>
                      <StatusBadge kind={healthKind(p.health)} label={tl(t, 'HEALTH_LABELS', p.health, HEALTH_LABELS[p.health])} />
                      {!p.enabled && <StatusBadge kind="neutral" label={t('common.disabled')} />}
                      <Tooltip content={canConfigure ? t('ops.providers.configureTip') : t('ops.providers.needConfigure')} relationship="description">
                        <Button icon={<SettingsRegular />} appearance="secondary" size="small" onClick={() => setEditing(p)} aria-label={t('ops.providers.configureAria', { name: tf(t, `data.provider.${p.id}.name`, p.name) })}>
                          {t('ops.providers.configure')}
                        </Button>
                      </Tooltip>
                    </div>
                  </div>
                  <Text size={200}>{tf(t, `data.provider.${p.id}.description`, p.description)}</Text>
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th className={s.th} scope="col">
                          {t('ops.models.col.regions')}
                        </th>
                        <th className={s.th} scope="col">
                          {t('ops.providers.th.endpoint')}
                        </th>
                        <th className={s.th} scope="col">
                          {t('ops.providers.th.key')}
                        </th>
                        <th className={s.th} scope="col">
                          RPM / TPM
                        </th>
                        <th className={s.th} scope="col">
                          {t('ops.providers.th.latency')}
                        </th>
                        <th className={s.th} scope="col">
                          {t('ops.models.col.status')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.endpoints.map((e) => (
                        <tr key={e.region} className={e.legacy ? s.legacy : undefined}>
                          <td className={s.td}>
                            <div>{tf(t, `data.region.${e.region}`, e.regionLabel)}</div>
                            <code className={s.mono}>{e.region}</code>
                          </td>
                          <td className={s.td}>
                            <code className={s.mono}>{e.baseUrl}</code>
                            {e.note && <div className={s.type}>{tf(t, `data.provider.${p.id}.endpointNote.${e.region}`, e.note)}</div>}
                          </td>
                          <td className={s.td}>
                            <code className={s.mono}>••••••••</code>
                            <div className={s.type}>KMS: {e.keyRef.split('/').slice(-2).join('/')}</div>
                          </td>
                          <td className={s.td} style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {e.rpmLimit.toLocaleString()} / {e.tpmLimit.toLocaleString()}
                          </td>
                          <td className={s.td} style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {e.latencyMs} ms
                          </td>
                          <td className={s.td}>
                            <StatusBadge kind={healthKind(e.health)} label={tl(t, 'HEALTH_LABELS', e.health, HEALTH_LABELS[e.health])} size="small" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {p.rateLimitNote && <Text size={200}>{tf(t, `data.provider.${p.id}.rateLimitNote`, p.rateLimitNote)}</Text>}
                  {p.hints.length > 0 && (
                    <ul className={s.hints}>
                      {p.hints.map((h, i) => (
                        <li key={h}>{tf(t, `data.provider.${p.id}.hint.${i + 1}`, h)}</li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
          </div>
        )}
      </AsyncView>
      <ProviderDrawer provider={editing} onClose={() => setEditing(null)} onSaved={st.reload} />
      <ConnectProviderDrawer open={connecting} mode="cloud" onClose={() => setConnecting(false)} onConnected={st.reload} />
    </>
  );
}

function ProviderDrawer({ provider, onClose, onSaved }: { provider: ProviderInfo | null; onClose: () => void; onSaved: () => void }) {
  const s = useStyles();
  const t = useT();
  const { session, canUi, bump } = useSession();
  const notify = useNotify();
  const [enabled, setEnabled] = useState(true);
  const [limits, setLimits] = useState<{ region: string; rpmLimit: number; tpmLimit: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState<ApiError | null>(null);
  const canConfigure = canUi('provider.configure', PLATFORM_SCOPE);

  useEffect(() => {
    if (provider) {
      setEnabled(provider.enabled);
      setLimits(provider.endpoints.filter((e) => !e.legacy).map((e) => ({ region: e.region, rpmLimit: e.rpmLimit, tpmLimit: e.tpmLimit })));
      setDenied(null);
    }
  }, [provider]);

  if (!provider) return null;
  const save = async () => {
    setBusy(true);
    try {
      const res = await server.updateProvider(session, provider.id, { enabled, endpoints: limits });
      if (res.ok) {
        notify.success(t('ops.providers.toastUpdated'), `requestId: ${res.requestId}`);
        bump();
        onSaved();
        onClose();
      } else if (res.status === 403) setDenied(res);
      else notify.apiError(res, t('ops.providers.updateAction'));
    } catch (e) {
      notify.apiError(e as Error, t('ops.providers.updateAction'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <OverlayDrawer open position="end" size="medium" onOpenChange={(_, d) => !d.open && onClose()} aria-label={t('ops.providers.drawer.aria', { name: tf(t, `data.provider.${provider.id}.name`, provider.name) })}>
      <DrawerHeader>
        <DrawerHeaderTitle action={<Button appearance="subtle" aria-label={t('common.close')} icon={<DismissRegular />} onClick={onClose} />}>
          {t('ops.providers.drawer.title', { name: tf(t, `data.provider.${provider.id}.name`, provider.name) })}
        </DrawerHeaderTitle>
      </DrawerHeader>
      <DrawerBody>
        <div className={s.form}>
          {!canConfigure && <PermissionDenied inline actionLabel={t('ops.providers.configureTip')} error={denied} />}
          {canConfigure && denied && <PermissionDenied inline error={denied} />}
          <MessageBar intent="info">
            <MessageBarBody>{t('ops.providers.drawer.kmsNote')}</MessageBarBody>
          </MessageBar>
          <Switch label={t('ops.providers.drawer.enable')} checked={enabled} onChange={(_, d) => setEnabled(d.checked)} disabled={!canConfigure} />
          <Text weight="semibold">{t('ops.providers.drawer.limits')}</Text>
          {limits.map((l, i) => (
            <div className={s.row} key={l.region}>
              <Field label={t('ops.models.col.regions')}>
                <Input value={l.region} readOnly />
              </Field>
              <Field label={t('ops.providers.drawer.rpm')}>
                <Input type="number" value={String(l.rpmLimit)} disabled={!canConfigure} onChange={(_, d) => setLimits((ls) => ls.map((x, j) => (j === i ? { ...x, rpmLimit: Number(d.value) || 0 } : x)))} />
              </Field>
              <Field label={t('ops.providers.drawer.tpm')}>
                <Input type="number" value={String(l.tpmLimit)} disabled={!canConfigure} onChange={(_, d) => setLimits((ls) => ls.map((x, j) => (j === i ? { ...x, tpmLimit: Number(d.value) || 0 } : x)))} />
              </Field>
            </div>
          ))}
        </div>
      </DrawerBody>
      <DrawerFooter>
        <Button appearance="primary" onClick={save} disabled={busy || !canConfigure}>
          {busy ? t('ops.providers.drawer.saving') : t('common.save')}
        </Button>
        <Button appearance="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </DrawerFooter>
    </OverlayDrawer>
  );
}
