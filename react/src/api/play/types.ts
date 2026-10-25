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
export type ChallengeOperation = 'COUNT' | 'ADD' | 'SUBTRACT';
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
}

export interface ObjectPlacement extends PlacedEntity {
  kind: PlacementKind;
  interactionId: string;
}

export interface ChestState extends PlacedEntity {
  openClip: string;
  isOpen: boolean;
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
