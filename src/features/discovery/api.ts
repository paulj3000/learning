/**
 * Discovery persistence (docs/ROADMAP.md Phase 26).
 *
 * The only impure module in `src/features/discovery/`. Every decision about
 * whether a secret opens is made by `discovery.ts` first, so the rules stay
 * unit-testable without a backend - the same split
 * `src/features/quests/` and `src/features/rewards/` already use.
 *
 * This is also where the Discovery Engine touches its neighbours, and it
 * only ever does so through their own public APIs: `recordWorldChangeOnce`
 * (Adventure Engine), `grantRewards` (Reward Engine), and `startQuest` /
 * `syncQuestProgress` (Quest Engine). It never writes another engine's table
 * directly, per docs/ARCHITECTURE.md's engine boundaries.
 *
 * The Quest Engine is reached through a dynamic `import()` rather than a
 * static one, for the same reason `grantQuestRewards` reaches rewards that
 * way: `src/features/quests/api.ts` imports `getWorldState` from here to
 * fill `QuestContext.discoveryKeys`, so a static import in both directions
 * would be a module cycle.
 *
 * Authorization is the model's own `allow.owner()`: a parent reaches only
 * their own children's exploration record, and Admins read only.
 */
import { client } from '../../lib/data-client';
import type { Schema } from '../../../amplify/data/resource';
import { listAllWorldChanges, recordWorldChangeOnce } from '../adventures/api';
import { getInventory, grantRewards } from '../rewards/api';
import { ISLAND_COLLECTIBLE_SETS, ISLAND_ITEMS, ISLAND_REWARD_TABLE } from '../rewards/content';
import { ISLAND_NPCS } from '../npc/content';
import { ISLAND_DISCOVERIES, ISLAND_DISCOVERY_IDS } from './content';
import { addDiscoveredId, parseKnownIds, resolveDiscovery } from './discovery';
import type {
  DiscoveryContext,
  DiscoveryDefinition,
  DiscoveryId,
  WorldStateSnapshot,
} from './types';
import { EMPTY_WORLD_STATE } from './types';
import type { DiscoveryOutcome } from './discovery';

export type ChildWorldStateRow = Schema['ChildWorldState']['type'];

const KNOWN_NPC_IDS: readonly string[] = ISLAND_NPCS.map((npc) => npc.id);

function toSnapshot(row: ChildWorldStateRow): WorldStateSnapshot {
  return {
    discoveredIds: parseKnownIds(row.discoveredObjects, ISLAND_DISCOVERY_IDS),
    metCharacterIds: parseKnownIds(row.discoveredCharacters, KNOWN_NPC_IDS),
  };
}

async function findRow(childProfileId: string): Promise<ChildWorldStateRow | undefined> {
  const { data } = await client.models.ChildWorldState.list();
  return data.find((row: ChildWorldStateRow) => row.childProfileId === childProfileId);
}

/** This child's exploration record, or an empty one if they have never found anything. */
export async function getWorldState(childProfileId: string): Promise<WorldStateSnapshot> {
  const row = await findRow(childProfileId);
  return row ? toSnapshot(row) : EMPTY_WORLD_STATE;
}

/**
 * Assembles the snapshot the pure discovery functions read: what the island
 * already recorded, what is in the backpack, and what has already been found.
 *
 * Three reads against engines that already own their data, and no new
 * bookkeeping anywhere else in the app - the same shape as
 * `buildQuestContext`.
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

async function writeIds(
  childProfileId: string,
  row: ChildWorldStateRow | undefined,
  snapshot: WorldStateSnapshot,
): Promise<void> {
  const now = new Date().toISOString();
  const fields = {
    discoveredObjects: [...snapshot.discoveredIds],
    discoveredCharacters: [...snapshot.metCharacterIds],
    updatedAt: now,
  };
  if (row) {
    await client.models.ChildWorldState.update({ id: row.id, ...fields });
  } else {
    await client.models.ChildWorldState.create({ childProfileId, ...fields });
  }
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
 * Records a discovery for this child, and fires everything finding it owes.
 *
 * Safe to call every time a child walks into the zone: a secret that is
 * already found writes nothing, grants nothing a second time, and returns
 * the same `revealMessage` - so a scene can call this unconditionally rather
 * than tracking elsewhere whether this is a repeat visit. A locked secret
 * writes nothing either; it just returns the authored `lockedMessage`.
 *
 * Order of side effects matters and is deliberate, matching
 * `syncQuestProgress`:
 * 1. the discovery row first, because it is what makes the secret *found*
 *    and everything below is a consequence of that;
 * 2. the world change next, because it is what the island shows;
 * 3. rewards next, since `grantRewards` is idempotent per rule;
 * 4. the quest last, because a quest is the only one of these that reads the
 *    others - "The Quiet Places" projects itself against the discovery row
 *    written in step 1.
 *
 * Every step after the first is individually failure-tolerant: a secret that
 * was found stays found even if a reward write fails, because the
 * alternative is a child watching a place they found go back to being
 * hidden. `grantRewards` being idempotent per rule means the missed grant is
 * picked up the next time anything calls it.
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

  const row = await findRow(childProfileId);
  const current = row ? toSnapshot(row) : EMPTY_WORLD_STATE;
  await writeIds(childProfileId, row, {
    ...current,
    discoveredIds: addDiscoveredId(current.discoveredIds, definition.id),
  });

  if (definition.worldChange) {
    await recordWorldChangeOnce(
      childProfileId,
      definition.worldChange.locationSlug,
      definition.worldChange.changeType,
      definition.worldChange.changeKey,
      // Discoveries have no adventure session behind them. The discovery id
      // is the honest provenance, and it keeps the column's "what caused
      // this" meaning intact - the same convention `syncQuestProgress` uses
      // with `quest:<id>`.
      `discovery:${definition.id}`,
    ).catch(() => undefined);
  }

  let rewardMessages: readonly string[] = [];
  let newItemIds: readonly string[] = [];
  try {
    const granted = await grantRewards(
      childProfileId,
      { type: 'DISCOVERY', discoveryKey: definition.id },
      ISLAND_REWARD_TABLE,
      ISLAND_COLLECTIBLE_SETS,
      ISLAND_ITEMS,
    );
    rewardMessages = granted.messages;
    newItemIds = granted.newItemIds;
  } catch {
    rewardMessages = [];
    newItemIds = [];
  }

  const startedQuestId = await startOrAdvanceQuest(childProfileId, definition.startsQuestId);

  return { outcome, rewardMessages, newItemIds, startedQuestId };
}

/**
 * Starts the quest this discovery gives out, then reprojects every active
 * quest so a `DISCOVER` objective the child just satisfied ticks over
 * immediately rather than waiting for the journal to be opened.
 *
 * `syncQuestProgress` runs even when no quest was started, because a
 * discovery can complete an objective in a quest that is already running -
 * which is the normal case for every secret after the first.
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
        // Checked before starting, so a second visit to the tide pool does
        // not re-announce a quest the child is already on. `startQuest`
        // itself is idempotent and would return the existing row either way.
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
 * Records that this child has met a character in the world.
 *
 * Distinct from `ChildNpcState`, which the NPC engine writes when a
 * *dialogue* happens: this is the flat "walked up and said hello" record the
 * explorable scenes produce, and today the scenes are the only thing a child
 * can actually reach. Cheap and idempotent - an already-met character writes
 * nothing.
 */
export async function recordCharacterMet(childProfileId: string, npcId: string): Promise<void> {
  if (!KNOWN_NPC_IDS.includes(npcId)) return;
  const row = await findRow(childProfileId);
  const current = row ? toSnapshot(row) : EMPTY_WORLD_STATE;
  if (current.metCharacterIds.includes(npcId)) return;
  await writeIds(childProfileId, row, {
    ...current,
    metCharacterIds: [...current.metCharacterIds, npcId],
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
  const { data } = await client.models.ChildWorldState.list();
  const rows = data.filter((row: ChildWorldStateRow) => row.childProfileId === childProfileId);
  await Promise.all(
    rows.map((row: ChildWorldStateRow) => client.models.ChildWorldState.delete({ id: row.id })),
  );
}
