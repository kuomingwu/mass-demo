/** Demo personas per portal: the admin portal only offers our own roles, the customer portal only customer roles. */
import { PERSONAS, USERS } from '../server/seed';
import { getPortal, type Portal } from './portal';

/** A persona is "ours" when its user is a platform-level principal (no tenant). */
export function isVendorPersona(personaId: string): boolean {
  const persona = PERSONAS.find((p) => p.id === personaId);
  const user = persona ? USERS.find((u) => u.id === persona.userId) : undefined;
  return !!user && user.tenantId === null;
}

export function personaAllowed(personaId: string, portal: Portal = getPortal()): boolean {
  if (!PERSONAS.some((p) => p.id === personaId)) return false;
  if (portal === 'all') return true;
  return isVendorPersona(personaId) === (portal === 'admin');
}

export function personasForPortal(portal: Portal = getPortal()) {
  return PERSONAS.filter((p) => personaAllowed(p.id, portal));
}

export function defaultPersona(portal: Portal = getPortal()): string {
  return portal === 'customer' ? 'tenant-admin' : 'owner';
}
