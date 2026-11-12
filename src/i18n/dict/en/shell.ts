import type { Dict } from '../../types';

const dict: Dict = {
  // Navigation
  'nav.group.customer': 'Customer portal',
  'nav.group.vendor': 'Platform operations',
  'nav.group.account': 'Account & team',
  'nav.group.help': 'Help',
  'nav.hub': 'Model hub',
  'nav.playground': 'Playground',
  'nav.keys': 'API keys',
  'nav.usage': 'Usage & billing',
  'nav.plan': 'Trial & plan',
  'nav.overview': 'Overview',
  'nav.trials': 'Trial requests',
  'nav.tenants': 'Tenants & projects',
  'nav.models': 'Models & deployments',
  'nav.clusters': 'Inference clusters',
  'nav.providers': 'Cloud & partner providers',
  'nav.routing': 'Routing & spillover',
  'nav.pricing': 'Pricing & billing',
  'nav.iam': 'Access control (IAM)',
  'nav.audit': 'Audit log',
  'nav.settings': 'Settings',
  'nav.guides': 'Guides',
  'shell.nav.aria': 'Main navigation',
  'shell.nav.expand': 'Expand navigation',
  'shell.nav.collapse': 'Collapse navigation',
  'shell.nav.deniedTooltip': '{label} (no permission)',

  // Header
  'shell.brand': 'MaaS Console',
  'shell.docTitle': 'MaaS Console (Demo)',
  'shell.tenant.aria': 'Tenant selector',
  'shell.tenant.all': 'All tenants',
  'shell.search.placeholder': 'Search models, keys, principals… (Enter)',
  'shell.search.aria': 'Global search',
  'shell.notifications.tooltip': 'Notifications (demo: nothing new)',
  'shell.notifications.aria': 'Notifications',
  'shell.help': 'Help: replay the onboarding tour',
  'shell.theme.tooltip': 'Theme: {mode}',
  'shell.theme.aria': 'Change theme',
  'shell.theme.light': 'Light',
  'shell.theme.dark': 'Dark',
  'shell.theme.hc': 'High contrast',
  'shell.lang.label': 'Language: {lang}',
  'shell.lang.menu': 'Display language',
  'shell.persona.label': 'Demo persona',
  'shell.persona.current': 'Switch demo persona (current: {name})',
  'shell.persona.menu': 'Demo personas',
  'shell.user.tooltip': '{name} ({email})',
  'shell.user.aria': 'Signed in as {name}',
  'shell.user.notSignedIn': 'not signed in',
  'shell.balance.prepaid': 'Balance {amount}',
  'shell.balance.postpaid': 'Invoiced · {tier}',
  'shell.balance.prepaidTip': '{tenant}: available prepaid credits (ledger − this month’s usage){low}. Click to top up in Trial & plan.',
  'shell.balance.lowSuffix': ', running low',
  'shell.balance.postpaidTip': '{tenant}: invoiced contract, paid per statement. Click to open Trial & plan.',
  'shell.footer':
    'This is a custom demo application that borrows Azure RBAC concepts and the Microsoft Fluent 2 design language. It is not the official Azure Portal and does not manage any real Azure resources. All tenants, datacenters, GPU metrics, prices, costs, balances and usage are fictitious demo data. “Inference clusters” are our own (the platform provider’s) GPU datacenters; customers use self-hosted and proxied models through one key and one API, and we bill them. Not affiliated with GMI Cloud, Inferel, Alibaba Cloud Model Studio or any model provider.',

  // Page header
  'shell.breadcrumb.aria': 'Breadcrumb',

  // Tour engine
  'shell.tour.stepOf': 'Step {n} of {total}',
  'shell.tour.start': 'Start tour',
  'shell.tour.skipStep': 'Skip this step',
  'shell.tour.hintDefault': 'Go ahead and do it on screen — the tour moves on automatically when you’re done.',

  // State components
  'shell.state.loadError.title': 'Couldn’t load data',
  'shell.state.loadError.body': '{msg}. Check your connection and try again. If the problem persists, contact platform operations with the time it happened.',
  'shell.denied.title': 'Permission denied (403)',
  'shell.denied.cannotAction': 'Your current role can’t perform “{action}”.',
  'shell.denied.cannot': 'Your current role can’t perform this action.',
  'shell.denied.body': 'The server rejected this request and recorded it in the audit log. If you need this permission, ',
  'shell.denied.request': 'request it from an access admin',
  'shell.denied.end': '.',
  'shell.notFound.title': '{what} not found (404)',
  'shell.notFound.body': 'The requested {what} doesn’t exist, or you don’t have permission to view it.',
  'shell.notFound.page': 'Page',
  'shell.notFound.resource': 'Resource',

  // Notifications
  'shell.notify.failed': 'Operation failed',
  'shell.notify.failedWith': '{context} failed',
  'shell.notify.failedStatus': '{title} ({status} {code})',

  // Error pages
  'shell.error.forbiddenTitle': 'Permission denied',
  'shell.error.notFoundTitle': 'Page not found',
};

export default dict;
