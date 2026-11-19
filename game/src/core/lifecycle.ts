/**
 * Engine lifecycle state machine.
 *
 *   created --start--> running <--pause/resume--> paused
 *      \                  \                         /
 *       +------------------+------dispose----------+--> disposed
 *
 * `start` may be awaited (scene and asset loading). While it runs the state is `starting`;
 * a `dispose` during `starting` wins: the start resolves into `disposed`, never `running`.
 * Any other transition throws `INVALID_STATE`, so a host bug (resume after dispose, double
 * start) fails loudly in development instead of corrupting a world.
 */

import { EngineError } from './errors';

export type LifecycleState = 'created' | 'starting' | 'running' | 'paused' | 'disposing' | 'disposed';

export type LifecycleTransition = 'start' | 'started' | 'pause' | 'resume' | 'dispose' | 'disposed';

const TRANSITIONS: Record<LifecycleTransition, { from: readonly LifecycleState[]; to: LifecycleState }> = {
  start: { from: ['created'], to: 'starting' },
  started: { from: ['starting'], to: 'running' },
  pause: { from: ['running'], to: 'paused' },
  resume: { from: ['paused'], to: 'running' },
  dispose: { from: ['created', 'starting', 'running', 'paused'], to: 'disposing' },
  disposed: { from: ['disposing'], to: 'disposed' },
};

export interface LifecycleMachine {
  readonly state: LifecycleState;
  can(transition: LifecycleTransition): boolean;
  /** Applies a transition or throws `INVALID_STATE`. Returns the new state. */
  apply(transition: LifecycleTransition): LifecycleState;
  onChange(listener: (state: LifecycleState, previous: LifecycleState) => void): () => void;
}

export function createLifecycle(): LifecycleMachine {
  let state: LifecycleState = 'created';
  const listeners = new Set<(state: LifecycleState, previous: LifecycleState) => void>();
  return {
    get state() {
      return state;
    },
    can(transition) {
      return TRANSITIONS[transition].from.includes(state);
    },
    apply(transition) {
      const rule = TRANSITIONS[transition];
      if (!rule.from.includes(state)) {
        throw new EngineError('INVALID_STATE', `Cannot ${transition} an engine that is ${state}`, {
          transition,
          state,
        });
      }
      const previous = state;
      state = rule.to;
      for (const listener of [...listeners]) {
        listener(state, previous);
      }
      return state;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
