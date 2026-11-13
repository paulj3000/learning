/**
 * NPC Manager closed vocabularies (ADR-054, contract version 1).
 *
 * Mirror of `lai/apps/npcs/vocabulary.py`; `lai/apps/npcs/tests/test_contract_mirror.py`
 * fails when the two drift. Never rename a value; add one only through a recorded contract
 * change (docs/NPC_MANAGER_CONTRACTS.md).
 */

export const CONTRACT_VERSION = 1;

export const NPC_ROLES = [
  'GUIDE',
  'COMPANION',
  'QUEST_GIVER',
  'STORYTELLER',
  'TEACHER',
  'MERCHANT',
  'INTERACTIVE',
  'AMBIENT',
] as const;
export type NpcRole = (typeof NPC_ROLES)[number];

export const DIALOGUE_MODES = ['AUTHORED', 'HYBRID', 'AI'] as const;
export type DialogueMode = (typeof DIALOGUE_MODES)[number];

export const ANIMATION_STATES = [
  'idle',
  'walk',
  'run',
  'talk',
  'wave',
  'point',
  'celebrate',
  'think',
  'sad',
  'laugh',
  'jump',
  // LAI-JMP-01c: air states for the player avatar (an NPC may use them too). Additive, so existing
  // releases and CONTRACT_VERSION are unchanged.
  'fall',
  'land',
] as const;
export type AnimationState = (typeof ANIMATION_STATES)[number];

export const LOOPING_ANIMATION_STATES: ReadonlySet<AnimationState> = new Set([
  'idle',
  'walk',
  'run',
  'talk',
  'think',
  'fall',
]);

/** Tried in order when a variant has no clip for a state; then 'idle'. */
export const ANIMATION_FALLBACKS: Readonly<Record<AnimationState, readonly AnimationState[]>> = {
  idle: [],
  walk: ['idle'],
  run: ['walk', 'idle'],
  talk: ['idle'],
  wave: ['talk', 'idle'],
  point: ['wave', 'talk', 'idle'],
  celebrate: ['laugh', 'wave', 'jump', 'idle'],
  think: ['idle'],
  sad: ['idle'],
  laugh: ['celebrate', 'talk', 'idle'],
  jump: ['celebrate', 'idle'],
  fall: ['jump', 'idle'],
  land: ['idle'],
};

/**
 * Animation priority bands. A request at a higher band preempts a lower one; a one-shot
 * returns to the behaviour's base state when it finishes.
 */
export const ANIMATION_PRIORITY = {
  behavior: 0,
  reaction: 1,
  dialogue: 2,
  scripted: 3,
} as const;

export const TRIGGERS = [
  'on_spawn',
  'on_player_near',
  'on_interact',
  'on_adventure_start',
  'on_challenge_start',
  'on_correct_answer',
  'on_incorrect_answer',
  'on_treasure_found',
  'on_quest_complete',
  'on_adventure_complete',
  'on_return_visit',
] as const;
export type Trigger = (typeof TRIGGERS)[number];

export const ADVENTURE_EVENTS = [
  'adventure.started',
  'adventure.resumed',
  'challenge.started',
  'answer.correct',
  'answer.incorrect',
  'treasure.found',
  'quest.completed',
  'adventure.completed',
] as const;
export type AdventureEvent = (typeof ADVENTURE_EVENTS)[number];

export const DIALOGUE_EVENTS = [
  'dialogue.started',
  'dialogue.node_entered',
  'dialogue.choice_made',
  'dialogue.ended',
  'dialogue.interrupted',
] as const;
export type DialogueEventName = (typeof DIALOGUE_EVENTS)[number];

export const EMOTIONS = [
  'neutral',
  'happy',
  'excited',
  'curious',
  'thinking',
  'sad',
  'surprised',
  'proud',
] as const;
export type Emotion = (typeof EMOTIONS)[number];

export const CHOICE_ACTIONS = [
  'NONE',
  'END',
  'SET_LOCAL_FLAG',
  'OFFER_QUEST',
  'REQUEST_HINT',
] as const;
export type ChoiceAction = (typeof CHOICE_ACTIONS)[number];

export const BEHAVIOR_TYPES = [
  'stationary',
  'wander',
  'patrol',
  'follow',
  'guide',
  'reactive',
  'scripted',
] as const;
export type BehaviorType = (typeof BEHAVIOR_TYPES)[number];

export const VARIANT_ASSET_ROLES = ['TEXTURE', 'ACCESSORY', 'PORTRAIT', 'AUDIO'] as const;
export type VariantAssetRole = (typeof VARIANT_ASSET_ROLES)[number];

export const ERROR_CODES = [
  'npc_not_found',
  'no_active_release',
  'place_not_found',
  'area_not_found',
  'dialogue_unavailable',
  'conversation_not_found',
  'conversation_ended',
  'invalid_choice',
  'invalid_trigger',
  'ai_unavailable',
  'rate_limited',
] as const;
export type NpcErrorCode = (typeof ERROR_CODES)[number];
