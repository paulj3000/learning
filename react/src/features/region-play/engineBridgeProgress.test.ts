import { describe, expect, it } from 'vitest';
import { bridgeCheckpoints, earnedBridgeCheckpoints, worldSignal, worldSignals } from './engineBridgeProgress';

/** GE-065: what region play tells the engine bridge about a child's progress. */

const BLOCK = {
  capabilities: [
    { id: 'environment.volumes', config: {} },
    {
      id: 'gameplay.checkpoints',
      config: {
        checkpoints: [
          { id: 'cp-start', courseId: 'c', position: { x: 0, y: 0, z: 0 }, yaw: 0, label: 'the start' },
          { id: 'cp-gate', courseId: 'c', position: { x: 0, y: 0, z: 9 }, yaw: 0, label: 'the gate', requiresSignalId: 'world:GATE_OPEN' },
          { id: 'cp-far', courseId: 'c', position: { x: 0, y: 0, z: 19 }, yaw: 0, label: 'far', requiresSignalId: 'world:FAR_OPEN' },
        ],
        goals: [],
      },
    },
  ],
};

describe('engine bridge progress', () => {
  it('names world changes as world:<key> signals, once each', () => {
    expect(worldSignal('A')).toBe('world:A');
    expect(worldSignals(['A', 'B', 'A'])).toEqual(['world:A', 'world:B']);
  });

  it('reads the checkpoint list in authored order, gate included', () => {
    expect(bridgeCheckpoints(BLOCK)).toEqual([
      { id: 'cp-start' },
      { id: 'cp-gate', requiresSignalId: 'world:GATE_OPEN' },
      { id: 'cp-far', requiresSignalId: 'world:FAR_OPEN' },
    ]);
  });

  it('earns ungated checkpoints always and gated ones with their world change, in order', () => {
    expect(earnedBridgeCheckpoints(BLOCK, [])).toEqual(['cp-start']);
    expect(earnedBridgeCheckpoints(BLOCK, ['FAR_OPEN'])).toEqual(['cp-start', 'cp-far']);
    expect(earnedBridgeCheckpoints(BLOCK, ['FAR_OPEN', 'GATE_OPEN'])).toEqual(['cp-start', 'cp-gate', 'cp-far']);
  });

  it('is empty for anything that is not a bridge block with checkpoints', () => {
    for (const value of [null, undefined, 7, 'x', {}, { capabilities: 'no' }, { capabilities: [{ id: 'gameplay.hazards' }] }]) {
      expect(bridgeCheckpoints(value)).toEqual([]);
      expect(earnedBridgeCheckpoints(value, ['GATE_OPEN'])).toEqual([]);
    }
  });
});
