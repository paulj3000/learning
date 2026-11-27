import { describe, expect, it } from 'vitest';
import { CheckpointsService } from '../components/checkpoints';
import { PlatformsService } from '../components/platforms';
import { registerGameplayComponents } from '../components/registerGameplayComponents';
import { createHarness } from '../components/testHarness';

/**
 * Wave 2 stabilization, areas 6, 7 and 9 (component side): CheckpointsService state after
 * markReached, recovery to the latest checkpoint, silent resume, and the steady (non-blinking)
 * warnings under reduced motion, including when the setting flips mid-visit.
 */

const harness = () => createHarness(registerGameplayComponents);
const cps = {
  checkpoints: [
    {
      id: 'cp.1',
      courseId: 'course.a',
      position: { x: 0, y: 0, z: 0 },
      yaw: 0.5,
      label: 'the dock',
    },
    {
      id: 'cp.2',
      courseId: 'course.a',
      position: { x: 10, y: 0, z: 0 },
      yaw: 1,
      label: 'the bridge',
    },
    {
      id: 'cp.3',
      courseId: 'course.a',
      position: { x: 20, y: 0, z: 0 },
      yaw: 2,
      label: 'the summit',
      requiresSignalId: 'sig.open',
    },
  ],
};

describe('CheckpointsService state', () => {
  it('starts empty: nothing reached, no latest, recovery only through a named fallback', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.checkpoints', config: cps }]);
    const api = h.runtime.services.require(CheckpointsService);
    expect(api.reachedIds()).toEqual([]);
    expect(api.latest()).toBeNull();
    expect(api.resolveRecovery(null)).toBeNull();
    expect(api.resolveRecovery('cp.2')?.id).toBe('cp.2');
    expect(api.resolveRecovery('cp.unknown')).toBeNull();
    h.dispose();
  });

  it('markReached records the checkpoint silently (no claim, no event) and makes it the latest', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.checkpoints', config: cps }]);
    const api = h.runtime.services.require(CheckpointsService);
    expect(api.markReached('cp.2')).toBe(true);
    expect(api.reachedIds()).toEqual(['cp.2']);
    expect(api.latest()).toMatchObject({ id: 'cp.2', yaw: 1, label: 'the bridge' });
    expect(api.resolveRecovery('cp.1')?.id).toBe('cp.2'); // the latest beats the fallback
    expect(h.claims).toEqual([]);
    expect(h.eventsNamed('CourseCheckpointReached')).toEqual([]);
    h.dispose();
  });

  it('markReached is false for an unknown id and changes nothing', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.checkpoints', config: cps }]);
    const api = h.runtime.services.require(CheckpointsService);
    expect(api.markReached('cp.nope')).toBe(false);
    expect(api.has('cp.nope')).toBe(false);
    expect(api.reachedIds()).toEqual([]);
    h.dispose();
  });

  it('marking the same checkpoint twice never duplicates it in reachedIds', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.checkpoints', config: cps }]);
    const api = h.runtime.services.require(CheckpointsService);
    api.markReached('cp.1');
    api.markReached('cp.1');
    api.markReached('cp.2');
    api.markReached('cp.2');
    expect(api.reachedIds()).toEqual(['cp.1', 'cp.2']);
    h.dispose();
  });

  it('a silently resumed checkpoint is never claimed later when the child stands on it', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.checkpoints', config: cps }]);
    const api = h.runtime.services.require(CheckpointsService);
    api.markReached('cp.1');
    api.markReached('cp.2');
    for (const x of [0, 10, 0, 10]) {
      h.setPlayer({ x, y: 0, z: 0 });
      h.advance(0.2);
    }
    expect(h.claimsOfType('course.checkpoint.reached')).toEqual([]);
    expect(h.eventsNamed('CourseCheckpointReached')).toEqual([]);
    h.dispose();
  });

  it('alreadyReached in the config restores order and latest without events', async () => {
    const h = harness();
    await h.start([
      { id: 'gameplay.checkpoints', config: { ...cps, alreadyReached: ['cp.1', 'cp.2'] } },
    ]);
    const api = h.runtime.services.require(CheckpointsService);
    expect(api.reachedIds()).toEqual(['cp.1', 'cp.2']);
    expect(api.latest()?.id).toBe('cp.2');
    h.setPlayer({ x: 10, y: 0, z: 0 });
    h.advance(0.3);
    expect(h.claims).toEqual([]);
    h.dispose();
  });

  it('a signal-gated checkpoint is not reached until its signal is on, then reached exactly once', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.checkpoints', config: cps }]);
    h.setPlayer({ x: 20, y: 0, z: 0 });
    h.advance(0.3);
    expect(h.claimsOfType('course.checkpoint.reached')).toHaveLength(0);
    const { signalBoard } = await import('../components/common');
    signalBoard(h.runtime).set('sig.open', true);
    h.advance(0.3);
    signalBoard(h.runtime).set('sig.open', false);
    signalBoard(h.runtime).set('sig.open', true);
    h.advance(0.3);
    expect(h.claimsOfType('course.checkpoint.reached')).toHaveLength(1);
    h.dispose();
  });

  // GE-L13 (fixed): re-marking or newly reaching an OLDER checkpoint of the same course never
  // moves recovery backwards. reachedIds stays the order things happened in.
  it('marking an earlier checkpoint after a later one keeps the later one as the latest (GE-L13)', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.checkpoints', config: cps }]);
    const api = h.runtime.services.require(CheckpointsService);
    api.markReached('cp.2');
    api.markReached('cp.1');
    expect(api.latest()?.id).toBe('cp.2');
    expect(api.resolveRecovery('cp.1')?.id).toBe('cp.2');
    expect(api.reachedIds()).toEqual(['cp.2', 'cp.1']);
    h.dispose();
  });

  it('reaching a skipped earlier checkpoint by walking back keeps recovery at the furthest one (GE-L13)', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.checkpoints', config: cps }]);
    const api = h.runtime.services.require(CheckpointsService);
    h.setPlayer({ x: 10, y: 0, z: 0 });
    h.advance(0.3);
    h.setPlayer({ x: 0, y: 0, z: 0 });
    h.advance(0.3);
    expect(api.reachedIds()).toEqual(['cp.2', 'cp.1']);
    expect(h.claimsOfType('course.checkpoint.reached')).toHaveLength(2);
    expect(api.latest()?.id).toBe('cp.2');
    h.dispose();
  });

  it('moving on to another course moves recovery to that course, even to its first checkpoint', async () => {
    const twoCourses = {
      ...cps,
      checkpoints: [
        ...cps.checkpoints,
        {
          id: 'cp.b1',
          courseId: 'course.b',
          position: { x: 0, y: 0, z: 30 },
          yaw: 0,
          label: 'the cave',
        },
      ],
    };
    const h = harness();
    await h.start([{ id: 'gameplay.checkpoints', config: twoCourses }]);
    const api = h.runtime.services.require(CheckpointsService);
    api.markReached('cp.b1');
    api.markReached('cp.2');
    expect(api.latest()?.id).toBe('cp.2');
    api.markReached('cp.1');
    expect(api.latest()?.id).toBe('cp.2'); // same course: never backwards
    api.markReached('cp.b1');
    expect(api.latest()?.id).toBe('cp.b1'); // the child is on course b now
    h.dispose();
  });

  it('dispose removes the service, so a stale handle cannot be used through the runtime', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.checkpoints', config: cps }]);
    h.dispose();
    expect(h.runtime.services.get(CheckpointsService)).toBeUndefined();
  });
});

describe('steady warnings under reduced motion', () => {
  const size = { x: 3, y: 0.4, z: 3 };
  const crumble = {
    id: 'crumble',
    position: { x: 0, y: 0, z: 0 },
    size,
    route: 'OPTIONAL',
    falling: {
      mode: 'STAND',
      visibleSeconds: 2,
      hiddenSeconds: 2,
      warningSeconds: 1,
      fallSeconds: 0.6,
      offsetSeconds: 0,
    },
  };

  it('the crumble warning blinks normally and holds a steady dim under reduced motion', async () => {
    for (const reduced of [false, true]) {
      const h = harness();
      h.settings.reducedMotion = reduced;
      await h.start([{ id: 'gameplay.platforms', config: { platforms: [crumble] } }]);
      h.advance(0.5);
      h.setPlayer({ x: 0, y: 0.4, z: 0 }, 'crumble');
      h.advance(1.5);
      expect(h.runtime.services.require(PlatformsService).phaseOf('crumble')).toBe('CRUMBLING');
      const warnings = (h.eventsNamed('PlatformPhaseChanged') as { warning: string | null }[])
        .map((e) => e.warning)
        .filter(Boolean);
      expect(warnings).toEqual([reduced ? 'STEADY_DIM' : 'BLINK']);
      h.dispose();
    }
  });

  it('a telegraphed hazard reports steadyWarning only under reduced motion, and the flag follows a live toggle', async () => {
    const rock = {
      id: 'hz.rock',
      kind: 'FALLING_ROCK',
      rect: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
      route: 'OPTIONAL',
      checkpointId: 'cp.1',
      messageKey: 'hazard.rock.kind',
      telegraphSeconds: 2,
      activeSeconds: 0.5,
      restSeconds: 3,
      offsetSeconds: 0,
    };
    const h = harness();
    await h.start([
      { id: 'gameplay.checkpoints', config: cps },
      { id: 'gameplay.hazards', config: { telegraphed: [rock] } },
    ]);
    h.setPlayer({ x: 50, y: 0, z: 50 });
    h.advance(3.5);
    const flags = () =>
      (h.eventsNamed('HazardTelegraph') as { steadyWarning: boolean }[]).map(
        (e) => e.steadyWarning,
      );
    expect(flags().every((f) => f === false)).toBe(true);
    h.settings.reducedMotion = true;
    h.advance(6);
    expect(flags().at(-1)).toBe(true);
    h.dispose();
  });
});
