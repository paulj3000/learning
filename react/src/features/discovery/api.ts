/**
 * Discovery persistence (docs/ROADMAP.md Phase 26), on Django (AMP-03).
 *
 * The only impure module in `src/features/discovery/`. The server is the authority for whether a
 * secret opens and what finding it owes (`POST children/<id>/discoveries/`, SC-R04-00): it
 * records the find, the authored world change and the reward rules, each once, from the content
 * export. `discovery.ts` still resolves the outcome locally first, so a secret that is plainly
 * found or plainly locked costs no write, and the child sees the authored copy at once.
 *
 * The rest of the exploration record is `children/<id>/world-state/`: the characters a child has
 * met and the last checkpoint they crossed, each an authored id the server checks.
 *
 * The Quest Engine is reached through a dynamic `import()` rather than a static one:
 * `src/features/quests/api.ts` imports `getWorldState` from here to fill
 * `QuestContext.discoveryKeys`, so a static import in both directions would be a module cycle.
 */
import { childPath, djangoClient } from '../../api/djangoClient';
import { read } from '../../api/parse';
import { recordDiscoveryOnServer } from '../../api/play/discoveriesApi';
import { listAllWorldChanges } from '../adventures/api';
import { getInventory } from '../rewards/api';
import { ISLAND_NPCS } from '../npc/content';
import { KNOWN_CHECKPOINT_IDS } from './checkpoints';
import { ISLAND_DISCOVERIES, ISLAND_DISCOVERY_IDS } from './content';
import { parseKnownId, parseKnownIds, resolveDiscovery } from './discovery';
import type {
  DiscoveryContext,
  DiscoveryDefinition,
  DiscoveryId,
  WorldStateSnapshot,
} from './types';
import type { DiscoveryOutcome } from './discovery';

const KNOWN_NPC_IDS: readonly string[] = ISLAND_NPCS.map((npc) => npc.id);

function worldStatePath(childProfileId: string): string {
  return childPath(childProfileId, 'world-state/');
}

function readSnapshot(data: unknown): WorldStateSnapshot {
  return read(data, (r) => ({
    discoveredIds: parseKnownIds(r.field('discoveredIds').value, ISLAND_DISCOVERY_IDS),
    metCharacterIds: parseKnownIds(r.field('metCharacterIds').value, KNOWN_NPC_IDS),
    lastCheckpointId: parseKnownId(r.field('lastCheckpointId').value, KNOWN_CHECKPOINT_IDS),
  }));
}

/** This child's exploration record, or an empty one if they have never found anything. */
export async function getWorldState(childProfileId: string): Promise<WorldStateSnapshot> {
  const response = await djangoClient().request('GET', worldStatePath(childProfileId));
  return readSnapshot(response.data);
}

/**
 * Assembles the snapshot the pure discovery functions read: what the island
 * already recorded, what is in the backpack, and what has already been found.
 */
export async function buildDiscoveryContext(childProfileId: string): Promise<DiscoveryContext> {
  const [worldChanges, inventory, worldState] = await Promise.all([
    listAllWorldChanges(childProfileId),
    getInventory(childProfileId),
    getWorldState(childProfileId),
  ]);

  return {
    worldChangeKeys: worldChanges.map((change) => change.changeKey),
    ownedItemIds: inventory.ownedItemIds,
    discoveredIds: worldState.discoveredIds,
  };
}

export interface DiscoveryResult {
  outcome: DiscoveryOutcome;
  /** Authored celebration lines from any reward rule this discovery fired. */
  rewardMessages: readonly string[];
  /** Item ids newly added to the backpack, for a "you found something" beat. */
  newItemIds: readonly string[];
  /** The quest this discovery started, if it started one and it was not already running. */
  startedQuestId?: string;
}

/**
 * Records a discovery for this child, and starts or advances the quest it gives out.
 *
 * Safe to call every time a child walks into the zone: a secret that is already found writes
 * nothing and returns the same `revealMessage`; a locked one returns the authored
 * `lockedMessage`. Otherwise the server decides: if it says the secret does not open for this
 * child, it stays shut, whatever the client's copy of the state said, and if it was already
 * found there, nothing is granted again.
 */
export async function recordDiscovery(
  childProfileId: string,
  definition: DiscoveryDefinition,
  context?: DiscoveryContext,
): Promise<DiscoveryResult> {
  const resolvedContext = context ?? (await buildDiscoveryContext(childProfileId));
  const outcome = resolveDiscovery(definition, resolvedContext);
  if (outcome.status !== 'FOUND_NOW') {
    return { outcome, rewardMessages: [], newItemIds: [] };
  }

  const recorded = await recordDiscoveryOnServer(djangoClient(), childProfileId, definition.id);
  if (recorded.status === 'LOCKED') {
    return {
      outcome: {
        ...outcome,
        status: 'LOCKED',
        message: recorded.message ?? definition.lockedMessage,
      },
      rewardMessages: [],
      newItemIds: [],
    };
  }
  if (recorded.status === 'ALREADY_FOUND') {
    return { outcome: { ...outcome, status: 'ALREADY_FOUND' }, rewardMessages: [], newItemIds: [] };
  }

  const startedQuestId = await startOrAdvanceQuest(childProfileId, definition.startsQuestId);
  return {
    outcome,
    rewardMessages: recorded.rewardMessages,
    newItemIds: recorded.newItemIds,
    startedQuestId,
  };
}

/**
 * Starts the quest this discovery gives out, then reprojects every active
 * quest so a `DISCOVER` objective the child just satisfied ticks over
 * immediately rather than waiting for the journal to be opened.
 */
async function startOrAdvanceQuest(
  childProfileId: string,
  questId: string | undefined,
): Promise<string | undefined> {
  try {
    const [{ listQuestStates, startQuest, syncQuestProgress }, { getQuestDefinition }] =
      await Promise.all([import('../quests/api'), import('../quests/content')]);

    let started: string | undefined;
    if (questId) {
      const definition = getQuestDefinition(questId);
      if (definition) {
        // Checked before starting, so a second visit does not re-announce a quest the child is
        // already on. `startQuest` itself is idempotent.
        const alreadyRunning = (await listQuestStates(childProfileId)).some(
          (state) => state.questId === questId,
        );
        await startQuest(childProfileId, definition);
        started = alreadyRunning ? undefined : questId;
      }
    }

    await syncQuestProgress(childProfileId);
    return started;
  } catch {
    return undefined;
  }
}

/**
 * Records that this child has met a character in the world. Cheap and idempotent: an unknown id
 * is dropped here, and the server ignores a character already met.
 */
export async function recordCharacterMet(childProfileId: string, npcId: string): Promise<void> {
  if (!KNOWN_NPC_IDS.includes(npcId)) return;
  await djangoClient().request('PATCH', worldStatePath(childProfileId), {
    body: { metCharacterId: npcId },
  });
}

/**
 * Records the last authored checkpoint (`checkpoints.ts`) a child crossed in a 3D explorable
 * region (docs/ROADMAP.md Phase 32). Only an authored id is ever sent, never a coordinate.
 */
export async function saveCheckpoint(childProfileId: string, checkpointId: string): Promise<void> {
  if (!KNOWN_CHECKPOINT_IDS.includes(checkpointId)) return;
  await djangoClient().request('PATCH', worldStatePath(childProfileId), {
    body: { lastCheckpointId: checkpointId },
  });
}

/** Looks up an authored discovery by the id a `DISCOVER` world action names. */
export function getDiscoveryDefinition(discoveryId: DiscoveryId): DiscoveryDefinition | undefined {
  return ISLAND_DISCOVERIES.find((discovery) => discovery.id === discoveryId);
}

/**
 * Deletes a child's exploration record. A parent-facing retention action
 * (docs/AI_AND_CHILD_SAFETY.md), never reachable from gameplay - a place a
 * child found is not taken back as a mechanic.
 */
export async function clearWorldState(childProfileId: string): Promise<void> {
  await djangoClient().request('DELETE', worldStatePath(childProfileId));
}
