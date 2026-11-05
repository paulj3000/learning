/**
 * The behaviour state machine (LAI-NPC-020). Pure logic, no Three.js, React or network.
 *
 * - Every state change goes through `BEHAVIOR_TRANSITIONS`; an illegal one is ignored and
 *   `transition` returns false, so a caller (and a test) can see it was refused.
 * - `interrupt(progress)` works from any state except `interrupted` itself: it remembers the
 *   prior state and the caller's progress snapshot (waypoint index, step index, remaining pause,
 *   ...). `resume()` restores that exact state and hands the snapshot back. `interrupted` is left
 *   only through `resume()`, never through `transition`.
 * - Every state change queues an `npc.behavior_changed` event; `drain()` hands them over once.
 * - `dispose()` stops everything: later calls are no-ops and nothing more is emitted.
 */

import type { BehaviorState, NpcEngineEvent } from '../contracts/engine';

export const BEHAVIOR_STATES: readonly BehaviorState[] = [
  'idle',
  'moving',
  'paused',
  'following',
  'waiting_for_player',
  'reacting',
  'interrupted',
  'returning',
];

/** Legal `from -> to` changes. `interrupted` is reached by `interrupt` and left by `resume`. */
export const BEHAVIOR_TRANSITIONS: Readonly<Record<BehaviorState, readonly BehaviorState[]>> = {
  idle: ['moving', 'paused', 'following', 'waiting_for_player', 'reacting', 'returning'],
  moving: ['idle', 'paused', 'waiting_for_player', 'reacting', 'returning'],
  paused: ['idle', 'moving', 'waiting_for_player', 'reacting', 'returning'],
  following: ['idle', 'returning', 'reacting'],
  waiting_for_player: ['idle', 'moving', 'reacting'],
  reacting: ['idle', 'moving', 'paused', 'following', 'waiting_for_player', 'returning'],
  returning: ['idle', 'moving', 'following', 'reacting'],
  interrupted: [],
};

export function canTransition(from: BehaviorState, to: BehaviorState): boolean {
  return BEHAVIOR_TRANSITIONS[from].includes(to);
}

export interface BehaviorMachine<P> {
  state(): BehaviorState;
  /** Changes state when the table allows it; false (and no event) otherwise or when unchanged. */
  transition(to: BehaviorState): boolean;
  /** Enters `interrupted`, remembering the current state and `progress`. False when ignored. */
  interrupt(progress: P): boolean;
  /** Leaves `interrupted` for the remembered state; returns the remembered progress, or null. */
  resume(): P | null;
  /** The state `resume()` would restore, or null when not interrupted. */
  interruptedFrom(): BehaviorState | null;
  /** Queues a non-state event (e.g. `npc.waypoint_reached`) for the next `drain`. */
  emit(event: NpcEngineEvent): void;
  /** Events since the last drain, in order (a shared empty array when there are none). */
  drain(): NpcEngineEvent[];
  dispose(): void;
  isDisposed(): boolean;
}

/** Frozen so a consumer that mutates the frame's events fails loudly instead of leaking. */
const NO_EVENTS = Object.freeze([]) as unknown as NpcEngineEvent[];

export function createBehaviorMachine<P>(
  placementKey: string,
  initial: BehaviorState = 'idle',
): BehaviorMachine<P> {
  let current: BehaviorState = initial;
  let remembered: { state: BehaviorState; progress: P } | null = null;
  let pending: NpcEngineEvent[] = [];
  let disposed = false;

  const enter = (to: BehaviorState) => {
    current = to;
    pending.push({ type: 'npc.behavior_changed', placementKey, state: to });
  };

  return {
    state: () => current,
    transition(to) {
      if (disposed || to === current || !canTransition(current, to)) return false;
      enter(to);
      return true;
    },
    interrupt(progress) {
      if (disposed || current === 'interrupted') return false;
      remembered = { state: current, progress };
      enter('interrupted');
      return true;
    },
    resume() {
      if (disposed || current !== 'interrupted' || remembered === null) return null;
      const { state, progress } = remembered;
      remembered = null;
      enter(state);
      return progress;
    },
    interruptedFrom: () => (current === 'interrupted' && remembered ? remembered.state : null),
    emit(event) {
      if (!disposed) pending.push(event);
    },
    drain() {
      if (pending.length === 0) return NO_EVENTS;
      const out = pending;
      pending = [];
      return out;
    },
    dispose() {
      disposed = true;
      remembered = null;
      pending = [];
    },
    isDisposed: () => disposed,
  };
}
