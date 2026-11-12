import { Button, Dropdown, Field, MessageBar, MessageBarBody, MessageBarTitle, Option, Switch, Text, makeStyles, tokens } from '@fluentui/react-components';
import { BugRegular, SparkleRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { CodeBlock } from '../components/CodeBlock';
import { useSession } from '../app/SessionContext';
import { useTour } from '../components/OnboardingTour';
import { THEME_LABEL_KEYS, useThemeMode, type ThemeMode } from '../theme/ThemeProvider';
import { server, PLATFORM_NOTE } from '../server/api';
import { useNotify } from '../components/Notify';
import { principalLabel, tf, useT } from '../i18n';

const useStyles = makeStyles({
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: tokens.spacingHorizontalM, '@media (max-width: 500px)': { gridTemplateColumns: '1fr' } },
  card: { backgroundColor: tokens.colorNeutralBackground1, borderTopWidth: '1px', borderRightWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px', borderTopStyle: 'solid', borderRightStyle: 'solid', borderBottomStyle: 'solid', borderLeftStyle: 'solid', borderTopColor: tokens.colorNeutralStroke2, borderRightColor: tokens.colorNeutralStroke2, borderBottomColor: tokens.colorNeutralStroke2, borderLeftColor: tokens.colorNeutralStroke2, borderRadius: tokens.borderRadiusLarge, padding: tokens.spacingVerticalL, display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalM, minWidth: 0 },
  title: { fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase400 },
});

export function SettingsPage() {
  const s = useStyles();
  const t = useT();
  const { mode, setMode } = useThemeMode();
  const { session, principal, simulateError, setSimulateError, simulateLocalExhausted, setSimulateLocalExhausted, simulateClusterOutage, setSimulateClusterOutage, bump } = useSession();
  const notify = useNotify();
  const tour = useTour();
  const [result, setResult] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const themeLabel = (m: ThemeMode) => t(THEME_LABEL_KEYS[m]);

  const bypass = async () => {
    setBusy(true);
    setResult('');
    try {
      // 刻意不經任何 UI 權限判斷，直接呼叫 api.ts：伺服器端仍應拒絕非授權者
      const res = await server.createRoleAssignment(session, { principalId: principal?.id ?? '', roleId: 'platform-owner', scope: '/', justification: t('billing.settings.bypass.justification') });
      setResult(JSON.stringify(res, null, 2));
      if (res.ok) notify.pending(t('billing.settings.bypass.acceptedTitle'), t('billing.settings.bypass.acceptedBody', { requestId: res.requestId }));
      else notify.error(t('billing.settings.bypass.rejectedTitle', { status: res.status, code: res.code }), `requestId: ${res.requestId}`);
      bump();
    } catch (e) {
      setResult(String(e));
      notify.apiError(e as Error, t('billing.settings.bypass.errContext'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={t('billing.settings.title')} subtitle={t('billing.settings.subtitle')} crumbs={[{ label: t('billing.settings.title') }]} />
      <div className={s.grid}>
        <section className={s.card} aria-labelledby="set-theme">
          <Text className={s.title} id="set-theme" as="h2">
            {t('billing.settings.appearance.title')}
          </Text>
          <Field label={t('billing.settings.appearance.theme')} hint={t('billing.settings.appearance.themeHint')}>
            <Dropdown value={themeLabel(mode)} selectedOptions={[mode]} onOptionSelect={(_, d) => d.optionValue && setMode(d.optionValue as ThemeMode)}>
              {(Object.keys(THEME_LABEL_KEYS) as ThemeMode[]).map((m) => (
                <Option key={m} value={m}>
                  {themeLabel(m)}
                </Option>
              ))}
            </Dropdown>
          </Field>
          <Field label={t('billing.settings.appearance.language')}>
            <Text size={300}>{t('billing.settings.appearance.languageNote')}</Text>
          </Field>
        </section>
        <section className={s.card} aria-labelledby="set-demo" data-tour="settings-sim">
          <Text className={s.title} id="set-demo" as="h2">
            {t('billing.settings.sim.title')}
          </Text>
          <Switch
            label={t('billing.settings.sim.error')}
            checked={simulateError}
            onChange={(_, d) => {
              setSimulateError(d.checked);
              bump();
            }}
          />
          <Switch
            label={t('billing.settings.sim.exhausted')}
            checked={simulateLocalExhausted}
            onChange={(_, d) => {
              setSimulateLocalExhausted(d.checked);
              bump();
            }}
            data-tour="sim-exhausted"
          />
          <Switch
            label={t('billing.settings.sim.outage')}
            checked={simulateClusterOutage}
            onChange={(_, d) => {
              setSimulateClusterOutage(d.checked);
              bump();
            }}
          />
          <Text size={200}>{t('billing.settings.sim.note')}</Text>
        </section>
        <section className={s.card} aria-labelledby="set-pricing-link" data-tour="settings-billing">
          <Text className={s.title} id="set-pricing-link" as="h2">
            {t('billing.settings.pricing.title')}
          </Text>
          <Text size={200}>{t('billing.settings.pricing.body')}</Text>
          <div>
            <Button appearance="secondary" as="a" href="#/pricing?tab=settings">
              {t('billing.settings.pricing.go')}
            </Button>
          </div>
        </section>
        <section className={s.card} aria-labelledby="set-dataplane" data-tour="settings-dataplane">
          <Text className={s.title} id="set-dataplane" as="h2">
            {t('billing.settings.dataplane.title')}
          </Text>
          <Text size={200}>
            {t('billing.settings.dataplane.before')}<strong>{t('billing.settings.dataplane.policyPack')}</strong>{t('billing.settings.dataplane.middle')}<code>x-maas-tier</code>{t('billing.settings.dataplane.tierValues')}<code>x-maas-deployment</code>{t('common.listSeparator')}<code>x-maas-sharing</code>{t('common.listSeparator')}<code>x-maas-spillover-from</code>{t('billing.settings.dataplane.after')}
          </Text>
        </section>
        <section className={s.card} aria-labelledby="set-tour">
          <Text className={s.title} id="set-tour" as="h2">
            {t('billing.settings.tour.title')}
          </Text>
          <Text size={200}>{t('billing.settings.tour.body')}{tour.hasCompleted ? t('billing.settings.tour.completed') : t('billing.settings.tour.notCompleted')}</Text>
          <div>
            <Button appearance="secondary" icon={<SparkleRegular />} onClick={() => tour.start()}>
              {t('billing.settings.tour.replay')}
            </Button>
            <Button appearance="subtle" as="a" href="#/guides">
              {t('billing.settings.tour.allGuides')}
            </Button>
          </div>
        </section>
        <section className={s.card} aria-labelledby="set-bypass" style={{ gridColumn: '1 / -1' }}>
          <Text className={s.title} id="set-bypass" as="h2">
            {t('billing.settings.bypass.title')}
          </Text>
          <MessageBar intent="warning">
            <MessageBarBody>
              <MessageBarTitle>{t('billing.settings.bypass.warnTitle')}</MessageBarTitle>
              {t('billing.settings.bypass.warnBefore')}<code>api.createRoleAssignment()</code>{t('billing.settings.bypass.warnAfter', { name: principalLabel(t, principal?.id, principal?.displayName) })}
            </MessageBarBody>
          </MessageBar>
          <div>
            <Button appearance="primary" icon={<BugRegular />} onClick={bypass} disabled={busy}>
              {busy ? t('billing.settings.bypass.calling') : t('billing.settings.bypass.button')}
            </Button>
          </div>
          {result && <CodeBlock code={result} label={t('billing.settings.bypass.resultLabel')} />}
        </section>
        <section className={s.card} aria-labelledby="set-about" style={{ gridColumn: '1 / -1' }}>
          <Text className={s.title} id="set-about" as="h2">
            {t('billing.settings.about.title')}
          </Text>
          <Text size={300}>{t('billing.settings.about.p1')}</Text>
          <Text size={300}>
            {t('billing.settings.about.p2Before')}<strong>{t('billing.settings.about.p2Strong')}</strong>{t('billing.settings.about.p2After')}
          </Text>
          <Text size={300}>{tf(t, 'billing.settings.about.platformNote', PLATFORM_NOTE)}</Text>
          <Text size={300}>
            {t('billing.settings.about.p4Before')}<code>src/server/</code>{t('billing.settings.about.p4After')}
          </Text>
        </section>
      </div>
    </>
  );
}
