import type { Dict } from '../../types';

// Copy used only by the two portals (customer portal / admin portal): brand, nav group, and per-portal guide steps
const dict: Dict = {
  'shell.brand.admin': 'MaaS Admin',
  'shell.docTitle.admin': 'MaaS Admin (Demo)',
  'nav.group.tenantTools': 'Tenant support tools',

  // Welcome tour of the customer portal
  'guides.welcome-customer.title': 'Welcome to the MaaS customer portal',
  'guides.welcome-customer.summary': 'A two-minute tour of the customer portal: Model hub, Playground, API keys, Usage & billing, Trial & plan.',
  'guides.welcome-customer.pages.0.label': 'Model hub',
  'guides.welcome-customer.step.welcome.title': 'Welcome: one key, every leading model',
  'guides.welcome-customer.step.welcome.body': 'One sk-maas- key and one OpenAI-compatible base URL reach every model here. Open-weight models run on GPUs in our Taiwan data centers. Closed models such as GPT, Claude and Gemini are proxied by us and billed on the same invoice.\nAll data is fictional demo data. Press "Skip" at any time.',
  'guides.welcome-customer.step.persona.title': 'Demo persona switcher',
  'guides.welcome-customer.step.persona.body': 'This portal lets you try different customer roles, for example customer admin, operator, viewer, auditor, billing, public-sector admin and trial customer. Each role sees different features and permissions.',
  'guides.welcome-customer.step.nav-hub.title': 'Start at the Model hub',
  'guides.welcome-customer.step.nav-hub.body': 'The Model hub lists every available model with its price and origin. Filter by modality and source, or request a trial from here.',
  'guides.welcome-customer.step.nav-playground.title': 'Playground',
  'guides.welcome-customer.step.nav-playground.body': 'Try a model without writing code. Next to each reply you see the tokens used, the cost and the equivalent curl command.',
  'guides.welcome-customer.step.nav-keys.title': 'API keys',
  'guides.welcome-customer.step.nav-keys.body': 'Create keys for your applications. A key is shown once, and can carry an expiry date, an allowed model list and a budget cap.',
  'guides.welcome-customer.step.nav-usage.title': 'Usage & billing',
  'guides.welcome-customer.step.nav-usage.body': 'See daily usage, spend per model and this month’s statement, and export it as CSV.',
  'guides.welcome-customer.step.nav-plan.title': 'Trial & plan',
  'guides.welcome-customer.step.nav-plan.body': 'Check your prepaid balance, rate-limit tier and plan details, and top up here.',
  'guides.welcome-customer.step.nav-guides.title': 'Guides',
  'guides.welcome-customer.step.nav-guides.body': 'Each guide walks you through a real task step by step, such as going from the Model hub to your first API call, or creating and testing a key.',
  'guides.welcome-customer.step.help.title': 'Replay any time',
  'guides.welcome-customer.step.help.body': 'Use "Help" in the top right corner or the Guides page to reopen any guide.',
  'guides.welcome-customer.step.done.title': 'Tour complete',
  'guides.welcome-customer.step.done.body': 'A good next step is the guide "From the Model hub to your first API call".',

  // Admin-portal variants of the welcome tour steps
  'guides.welcome.step.persona-admin.title': 'Demo persona switcher',
  'guides.welcome.step.persona-admin.body': 'The admin portal lets you switch between our own three roles: Platform Owner (trial review, tenants, pricing, access approval), Platform Operations (data centers and deployments) and Platform Finance (pricing and billing). What customers see lives on a separate site, the customer portal.',
  'guides.welcome.step.nav-guides-admin.title': 'Guides',
  'guides.welcome.step.nav-guides-admin.body': 'Every guide here covers platform operations work: connect your own GPU, register a cluster, deploy a model, onboard a tenant, connect a provider, routing and spillover, billing, and trial review.',
  'guides.welcome.step.done-admin.title': 'Tour complete',
  'guides.welcome.step.done-admin.body': 'Good next steps are the guides "Connect your own GPU" and "Register a cluster". To see the customer experience, open the customer portal.',

  // Trial request: each portal gets its own half
  'guides.trial-request.step.intro-admin.title': 'Review a trial request',
  'guides.trial-request.step.intro-admin.body': 'When a customer submits the testing questionnaire in the customer portal, the request lands in this queue. This guide walks you through reviewing one request and opening a trial tenant.',
  'guides.trial-request.step.queue-admin.hint': 'Select the row that is pending review.',
  'guides.trial-request.step.queue-admin.title': 'Trial request queue',
  'guides.trial-request.step.queue-admin.body': 'Each row is one testing questionnaire submitted by a customer: company and test account, contact, models to test, local requirements and status. Open the one that is pending review.',
  'guides.trial-request.step.done-admin.title': 'Done',
  'guides.trial-request.step.done-admin.body': 'You reviewed a trial request and the system created a prepaid trial tenant. The customer side of this flow is "Request a trial" in the customer portal.',
  'guides.trial-request.step.done-dialog-customer.title': 'Request received',
  'guides.trial-request.step.done-dialog-customer.body': 'You get a request number only. No account or key is created yet. The page returns to the Model hub after a few seconds.',
  'guides.trial-request.step.done-customer.title': 'Done',
  'guides.trial-request.step.done-customer.body': 'Your request is in. Once our team approves it, we open a trial account and notify you. During the trial, your balance and expiry date are under "Trial & plan".',
};

export default dict;
