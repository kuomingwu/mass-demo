/**
 * Which site this build is: the customer portal, the admin portal, or the combined console (development and tests).
 * Same code base, two production builds:
 *   vite build --mode customer  -> dist-customer  (VITE_PORTAL=customer)
 *   vite build --mode admin     -> dist-admin     (VITE_PORTAL=admin)
 * The portal decides routes, navigation, the demo persona list and the guides. It is a packaging boundary, not the
 * security boundary: every server call is still authorized per principal (see src/auth).
 */
export type Portal = 'customer' | 'admin' | 'all';

function fromEnv(): Portal {
  const v = import.meta.env.VITE_PORTAL as string | undefined;
  return v === 'customer' || v === 'admin' ? v : 'all';
}

let current: Portal = fromEnv();

export function getPortal(): Portal {
  return current;
}

/** Tests only: switch the portal before mounting the app. */
export function setPortal(p: Portal) {
  current = p;
}

/** Customer-facing pages that do not exist in the admin portal. */
const CUSTOMER_ONLY = ['/hub', '/plan'];
/** Platform-operations pages that do not exist in the customer portal. */
const ADMIN_ONLY = ['/trials', '/tenants', '/models', '/deployments', '/clusters', '/local-gpu', '/providers', '/routing', '/pricing'];

const under = (path: string, list: string[]) => list.some((p) => path === p || path.startsWith(p + '/'));

/** Does this portal serve the route? (accepts '/hub?tab=faq' and '#/hub') */
export function portalHasRoute(route: string, portal: Portal = current): boolean {
  const path = route.replace(/^#/, '').split('?')[0];
  if (portal === 'customer') return !under(path, ADMIN_ONLY);
  if (portal === 'admin') return !under(path, CUSTOMER_ONLY);
  return true;
}
