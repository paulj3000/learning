import type { WorldInteraction } from '../../../worldObjects';

/**
 * Which castle characters the NPC Manager serves right now (LAI-NPC-039).
 *
 * `claimsInteraction` is asked by the view with only the interaction and the extension config,
 * so it cannot see the companion's NPC scene host. The companion records here the NPC ids the
 * host serves while it serves them, and `castle-tale` then claims those characters' `TALK_TO`
 * interactions (walking up, tapping, or the "Things to do here" list) so the managed
 * conversation opens instead of the legacy `NpcConversation`. Nothing is claimed when the host
 * serves nothing (no release, Django off, a failed load), so the legacy path is unchanged.
 *
 * Module state on purpose and tiny: one castle is mounted at a time, and the companion clears
 * its entry on unmount.
 */
const managed = new Set<string>();

/** Marks `npcIds` as served by the NPC Manager; returns the function that unmarks them. */
export function handOverCastleNpcs(npcIds: Iterable<string>): () => void {
  const ids = [...npcIds];
  for (const id of ids) managed.add(id);
  return () => {
    for (const id of ids) managed.delete(id);
  };
}

/** The managed NPC a `TALK_TO` interaction is about, or null. */
export function managedCastleNpcFor(interaction: WorldInteraction): string | null {
  return interaction.action.kind === 'TALK_TO' && managed.has(interaction.action.npcId)
    ? interaction.action.npcId
    : null;
}

/** Tests only. */
export function resetCastleNpcHandover(): void {
  managed.clear();
}
