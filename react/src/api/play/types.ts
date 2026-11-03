import type { JsonObject } from '../parse';

/**
 * The play API's response shapes (TR-5), exactly as documented in
 * docs/PLAY_API.md and produced by `lai/apps/game_sessions/serializers.py`.
 * Hand-owned DTOs (LAI-0501): change them only with the serializers.
 *
 * Positions are on the ground plane (`x`, `z`) with `elevation` above it.
 * `assetId` is a bundled-manifest id; `''` means "draw a placeholder of
 * `placeholder` size" (TR-7a). There are never URLs.
 */

export type AgeBand = 'SPROUT' | 'PATHFINDER' | 'EXPLORER';
export type SessionKind = 'ADVENTURE' | 'REGION';
export type SessionStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ABANDONED' | 'SAFETY_STOPPED';
export type SessionAction = 'pause' | 'resume' | 'complete' | 'abandon';
export type QuestStatus = 'AVAILABLE' | 'ACTIVE' | 'COMPLETED';
export type PlacementKind = 'PROP' | 'COLLECTIBLE' | 'SCENERY';
export type ItemCategory = 'COLLECTIBLE' | 'COSMETIC' | 'QUEST_ITEM' | 'KEEPSAKE';
export type ChallengeOperation = 'COUNT' | 'ADD' | 'SUBTRACT' | 'MULTIPLY';
export type ResponseMode = 'CHOICE' | 'NUMBER_INPUT';
export type AnswerFeedback = 'CORRECT' | 'TRY_AGAIN';

export interface Placeholder {
  width: number;
  height: number;
  depth: number;
}

/** Where a placed thing is, shared by NPCs, objects, and chests. */
export interface PlacedEntity {
  entityId: string;
  label: string;
  x: number;
  z: number;
  elevation: number;
  rotationY: number;
  scale: number;
  assetId: string;
  placeholder: Placeholder;
}

export interface RegionInfo {
  regionId: string;
  title: string;
  locationSlug: string;
  version: number;
  /** Bounds, environment, and copy in `ThreeLocationManifest` field names; validated by TR-7. */
  scene: JsonObject;
}

export interface SpawnPoint {
  checkpointId: string;
  label: string;
  x: number;
  z: number;
  /** Radians. */
  yaw: number;
}

export interface NpcPlacement extends PlacedEntity {
  npcId: string;
  displayName: string;
  interactionId: string;
  /** Authored dialogue whose conditions hold for this child now, in authored order (ADR-047). */
  dialogue: DialogueNodeView[];
}

export interface DialogueChoiceView {
  choiceId: string;
  label: string;
  nextNodeId: string | null;
}

/** An NPC dialogue node as the server served it: authored text, never generated. */
export interface DialogueNodeView {
  nodeId: string;
  text: string;
  /** Reached only through a choice's `nextNodeId`, never shown first. */
  followUpOnly: boolean;
  choices: DialogueChoiceView[];
}

export type PuzzleKind =
  'OBSERVE_FEATURES' | 'PLACE_PLATFORMS' | 'VALVE_SEQUENCE' | 'COLLECT_OBJECT' | 'RETURN_TO_NPC';

/**
 * A 3D Area puzzle for this child's age band (ADR-047 F, LAI-0812). `parameters` is the kind's
 * own shape, read by `region-play/areaPuzzles.ts`; the server grades every solution.
 */
export interface PuzzleState {
  puzzleId: string;
  kind: PuzzleKind;
  title: string;
  /** The placements this puzzle uses (stones, gaps, valves, the telescope, the crystal). */
  entityIds: string[];
  solved: boolean;
  /** An earlier stage is not done yet. */
  locked: boolean;
  /** Wrong tries in this visit, for offering a hint (never shown as a score). */
  failedAttempts: number;
  parameters: JsonObject;
}

/** What a served 3D Area names, so the client validates it against Django (ADR-047 A). */
export interface RegionCatalog {
  worldSlug: string;
  assets: CatalogAsset[];
}

export interface CatalogAsset {
  assetId: string;
  kind: string;
  clips: string[];
  /** False until a model is published or bundled; the client draws a stand-in meanwhile. */
  deliverable: boolean;
}

export interface ObjectPlacement extends PlacedEntity {
  kind: PlacementKind;
  interactionId: string;
  /** TR-14: a collectible the child picks up through the play API (a key). */
  pickup: boolean;
  /** TR-14: whether this child has picked it up. */
  collected: boolean;
}

/** How a chest appears (TR-14). `HIDDEN` is not drawn until it may be opened. */
export type ChestPresentation = 'CHEST' | 'HIDDEN' | 'PUZZLE' | 'REPLAY';
/** Why a chest is locked for this child: an earlier encounter, or an item they lack. */
export type ChestLockReason = 'PROGRESS' | 'ITEM';

export interface ChestState extends PlacedEntity {
  openClip: string;
  isOpen: boolean;
  /** TR-14 (absent from older servers: `CHEST`, order 0, unlocked). */
  presentation: ChestPresentation;
  sortOrder: number;
  locked: boolean;
  lockReason: ChestLockReason | null;
  requiredItemId: string | null;
  /** A puzzle's answer objects, one per choice, in choice order. */
  answerEntityIds: string[];
  /** Pip's line that sends the child here. */
  clue: string;
  /** False when no published challenge exists for this child's age band. */
  challengeAvailable: boolean;
}

export interface QuestObjectiveView {
  id: string;
  label: string;
  optional: boolean;
  complete: boolean;
}

export interface QuestStageView {
  id: string;
  title: string;
  complete: boolean;
  objectives: QuestObjectiveView[];
}

/** A quest offer (`AVAILABLE`) or the child's progress on one (`ACTIVE`, `COMPLETED`). */
export interface QuestEntry {
  questId: string;
  title: string;
  summary: string;
  giverNpcId: string | null;
  status: QuestStatus;
  currentStageId: string | null;
  completedAt: string | null;
  stages: QuestStageView[];
}

export interface PlaySession {
  sessionId: string;
  kind: SessionKind;
  regionId: string;
  templateSlug: string;
  locationSlug: string;
  status: SessionStatus;
  startedAt: string;
  lastActivityAt: string;
  completedAt: string | null;
}

export interface WorldChange {
  locationSlug: string;
  changeType: string;
  changeKey: string;
  payload: JsonObject;
  createdAt: string;
}

export interface ItemView {
  itemId: string;
  displayName: string;
  description: string;
  category: ItemCategory;
  assetId: string;
  /** The collectible set it belongs to (a Discovery Journal page, Firepeak FP-10). */
  setId: string | null;
  /** Present when the item is a Discovery Journal entry. */
  journal: ItemJournal | null;
}

export type JournalSubject =
  'EARTH_SCIENCE' | 'MATHEMATICS' | 'SPATIAL_REASONING' | 'PROBLEM_SOLVING';

export interface ItemJournal {
  subject: JournalSubject;
  questId: string;
  illustrationAssetId: string | null;
}

export interface InventoryEntry {
  item: ItemView;
  grantedAt: string;
}

export interface RegionBootstrap {
  region: RegionInfo;
  spawn: SpawnPoint | null;
  npcs: NpcPlacement[];
  objects: ObjectPlacement[];
  chests: ChestState[];
  quests: QuestEntry[];
  session: PlaySession | null;
  worldChanges: WorldChange[];
  /** Objects here that start one of this Place's Adventures, for this child (ADR-041). */
  launchPoints: LaunchPoint[];
  /** This 3D Area's puzzles for the child's age band (ADR-047, LAI-0812). */
  puzzles: PuzzleState[];
  catalog: RegionCatalog;
}

export type LaunchObjectKind = 'NPC' | 'CHEST' | 'DOOR' | 'SIGN' | 'OTHER';

/**
 * An object in a 3D Area that starts an Adventure (ADR-041). It names an entity already in
 * `npcs` or `objects`; where it stands is that placement's. The server has already filtered
 * these for the child, and checks again when one is started.
 */
export interface LaunchPoint {
  launchId: string;
  entityId: string;
  objectKind: LaunchObjectKind;
  label: string;
  prompt: string;
  adventure: { adventureId: string; title: string; placeSlug: string };
}

/** `POST .../launch-points/<id>/start/`: the Adventure session the server started or resumed. */
export interface LaunchStart {
  launchId: string;
  regionId: string;
  adventureId: string;
  placeSlug: string;
  sessionId: string;
  returnTo: { regionId: string };
}

/** What the child is shown. There is no answer field, by contract. */
export interface PublicChallenge {
  skillId: string;
  operation: ChallengeOperation;
  operands: number[];
  responseMode: ResponseMode;
  /** Ascending; empty for `NUMBER_INPUT`. */
  choices: number[];
}

export interface IssuedChallenge {
  attemptId: string;
  attemptNumber: number;
  sessionId: string;
  targetEntityId: string;
  ageBand: AgeBand;
  issuedAt: string;
  challenge: PublicChallenge;
}

export interface AnswerSubmission {
  /** A whole number; for `CHOICE`, one of the offered choices. */
  answer: number;
  /** Hints the child used (0 to 10). Recorded as support, never a penalty. */
  hintLevel?: number;
  durationMs?: number | null;
}

export interface QuestUpdate {
  questId: string;
  status: QuestStatus;
  currentStageId: string;
  justCompleted: boolean;
  newlyCompletedObjectiveIds: string[];
}

export interface AnswerOutcome {
  attemptId: string;
  correct: boolean;
  feedback: AnswerFeedback;
  canRetry: boolean;
  chestOpened: boolean;
  /** Only items the child did not own before this answer. */
  newItems: ItemView[];
  rewardMessage: string | null;
  questUpdates: QuestUpdate[];
  /** Rewards for finishing a quest with this answer (TR-14). */
  completionRewards: CompletionReward[];
}

export interface CompletionReward {
  ruleId: string;
  items: ItemView[];
  message: string;
}

/** Picking up a collectible (TR-14). `pickedUp` is false on a repeat. */
export interface PickupOutcome {
  entityId: string;
  pickedUp: boolean;
  collected: boolean;
  newItems: ItemView[];
  rewardMessage: string | null;
  questUpdates: QuestUpdate[];
  completionRewards: CompletionReward[];
}

/** Talking to an NPC in the region (TR-14): may complete a quest's TALK_TO objective. */
export interface TalkOutcome {
  flagsSet: string[];
  questUpdates: QuestUpdate[];
  completionRewards: CompletionReward[];
}

/** `POST .../puzzles/<id>/solve/`: graded on the server (LAI-0812). */
export interface PuzzleOutcome {
  attemptId: string | null;
  correct: boolean;
  feedback: AnswerFeedback;
  /** True only on the submission that solved it. */
  solvedNow: boolean;
  /** It was already solved; nothing new was recorded or granted. */
  alreadySolved: boolean;
  failedAttempts: number;
  newItems: ItemView[];
  rewardMessage: string | null;
  questUpdates: QuestUpdate[];
}

export interface OpenedChest {
  regionId: string;
  entityId: string;
}

export interface PracticeCount {
  objectiveCode: string;
  attempts: number;
  correct: number;
}

export interface PlayerProgress {
  sessions: PlaySession[];
  worldChanges: WorldChange[];
  openedChests: OpenedChest[];
  inventory: InventoryEntry[];
  quests: QuestEntry[];
  practice: PracticeCount[];
}

/** A `POST` that either created something (201) or returned what already existed (200). */
export interface Upserted<T> {
  value: T;
  created: boolean;
}
