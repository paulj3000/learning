import { describe, expect, it } from 'vitest';
import { createSoundManager } from './SoundManager';
import { MAX_SPATIAL_VOICES } from './spatial';
import { FakeEngine, type FakeVoice } from './testing/fakes';

function setup(defs: Array<{ id: string; spatial?: object; loop?: boolean }> = []) {
  const engine = new FakeEngine();
  const manager = createSoundManager({ engine });
  manager.register({ id: 'sfx.s.pop', channel: 'sfx', url: 'p' });
  manager.register({ id: 'ambient.s.fall', channel: 'ambient', url: 'f', loop: true });
  for (const d of defs) {
    manager.register({
      id: d.id,
      channel: 'sfx',
      url: d.id,
      loop: d.loop,
      spatial: d.spatial as never,
    });
  }
  return { engine, manager };
}
const at = (x: number, y = 0, z = 0) => ({ position: [x, y, z] as [number, number, number] });

describe('positional playback', () => {
  it('passes the resolved parameters to the engine and keeps the sound in its channel', async () => {
    const { engine, manager } = setup();
    const handle = await manager.play('sfx.s.pop', {
      spatial: { ...at(3, 1, -4), refDistance: 2, maxDistance: 20 },
    });
    const voice = engine.voices[0] as FakeVoice;
    expect(voice.options.channel).toBe('sfx');
    expect(voice.options.spatial).toMatchObject({
      position: [3, 1, -4],
      refDistance: 2,
      maxDistance: 20,
    });
    expect(handle?.soundId).toBe('sfx.s.pop');
  });

  it('plays plainly with no spatial options, and when staff forbid positional playback', async () => {
    const { engine, manager } = setup([{ id: 'sfx.s.off', spatial: { enabled: false } }]);
    await manager.play('sfx.s.pop');
    await manager.play('sfx.s.off', { spatial: at(1) });
    expect(engine.voices[0]?.options.spatial).toBeUndefined();
    expect(engine.voices[1]?.options.spatial).toBeUndefined();
  });

  it('applies staff defaults and lets the game override them', async () => {
    const { engine, manager } = setup([
      { id: 'sfx.s.tuned', spatial: { enabled: true, refDistance: 5, maxDistance: 50 } },
    ]);
    await manager.play('sfx.s.tuned', { spatial: at(0) });
    await manager.play('sfx.s.tuned', { spatial: { ...at(0), maxDistance: 9 } });
    expect(engine.voices[0]?.options.spatial).toMatchObject({ refDistance: 5, maxDistance: 50 });
    expect(engine.voices[1]?.options.spatial).toMatchObject({ refDistance: 5, maxDistance: 9 });
  });

  it('moves and turns a sound, and ignores non-finite values', async () => {
    const { engine, manager } = setup();
    const handle = (await manager.play('sfx.s.pop', { spatial: at(0) }))!;
    handle.setPosition(1, 2, 3);
    handle.setPosition(NaN, 0, 0);
    handle.setOrientation(0, 0, 1);
    const voice = engine.voices[0] as FakeVoice;
    expect(voice.positionLog).toEqual([[1, 2, 3]]);
    expect(voice.orientation).toEqual([0, 0, 1]);
  });

  it('moving a plain sound does nothing and does not throw', async () => {
    const { manager } = setup();
    const handle = (await manager.play('sfx.s.pop'))!;
    expect(() => handle.setPosition(1, 2, 3)).not.toThrow();
  });

  it('reports invalid spatial options and still plays the sound', async () => {
    const { engine, manager } = setup();
    const handle = await manager.play('sfx.s.pop', {
      spatial: { position: [0, 0, 0], refDistance: -1 },
    });
    expect(handle).not.toBeNull();
    expect(engine.voices[0]?.options.spatial).toBeUndefined();
    expect(manager.getDiagnostics().some((d) => d.code === 'invalid-spatial')).toBe(true);
  });

  it('falls back to plain playback on an engine that cannot place sounds', async () => {
    const { engine, manager } = setup();
    engine.supportsSpatial = false;
    const handle = await manager.play('sfx.s.pop', { spatial: at(5) });
    expect(handle).not.toBeNull();
    expect(engine.voices[0]?.options.spatial).toBeUndefined();
    expect(manager.getSpatialStats().supported).toBe(false);
  });
});

describe('listener and range', () => {
  it('forwards the listener to the engine', () => {
    const { engine, manager } = setup();
    manager.setListener({ position: [1, 2, 3], forward: [0, 0, -1] });
    expect(engine.listener?.position).toEqual([1, 2, 3]);
  });

  it('does not start a one-shot that is beyond its range, but plays a loop (the emitter ranges it)', async () => {
    const { engine, manager } = setup();
    manager.setListener({ position: [0, 0, 0], forward: [0, 0, -1] });
    expect(
      await manager.play('sfx.s.pop', { spatial: { ...at(100), maxDistance: 20 } }),
    ).toBeNull();
    expect(
      await manager.play('sfx.s.pop', { spatial: { ...at(10), maxDistance: 20 } }),
    ).not.toBeNull();
    expect(
      await manager.play('ambient.s.fall', { spatial: { ...at(100), maxDistance: 20 } }),
    ).not.toBeNull();
    expect(engine.voices).toHaveLength(2);
  });
});

describe('limits and cleanup', () => {
  it('caps simultaneous positional sounds by dropping the farthest', async () => {
    const { engine, manager } = setup();
    manager.setListener({ position: [0, 0, 0], forward: [0, 0, -1] });
    for (let i = 0; i < MAX_SPATIAL_VOICES; i += 1) {
      await manager.play('ambient.s.fall', { spatial: at(10 + i) });
    }
    expect(manager.getSpatialStats().active).toBe(MAX_SPATIAL_VOICES);
    // A nearer sound steals the farthest; a farther one is dropped.
    expect(await manager.play('ambient.s.fall', { spatial: at(1) })).not.toBeNull();
    expect((engine.voices[MAX_SPATIAL_VOICES - 1] as FakeVoice).stopped).toBe(true);
    expect(await manager.play('ambient.s.fall', { spatial: at(500) })).toBeNull();
    expect(manager.getSpatialStats().active).toBeLessThanOrEqual(MAX_SPATIAL_VOICES);
  });

  it('stops positional sounds with their scope and plays nothing afterwards', async () => {
    const { engine, manager } = setup();
    const scope = manager.createScope('world');
    await scope.play('ambient.s.fall', { spatial: at(2) });
    scope.dispose();
    await Promise.resolve();
    expect(engine.voices.every((v) => v.stopped)).toBe(true);
    expect(await scope.play('ambient.s.fall', { spatial: at(2) })).toBeNull();
    await Promise.resolve();
    expect(manager.getSpatialStats().active).toBe(0);
  });

  it('keeps the channel and master mix for positional sounds', async () => {
    const { engine, manager } = setup();
    await manager.play('sfx.s.pop', { spatial: at(1) });
    manager.muteChannel('sfx', true);
    expect(engine.channelGains.get('sfx')).toBe(0);
    manager.muteChannel('sfx', false);
    manager.setMasterVolume(0.4);
    expect(engine.masterGain).toBe(0.4);
    manager.applySettings({ reducedIntensity: true });
    expect(engine.channelGains.get('ambient')).toBe(0.25);
  });
});
