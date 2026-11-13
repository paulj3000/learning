import { AnimationClip } from 'three';
import type { AnimationState } from '../../npc-manager/contracts/vocabulary';
import type { MovementState } from './firstPersonController';
import { effectivePlayerAnimationMap, type PlayerAnimationState } from './playerAvatarCatalog';

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
  /** LAI-JMP-01c: its own falling clip. Absent means no. */
  hasFallClip?: boolean;
  /** LAI-JMP-01c: its own landing clip. Absent means no. */
  hasLandClip?: boolean;
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
      return context.hasJumpClip ? 'jump' : ground;
    case 'FALLING':
      if (context.hasFallClip) return 'fall';
      return context.hasJumpClip ? 'jump' : ground;
    case 'LANDING':
      return context.hasLandClip ? 'land' : ground;
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
  The player animation controller (LAI-JMP-01a, extended by LAI-JMP-01c). It owns no mixer of
  its own: it drives the NPC Manager's animator (crossfades, clip fallback, procedural motion for
  a model with no clips, reduced motion) with player states.

  The avatar's map is in player states (`playerAvatarCatalog.ts`: idle, walk, run, jump, fall,
  land, interact, celebrate), the same vocabulary Django serves. It is translated once into the
  animator's vocabulary (interact plays as `point`). The controller only ever asks for a state the
  map really has (idle and walk aside), so the NPC fallback chains never turn a jump into a
  celebration.
*/

/** The animator `animationMap` for a player-state map. */
export function toAnimatorMap(
  playerMap: Readonly<Partial<Record<PlayerAnimationState, string>>>,
): Partial<Record<AnimationState, string>> {
  const map: Partial<Record<AnimationState, string>> = {};
  for (const state of ['idle', 'walk', 'run', 'jump', 'fall', 'land', 'celebrate'] as const) {
    const clip = playerMap[state];
    if (clip) map[state] = clip;
  }
  if (playerMap.interact) map.point = playerMap.interact;
  return map;
}

/**
 * The player-state map for a model that authors `clipNames`, with no published map: the
 * standard clip names (`PLAYER_DEFAULT_CLIPS`).
 */
export function playerAnimationMap(
  clipNames: readonly string[],
): Partial<Record<PlayerAnimationState, string>> {
  return effectivePlayerAnimationMap({}, clipNames);
}

/** The part of `NpcAnimator` the player controller uses. */
export interface PlayerAnimatorTarget extends BaseAnimator {
  play(state: AnimationState, request?: { mode?: 'once' | 'loop'; priority?: number }): boolean;
  setTimeScale(scale: number): void;
}

export interface PlayerAnimationController {
  /**
   * Once per frame. `walkSpeed` is the controller's top walking speed, so the walk cycle plays
   * at its authored speed at full stick and slower when creeping (feet do not skate).
   */
  update(movement: MovementState, horizontalSpeed: number, walkSpeed: number): AnimationState;
  /** A short gesture when the child interacts, if the avatar has one. False when it has none. */
  interact(): boolean;
  /** A celebration (a world change, a find), if the avatar has one. False when it has none. */
  celebrate(): boolean;
}

/** Above the behaviour band, below dialogue: a gesture that ends by itself. */
const GESTURE_PRIORITY = 1;
const MIN_WALK_TIME_SCALE = 0.6;
const MAX_WALK_TIME_SCALE = 1.25;

export function createPlayerAnimationController(
  animator: PlayerAnimatorTarget,
  playerMap: Readonly<Partial<Record<PlayerAnimationState, string>>>,
): PlayerAnimationController {
  const driver = createPlayerAnimationDriver(animator);
  const clips: PlayerAnimationContext = {
    horizontalSpeed: 0,
    hasJumpClip: playerMap.jump !== undefined,
    hasFallClip: playerMap.fall !== undefined,
    hasLandClip: playerMap.land !== undefined,
  };
  let timeScale = 1;

  const gesture = (state: AnimationState, available: boolean) =>
    available ? animator.play(state, { mode: 'once', priority: GESTURE_PRIORITY }) : false;

  return {
    update(movement, horizontalSpeed, walkSpeed) {
      clips.horizontalSpeed = horizontalSpeed;
      const state = driver.update(movement, clips);
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
    interact: () => gesture('point', playerMap.interact !== undefined),
    celebrate: () => gesture('celebrate', playerMap.celebrate !== undefined),
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
