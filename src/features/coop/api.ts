import { client } from '../../lib/data-client';
import type { Schema } from '../../../amplify/data/resource';
import { parseCoopSharedState, type CoopSharedState } from './types';

export type CoopSession = Schema['CoopSession']['type'];

/**
 * Starts a new household coop session for exactly two of the signed-in
 * parent's own children (docs/DATA_MODEL.md CoopSession: "2 for v1").
 * `hostParentProfileId` is left unset — the model's `ownerDefinedIn`
 * authorization rule (amplify/data/resource.ts) auto-populates it with the
 * caller's own Cognito `sub` on create, the same way every other model's
 * implicit `owner` field is populated.
 */
export async function startCoopSession(
  templateSlug: string,
  templateVersion: number,
  participantChildProfileIds: [string, string],
): Promise<CoopSession> {
  const now = new Date().toISOString();
  const { data, errors } = await client.models.CoopSession.create({
    templateSlug,
    templateVersion,
    participantChildProfileIds,
    status: 'ACTIVE',
    sharedState: { slots: {}, presence: [] },
    startedAt: now,
    lastActivityAt: now,
  });
  if (!data) {
    throw new Error(errors?.[0]?.message ?? 'Could not start the shared adventure.');
  }
  return data;
}

export async function getCoopSession(id: string): Promise<CoopSession | null> {
  const { data } = await client.models.CoopSession.get({ id });
  return data ?? null;
}

/**
 * Atomically claims a coop-eligible step's shared slot
 * (docs/ADVENTURE_ENGINE.md "Co-op sessions"). Routed through the
 * `claimCoopSlot` function-backed mutation rather than a plain
 * `CoopSession.update()` because only that mutation's server-side
 * conditional write can guarantee "first write wins, second write
 * rejected, not surfaced as an error" — the returned session already
 * reflects whichever outcome actually happened, so the caller never needs
 * to distinguish "I claimed it" from "someone else already had".
 */
export async function claimCoopSlot(
  coopSessionId: string,
  slotKey: string,
  childProfileId: string,
): Promise<CoopSession> {
  const { data, errors } = await client.mutations.claimCoopSlot({
    coopSessionId,
    slotKey,
    childProfileId,
  });
  if (!data) {
    throw new Error(errors?.[0]?.message ?? 'Could not save that shared step.');
  }
  return data;
}

export function slotClaimedBy(session: CoopSession, slotKey: string): string | null {
  return parseCoopSharedState(session.sharedState).slots[slotKey] ?? null;
}

/**
 * Best-effort, last-write-wins join/leave presence signal — not a
 * conflict-resolved write like `claimCoopSlot`, since ADR-006 deliberately
 * excludes continuous/telemetry-level presence from v1 and a lost or
 * overwritten join/leave toggle has no gameplay consequence.
 */
export async function setCoopPresence(
  coopSessionId: string,
  childProfileId: string,
  present: boolean,
): Promise<void> {
  const session = await getCoopSession(coopSessionId);
  if (!session) return;
  const state = parseCoopSharedState(session.sharedState);
  const presence = present
    ? Array.from(new Set([...state.presence, childProfileId]))
    : state.presence.filter((id) => id !== childProfileId);
  await client.models.CoopSession.update({
    id: coopSessionId,
    sharedState: { ...state, presence },
    lastActivityAt: new Date().toISOString(),
  });
}

export async function completeCoopSession(id: string): Promise<CoopSession> {
  const now = new Date().toISOString();
  const { data, errors } = await client.models.CoopSession.update({
    id,
    status: 'COMPLETED',
    completedAt: now,
    lastActivityAt: now,
  });
  if (!data) {
    throw new Error(errors?.[0]?.message ?? 'Could not finish the shared adventure.');
  }
  return data;
}

/**
 * Live shared-state updates (docs/DATA_MODEL.md: "shared-state subscription
 * ... driving live avatar and action presence on both children's clients").
 * Uses the model's own generated `onUpdate` subscription rather than a
 * custom one — every write this feature makes (`claimCoopSlot`,
 * `setCoopPresence`, `completeCoopSession`) is already a `CoopSession`
 * update, so no separate subscription type is needed.
 */
export function subscribeToCoopSession(
  coopSessionId: string,
  onChange: (session: CoopSession) => void,
): () => void {
  const subscription = client.models.CoopSession.onUpdate({
    filter: { id: { eq: coopSessionId } },
  }).subscribe({
    next: (session) => onChange(session),
    error: () => undefined,
  });
  return () => subscription.unsubscribe();
}

export { parseCoopSharedState, type CoopSharedState };
