/**
 * Persistent NPC System (docs/ROADMAP.md Phase 23). The domain half of the
 * island's characters: identity, schedule, dialogue trees, per-child memory,
 * and relationship progression.
 *
 * Deliberately separate from `src/features/island-map/npcs.ts`, which is the
 * World Engine's *presentation* half (spawn point, palette, follow distance)
 * and stays Phaser-facing. Per docs/ARCHITECTURE.md "Platform engine
 * boundaries", the rendering layer never decides what an NPC knows or says;
 * it renders a body and fires a tap event. The two halves are joined only by
 * a stable semantic `NpcId`, never by a Phaser object reference — the same
 * discipline ADR-008 requires for the Three.js migration.
 *
 * Everything in this module except `api.ts` is pure and Phaser-free, so NPC
 * behavior is unit-testable without a canvas.
 */

/**
 * Stable semantic identifier for a character, shared by the domain NPC
 * (this module), the World Engine's spawn/palette data, and the
 * `WorldInteraction` a child taps. Never a generated or positional ID.
 */
export type NpcId = string;

/**
 * A coarse time-of-day bucket for NPC schedules. Deliberately not a clock
 * time: the island has no simulated day/night cycle, and tying an NPC's
 * whereabouts to the child's real-world clock would make content
 * unreachable for a child who plays only in the evening. Resolved from the
 * child's own session (`docs/UX_AND_ACCESSIBILITY.md` calm-engagement
 * rules), and every NPC must be reachable in at least one bucket.
 */
export type TimeOfDay = 'MORNING' | 'AFTERNOON' | 'EVENING';

export const TIME_OF_DAY_ORDER: readonly TimeOfDay[] = ['MORNING', 'AFTERNOON', 'EVENING'];

/**
 * Where an NPC can be found during one time bucket. `locationSlug` matches
 * `src/features/island/locations.ts`; `zoneId` matches the location's own
 * zone content so the World Engine can place the body without this module
 * knowing any pixel coordinates.
 */
export interface NpcScheduleEntry {
  timeOfDay: TimeOfDay;
  locationSlug: string;
  zoneId?: string;
}

/**
 * How well the child and this NPC know each other. Four bounded steps, and
 * that is the whole ladder — there is no infinite affinity score, no daily
 * streak, and no decay. CLAUDE.md pillar 7 (calm engagement) and section 6
 * (Chatty must not create dependency) both rule out a relationship meter a
 * child could feel punished by. Friendship here only ever unlocks warmer
 * greetings and new quests; it never gates learning content, and it never
 * goes down.
 */
export type RelationshipLevel = 'STRANGER' | 'ACQUAINTANCE' | 'FRIEND' | 'TRUSTED_FRIEND';

export const RELATIONSHIP_LEVEL_ORDER: readonly RelationshipLevel[] = [
  'STRANGER',
  'ACQUAINTANCE',
  'FRIEND',
  'TRUSTED_FRIEND',
];

/**
 * Per-child, per-NPC memory. Flags are authored booleans keyed by content
 * (`bridgeQuestCompleted` is the roadmap's own example), never free text and
 * never anything a child typed — CLAUDE.md section 13 forbids logging child
 * free-text, so a flag records *that* something happened, not what was said.
 */
export type NpcMemoryFlags = Readonly<Record<string, boolean>>;

/**
 * Everything the pure dialogue/quest functions are allowed to see about the
 * current child. Assembled by the caller; this module never reads the
 * network, and never receives the child's nickname, age, or any identifier
 * beyond what a condition can branch on.
 */
export interface NpcContext {
  npcId: NpcId;
  timeOfDay: TimeOfDay;
  relationshipLevel: RelationshipLevel;
  memoryFlags: NpcMemoryFlags;
  /** `WorldChange.changeKey` values already recorded for this child. */
  worldChangeKeys: readonly string[];
  /** Quest IDs the child has completed. Empty until the Phase 25 Quest Engine exists. */
  completedQuestIds: readonly string[];
}

/**
 * A guard on a dialogue node or quest offer. A closed set of authored shapes
 * rather than an arbitrary predicate, so conditions stay serializable,
 * reviewable by a content designer, and impossible to smuggle logic into.
 */
export type NpcCondition =
  | { type: 'ALWAYS' }
  | { type: 'MEMORY_FLAG'; flag: string; equals: boolean }
  | { type: 'RELATIONSHIP_AT_LEAST'; level: RelationshipLevel }
  | { type: 'WORLD_CHANGE'; changeKey: string }
  | { type: 'QUEST_COMPLETED'; questId: string }
  | { type: 'TIME_OF_DAY'; timeOfDay: TimeOfDay };

/**
 * One authored thing an NPC can say. `text` is authored copy, never model
 * output: CLAUDE.md section 7 requires every AI response to have an authored
 * fallback, and here the authored line *is* the content — Chatty may later
 * re-narrate it (see `narration`), but the child always has something safe
 * to read if that call fails or a parent has AI switched off.
 */
export interface DialogueNode {
  id: string;
  /** Shown only when every condition passes; first matching node wins. */
  conditions: NpcCondition[];
  text: string;
  /** Bounded follow-ups. An empty array ends the exchange; there is no free-text reply. */
  choices: DialogueChoice[];
  /**
   * Flags to set when this node is shown. The mechanism behind the
   * roadmap's `bridgeQuestCompleted` example: meeting an NPC is itself a
   * remembered event.
   */
  setsMemoryFlags?: readonly string[];
  /** Relationship points awarded the first time this node is reached. */
  awardsRelationshipPoints?: number;
  /**
   * Marks a node reachable only by following a choice, never as the opening
   * line of a conversation. Without this, a mid-conversation node carrying
   * broad conditions shadows the general greeting that follows it in
   * authored order, and a child who walks up to an NPC is dropped into the
   * middle of an exchange. Absent means the node may open a conversation.
   */
  followUpOnly?: boolean;
  /**
   * Opt-in marker that this authored line may be re-narrated by Chatty
   * (Phase 27's AI Tutor Engine). Absent means "authored text only, never
   * sent to a model" — the safe default, so adding an NPC does not silently
   * add an AI surface.
   */
  narration?: NpcNarrationHint;
}

export interface DialogueChoice {
  id: string;
  /** Child-facing label. Readable aloud and localizable (CLAUDE.md section 13). */
  label: string;
  /** Node to show next, or absent to end the conversation warmly. */
  nextNodeId?: string;
  conditions?: NpcCondition[];
}

/**
 * The bounded contract for letting Chatty re-voice an authored NPC line
 * (roadmap Phase 23: "controlled integration points for Chatty-narrated
 * dialogue, bounded by the same authored-schema rules"). It carries no child
 * data at all — the AI Tutor Engine adds age band and length caps at call
 * time from its own safe-context builder. Nothing in this module calls
 * Bedrock; this is the shape a Phase 27 caller must fill in.
 */
export interface NpcNarrationHint {
  /** Allowed topic passed to the companion route, per CLAUDE.md section 7. */
  allowedTopic: string;
  /** The authored line that must render if generation fails, is invalid, or AI is off. */
  fallbackText: string;
}

/**
 * A quest this NPC can offer. Phase 23 owns only the *offer* — which NPC
 * offers what, and under which conditions. The quest's own objectives,
 * progression, and rewards belong to the Phase 25 Quest Engine, which does
 * not exist yet; `questId` is the seam between them, so this phase ships a
 * quest-giver without inventing a quest model that Phase 25 would have to
 * migrate.
 */
export interface NpcQuestOffer {
  questId: string;
  /** Child-facing one-line summary of the ask. */
  summary: string;
  conditions: NpcCondition[];
}

/** An island character's authored, child-independent definition. */
export interface NpcDefinition {
  id: NpcId;
  /** Child-facing name, e.g. "Pirate Pip". */
  displayName: string;
  /** One-line description for parent/admin surfaces, not child-facing copy. */
  role: string;
  /** Where this NPC lives when no schedule entry matches. */
  homeLocationSlug: string;
  /**
   * Must resolve to a `type: 'NPC'` entry in the matching location's
   * `WorldInteraction` list, joining this domain NPC to its rendered body.
   */
  interactionId: string;
  schedule: NpcScheduleEntry[];
  dialogue: DialogueNode[];
  questOffers: NpcQuestOffer[];
}

/** Per-child, per-NPC state as persisted by `api.ts`. */
export interface NpcRelationshipState {
  npcId: NpcId;
  relationshipPoints: number;
  memoryFlags: NpcMemoryFlags;
  /** Dialogue node IDs already reached, so one-time awards stay one-time. */
  seenNodeIds: readonly string[];
}
