import { describe, expect, it } from 'vitest';
import { WorldEngineEventBus } from '../../island-map/three/worldEngineEvents';
import { listenFootsteps } from './surfaceFootsteps';

/** GE-074: one footstep sound per step, chosen by the surface underfoot. */

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const CUES = { iceStep: 'sfx.ice', snowStep: 'sfx.snow' };

function setup(cues: Record<string, string> = CUES) {
  const bus = new WorldEngineEventBus();
  const played: [string, string][] = [];
  const off = listenFootsteps(bus, (cue, gait) => played.push([cue, gait]), 'sfx.default', cues);
  return { bus, played, off };
}

describe('surface footsteps', () => {
  it('plays the surface cue instead of the default, once, whichever event comes first', async () => {
    const { bus, played } = setup();
    bus.emit('PlayerFootstep', { gait: 'walk' });
    bus.emit('SurfaceFootstep', { surfaceId: 'ice', footstepCue: 'iceStep' });
    await flush();
    bus.emit('SurfaceFootstep', { surfaceId: 'snow', footstepCue: 'snowStep' });
    bus.emit('PlayerFootstep', { gait: 'run' });
    await flush();
    expect(played).toEqual([
      ['sfx.ice', 'walk'],
      ['sfx.snow', 'run'],
    ]);
  });

  it('plays the default for ground, an unmapped surface, or no surface event at all', async () => {
    const { bus, played } = setup();
    bus.emit('PlayerFootstep', { gait: 'walk' });
    bus.emit('SurfaceFootstep', { surfaceId: 'ground', footstepCue: 'groundStep' });
    await flush();
    bus.emit('PlayerFootstep', { gait: 'sprint' });
    await flush();
    expect(played).toEqual([
      ['sfx.default', 'walk'],
      ['sfx.default', 'sprint'],
    ]);
  });

  it('a region with no map plays exactly as before', async () => {
    const { bus, played } = setup({});
    bus.emit('PlayerFootstep', { gait: 'walk' });
    bus.emit('SurfaceFootstep', { surfaceId: 'ice', footstepCue: 'iceStep' });
    await flush();
    expect(played).toEqual([['sfx.default', 'walk']]);
  });

  it('two steps in one tick are two sounds, in either event order', async () => {
    const { bus, played } = setup();
    bus.emit('PlayerFootstep', { gait: 'walk' });
    bus.emit('PlayerFootstep', { gait: 'sprint' });
    await flush();
    bus.emit('SurfaceFootstep', { surfaceId: 'ice', footstepCue: 'iceStep' });
    bus.emit('PlayerFootstep', { gait: 'walk' });
    bus.emit('SurfaceFootstep', { surfaceId: 'snow', footstepCue: 'snowStep' });
    bus.emit('PlayerFootstep', { gait: 'run' });
    await flush();
    bus.emit('PlayerFootstep', { gait: 'walk' });
    bus.emit('SurfaceFootstep', { surfaceId: 'ice', footstepCue: 'iceStep' });
    bus.emit('PlayerFootstep', { gait: 'run' });
    bus.emit('SurfaceFootstep', { surfaceId: 'snow', footstepCue: 'snowStep' });
    await flush();
    expect(played).toEqual([
      ['sfx.default', 'walk'],
      ['sfx.default', 'sprint'],
      ['sfx.ice', 'walk'],
      ['sfx.snow', 'run'],
      ['sfx.ice', 'walk'],
      ['sfx.snow', 'run'],
    ]);
  });

  it('stops listening when switched off', async () => {
    const { bus, played, off } = setup();
    off();
    bus.emit('PlayerFootstep', { gait: 'walk' });
    await flush();
    expect(played).toEqual([]);
  });
});
