/**
 * Quest persistence and progression (docs/ROADMAP.md Phase 25).
 *
 * The only impure module in `src/features/quests/`. Every decision about
 * whether an objective is done, which stage follows, and whether a quest is
 * finished is made by the pure modules first, so the rules stay unit-testable
 * without a backend - the same split `src/features/npc/` and
 * `src/features/rewards/` already use.
 *
 * This module is also where the Quest Engine touches its neighbours, and it
 * only ever does so through their own public APIs: `recordWorldChangeOnce`
 * (Adventure Engine), `setNpcMemoryFlagsForQuest` (NPC System), and
 * `grantRewards` (Reward Engine). It never writes another engine's table
 * directly, per docs/ARCHITECTURE.md's engine boundaries.
 *
 * Authorization is the model's own `allow.owner()`: a parent reaches only
 * their own children's quest state, and Admins read only.
 */
import { client } from '../../lib/data-client';
import type { Schema } from '../../../amplify/data/resource';
import { listSessions, listAllWorldChanges, recordWorldChangeOnce } from '../adventures/api';
import { listNpcStates, setNpcMemoryFlagsForQuest } from '../npc/api';
import { relationshipLevelForPoints } from '../npc/relationship';
import type { RelationshipLevel } from '../npc/types';
import type { SkillStatus } from '../mastery/types';
import { listSkillProgress } from '../mastery/api';
import { getInventory } from '../rewards/api';
import { advanceQuest, startQuest as startQuestState } from './quest';
import { QUEST_DEFINITIONS } from './content';
import type { QuestContext, QuestDefinition, QuestId, QuestState } from './types';

export type ChildQuestStateRow = Schema['ChildQuestState']['type'];

function toState(row: ChildQuestStateRow): QuestState {
  return {
    questId: row.questId,
    status: row.status ?? 'ACTIVE',
    currentStageId: row.currentStageId,
    completedStageIds: (row.completedStageIds ?? []).filter(
      (id): id is string => typeof id === 'string',
    ),
    completedObjectiveIds: (row.completedObjectiveIds ?? []).filter(
      (id): id is string => typeof id === 'string',
    ),
    startedAt: row.startedAt,
    completedAt: row.completedAt ?? undefined,
  };
}

async function listRows(childProfileId: string): Promise<ChildQuestStateRow[]> {
  const { data } = await client.models.ChildQuestState.list();
  return data.filter((row: ChildQuestStateRow) => row.childProfileId === childProfileId);
}

/** Every quest this child has started or finished. */
export async function listQuestStates(childProfileId: string): Promise<QuestState[]> {
  const rows = await listRows(childProfileId);
  return rows.map(toState);
}

/**
 * Assembles the snapshot the pure quest functions read.
 *
 * This is the whole integration surface of the Quest Engine: five reads
 * against engines that already own their data, and no new bookkeeping
 * anywhere else in the app. Adding a sixth primitive later means adding a
 * field here, not threading a new event through every call site.
 */
export async function buildQuestContext(childProfileId: string): Promise<QuestContext> {
  const [sessions, worldChanges, npcStates, skillProgress, inventory, questStates] =
    await Promise.all([
      listSessions(childProfileId),
      listAllWorldChanges(childProfileId),
      listNpcStates(childProfileId),
      listSkillProgress(childProfileId),
      getInventory(childProfileId),
      listQuestStates(childProfileId),
    ]);

  const npcMemoryFlags: Record<string, Record<string, boolean>> = {};
  const relationshipLevels: Record<string, RelationshipLevel> = {};
  for (const state of npcStates) {
    npcMemoryFlags[state.npcId] = { ...state.memoryFlags };
    // Derived from points rather than read from the stored level column, so
    // a quest condition and an NPC's own dialogue can never disagree about
    // how well they know each other (src/features/npc/relationship.ts).
    relationshipLevels[state.npcId] = relationshipLevelForPoints(state.relationshipPoints);
  }

  const skillStatuses: Record<string, SkillStatus> = {};
  for (const progress of skillProgress) {
    if (progress.recentLevel) {
      skillStatuses[progress.learningObjectiveCode] = progress.recentLevel;
    }
  }

  return {
    completedAdventureSlugs: sessions
      .filter((session) => session.status === 'COMPLETED')
      .map((session) => session.templateSlug),
    worldChangeKeys: worldChanges.map((change) => change.changeKey),
    // A child has "been" somewhere if the island recorded a change there.
    // Deliberately not a new visited-locations table: the World Engine does
    // not persist footsteps today, and inventing a row per room entered
    // would collect more about a child than the feature needs
    // (CLAUDE.md section 13, least data).
    visitedLocationSlugs: [...new Set(worldChanges.map((change) => change.locationSlug))],
    ownedItemIds: inventory.ownedItemIds,
    npcMemoryFlags,
    relationshipLevels,
    skillStatuses,
    discoveryKeys: [],
    completedQuestIds: questStates
      .filter((state) => state.status === 'COMPLETED')
      .map((state) => state.questId),
  };
}

/** Starts a quest for this child. Idempotent: an already-started quest is returned as-is. */
export async function startQuest(
  childProfileId: string,
  definition: QuestDefinition,
): Promise<QuestState> {
  const rows = await listRows(childProfileId);
  const existing = rows.find((row) => row.questId === definition.id);
  if (existing) return toState(existing);

  const now = new Date().toISOString();
  const state = startQuestState(definition, now);
  const { data, errors } = await client.models.ChildQuestState.create({
    childProfileId,
    questId: state.questId,
    status: state.status,
    currentStageId: state.currentStageId,
    completedStageIds: [...state.completedStageIds],
    completedObjectiveIds: [...state.completedObjectiveIds],
    startedAt: state.startedAt,
    lastUpdatedAt: now,
  });
  if (!data) {
    throw new Error(errors?.[0]?.message ?? 'Could not start that quest.');
  }
  return toState(data);
}

export interface QuestProgressResult {
  questId: QuestId;
  state: QuestState;
  justCompleted: boolean;
  newlyCompletedObjectiveIds: readonly string[];
  /** Authored celebration lines from any rewards this completion granted. */
  rewardMessages: readonly string[];
}

/**
 * Recomputes every active quest against the world, persists whatever moved,
 * and fires the side effects a finished quest owes.
 *
 * Safe to call after any gameplay event, and cheap when nothing changed: a
 * quest whose projection is identical to its stored row is skipped without a
 * write. That is what lets the adventure-completion path call it
 * unconditionally rather than knowing which quests an adventure belongs to.
 *
 * Order of side effects on completion matters and is deliberate:
 * 1. world changes first, because they are what the island shows;
 * 2. NPC memory flags next, so a character stops asking for something the
 *    child just did;
 * 3. rewards last, since `grantRewards` is idempotent per rule and can be
 *    safely retried, while a half-applied world change cannot.
 *
 * Every side effect is individually failure-tolerant: a quest that finished
 * stays finished even if a reward write fails, because the alternative is a
 * child watching a completed quest revert.
 */
export async function syncQuestProgress(
  childProfileId: string,
  definitions: readonly QuestDefinition[] = QUEST_DEFINITIONS,
  context?: QuestContext,
): Promise<QuestProgressResult[]> {
  const rows = await listRows(childProfileId);
  const active = rows.filter((row) => (row.status ?? 'ACTIVE') === 'ACTIVE');
  if (active.length === 0) return [];

  const resolvedContext = context ?? (await buildQuestContext(childProfileId));
  const results: QuestProgressResult[] = [];

  for (const row of active) {
    const definition = definitions.find((candidate) => candidate.id === row.questId);
    if (!definition) continue;

    const outcome = advanceQuest(definition, toState(row), resolvedContext);
    if (!outcome.changed) continue;

    const now = new Date().toISOString();
    const nextState: QuestState = {
      ...outcome.state,
      completedAt: outcome.justCompleted ? now : outcome.state.completedAt,
    };

    await client.models.ChildQuestState.update({
      id: row.id,
      status: nextState.status,
      currentStageId: nextState.currentStageId,
      completedStageIds: [...nextState.completedStageIds],
      completedObjectiveIds: [...nextState.completedObjectiveIds],
      lastUpdatedAt: now,
      completedAt: nextState.completedAt,
    });

    for (const change of outcome.worldChanges) {
      await recordWorldChangeOnce(
        childProfileId,
        change.locationSlug,
        change.changeType,
        change.changeKey,
        // Quest-driven changes have no adventure session behind them. The
        // quest id is the honest provenance, and it keeps the column's
        // "what caused this" meaning intact rather than inventing a fake
        // session id.
        `quest:${definition.id}`,
      ).catch(() => undefined);
    }

    let rewardMessages: readonly string[] = [];
    if (outcome.justCompleted) {
      for (const entry of definition.completion.setsNpcMemoryFlags ?? []) {
        await setNpcMemoryFlagsForQuest(childProfileId, entry.npcId, entry.flags).catch(
          () => undefined,
        );
      }
      rewardMessages = await grantQuestRewards(childProfileId, definition.id);
    }

    results.push({
      questId: definition.id,
      state: nextState,
      justCompleted: outcome.justCompleted,
      newlyCompletedObjectiveIds: outcome.newlyCompletedObjectiveIds,
      rewardMessages,
    });
  }

  return results;
}

/**
 * Fires the Reward Engine's `QUEST_COMPLETED` trigger - the seam Phase 24
 * defined and left dormant because no quest could complete yet.
 *
 * Imported lazily so that `src/features/quests/` does not pull the reward
 * content pack into every bundle that only wants to read a journal, and so a
 * reward-side failure cannot prevent a quest from being recorded as done.
 */
async function grantQuestRewards(
  childProfileId: string,
  questId: QuestId,
): Promise<readonly string[]> {
  try {
    const [{ grantRewards }, { ISLAND_REWARD_TABLE, ISLAND_COLLECTIBLE_SETS, ISLAND_ITEMS }] =
      await Promise.all([import('../rewards/api'), import('../rewards/content')]);
    const result = await grantRewards(
      childProfileId,
      { type: 'QUEST_COMPLETED', questId },
      ISLAND_REWARD_TABLE,
      ISLAND_COLLECTIBLE_SETS,
      ISLAND_ITEMS,
    );
    return result.messages;
  } catch {
    return [];
  }
}

/**
 * Deletes a child's quest progress. A parent-facing retention action
 * (docs/AI_AND_CHILD_SAFETY.md), never reachable from gameplay - a quest is
 * not taken away as a mechanic.
 */
export async function clearQuestStates(childProfileId: string): Promise<void> {
  const rows = await listRows(childProfileId);
  await Promise.all(
    rows.map((row: ChildQuestStateRow) => client.models.ChildQuestState.delete({ id: row.id })),
  );
}
