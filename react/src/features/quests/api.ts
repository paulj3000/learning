/**
 * Quest persistence and progression (docs/ROADMAP.md Phase 25), on Django (AMP-03).
 *
 * The only impure module in `src/features/quests/`. Every decision about
 * whether an objective is done, which stage follows, and whether a quest is
 * finished is made by the pure modules first, so the rules stay unit-testable
 * without a backend - the same split `src/features/npc/` and
 * `src/features/rewards/` already use.
 *
 * The projected state is saved with `PUT children/<id>/quests/<quest>/`, a validated write: the
 * server accepts only the quest's own stage and objective ids, completed lists that only grow,
 * and never a change to a finished quest. What a stage or the quest's completion owes is decided
 * there from the catalog quest, never sent from here: the authored world changes, the
 * completion's NPC memory flags, and the `QUEST_COMPLETED` rewards, each once. Starting a quest is
 * `quests/<quest>/accept/`, which checks the age band and prerequisites.
 *
 * Every route is child-scoped on the server: a parent reaches only their own children.
 */
import { childPath, djangoClient } from '../../api/djangoClient';
import { read, type Reader } from '../../api/parse';
import { listSessions, listAllWorldChanges } from '../adventures/api';
import { listNpcStates } from '../npc/api';
import { relationshipLevelForPoints } from '../npc/relationship';
import type { RelationshipLevel } from '../npc/types';
import type { SkillStatus } from '../mastery/types';
import { listSkillProgress } from '../mastery/api';
import { getInventory } from '../rewards/api';
import { getWorldState } from '../discovery/api';
import { advanceQuest } from './quest';
import { QUEST_DEFINITIONS } from './content';
import type { QuestContext, QuestDefinition, QuestId, QuestState } from './types';

function readState(r: Reader): QuestState {
  const completedAt = r.field('completedAt').nullable((v) => v.string());
  return {
    questId: r.field('questId').string(),
    status: r.field('status').oneOf(['ACTIVE', 'COMPLETED'] as const),
    currentStageId: r.field('currentStageId').string(),
    completedStageIds: r.field('completedStageIds').array((id) => id.string()),
    completedObjectiveIds: r.field('completedObjectiveIds').array((id) => id.string()),
    startedAt: r.field('startedAt').string(),
    ...(completedAt ? { completedAt } : {}),
  };
}

/** Every quest this child has started or finished. */
export async function listQuestStates(childProfileId: string): Promise<QuestState[]> {
  const response = await djangoClient().request('GET', childPath(childProfileId, 'quests/'));
  return read(response.data, (r) => r.field('quests').array(readState));
}

/**
 * Assembles the snapshot the pure quest functions read.
 *
 * This is the whole integration surface of the Quest Engine: reads against
 * engines that already own their data, and no new bookkeeping anywhere else
 * in the app.
 */
export async function buildQuestContext(childProfileId: string): Promise<QuestContext> {
  const [sessions, worldChanges, npcStates, skillProgress, inventory, questStates, worldState] =
    await Promise.all([
      listSessions(childProfileId),
      listAllWorldChanges(childProfileId),
      listNpcStates(childProfileId),
      listSkillProgress(childProfileId),
      getInventory(childProfileId),
      listQuestStates(childProfileId),
      getWorldState(childProfileId),
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
    // Deliberately not a new visited-locations table (CLAUDE.md section 13, least data).
    visitedLocationSlugs: [...new Set(worldChanges.map((change) => change.locationSlug))],
    ownedItemIds: inventory.ownedItemIds,
    npcMemoryFlags,
    relationshipLevels,
    skillStatuses,
    discoveryKeys: worldState.discoveredIds,
    completedQuestIds: questStates
      .filter((state) => state.status === 'COMPLETED')
      .map((state) => state.questId),
  };
}

/**
 * Starts a quest for this child. Idempotent: an already-started quest is returned as-is. The
 * server checks the age band and the quest's prerequisites (refused: `quest_unavailable`).
 */
export async function startQuest(
  childProfileId: string,
  definition: QuestDefinition,
): Promise<QuestState> {
  await djangoClient().request(
    'POST',
    childPath(childProfileId, `quests/${encodeURIComponent(definition.id)}/accept/`),
    { body: {} },
  );
  const started = (await listQuestStates(childProfileId)).find(
    (state) => state.questId === definition.id,
  );
  if (!started) throw new Error('Could not start that quest.');
  return started;
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
 * Recomputes every active quest against the world and saves whatever moved.
 *
 * Safe to call after any gameplay event, and cheap when nothing changed: a
 * quest whose projection is identical to its stored row is skipped without a
 * write. The server applies what each newly completed stage and a completion
 * owe (world changes, NPC memory flags, rewards), once, and reports the
 * reward lines to celebrate with.
 */
export async function syncQuestProgress(
  childProfileId: string,
  definitions: readonly QuestDefinition[] = QUEST_DEFINITIONS,
  context?: QuestContext,
): Promise<QuestProgressResult[]> {
  const states = await listQuestStates(childProfileId);
  const active = states.filter((state) => state.status === 'ACTIVE');
  if (active.length === 0) return [];

  const resolvedContext = context ?? (await buildQuestContext(childProfileId));
  const results: QuestProgressResult[] = [];

  for (const current of active) {
    const definition = definitions.find((candidate) => candidate.id === current.questId);
    if (!definition) continue;

    const outcome = advanceQuest(definition, current, resolvedContext);
    if (!outcome.changed) continue;

    const response = await djangoClient().request(
      'PUT',
      childPath(childProfileId, `quests/${encodeURIComponent(definition.id)}/`),
      {
        body: {
          status: outcome.state.status,
          currentStageId: outcome.state.currentStageId,
          completedStageIds: [...outcome.state.completedStageIds],
          completedObjectiveIds: [...outcome.state.completedObjectiveIds],
        },
      },
    );
    const saved = read(response.data, (r) => ({
      state: readState(r.field('quest')),
      rewardMessages: r.field('rewardMessages').array((m) => m.string()),
    }));

    results.push({
      questId: definition.id,
      state: saved.state,
      justCompleted: outcome.justCompleted,
      newlyCompletedObjectiveIds: outcome.newlyCompletedObjectiveIds,
      rewardMessages: saved.rewardMessages,
    });
  }

  return results;
}

/**
 * Deletes a child's quest progress. A parent-facing retention action
 * (docs/AI_AND_CHILD_SAFETY.md), never reachable from gameplay - a quest is
 * not taken away as a mechanic.
 */
export async function clearQuestStates(childProfileId: string): Promise<void> {
  await djangoClient().request('DELETE', childPath(childProfileId, 'quests/'));
}
