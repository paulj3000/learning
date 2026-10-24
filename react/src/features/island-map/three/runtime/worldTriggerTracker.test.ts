import { describe, expect, it } from 'vitest';
import { WorldTriggerTracker } from './worldTriggerTracker';
import type { TriggerVolume } from './sceneLayout';

const ZONE: TriggerVolume = {
  id: 'pool',
  kind: 'ZONE',
  box: { minX: 0, minY: -1, minZ: 0, maxX: 2, maxY: 3, maxZ: 2 },
};

function tracker() {
  return new WorldTriggerTracker([ZONE], [{ entityId: 'pip', x: 10, z: 0 }], 2.5);
}

const at = (x: number, z: number) => ({ x, y: 0, z });

describe('WorldTriggerTracker', () => {
  it('reports entering a zone once, not every frame inside it', () => {
    const subject = tracker();
    expect(subject.step(at(-5, -5), null).enteredZoneIds).toEqual([]);
    expect(subject.step(at(1, 1), null).enteredZoneIds).toEqual(['pool']);
    expect(subject.step(at(1.5, 1), null).enteredZoneIds).toEqual([]);
    subject.step(at(-5, -5), null);
    expect(subject.step(at(1, 1), null).enteredZoneIds).toEqual(['pool']);
  });

  it('reports a zone the player starts inside on the first frame', () => {
    expect(tracker().step(at(1, 1), null).enteredZoneIds).toEqual(['pool']);
  });

  it('reports an NPC approach once per approach', () => {
    const subject = tracker();
    expect(subject.step(at(0, 0), null).approachedEntityIds).toEqual([]);
    expect(subject.step(at(8, 0), null).approachedEntityIds).toEqual(['pip']);
    expect(subject.step(at(9, 0), null).approachedEntityIds).toEqual([]);
    subject.step(at(0, 0), null);
    expect(subject.step(at(8, 0), null).approachedEntityIds).toEqual(['pip']);
  });

  it('reports focus only when it changes, including losing focus', () => {
    const subject = tracker();
    expect(subject.step(at(0, 0), null).focusChanged).toBeUndefined();
    expect(subject.step(at(0, 0), 'pip').focusChanged).toEqual({ entityId: 'pip' });
    expect(subject.step(at(0, 0), 'pip').focusChanged).toBeUndefined();
    expect(subject.step(at(0, 0), null).focusChanged).toEqual({ entityId: null });
  });
});
