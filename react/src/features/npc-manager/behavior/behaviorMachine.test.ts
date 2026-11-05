import { describe, expect, it } from 'vitest';
import type { BehaviorState } from '../contracts/engine';
import {
  BEHAVIOR_STATES,
  BEHAVIOR_TRANSITIONS,
  canTransition,
  createBehaviorMachine,
} from './behaviorMachine';

interface Progress {
  index: number;
  pauseRemaining: number;
}

/** Puts a fresh machine into `state` through legal moves only. */
function machineIn(state: BehaviorState) {
  const machine = createBehaviorMachine<Progress>('spot');
  if (state === 'interrupted') machine.interrupt({ index: 0, pauseRemaining: 0 });
  else if (state !== 'idle') expect(machine.transition(state)).toBe(true);
  machine.drain();
  return machine;
}

describe('behaviour state machine (LAI-NPC-020)', () => {
  it('lists every BehaviorState in the table', () => {
    expect(Object.keys(BEHAVIOR_TRANSITIONS).sort()).toEqual([...BEHAVIOR_STATES].sort());
  });

  // Every (from, to) pair: legal ones change state and emit; illegal ones are ignored silently.
  const pairs = BEHAVIOR_STATES.flatMap((from) => BEHAVIOR_STATES.map((to) => [from, to]));
  it.each(pairs)('%s -> %s follows the transition table', (from, to) => {
    // Every state except `interrupted` can be reached from idle in one legal step.
    const machine = machineIn(from);
    const legal = canTransition(from, to);
    expect(machine.transition(to)).toBe(legal);
    expect(machine.state()).toBe(legal ? to : from);
    expect(machine.drain()).toEqual(
      legal ? [{ type: 'npc.behavior_changed', placementKey: 'spot', state: to }] : [],
    );
  });

  it('has the documented legal and illegal transitions', () => {
    expect(canTransition('idle', 'moving')).toBe(true);
    expect(canTransition('moving', 'paused')).toBe(true);
    expect(canTransition('paused', 'moving')).toBe(true);
    expect(canTransition('following', 'returning')).toBe(true);
    expect(canTransition('waiting_for_player', 'moving')).toBe(true);
    expect(canTransition('reacting', 'following')).toBe(true);
    expect(canTransition('following', 'paused')).toBe(false);
    expect(canTransition('waiting_for_player', 'following')).toBe(false);
    expect(canTransition('moving', 'moving')).toBe(false);
    for (const to of BEHAVIOR_STATES) {
      expect(canTransition('interrupted', to)).toBe(false);
      expect(canTransition(to, 'interrupted')).toBe(false);
    }
  });

  it('interrupts from any other state and resumes exactly, returning the progress', () => {
    for (const from of BEHAVIOR_STATES.filter((s) => s !== 'interrupted')) {
      const machine = machineIn(from);
      const progress = { index: 3, pauseRemaining: 1.25 };
      expect(machine.interrupt(progress)).toBe(true);
      expect(machine.state()).toBe('interrupted');
      expect(machine.interruptedFrom()).toBe(from);
      expect(machine.transition('idle')).toBe(false);
      expect(machine.resume()).toEqual({ index: 3, pauseRemaining: 1.25 });
      expect(machine.state()).toBe(from);
      expect(
        machine.drain().map((e) => (e.type === 'npc.behavior_changed' ? e.state : '')),
      ).toEqual(['interrupted', from]);
    }
  });

  it('ignores a second interrupt and a resume without an interrupt', () => {
    const machine = machineIn('moving');
    expect(machine.resume()).toBeNull();
    machine.interrupt({ index: 1, pauseRemaining: 0 });
    expect(machine.interrupt({ index: 9, pauseRemaining: 9 })).toBe(false);
    expect(machine.resume()).toEqual({ index: 1, pauseRemaining: 0 });
    expect(machine.state()).toBe('moving');
  });

  it('queues other events in order and drains them once', () => {
    const machine = createBehaviorMachine<Progress>('spot');
    machine.transition('moving');
    machine.emit({ type: 'npc.waypoint_reached', placementKey: 'spot', index: 0 });
    machine.transition('paused');
    expect(machine.drain().map((e) => e.type)).toEqual([
      'npc.behavior_changed',
      'npc.waypoint_reached',
      'npc.behavior_changed',
    ]);
    expect(machine.drain()).toEqual([]);
  });

  it('makes every call a no-op after dispose', () => {
    const machine = createBehaviorMachine<Progress>('spot');
    machine.transition('moving');
    machine.dispose();
    expect(machine.isDisposed()).toBe(true);
    expect(machine.transition('paused')).toBe(false);
    expect(machine.interrupt({ index: 0, pauseRemaining: 0 })).toBe(false);
    expect(machine.resume()).toBeNull();
    machine.emit({ type: 'npc.waypoint_reached', placementKey: 'spot', index: 0 });
    expect(machine.drain()).toEqual([]);
    expect(machine.state()).toBe('moving');
  });

  it('reset cancels an interruption without restoring it', () => {
    const machine = machineIn('moving');
    machine.interrupt({ index: 3, pauseRemaining: 1 });
    expect(machine.reset('idle')).toBe(true);
    expect(machine.state()).toBe('idle');
    expect(machine.interruptedFrom()).toBeNull();
    expect(machine.resume()).toBeNull();
    expect(
      machine.drain().map((e) => (e.type === 'npc.behavior_changed' ? e.state : e.type)),
    ).toEqual(['interrupted', 'idle']);
    expect(machine.reset('idle')).toBe(false);
    machine.dispose();
    expect(machine.reset('moving')).toBe(false);
  });
});
