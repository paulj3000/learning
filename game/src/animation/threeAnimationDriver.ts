/**
 * A thin driver that applies an `AnimationFrame` (clip weights and speeds) to a
 * `THREE.AnimationMixer` (GE-030). It holds no animation logic: weights come from the state
 * machine. It is written against minimal `MixerLike` and `ActionLike` shapes so a fake mixer
 * tests it; a real `AnimationMixer` and `AnimationAction` satisfy them.
 */

import { LoopOnce, LoopRepeat, type AnimationClip } from 'three';
import type { AnimationFrame } from './animationStateMachine';

export interface ActionLike {
  enabled: boolean;
  clampWhenFinished: boolean;
  play(): unknown;
  stop(): unknown;
  reset(): unknown;
  setLoop(mode: number, repetitions: number): unknown;
  setEffectiveWeight(weight: number): unknown;
  setEffectiveTimeScale(scale: number): unknown;
}

export interface MixerLike {
  clipAction(clip: AnimationClip): ActionLike;
  update(deltaSeconds: number): unknown;
}

/** Weights under this are treated as off, so a faded-out clip stops costing mixer time. */
const OFF = 1e-3;

export interface ThreeAnimationDriver {
  /** Applies one frame's weights and speeds. Call before `update`. */
  apply(frame: AnimationFrame): void;
  /** Advances the mixer. */
  update(deltaSeconds: number): void;
  /** Clip names the driver can play. */
  clipNames(): string[];
  /** Weights currently applied, for diagnostics and tests. */
  appliedWeights(): Readonly<Record<string, number>>;
  dispose(): void;
}

export function createThreeAnimationDriver(mixer: MixerLike, clips: readonly AnimationClip[]): ThreeAnimationDriver {
  const actions = new Map<string, ActionLike>();
  const applied: Record<string, number> = {};
  for (const clip of clips) {
    if (!actions.has(clip.name)) {
      actions.set(clip.name, mixer.clipAction(clip));
    }
  }

  return {
    apply(frame) {
      const oneShots = new Set(frame.oneShots);
      for (const [name, action] of actions) {
        const weight = frame.weights[name] ?? 0;
        if (weight <= OFF) {
          if ((applied[name] ?? 0) > OFF) {
            action.setEffectiveWeight(0);
            action.stop();
          }
          applied[name] = 0;
          continue;
        }
        const starting = (applied[name] ?? 0) <= OFF;
        if (starting) {
          action.reset();
          action.enabled = true;
          if (oneShots.has(name)) {
            action.setLoop(LoopOnce, 1);
            action.clampWhenFinished = true;
          } else {
            action.setLoop(LoopRepeat, Infinity);
            action.clampWhenFinished = false;
          }
        }
        action.setEffectiveWeight(weight);
        action.setEffectiveTimeScale(frame.timeScales[name] ?? 1);
        // A finished, clamped one-shot is not restarted: it holds its last pose.
        if (starting) {
          action.play();
        }
        applied[name] = weight;
      }
    },
    update(deltaSeconds) {
      mixer.update(deltaSeconds);
    },
    clipNames: () => [...actions.keys()],
    appliedWeights: () => ({ ...applied }),
    dispose() {
      for (const action of actions.values()) {
        action.stop();
      }
      actions.clear();
    },
  };
}
