/**
 * Data-Driven Quest Engine (docs/ROADMAP.md Phase 25, docs/ARCHITECTURE.md
 * "Platform engine boundaries").
 *
 * A quest is a thin, authored *composition* of things the island can
 * already do. The roadmap is explicit that this phase "complements, rather
 * than replaces, the existing AdventureTemplate/AdventureStep model", so
 * nothing here re-implements challenges, correctness, or hints: a `SOLVE`
 * objective names an adventure that the Adventure Engine already runs, a
 * `COLLECT` objective names items the Reward Engine already grants, and a
 * `BUILD` objective names a `WorldChange` the world already records.
 *
 * The consequence worth understanding before reading further: **quest
 * progress is derived, never reported**. `isObjectiveComplete` is a pure
 * function of authored content and a `QuestContext` snapshot assembled from
 * state that already exists, so no call site anywhere has to remember to
 * tell the quest engine what a child did. A child who repairs the bridge
 * because they felt like it gets credit for the bridge quest the next time
 * their journal is read, and a crash mid-quest loses nothing, because there
 * is no separate event log to fall out of sync. Save/resume falls out of
 * the same property.
 *
 * Everything in this module except `api.ts` is pure and has no backend or
 * Phaser dependency, matching how `src/features/npc/` and
 * `src/features/mastery/` are split.
 */
import type { AgeBandValue } from '../child-profile/constants';
import type { RelationshipLevel } from '../npc/types';
import type { SkillStatus } from '../mastery/types';

/** Stable authored identifier for a quest. Never generated at runtime. */
export type QuestId = string;

/**
 * The eleven quest primitives named in docs/ROADMAP.md Phase 25.
 *
 * Each one is satisfied by a *different existing subsystem*, which is what
 * keeps quests compositional rather than a parallel content format:
 *
 * | primitive  | satisfied by                                  | owner    |
 * | ---------- | --------------------------------------------- | -------- |
 * | `TALK_TO`  | an NPC memory flag set by dialogue            | Phase 23 |
 * | `HELP_NPC` | an NPC memory flag set by dialogue            | Phase 23 |
 * | `DELIVER`  | owning an item *and* an NPC remembering it    | 23 + 24  |
 * | `FIND`     | owning a specific item                        | Phase 24 |
 * | `COLLECT`  | owning several items                          | Phase 24 |
 * | `CRAFT`    | owning an item made rather than found         | Phase 24 |
 * | `SOLVE`    | completing an adventure                       | Phase 3  |
 * | `BUILD`    | a `WorldChange` key being recorded            | Phase 3  |
 * | `EXPLORE`  | having visited a location                     | Phase 9  |
 * | `LEARN`    | a skill reaching a mastery status             | Phase 20 |
 * | `DISCOVER` | a discovery key (Phase 26; dormant today)     | Phase 26 |
 */
export type QuestObjectiveKind =
  | 'TALK_TO'
  | 'FIND'
  | 'COLLECT'
  | 'DELIVER'
  | 'EXPLORE'
  | 'SOLVE'
  | 'BUILD'
  | 'CRAFT'
  | 'HELP_NPC'
  | 'DISCOVER'
  | 'LEARN';

interface QuestObjectiveBase {
  id: string;
  /** Child-facing line for the journal. Readable aloud and localizable (CLAUDE.md section 13). */
  label: string;
  /**
   * An optional objective is tracked and celebrated but never gates the
   * quest: the stage advances without it. This is the roadmap's "optional
   * objectives" deliverable, and it is also how a quest offers a
   * side-errand to a child who wants more without stranding a child who
   * does not.
   */
  optional?: boolean;
}

/**
 * One authored step of a quest. A closed union rather than a predicate, for
 * the same reason `NpcCondition` is closed: content stays serializable,
 * reviewable by a designer, and impossible to smuggle logic into.
 */
export type QuestObjective = QuestObjectiveBase &
  (
    | { kind: 'TALK_TO'; npcId: string; memoryFlag: string }
    | { kind: 'HELP_NPC'; npcId: string; memoryFlag: string }
    | { kind: 'DELIVER'; itemId: string; npcId: string; memoryFlag: string }
    | { kind: 'FIND'; itemId: string }
    | { kind: 'CRAFT'; itemId: string }
    | {
        kind: 'COLLECT';
        itemIds: readonly string[];
        /** Defaults to "all of them". Set lower for "any 3 of these 5". */
        requiredCount?: number;
      }
    | { kind: 'SOLVE'; adventureSlug: string }
    | { kind: 'BUILD'; changeKey: string }
    | { kind: 'EXPLORE'; locationSlug: string }
    | { kind: 'LEARN'; learningObjectiveCode: string; atLeast: SkillStatus }
    | { kind: 'DISCOVER'; discoveryKey: string }
  );

/**
 * A guard on a quest's availability or on which branch it takes. Mirrors
 * `NpcCondition` deliberately - a content designer who has authored one has
 * authored the other - but scoped to what a quest can see.
 */
export type QuestCondition =
  | { type: 'ALWAYS' }
  | { type: 'QUEST_COMPLETED'; questId: QuestId }
  | { type: 'WORLD_CHANGE'; changeKey: string }
  | { type: 'ITEM_OWNED'; itemId: string }
  | { type: 'RELATIONSHIP_AT_LEAST'; npcId: string; level: RelationshipLevel }
  /** Branching on what the child actually chose to do, including optional work. */
  | { type: 'OBJECTIVE_COMPLETED'; objectiveId: string };

/**
 * A change to the island recorded when a stage or a quest finishes. The
 * roadmap's "quest events that modify WorldChange state" deliverable.
 *
 * Written through the Adventure Engine's existing `recordWorldChangeOnce`
 * rather than a new write path, so a quest-driven change is indistinguishable
 * from an adventure-driven one downstream - the island does not care why a
 * bridge got repaired, and `isLocationUnlocked` keeps working unchanged.
 */
export interface QuestWorldChange {
  locationSlug: string;
  changeType: string;
  changeKey: string;
}

/** Taken when its conditions pass; the first matching branch wins. */
export interface QuestBranch {
  conditions: QuestCondition[];
  nextStageId: string;
}

/**
 * One chapter of a quest. A stage completes when all of its non-optional
 * objectives are complete; the engine then follows the first matching
 * branch, or `nextStageId`, or - with neither - completes the quest.
 */
export interface QuestStage {
  id: string;
  /** Child-facing heading in the journal, e.g. "Count the planks". */
  title: string;
  objectives: QuestObjective[];
  branches?: QuestBranch[];
  nextStageId?: string;
  /** Recorded when this stage completes, not when the whole quest does. */
  worldChanges?: QuestWorldChange[];
}

/** What happens once, when the quest as a whole is finished. */
export interface QuestCompletion {
  /** Child-facing wrap-up line kept in the journal afterwards. */
  journalNote: string;
  worldChanges?: QuestWorldChange[];
  /**
   * Memory flags to set on NPCs when the quest ends. This is what closes
   * the loop Phase 23 deliberately left open: Pirate Pip's offer is gated
   * on `bridgeQuestCompleted` being false, and nothing could set that flag
   * until a quest engine existed to finish the quest.
   */
  setsNpcMemoryFlags?: readonly { npcId: string; flags: readonly string[] }[];
}

/** An authored quest, independent of any child. */
export interface QuestDefinition {
  id: QuestId;
  /** Child-facing title. */
  title: string;
  /** Child-facing one-line ask, matching the NPC's own offer summary. */
  summary: string;
  /**
   * The NPC who offers this quest. Must match an `NpcQuestOffer.questId`
   * in `src/features/npc/content/`, which `islandQuests.test.ts` asserts -
   * an offer pointing at a quest that does not exist would be a dead end a
   * child could walk into.
   */
  giverNpcId?: string;
  ageBands: AgeBandValue[];
  prerequisites: QuestCondition[];
  entryStageId: string;
  stages: QuestStage[];
  completion: QuestCompletion;
}

/**
 * Everything the pure quest functions may see about one child. Assembled by
 * `buildQuestContext` (api.ts) from state other engines already own; this
 * module never reads the network and never receives a nickname, age, or any
 * identifier beyond what an objective can be checked against.
 */
export interface QuestContext {
  /** `AdventureDefinition.slug` values with a COMPLETED session. */
  completedAdventureSlugs: readonly string[];
  /** `WorldChange.changeKey` values recorded for this child. */
  worldChangeKeys: readonly string[];
  /** Location slugs the child has reached, derived from their world changes and sessions. */
  visitedLocationSlugs: readonly string[];
  /** `ItemDefinition.id` values in the child's backpack (Phase 24). */
  ownedItemIds: readonly string[];
  /** Per-NPC memory flags (Phase 23), keyed by `NpcId`. */
  npcMemoryFlags: Readonly<Record<string, Readonly<Record<string, boolean>>>>;
  /** Per-NPC relationship level (Phase 23), keyed by `NpcId`. */
  relationshipLevels: Readonly<Record<string, RelationshipLevel>>;
  /** Mastery status per `learningObjectiveCode` (Phase 20). */
  skillStatuses: Readonly<Record<string, SkillStatus>>;
  /**
   * Discovery keys (Phase 26). Always empty today, exactly as
   * `NpcContext.completedQuestIds` was empty before this phase existed: a
   * `DISCOVER` objective is authorable now and simply never completes until
   * Phase 26 ships a discovery system to fill this in.
   */
  discoveryKeys: readonly string[];
  /** Quest IDs this child has already finished, for prerequisites. */
  completedQuestIds: readonly QuestId[];
}

export const EMPTY_QUEST_CONTEXT: QuestContext = {
  completedAdventureSlugs: [],
  worldChangeKeys: [],
  visitedLocationSlugs: [],
  ownedItemIds: [],
  npcMemoryFlags: {},
  relationshipLevels: {},
  skillStatuses: {},
  discoveryKeys: [],
  completedQuestIds: [],
};

/**
 * Stored progress for one (child, quest). `AVAILABLE` is deliberately not a
 * stored status - it is derived from prerequisites for any quest with no
 * row yet, so authoring a new quest offers it to every eligible child
 * without a backfill.
 */
export type QuestStatus = 'ACTIVE' | 'COMPLETED';

export interface QuestState {
  questId: QuestId;
  status: QuestStatus;
  currentStageId: string;
  completedStageIds: readonly string[];
  completedObjectiveIds: readonly string[];
  startedAt: string;
  completedAt?: string;
}
