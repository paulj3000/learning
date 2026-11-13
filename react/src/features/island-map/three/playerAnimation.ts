import { AnimationClip } from 'three';
import type { AnimationState } from '../../npc-manager/contracts/vocabulary';
import type { MovementState } from './firstPersonController';

/**
 * Player body animation for jumping (LAI-JMP-01), on top of the existing
 * animation system: the NPC Manager's animator (`npc-manager/animation/
 * npcAnimator.ts`) and its shared state vocabulary (`idle`, `walk`, `run`,
 * `jump`, ...), which already resolves a state to a GLB clip through an
 * avatar's `animationMap` and fades between clips.
 *
 *   Idle -> Walk -> Jump Start -> Airborne / Falling -> Landing -> Idle / Walk
 *
 * LAI-JMP-01a draws the avatar in third-person (`playerAvatar.ts`) and drives
 * it through `createPlayerAnimationController` below. It never breaks an
 * avatar without a jump clip: the jump states
 * then keep the ground clip the avatar was already playing (rather than the
 * NPC fallback chain, which would turn a jump into a celebration).
 */

export interface PlayerAnimationContext {
  /** Horizontal speed, m/s. */
  horizontalSpeed: number;
  /** Whether this avatar has its own jump clip (its `animationMap` names one). */
  hasJumpClip: boolean;
}

/** Above this horizontal speed a landing goes straight back to walking. */
const MOVING_SPEED = 0.2;

/** The vocabulary state the avatar should show for a movement state. */
export function playerAnimationState(
  movement: MovementState,
  context: PlayerAnimationContext,
): AnimationState {
  const moving = context.horizontalSpeed > MOVING_SPEED;
  const ground: AnimationState = moving ? 'walk' : 'idle';
  switch (movement) {
    case 'IDLE':
      return 'idle';
    case 'WALK':
      return 'walk';
    case 'JUMP_START':
    case 'AIRBORNE':
    case 'FALLING':
      return context.hasJumpClip ? 'jump' : ground;
    case 'LANDING':
      return ground;
  }
}

/** The part of `NpcAnimator` the driver needs. */
export interface BaseAnimator {
  setBase(state: AnimationState): void;
}

export interface PlayerAnimationDriver {
  /** Call once per frame; changes the animator's base state only when it changes. */
  update(movement: MovementState, context: PlayerAnimationContext): AnimationState;
}

export function createPlayerAnimationDriver(animator: BaseAnimator): PlayerAnimationDriver {
  let current: AnimationState | null = null;
  return {
    update(movement, context) {
      const next = playerAnimationState(movement, context);
      if (next !== current) {
        current = next;
        animator.setBase(next);
      }
      return next;
    },
  };
}

/*
  LAI-JMP-01a: the player animation controller. It owns no mixer of its own:
  it drives the NPC Manager's animator (crossfades, clip fallback, procedural
  motion for a model with no clips, reduced motion) with player states.
*/

/**
 * Which GLB clip names play each vocabulary state for a player avatar, in
 * order of preference (`docs/PLAYER_AVATAR_AND_CAMERA.md`, "GLB animation
 * naming"). `Celebrate` is deliberately not mapped: a jump must never fall back
 * to a celebration. `Run` is reserved for a future run speed.
 */
export const PLAYER_CLIP_CANDIDATES: Readonly<Partial<Record<AnimationState, readonly string[]>>> =
  {
    idle: ['Idle'],
    walk: ['Walk'],
    run: ['Run'],
    jump: ['Jump'],
    point: ['Point'],
    wave: ['Wave'],
    talk: ['Talk'],
  };

/** The animator `animationMap` for an avatar whose GLB authors `clipNames`. */
export function playerAnimationMap(
  clipNames: readonly string[],
): Partial<Record<AnimationState, string>> {
  const available = new Set(clipNames);
  const map: Partial<Record<AnimationState, string>> = {};
  for (const [state, candidates] of Object.entries(PLAYER_CLIP_CANDIDATES) as [
    AnimationState,
    readonly string[],
  ][]) {
    const clip = candidates.find((name) => available.has(name));
    if (clip) map[state] = clip;
  }
  return map;
}

/** The part of `NpcAnimator` the player controller uses. */
export interface PlayerAnimatorTarget extends BaseAnimator {
  play(state: AnimationState, request?: { mode?: 'once' | 'loop'; priority?: number }): boolean;
  setTimeScale(scale: number): void;
}

export interface PlayerAnimationController {
  /**
   * Once per frame. `walkSpeed` is the controller's top walking speed, so the
   * walk cycle plays at its authored speed at full stick and slower when
   * creeping (feet do not skate).
   */
  update(movement: MovementState, horizontalSpeed: number, walkSpeed: number): AnimationState;
  /** A short gesture when the child interacts, if the avatar has one. False when it has none. */
  interact(): boolean;
}

/** Above the behaviour band, below dialogue: a gesture that ends by itself. */
const INTERACT_PRIORITY = 1;
const MIN_WALK_TIME_SCALE = 0.6;
const MAX_WALK_TIME_SCALE = 1.25;

export function createPlayerAnimationController(
  animator: PlayerAnimatorTarget,
  animationMap: Partial<Record<AnimationState, string>>,
): PlayerAnimationController {
  const driver = createPlayerAnimationDriver(animator);
  const hasJumpClip = animationMap.jump !== undefined;
  const gesture: AnimationState | null =
    animationMap.point !== undefined ? 'point' : animationMap.wave !== undefined ? 'wave' : null;
  let timeScale = 1;

  return {
    update(movement, horizontalSpeed, walkSpeed) {
      const state = driver.update(movement, { horizontalSpeed, hasJumpClip });
      const next =
        state === 'walk' && walkSpeed > 0
          ? Math.min(
              MAX_WALK_TIME_SCALE,
              Math.max(MIN_WALK_TIME_SCALE, horizontalSpeed / walkSpeed),
            )
          : 1;
      // Only on a real change, so the mixer is not touched every frame.
      if (Math.abs(next - timeScale) > 0.02) {
        timeScale = next;
        animator.setTimeScale(next);
      }
      return state;
    },
    interact() {
      if (!gesture) return false;
      return animator.play(gesture, { mode: 'once', priority: INTERACT_PRIORITY });
    },
  };
}

/**
 * Clips without root motion: position tracks on the model's top-level nodes
 * (where exporters put root motion) are dropped, so an animation can never
 * carry the avatar away from where the movement controller put it, through a
 * wall or past a gate. Bone rotations, and positions deeper in the rig (a hip
 * bob), are kept.
 */
export function withoutRootMotion(
  clips: readonly AnimationClip[],
  rootNodeNames: ReadonlySet<string>,
): AnimationClip[] {
  return clips.map((clip) => {
    const tracks = clip.tracks.filter((track) => {
      const dot = track.name.lastIndexOf('.');
      const node = track.name.slice(0, dot);
      const property = track.name.slice(dot + 1);
      return !(property === 'position' && (node === '' || rootNodeNames.has(node)));
    });
    return tracks.length === clip.tracks.length
      ? clip
      : new AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
  });
}
