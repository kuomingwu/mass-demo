import {
  Avatar,
  Badge,
  Button,
  Dropdown,
  Menu,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Option,
  SearchBox,
  Text,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  AlertRegular,
  AppsListRegular,
  BookRegular,
  ArrowRoutingRegular,
  BuildingMultipleRegular,
  ChatRegular,
  CloudRegular,
  DataUsageRegular,
  DocumentBulletListRegular,
  HomeRegular,
  KeyRegular,
  LocalLanguageRegular,
  MoneyRegular,
  NavigationRegular,
  PersonLockRegular,
  PersonSwapRegular,
  QuestionCircleRegular,
  RocketRegular,
  ServerRegular,
  SettingsRegular,
  StoreMicrosoftRegular,
  WalletCreditCardRegular,
  WeatherMoonRegular,
  WeatherSunnyRegular,
} from '@fluentui/react-icons';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from './SessionContext';
import { THEME_LABEL_KEYS, useThemeMode, type ThemeMode } from '../theme/ThemeProvider';
import { LOCALES, LOCALE_NATIVE_NAMES, principalLabel, setLocale, tenantLabel as tenantText, tf, useT, type Locale } from '../i18n';
import { PERSONAS, TENANTS, USERS } from '../server/seed';
import type { Action } from '../auth/types';
import { TourProvider, useTour } from '../components/OnboardingTour';
import { server } from '../server/api';
import { useApi } from '../hooks/useApi';
import { tenantScope, PLATFORM_SCOPE } from '../auth/scope';
import { formatUsd } from '../theme/chartPalette';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: tokens.colorNeutralBackground2 },
  header: {
    height: '48px',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalS,
    padding: `0 ${tokens.spacingHorizontalM}`,
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    boxShadow: tokens.shadow4,
    zIndex: 10,
    /* ≤ 600 px：縮小間距，讓語言、主題、角色與頭像都放得下（390 px 不水平溢出） */
    '@media (max-width: 600px)': { columnGap: tokens.spacingHorizontalXS, padding: `0 ${tokens.spacingHorizontalS}` },
  },
  brand: { fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase400, whiteSpace: 'nowrap', color: tokens.colorNeutralForegroundOnBrand, textDecoration: 'none', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
  headerBtn: { flexShrink: 0, color: tokens.colorNeutralForegroundOnBrand, ':hover': { color: tokens.colorNeutralForegroundOnBrand, backgroundColor: 'rgba(255,255,255,0.12)' } },
  balanceBtn: { color: tokens.colorNeutralForegroundOnBrand, backgroundColor: 'rgba(255,255,255,0.14)', whiteSpace: 'nowrap', ':hover': { color: tokens.colorNeutralForegroundOnBrand, backgroundColor: 'rgba(255,255,255,0.24)' }, '@media (max-width: 600px)': { display: 'none' } },
  balanceLow: { backgroundColor: tokens.colorPaletteDarkOrangeBackground3, ':hover': { backgroundColor: tokens.colorPaletteDarkOrangeBackground3 } },
  search: { flexGrow: 1, maxWidth: '420px', minWidth: '120px', '@media (max-width: 900px)': { display: 'none' } },
  tenantSel: { minWidth: '160px', '@media (max-width: 1100px)': { display: 'none' } },
  persona: { display: 'flex', alignItems: 'center', columnGap: tokens.spacingHorizontalXS, minWidth: 0 },
  personaLabel: { fontSize: tokens.fontSizeBase200, whiteSpace: 'nowrap', '@media (max-width: 1200px)': { display: 'none' } },
  /** ≤ 600 px：角色下拉改成圖示按鈕＋選單，避免 170 px 的下拉＋頭像把標頭撐出視窗 */
  personaDropdown: { minWidth: '170px', '@media (max-width: 600px)': { display: 'none' } },
  personaMenuBtn: { display: 'none', '@media (max-width: 600px)': { display: 'inline-flex' } },
  /** 非必要的標頭項目在窄螢幕隱藏 */
  hideNarrow: { '@media (max-width: 600px)': { display: 'none' } },
  spacer: { flexGrow: 1 },
  avatar: { flexShrink: 0 },
  body: { display: 'flex', flexGrow: 1, minHeight: 0 },
  nav: {
    width: '240px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    rowGap: '2px',
    padding: tokens.spacingVerticalS,
    backgroundColor: tokens.colorNeutralBackground1,
    borderRightWidth: '1px',
    borderRightStyle: 'solid',
    borderRightColor: tokens.colorNeutralStroke2,
    overflowY: 'auto',
    transitionProperty: 'width',
    transitionDuration: tokens.durationNormal,
  },
  navCollapsed: { width: '56px' },
  navHidden: { display: 'none' },
  navGroupTitle: {
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'none',
    letterSpacing: '0.02em',
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalS} ${tokens.spacingVerticalXS}`,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
  navGroupRule: { height: '1px', backgroundColor: tokens.colorNeutralStroke2, margin: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}` },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusMedium,
    color: tokens.colorNeutralForeground1,
    textDecoration: 'none',
    fontSize: tokens.fontSizeBase300,
    minHeight: '36px',
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
    ':focus-visible': { outline: `2px solid ${tokens.colorStrokeFocus2}`, outlineOffset: '1px' },
  },
  navActive: {
    backgroundColor: tokens.colorNeutralBackground1Selected,
    fontWeight: tokens.fontWeightSemibold,
    position: 'relative',
    '::before': {
      content: '""',
      position: 'absolute',
      left: 0,
      top: '8px',
      bottom: '8px',
      width: '3px',
      borderRadius: '2px',
      backgroundColor: tokens.colorBrandForeground1,
    },
  },
  navIcon: { fontSize: '20px', flexShrink: 0 },
  navLabel: { whiteSpace: 'nowrap', overflow: 'hidden' },
  navDenied: { color: tokens.colorNeutralForeground4 },
  navBottom: { marginTop: 'auto' },
  main: { flexGrow: 1, minWidth: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' },
  content: { padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalXXL}`, flexGrow: 1, '@media (max-width: 700px)': { padding: tokens.spacingVerticalM } },
  footer: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalXXL}`,
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: tokens.colorNeutralStroke2,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  demoBadge: { marginLeft: tokens.spacingHorizontalXS, '@media (max-width: 420px)': { display: 'none' } },
});

interface NavItem {
  to: string;
  /** 字典鍵（nav.*） */
  labelKey: string;
  icon: ReactElement;
  /** 可用性提示：缺少此動作時以淡色標示（仍可進入，頁面會顯示 403） */
  action?: Action;
  /** 動作要在平台範圍檢查（例如定價與帳務需平台範圍 billing.read） */
  platformScope?: boolean;
  /** 額外視為「作用中」的路徑前綴（例如 /deployments 屬於「模型與部署」） */
  match?: string[];
  /** 缺少動作時整個隱藏（平台層資源，客戶不應看到） */
  hideIfDenied?: boolean;
}

interface NavGroup {
  id: string;
  /** 群組標題（省略 ＝ 無標題，例如底部的操作指引） */
  titleKey?: string;
  /** 只給我們的角色（平台層主體） */
  vendorOnly?: boolean;
  /** 只給客戶角色 */
  customerOnly?: boolean;
  items: NavItem[];
}

/**
 * 資訊架構（One API token 事業）：
 * - 客戶入口（所有角色）：模型中心 → Playground → API 金鑰 → 用量與帳單 → 試用與方案
 * - 平台營運（只有我們的角色看得到）：總覽、試用申請、租戶與專案、模型與部署、推論叢集、雲端與夥伴供應商、路由與溢出、定價與帳務、存取控制、稽核、設定
 * - 帳戶與團隊（客戶角色）：存取控制（自己租戶的角色指派）、稽核紀錄、設定
 * - 操作指引（所有角色，底部）
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'customer',
    titleKey: 'nav.group.customer',
    items: [
      { to: '/hub', labelKey: 'nav.hub', icon: <StoreMicrosoftRegular /> },
      { to: '/playground', labelKey: 'nav.playground', icon: <ChatRegular />, action: 'playground.invoke' },
      { to: '/keys', labelKey: 'nav.keys', icon: <KeyRegular />, action: 'key.read' },
      { to: '/usage', labelKey: 'nav.usage', icon: <DataUsageRegular />, action: 'usage.read' },
      { to: '/plan', labelKey: 'nav.plan', icon: <WalletCreditCardRegular />, action: 'billing.read' },
    ],
  },
  {
    id: 'vendor',
    titleKey: 'nav.group.vendor',
    vendorOnly: true,
    items: [
      { to: '/', labelKey: 'nav.overview', icon: <HomeRegular /> },
      { to: '/trials', labelKey: 'nav.trials', icon: <RocketRegular />, action: 'trial.review', platformScope: true },
      { to: '/tenants', labelKey: 'nav.tenants', icon: <BuildingMultipleRegular />, action: 'tenant.read' },
      { to: '/models', labelKey: 'nav.models', icon: <AppsListRegular />, action: 'model.read', match: ['/deployments'] },
      { to: '/clusters', labelKey: 'nav.clusters', icon: <ServerRegular />, action: 'cluster.read', hideIfDenied: true },
      { to: '/providers', labelKey: 'nav.providers', icon: <CloudRegular />, action: 'provider.read' },
      { to: '/routing', labelKey: 'nav.routing', icon: <ArrowRoutingRegular />, action: 'model.read' },
      { to: '/pricing', labelKey: 'nav.pricing', icon: <MoneyRegular />, action: 'billing.read', platformScope: true },
      { to: '/iam', labelKey: 'nav.iam', icon: <PersonLockRegular />, action: 'iam.read' },
      { to: '/audit', labelKey: 'nav.audit', icon: <DocumentBulletListRegular />, action: 'audit.read' },
      { to: '/settings', labelKey: 'nav.settings', icon: <SettingsRegular /> },
    ],
  },
  {
    id: 'account',
    titleKey: 'nav.group.account',
    customerOnly: true,
    items: [
      { to: '/iam', labelKey: 'nav.iam', icon: <PersonLockRegular />, action: 'iam.read' },
      { to: '/audit', labelKey: 'nav.audit', icon: <DocumentBulletListRegular />, action: 'audit.read' },
      { to: '/settings', labelKey: 'nav.settings', icon: <SettingsRegular /> },
    ],
  },
  {
    id: 'help',
    items: [{ to: '/guides', labelKey: 'nav.guides', icon: <BookRegular /> }],
  },
];

/** 切換示範角色後的落地頁：我們的角色 → 總覽；客戶 → 模型中心 */
export function landingFor(personaId: string): string {
  const persona = PERSONAS.find((p) => p.id === personaId);
  const user = persona ? USERS.find((u) => u.id === persona.userId) : undefined;
  return user && user.tenantId === null ? '/' : '/hub';
}

export function AppShell() {
  return (
    <TourProvider>
      <ShellInner />
    </TourProvider>
  );
}

/** 標頭餘額（客戶角色）：預付 → 「餘額 US$…」（低餘額橘色）；月結 → 「月結 · Tier 4」；點擊前往試用與方案 */
function HeaderBalance() {
  const s = useStyles();
  const t = useT();
  const navigate = useNavigate();
  const { session, principal, canUi } = useSession();
  const tenantId = principal?.tenantId ?? null;
  const allowed = !!tenantId && canUi('billing.read', tenantScope(tenantId));
  const st = useApi(() => (tenantId && allowed ? server.getTenantAccount(session, tenantId) : Promise.resolve({ ok: false as const, status: 403 as const, code: 'FORBIDDEN', message: '', requestId: '-' })), [session, tenantId, allowed]);
  if (!tenantId || !allowed || !st.data) return null;
  const a = st.data;
  const label = a.credits ? t('shell.balance.prepaid', { amount: formatUsd(a.credits.availableUsd, a.credits.availableUsd < 100 ? 2 : 0) }) : t('shell.balance.postpaid', { tier: a.tier.current.name });
  const low = !!a.credits?.lowBalance;
  return (
    <Tooltip content={a.credits ? t('shell.balance.prepaidTip', { tenant: tenantText(t, a.tenantId, a.tenantName), low: low ? t('shell.balance.lowSuffix') : '' }) : t('shell.balance.postpaidTip', { tenant: tenantText(t, a.tenantId, a.tenantName) })} relationship="description">
      <Button appearance="transparent" size="small" className={mergeClasses(s.balanceBtn, low && s.balanceLow)} icon={<WalletCreditCardRegular />} onClick={() => navigate('/plan')} data-tour="header-balance" aria-label={label}>
        {label}
      </Button>
    </Tooltip>
  );
}

/** 語言切換：地球圖示 → 選單（繁體中文／English／日本語）；選取後所有元件立即重繪 */
function LanguageSwitcher() {
  const s = useStyles();
  const t = useT();
  const locale = t.locale;
  const label = t('shell.lang.label', { lang: LOCALE_NATIVE_NAMES[locale] });
  return (
    <Menu checkedValues={{ lang: [locale] }} onCheckedValueChange={(_, d) => d.checkedItems[0] && setLocale(d.checkedItems[0] as Locale)}>
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content={label} relationship="label">
          <Button data-tour="lang-switch" appearance="transparent" className={s.headerBtn} icon={<LocalLanguageRegular />} aria-label={label} />
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList aria-label={t('shell.lang.menu')}>
          {LOCALES.map((l) => (
            <MenuItemRadio key={l} name="lang" value={l} lang={l === 'zh-TW' ? 'zh-Hant-TW' : l}>
              {LOCALE_NATIVE_NAMES[l]}
            </MenuItemRadio>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

function ShellInner() {
  const s = useStyles();
  const t = useT();
  const tour = useTour();
  const { personaId, setPersona, principal, canUi, canUiAnywhere, tenantId, setTenantId } = useSession();
  const { mode, setMode } = useThemeMode();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 1024);
  const [hidden, setHidden] = useState(() => window.innerWidth < 700);

  useEffect(() => {
    const onResize = () => {
      setCollapsed(window.innerWidth < 1024);
      setHidden(window.innerWidth < 700);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (window.innerWidth < 700) setHidden(true);
  }, [location.pathname]);

  const persona = PERSONAS.find((p) => p.id === personaId) ?? PERSONAS[0];
  const personaLabel = (p: (typeof PERSONAS)[number]) => tf(t, `server.persona.${p.id}.label`, p.label);
  const personaDescription = (p: (typeof PERSONAS)[number]) => tf(t, `server.persona.${p.id}.description`, p.description);
  const currentPersonaLabel = personaLabel(persona);
  const isVendor = principal?.tenantId === null;
  const tenantOptions = useMemo(() => TENANTS.filter((tn) => !principal?.tenantId || tn.id === principal.tenantId), [principal]);
  const tenantLabel = tenantId ? tenantText(t, tenantId, TENANTS.find((tn) => tn.id === tenantId)?.name ?? tenantId) : t('shell.tenant.all');
  const navToggleLabel = hidden || collapsed ? t('shell.nav.expand') : t('shell.nav.collapse');
  const personaCurrent = t('shell.persona.current', { name: currentPersonaLabel });

  /** 切換示範角色：同時導向該角色的落地頁（客戶 → 模型中心、我們 → 總覽） */
  const switchPersona = (id: string) => {
    setPersona(id);
    navigate(landingFor(id));
  };

  const allowed = (item: NavItem) => (item.action ? (item.platformScope ? canUi(item.action, PLATFORM_SCOPE) : canUiAnywhere(item.action)) : true);
  const groups = NAV_GROUPS.filter((g) => (g.vendorOnly ? isVendor : true) && (g.customerOnly ? !isVendor : true));

  return (
    <div className={s.root}>
      <header className={s.header} role="banner">
        <Tooltip content={navToggleLabel} relationship="label">
          <Button
            appearance="transparent"
            className={s.headerBtn}
            icon={<NavigationRegular />}
            aria-label={navToggleLabel}
            aria-expanded={!(hidden || collapsed)}
            onClick={() => {
              if (window.innerWidth < 700) setHidden((h) => !h);
              else setCollapsed((c) => !c);
            }}
          />
        </Tooltip>
        <a href={isVendor ? '#/' : '#/hub'} className={s.brand}>
          {t('shell.brand')}
          <Badge appearance="outline" size="small" className={s.demoBadge} style={{ color: 'inherit', borderColor: 'currentColor' }}>
            {t('common.demo')}
          </Badge>
        </a>
        <Dropdown
          data-tour="tenant"
          className={s.tenantSel}
          size="small"
          aria-label={t('shell.tenant.aria')}
          value={tenantLabel}
          selectedOptions={[tenantId ?? '*']}
          onOptionSelect={(_, d) => setTenantId(d.optionValue === '*' ? null : (d.optionValue ?? null))}
        >
          {!principal?.tenantId && <Option value="*">{t('shell.tenant.all')}</Option>}
          {tenantOptions.map((tn) => (
            <Option key={tn.id} value={tn.id}>
              {tenantText(t, tn.id, tn.name)}
            </Option>
          ))}
        </Dropdown>
        <SearchBox
          className={s.search}
          size="small"
          placeholder={t('shell.search.placeholder')}
          aria-label={t('shell.search.aria')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const q = (e.target as HTMLInputElement).value.trim();
              if (q) navigate(`${isVendor ? '/models' : '/hub'}?q=${encodeURIComponent(q)}`);
            }
          }}
        />
        <div className={s.spacer} />
        {!isVendor && <HeaderBalance />}
        <Tooltip content={t('shell.notifications.tooltip')} relationship="label">
          <Button appearance="transparent" className={mergeClasses(s.headerBtn, s.hideNarrow)} icon={<AlertRegular />} aria-label={t('shell.notifications.aria')} />
        </Tooltip>
        <Tooltip content={t('shell.help')} relationship="label">
          <Button data-tour="help" appearance="transparent" className={s.headerBtn} icon={<QuestionCircleRegular />} aria-label={t('shell.help')} onClick={() => tour.start()} />
        </Tooltip>
        <LanguageSwitcher />
        <Menu checkedValues={{ theme: [mode] }} onCheckedValueChange={(_, d) => setMode(d.checkedItems[0] as ThemeMode)}>
          <MenuTrigger disableButtonEnhancement>
            <Tooltip content={t('shell.theme.tooltip', { mode: t(THEME_LABEL_KEYS[mode]) })} relationship="label">
              <Button appearance="transparent" className={s.headerBtn} icon={mode === 'light' ? <WeatherSunnyRegular /> : <WeatherMoonRegular />} aria-label={t('shell.theme.aria')} />
            </Tooltip>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              {(Object.keys(THEME_LABEL_KEYS) as ThemeMode[]).map((m) => (
                <MenuItemRadio key={m} name="theme" value={m}>
                  {t(THEME_LABEL_KEYS[m])}
                </MenuItemRadio>
              ))}
            </MenuList>
          </MenuPopover>
        </Menu>
        <div className={s.persona} data-tour="persona">
          <Text className={s.personaLabel} id="persona-label">
            {t('shell.persona.label')}
          </Text>
          <Dropdown size="small" className={s.personaDropdown} aria-labelledby="persona-label" aria-label={t('shell.persona.label')} value={currentPersonaLabel} selectedOptions={[persona.id]} onOptionSelect={(_, d) => d.optionValue && switchPersona(d.optionValue)}>
            {PERSONAS.map((p) => (
              <Option key={p.id} value={p.id} text={personaLabel(p)}>
                {personaLabel(p)} — {personaDescription(p)}
              </Option>
            ))}
          </Dropdown>
          <Menu checkedValues={{ persona: [persona.id] }} onCheckedValueChange={(_, d) => d.checkedItems[0] && switchPersona(d.checkedItems[0])}>
            <MenuTrigger disableButtonEnhancement>
              <Tooltip content={personaCurrent} relationship="label">
                <Button appearance="transparent" className={mergeClasses(s.headerBtn, s.personaMenuBtn)} icon={<PersonSwapRegular />} aria-label={personaCurrent} />
              </Tooltip>
            </MenuTrigger>
            <MenuPopover>
              <MenuList aria-label={t('shell.persona.menu')}>
                {PERSONAS.map((p) => (
                  <MenuItemRadio key={p.id} name="persona" value={p.id}>
                    {personaLabel(p)}
                  </MenuItemRadio>
                ))}
              </MenuList>
            </MenuPopover>
          </Menu>
        </div>
        <Tooltip content={t('shell.user.tooltip', { name: principalLabel(t, principal?.id, principal?.displayName), email: principal?.email ?? '—' })} relationship="description">
          <Avatar className={s.avatar} name={principal ? principalLabel(t, principal.id, principal.displayName) : '?'} size={28} color="colorful" aria-label={t('shell.user.aria', { name: principal ? principalLabel(t, principal.id, principal.displayName) : t('shell.user.notSignedIn') })} />
        </Tooltip>
      </header>
      <div className={s.body}>
        <nav className={mergeClasses(s.nav, collapsed && s.navCollapsed, hidden && s.navHidden)} aria-label={t('shell.nav.aria')} data-tour="nav">
          {groups.map((g, gi) => {
            const items = g.items.filter((item) => !(item.hideIfDenied && !allowed(item)));
            if (items.length === 0) return null;
            const title = g.titleKey ? t(g.titleKey) : undefined;
            return (
              <div key={g.id} role="group" aria-label={title ?? t('nav.group.help')} data-tour={`nav-group-${g.id}`} className={g.id === 'help' ? s.navBottom : undefined}>
                {title && !collapsed ? <div className={s.navGroupTitle}>{title}</div> : gi > 0 ? <div className={s.navGroupRule} aria-hidden /> : null}
                {items.map((item) => {
                  const denied = !allowed(item);
                  const label = t(item.labelKey);
                  const extraActive = item.match?.some((m) => location.pathname === m || location.pathname.startsWith(m + '/')) ?? false;
                  const link = (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/'}
                      className={({ isActive }) => mergeClasses(s.navItem, (isActive || extraActive) && s.navActive, denied && s.navDenied)}
                      aria-label={collapsed ? label : undefined}
                      data-tour={`nav-${item.to === '/' ? 'home' : item.to.slice(1)}`}
                    >
                      <span className={s.navIcon} aria-hidden>
                        {item.icon}
                      </span>
                      {!collapsed && <span className={s.navLabel}>{label}</span>}
                      {!collapsed && denied && (
                        <Badge size="small" appearance="outline" color="subtle" style={{ marginLeft: 'auto' }}>
                          {t('common.noPermission')}
                        </Badge>
                      )}
                    </NavLink>
                  );
                  return collapsed ? (
                    <Tooltip key={item.to} content={denied ? t('shell.nav.deniedTooltip', { label }) : label} relationship="label" positioning="after">
                      {link}
                    </Tooltip>
                  ) : (
                    link
                  );
                })}
              </div>
            );
          })}
        </nav>
        <main className={s.main} id="main">
          <div className={s.content}>
            <Outlet />
          </div>
          <footer className={s.footer}>{t('shell.footer')}</footer>
        </main>
      </div>
    </div>
  );
}
