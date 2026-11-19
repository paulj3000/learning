import { CheckpointTracker, validateCheckpoints, type CheckpointSpec } from './checkpoints';
import { FirstPersonController } from './firstPersonController';

const course: CheckpointSpec[] = [
  { id: 'a', label: 'Start', x: 0, z: 5, yaw: 1 },
  { id: 'b', x: 0, z: 15 },
  { id: 'c', x: 0, z: 25 },
];

describe('CheckpointTracker', () => {
  it('reaches checkpoints in range once and remembers the latest', () => {
    const t = new CheckpointTracker(course);
    expect(t.recoveryPoint()).toBeNull();
    expect(t.update(0, 0)).toEqual([]);
    expect(t.update(0.5, 5).map((s) => s.id)).toEqual(['a']);
    expect(t.update(0.5, 5)).toEqual([]);
    expect(t.recoveryPoint()).toEqual({ x: 0, z: 5, yaw: 1 });
    t.update(0, 15);
    expect(t.recoveryPoint()).toEqual({ x: 0, z: 15 });
    expect(t.reachedIds()).toEqual(['a', 'b']);
  });

  it('can resume at the furthest checkpoint instead of the latest', () => {
    const t = new CheckpointTracker(course, { resume: 'FURTHEST' });
    t.reach('c');
    t.reach('a');
    expect(t.current()?.id).toBe('c');
    expect(new CheckpointTracker(course).reach('zzz')).toBe(false);
  });

  it('reset forgets checkpoints only and restore replays reached ids', () => {
    const t = new CheckpointTracker(course);
    t.reach('a');
    t.reset();
    expect(t.reachedIds()).toEqual([]);
    expect(t.recoveryPoint()).toBeNull();
    t.restore(['a', 'c', 'nope']);
    expect(t.reachedIds()).toEqual(['a', 'c']);
    expect(t.current()?.id).toBe('c');
  });

  it('is the controller recovery point: a hazard recovery returns to the checkpoint', () => {
    const t = new CheckpointTracker(course);
    t.reach('b');
    const c = new FirstPersonController({ recoveryPoint: t.recoveryPoint });
    c.teleport(3, 40, 0);
    c.recover('HAZARD');
    expect(c.position.x).toBe(0);
    expect(c.position.z).toBe(15);
    expect(c.consumeEvents().some((e) => e.type === 'RECOVERED')).toBe(true);
  });

  it('rejects checkpoints on moving or vanishing platforms, duplicates and bad numbers', () => {
    expect(validateCheckpoints(course)).toEqual([]);
    const issues = validateCheckpoints([
      { id: 'a', x: 0, z: 0, surface: 'MOVING' },
      { id: 'a', x: 0, z: 0, surface: 'VANISHING' },
      { id: 'c', x: Number.NaN, z: 0 },
    ]);
    expect(issues.map((i) => i.message).join('|')).toMatch(/moving or vanishing/);
    expect(issues.some((i) => /duplicate/.test(i.message))).toBe(true);
    expect(issues.some((i) => /finite/.test(i.message))).toBe(true);
  });
});
