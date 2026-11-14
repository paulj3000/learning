/**
 * The player avatar contract (LAI-JMP-01c): what the play API says a child's 3D avatar is, and
 * the vocabulary it uses. Mirrors `lai/apps/avatars/vocabulary.py`; the Django test
 * `test_contract_mirror.py` fails if the two drift apart.
 *
 * Pure: no Three.js, no DOM, no network. `parsePlayerAvatar` validates the answer at runtime, so
 * anything malformed is treated as "no model" and the child gets the placeholder.
 */

/** Player animation states an avatar's `animationMap` may name. `run` is reserved. */
export const PLAYER_ANIMATION_STATES = [
  'idle',
  'walk',
  'run',
  'jump',
  'fall',
  'land',
  'interact',
  'celebrate',
] as const;
export type PlayerAnimationState = (typeof PLAYER_ANIMATION_STATES)[number];

/** Clip names tried, in order, for a state the map leaves out (the GLB naming convention). */
export const PLAYER_DEFAULT_CLIPS: Readonly<Record<PlayerAnimationState, readonly string[]>> = {
  idle: ['Idle'],
  walk: ['Walk'],
  run: ['Run'],
  jump: ['Jump'],
  fall: ['Fall'],
  land: ['Land'],
  interact: ['Point', 'Wave', 'Activate'],
  celebrate: ['Celebrate'],
};

/** Named places on a model where future cosmetics attach (hats, backpacks, shoes...). */
export const ATTACHMENT_SLOTS = ['head', 'back', 'hand_left', 'hand_right', 'feet'] as const;
export type AttachmentSlot = (typeof ATTACHMENT_SLOTS)[number];

/** Which of the child's avatar colours (`avatarAppearance.ts`) a named material takes. */
export const COLOR_ROLES = ['body', 'accent'] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

export interface PlayerAvatarCustomization {
  /** Material name in the GLB to the child's colour it takes. */
  colorMaterials: Readonly<Record<string, ColorRole>>;
  /** Attachment slot to the node or bone name in the GLB. */
  attachPoints: Readonly<Partial<Record<AttachmentSlot, string>>>;
}

/** A published model for an avatar identity, as the play API serves it. */
export interface PlayerAvatarModel {
  /** What to load through the asset resolver: `asset-id` or a pinned `asset-id@n`. */
  ref: string;
  assetId: string;
  version: number;
  clips: readonly string[];
  scale: number;
  /** Radians added to the model's facing. */
  rotationOffset: number;
  animationMap: Readonly<Partial<Record<PlayerAnimationState, string>>>;
  customization: PlayerAvatarCustomization;
}

export interface PlayerAvatarAnswer {
  avatarKey: string;
  displayName: string;
  /** `null`: no published model for this identity; the child gets the placeholder. */
  model: PlayerAvatarModel | null;
  /** Why there is no model (`not_configured`, `not_available`, `invalid`, `retired`, ...). */
  reason: string | null;
}

export const NO_CUSTOMIZATION: PlayerAvatarCustomization = Object.freeze({
  colorMaterials: Object.freeze({}),
  attachPoints: Object.freeze({}),
});

type Fields = Record<string, unknown>;

function isObject(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const REF = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:@[1-9][0-9]{0,5})?$/;
const MIN_SCALE = 0.2;
const MAX_SCALE = 5;

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return (list as readonly unknown[]).includes(value);
}

function parseCustomization(raw: unknown): PlayerAvatarCustomization {
  if (!isObject(raw)) return NO_CUSTOMIZATION;
  const colorMaterials: Record<string, ColorRole> = {};
  if (isObject(raw.colorMaterials)) {
    for (const [material, role] of Object.entries(raw.colorMaterials)) {
      if (material.trim() && isOneOf(COLOR_ROLES, role)) colorMaterials[material] = role;
    }
  }
  const attachPoints: Partial<Record<AttachmentSlot, string>> = {};
  if (isObject(raw.attachPoints)) {
    for (const [slot, node] of Object.entries(raw.attachPoints)) {
      if (isOneOf(ATTACHMENT_SLOTS, slot) && typeof node === 'string' && node.trim()) {
        attachPoints[slot] = node;
      }
    }
  }
  return { colorMaterials, attachPoints };
}

function parseModel(raw: unknown): PlayerAvatarModel | null {
  if (!isObject(raw)) return null;
  const { ref, assetId, version, clips, scale, rotationOffset, animationMap } = raw;
  if (typeof ref !== 'string' || !REF.test(ref)) return null;
  if (typeof assetId !== 'string' || !ref.startsWith(assetId)) return null;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return null;
  if (!Array.isArray(clips) || !clips.every((clip) => typeof clip === 'string')) return null;
  if (typeof scale !== 'number' || !(scale >= MIN_SCALE && scale <= MAX_SCALE)) return null;
  if (typeof rotationOffset !== 'number' || !Number.isFinite(rotationOffset)) return null;
  const map: Partial<Record<PlayerAnimationState, string>> = {};
  if (isObject(animationMap)) {
    for (const [state, clip] of Object.entries(animationMap)) {
      // Only clips the model really has: a stale map never asks the mixer for a missing clip.
      if (
        isOneOf(PLAYER_ANIMATION_STATES, state) &&
        typeof clip === 'string' &&
        clips.includes(clip)
      ) {
        map[state] = clip;
      }
    }
  }
  return {
    ref,
    assetId,
    version,
    clips: [...(clips as string[])],
    scale,
    rotationOffset,
    animationMap: map,
    customization: parseCustomization(raw.customization),
  };
}

/** The play API's answer, validated; `null` when it is not an avatar answer at all. */
export function parsePlayerAvatar(raw: unknown): PlayerAvatarAnswer | null {
  if (!isObject(raw) || typeof raw.avatarKey !== 'string') return null;
  return {
    avatarKey: raw.avatarKey,
    displayName: typeof raw.displayName === 'string' ? raw.displayName : '',
    model: raw.model === null ? null : parseModel(raw.model),
    reason: typeof raw.reason === 'string' ? raw.reason : null,
  };
}

/**
 * Each state to the clip that plays it: the published map, else the standard clip names. The
 * same rule as Django's `effective_animation_map`, so a model loaded without an answer (a
 * location costume) animates the same way.
 */
export function effectivePlayerAnimationMap(
  explicit: Readonly<Partial<Record<PlayerAnimationState, string>>>,
  clips: readonly string[],
): Partial<Record<PlayerAnimationState, string>> {
  const available = new Set(clips);
  const resolved: Partial<Record<PlayerAnimationState, string>> = {};
  for (const state of PLAYER_ANIMATION_STATES) {
    const named = explicit[state];
    if (named && available.has(named)) {
      resolved[state] = named;
      continue;
    }
    const fallback = PLAYER_DEFAULT_CLIPS[state].find((candidate) => available.has(candidate));
    if (fallback) resolved[state] = fallback;
  }
  return resolved;
}
