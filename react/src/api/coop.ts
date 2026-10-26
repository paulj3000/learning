import * as amplify from './amplify/coop';
import { selectApi } from './select';
import { BACKEND_SELECTION, type BackendSelection } from './config';

export type { CoopSession } from './amplify/coop';

/**
 * Household co-op sessions (ADR-006): start, atomic slot claims, presence,
 * completion and live updates. Django has no co-op routes yet (LAI-0901 to
 * LAI-0903), so every request is `coop_unavailable` there. This is not the
 * multiplayer room server (ADR-026), which is a separate service.
 */
export interface CoopRequestsApi {
  startCoopSession: typeof amplify.startCoopSession;
  getCoopSession: typeof amplify.getCoopSession;
  claimCoopSlot: typeof amplify.claimCoopSlot;
  setCoopPresence: typeof amplify.setCoopPresence;
  completeCoopSession: typeof amplify.completeCoopSession;
}

export const coopApi: CoopRequestsApi = selectApi<CoopRequestsApi>('coop', {
  amplify: {
    startCoopSession: amplify.startCoopSession,
    getCoopSession: amplify.getCoopSession,
    claimCoopSlot: amplify.claimCoopSlot,
    setCoopPresence: amplify.setCoopPresence,
    completeCoopSession: amplify.completeCoopSession,
  },
});

/**
 * Live updates for one co-op session. Synchronous by contract (it returns
 * the unsubscribe function), so it cannot reject: off Amplify it subscribes
 * to nothing. That is never reached with a real session there, because
 * every co-op request above already failed with `coop_unavailable`.
 */
export function subscribeToCoopSessionFor(
  selection: BackendSelection = BACKEND_SELECTION,
): typeof amplify.subscribeToCoopSession {
  return selection.backend === 'amplify' ? amplify.subscribeToCoopSession : () => () => {};
}
