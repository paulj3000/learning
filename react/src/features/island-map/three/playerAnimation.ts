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
 * The player is first-person today, so no avatar model is drawn and nothing
 * calls this yet; it is the contract the follow-up third-person avatar card
 * plugs into. It never breaks an avatar without a jump clip: the jump states
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
