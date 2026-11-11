/**
 * NPC Manager runtime API types (contract v1, docs/NPC_MANAGER_CONTRACTS.md section 5).
 *
 * Every response is parsed by `./parse.ts` before use. Nothing here decides an outcome: the
 * server chooses dialogue, evaluates spawn and availability conditions, and owns progress.
 */

import type {
  AdventureEvent,
  AnimationState,
  BehaviorType,
  ChoiceAction,
  DialogueMode,
  Emotion,
  NpcRole,
  Trigger,
  VariantAssetRole,
} from './vocabulary';

/** A frozen asset reference. Resolve `assetId@version`, or `assetId` when version is null. */
export interface NpcAssetRef {
  assetId: string;
  version: number | null;
}

export function assetRefKey(ref: NpcAssetRef): string {
  return ref.version === null ? ref.assetId : `${ref.assetId}@${ref.version}`;
}

export interface RuntimeVariant {
  variantKey: string;
  displayName: string;
  model: NpcAssetRef;
  portrait: NpcAssetRef | null;
  scale: number;
  rotationOffsetY: number;
  positionOffsetY: number;
  /** Runtime state to the model's clip name. Missing states use ANIMATION_FALLBACKS. */
  animationMap: Partial<Record<AnimationState, string>>;
  extras: { role: VariantAssetRole; asset: NpcAssetRef; attachPoint: string }[];
}

export interface RuntimeCharacter {
  npcId: string;
  displayName: string;
  role: NpcRole;
  ageBands: string[];
  personality: { traits?: string[]; tone?: string; catchphrases?: string[] };
  dialogueMode: DialogueMode;
  voiceProfile: string | null;
  defaultVariant: string | null;
  variants: RuntimeVariant[];
}

export interface Waypoint {
  x: number;
  z: number;
  pauseSeconds?: number;
}

export type ScriptedStep =
  | { action: 'moveTo'; x: number; z: number }
  | { action: 'play'; state: AnimationState }
  | { action: 'wait'; seconds: number }
  | { action: 'face'; yaw: number };

/** Parameters with server defaults filled (`apps/npcs/behaviors.py` runtime_parameters). */
export interface BehaviorParameters {
  boundsRadius: number;
  reactions: Partial<Record<AdventureEvent, AnimationState>>;
  facePlayer?: boolean;
  radius?: number;
  speed?: number;
  pauseSeconds?: [number, number];
  waypoints?: Waypoint[];
  loop?: boolean;
  stopDistance?: number;
  giveUpDistance?: number;
  waitForPlayerDistance?: number;
  steps?: ScriptedStep[];
}

export interface BehaviorSpec {
  key: string;
  type: BehaviorType;
  parameters: BehaviorParameters;
}

export interface RuntimePlacement {
  placementKey: string;
  npcId: string;
  /** Already resolved by the server (placement variant, availability, then default). */
  variant: string;
  behavior: BehaviorSpec | null;
  position: { x: number; y: number; z: number };
  rotationY: number;
  scale: number;
  interactionRadius: number;
}

/** GET children/<child>/npcs/ */
export interface NpcCatalogResponse {
  contractVersion: number;
  release: number;
  characters: RuntimeCharacter[];
}

/** GET .../regions/<area>/npcs/ and .../places/<place>/npcs/ */
export interface NpcSceneResponse {
  contractVersion: number;
  release: number;
  scope: { place: string; area: string | null };
  characters: Record<string, RuntimeCharacter>;
  placements: RuntimePlacement[];
}

/** A server-approved speech reference for the speech API (ADR-049); text is never sent. */
export interface NpcSpeechRef {
  kind: 'npcDialogueNode';
  npcId: string;
  release: number;
  dialogueKey: string;
  nodeKey: string;
}

export interface RuntimeNode {
  nodeKey: string;
  text: string;
  emotion: Emotion;
  animationState: AnimationState | null;
  audio: NpcAssetRef | null;
  speech: NpcSpeechRef | null;
  allowAiHint: boolean;
}

export interface RuntimeChoice {
  choiceKey: string;
  label: string;
  action: ChoiceAction;
}

/** POST .../interactions/ and every interaction action. */
export interface InteractionResponse {
  contractVersion: number;
  release: number;
  npcId: string;
  conversationId: string | null;
  dialogueKey: string | null;
  node: RuntimeNode | null;
  /** Only choices whose conditions hold for this child. */
  choices: RuntimeChoice[];
  ended: boolean;
  /** Set after an OFFER_QUEST choice: the client shows the quest offer; accepting it is the
   * child's own tap through the quests API. */
  questOffer: { questId: string } | null;
}

export interface InteractionStartRequest {
  trigger: Trigger;
  placementKey?: string;
}

/** POST .../interactions/<conversation>/hint/ (hybrid mode). */
export interface HintResponse {
  contractVersion: number;
  hint: { text: string; source: 'AI' | 'FALLBACK'; speech: NpcSpeechHintRef | null };
}

/** A hint is spoken from an ApprovedUtterance (ADR-049), never from client-sent text. */
export interface NpcSpeechHintRef {
  kind: 'utterance';
  id: string;
}
