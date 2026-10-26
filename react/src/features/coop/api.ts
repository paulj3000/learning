/**
 * Household co-op sessions, through `react/src/api/coop.ts` (LAI-0501B).
 * Names and signatures are the ones the app already used.
 */
import { coopApi, subscribeToCoopSessionFor, type CoopSession } from '../../api/coop';
import { parseCoopSharedState, type CoopSharedState } from './types';

export type { CoopSession };

export const {
  startCoopSession,
  getCoopSession,
  claimCoopSlot,
  setCoopPresence,
  completeCoopSession,
} = coopApi;

/** Live shared-state updates (docs/DATA_MODEL.md CoopSession). */
export const subscribeToCoopSession = subscribeToCoopSessionFor();

export function slotClaimedBy(session: CoopSession, slotKey: string): string | null {
  return parseCoopSharedState(session.sharedState).slots[slotKey] ?? null;
}

export { parseCoopSharedState, type CoopSharedState };
