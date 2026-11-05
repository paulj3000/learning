import { describe, expect, it, vi } from 'vitest';
import { createSoundManager } from '../SoundManager';
import { FakeEngine, type FakeVoice } from '../testing/fakes';
import { createSpatialEmitters } from './SpatialEmitters';
import { fixedPosition } from './threeBindings';

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const engine = new FakeEngine();
  const manager = createSoundManager({ engine });
  manager.register({ id: 'ambient.w.fall', channel: 'ambient', url: 'f', loop: true });
  manager.register({ id: 'sfx.w.pop', channel: 'sfx', url: 'p' });
  const scope = manager.createScope('world');
  const emitters = createSpatialEmitters({
    player: scope,
    hysteresis: 2,
    setListener: (pose) => manager.setListener(pose),
  });
  const pose = {
    position: [0, 0, 0] as [number, number, number],
    forward: [0, 0, -1] as [number, number, number],
  };
  const move = (x: number, y = 0, z = 0) => {
    pose.position[0] = x;
    pose.position[1] = y;
    pose.position[2] = z;
    emitters.setListener(pose);
    emitters.update();
  };
  const live = () => engine.voices.filter((v) => !v.stopped);
  return { engine, manager, scope, emitters, pose, move, live };
}

describe('emitters', () => {
  it('starts a looping emitter at its place when the listener is in range', async () => {
    const s = setup();
    s.emitters.setListener(s.pose);
    s.emitters.add({
      id: 'fall',
      soundId: 'ambient.w.fall',
      loop: true,
      read: fixedPosition(3, 0, 0),
    });
    await tick();
    expect(s.live()).toHaveLength(1);
    expect(s.live()[0]?.options.spatial?.position).toEqual([3, 0, 0]);
  });

  it('does not start a loop that is out of range, and starts it on arrival', async () => {
    const s = setup();
    s.emitters.setListener(s.pose);
    s.emitters.add({
      id: 'fall',
      soundId: 'ambient.w.fall',
      loop: true,
      spatial: { maxDistance: 20 },
      read: fixedPosition(100, 0, 0),
    });
    await tick();
    expect(s.live()).toHaveLength(0);
    s.move(90);
    await tick();
    expect(s.live()).toHaveLength(1);
  });

  it('stops a loop when the listener leaves, with hysteresis, and resumes on return', async () => {
    const s = setup();
    s.emitters.setListener(s.pose);
    s.emitters.add({
      id: 'fall',
      soundId: 'ambient.w.fall',
      loop: true,
      spatial: { maxDistance: 20 },
      read: fixedPosition(0, 0, 0),
    });
    await tick();
    s.move(21); // outside range but inside the 2 m hysteresis: still playing
    await tick();
    expect(s.live()).toHaveLength(1);
    s.move(30);
    await tick();
    expect(s.live()).toHaveLength(0);
    s.move(10);
    await tick();
    expect(s.live()).toHaveLength(1);
  });

  it('follows a moving source, only telling the engine when it moved', async () => {
    const s = setup();
    s.emitters.setListener(s.pose);
    let x = 0;
    s.emitters.add({
      id: 'npc',
      soundId: 'ambient.w.fall',
      loop: true,
      read: (out) => {
        out[0] = x;
        out[1] = 0;
        out[2] = 0;
        return true;
      },
    });
    await tick();
    const voice = s.live()[0] as FakeVoice;
    s.emitters.update();
    s.emitters.update();
    expect(voice.positionLog).toHaveLength(0); // static: nothing sent
    x = 4;
    s.emitters.update();
    x = 4.001; // below the epsilon
    s.emitters.update();
    expect(voice.positionLog).toEqual([[4, 0, 0]]);
  });

  it('plays a one-shot emitter once and does not loop it', async () => {
    const s = setup();
    const emitter = s.emitters.add({
      id: 'pop',
      soundId: 'sfx.w.pop',
      read: fixedPosition(1, 0, 0),
    });
    await emitter.start();
    expect(s.engine.voices).toHaveLength(1);
    expect(s.engine.voices[0]?.options.loop).toBe(false);
  });

  it('stops the sound and drops the source when removed', async () => {
    const s = setup();
    const read = vi.fn(fixedPosition(1, 0, 0));
    const emitter = s.emitters.add({ id: 'fall', soundId: 'ambient.w.fall', loop: true, read });
    await tick();
    emitter.remove();
    expect(s.live()).toHaveLength(0);
    const calls = read.mock.calls.length;
    s.emitters.update();
    expect(read.mock.calls.length).toBe(calls); // no longer read: no retained reference
    expect(s.emitters.size).toBe(0);
  });

  it('removes itself when the source disappears', async () => {
    const s = setup();
    let present = true;
    const onGone = vi.fn();
    s.emitters.add({
      id: 'chest',
      soundId: 'ambient.w.fall',
      loop: true,
      read: (out) => {
        out[0] = 0;
        return present;
      },
      onGone,
    });
    await tick();
    present = false;
    s.emitters.update();
    expect(onGone).toHaveBeenCalledTimes(1);
    expect(s.live()).toHaveLength(0);
    expect(s.emitters.size).toBe(0);
  });

  it('is silent for a missing sound and does not retry on every frame', async () => {
    const s = setup();
    s.emitters.setListener(s.pose);
    s.emitters.add({
      id: 'ghost',
      soundId: 'ambient.w.missing',
      loop: true,
      read: fixedPosition(1, 0, 0),
    });
    await tick();
    const before = s.manager.getDiagnostics().length;
    for (let i = 0; i < 5; i += 1) s.emitters.update();
    await tick();
    expect(s.engine.voices).toHaveLength(0);
    expect(s.manager.getDiagnostics().length).toBe(before);
  });

  it('a removal while the sound is still loading leaves nothing playing', async () => {
    const s = setup();
    s.engine.autoLoad = false;
    const emitter = s.emitters.add({
      id: 'fall',
      soundId: 'ambient.w.fall',
      loop: true,
      read: fixedPosition(1, 0, 0),
    });
    await tick();
    emitter.remove();
    s.engine.loads[0]?.resolve();
    await tick();
    expect(s.live()).toHaveLength(0);
  });

  it('disposes everything with the scope and restarts nothing', async () => {
    const s = setup();
    s.emitters.setListener(s.pose);
    s.emitters.add({
      id: 'a',
      soundId: 'ambient.w.fall',
      loop: true,
      read: fixedPosition(1, 0, 0),
    });
    s.emitters.add({
      id: 'b',
      soundId: 'ambient.w.fall',
      loop: true,
      read: fixedPosition(2, 0, 0),
    });
    await tick();
    s.scope.dispose();
    s.emitters.update();
    await tick();
    expect(s.live()).toHaveLength(0);
    expect(s.emitters.size).toBe(0);
    s.emitters.add({
      id: 'late',
      soundId: 'ambient.w.fall',
      loop: true,
      read: fixedPosition(1, 0, 0),
    });
    await tick();
    expect(s.live()).toHaveLength(0);
  });

  it('playAt places a one-shot where the game says', async () => {
    const s = setup();
    await s.emitters.playAt('sfx.w.pop', [5, 1, 0], { maxDistance: 30 });
    expect(s.engine.voices[0]?.options.spatial).toMatchObject({
      position: [5, 1, 0],
      maxDistance: 30,
    });
  });

  it('replacing an emitter with the same id stops the old one', async () => {
    const s = setup();
    s.emitters.add({
      id: 'x',
      soundId: 'ambient.w.fall',
      loop: true,
      read: fixedPosition(1, 0, 0),
    });
    await tick();
    s.emitters.add({
      id: 'x',
      soundId: 'ambient.w.fall',
      loop: true,
      read: fixedPosition(9, 0, 0),
    });
    await tick();
    expect(s.live()).toHaveLength(1);
    expect(s.live()[0]?.options.spatial?.position).toEqual([9, 0, 0]);
  });
});
