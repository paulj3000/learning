import type {
  ChestState,
  LaunchPoint,
  NpcPlacement,
  QuestEntry,
  RegionBootstrap,
} from '../../api/play/types';
import type { RegionPlayConfig } from './regionManifest';

/**
 * What interacting with something in a published region means (TR-7),
 * kept apart from both rendering and the UI. The scene only says "the
 * child used this entity"; this resolves that, against the child's current
 * server state, into an event TR-8 renders: a conversation with quest
 * offers, or a chest the child may ask a challenge for.
 *
 * Nothing here talks to the server, grants anything, or changes a chest.
 * Asking for a challenge, answering it, and accepting a quest are the play
 * API's, through `useRegionPlay`.
 */

export type RegionPlayInteractionEvent =
  | {
      kind: 'npc';
      entityId: string;
      npcId: string;
      label: string;
      /** This NPC's quests as the server reports them: offers (`AVAILABLE`) and progress. */
      quests: readonly QuestEntry[];
      /** Adventures this NPC can start for the child (ADR-041), already filtered by the server. */
      launches: readonly LaunchPoint[];
    }
  | {
      /** An object that starts one of this Place's Adventures (a sign, a door, ADR-041). */
      kind: 'launch';
      entityId: string;
      label: string;
      launches: readonly LaunchPoint[];
    }
  | {
      kind: 'chest';
      entityId: string;
      label: string;
      isOpen: boolean;
      /** False when no published challenge exists for this child's age band. */
      challengeAvailable: boolean;
      /** Whether a challenge can be asked for right now (open session, closed chest, available). */
      canRequestChallenge: boolean;
    };

export function resolveRegionPlayInteraction(
  config: RegionPlayConfig,
  bootstrap: RegionBootstrap,
  interactionId: string,
  sessionOpen: boolean,
): RegionPlayInteractionEvent | null {
  const binding = config.interactions.find(
    (candidate) => candidate.interactionId === interactionId,
  );
  if (!binding) return null;

  if (binding.kind === 'chest') {
    const chest: ChestState | undefined = bootstrap.chests.find(
      (c) => c.entityId === binding.entityId,
    );
    if (!chest) return null;
    return {
      kind: 'chest',
      entityId: chest.entityId,
      label: chest.label,
      isOpen: chest.isOpen,
      challengeAvailable: chest.challengeAvailable,
      canRequestChallenge: sessionOpen && !chest.isOpen && chest.challengeAvailable,
    };
  }

  const launches = launchesFor(bootstrap, binding.entityId);
  if (binding.kind === 'launch') {
    const placed = bootstrap.objects.find((o) => o.entityId === binding.entityId);
    if (!placed || launches.length === 0) return null;
    return { kind: 'launch', entityId: placed.entityId, label: placed.label, launches };
  }

  const npc: NpcPlacement | undefined = bootstrap.npcs.find((n) => n.entityId === binding.entityId);
  if (!npc) return null;
  return {
    kind: 'npc',
    entityId: npc.entityId,
    npcId: npc.npcId,
    label: npc.displayName || npc.label,
    quests: bootstrap.quests.filter((quest) => quest.giverNpcId === npc.npcId),
    launches,
  };
}

/** The launch points on one entity, in the server's order. */
export function launchesFor(bootstrap: RegionBootstrap, entityId: string): LaunchPoint[] {
  return bootstrap.launchPoints.filter((point) => point.entityId === entityId);
}

/** Whether an interaction is one this region's extension owns. */
export function claimsRegionPlayInteraction(
  config: RegionPlayConfig | null,
  interactionId: string,
): boolean {
  return config?.interactions.some((binding) => binding.interactionId === interactionId) ?? false;
}

/** Chests whose drawn state differs from the server's, so the scene changes only those. */
export function chestStateChanges(
  drawn: ReadonlyMap<string, boolean>,
  chests: readonly ChestState[],
): { entityId: string; isOpen: boolean }[] {
  return chests
    .filter((chest) => drawn.get(chest.entityId) !== chest.isOpen)
    .map((chest) => ({ entityId: chest.entityId, isOpen: chest.isOpen }));
}
