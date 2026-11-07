import { describe, expect, it } from 'vitest';
import { createSoundManager } from './SoundManager';
import { FakeEngine, type FakeVoice } from './testing/fakes';

function setup() {
  const engine = new FakeEngine();
  const manager = createSoundManager({ engine });
  manager.register({ id: 'music.d.bed', channel: 'music', url: 'm', loop: true });
  manager.register({ id: 'voice.d.hello', channel: 'voice', url: 'v1' });
  manager.register({ id: 'voice.d.again', channel: 'voice', url: 'v2' });
  manager.register({ id: 'sfx.d.pop', channel: 'sfx', url: 's' });
  return { engine, manager };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const music = (engine: FakeEngine) => engine.channelGains.get('music');
const lastRamp = (engine: FakeEngine) => engine.gainLog.at(-1)?.rampMs;

describe('automatic voice ducking', () => {
  it('lowers music to 30 percent of its level while a voice plays, then restores it smoothly', async () => {
    const { engine, manager } = setup();
    await manager.play('music.d.bed');
    expect(music(engine)).toBe(0.5);
    const voice = (await manager.play('voice.d.hello'))!;
    expect(music(engine)).toBeCloseTo(0.15);
    expect(lastRamp(engine)).toBe(250);
    voice.stop();
    await tick();
    expect(music(engine)).toBe(0.5);
    expect(lastRamp(engine)).toBe(700);
  });

  it('never changes the saved music volume', async () => {
    const { engine, manager } = setup();
    await manager.play('voice.d.hello');
    expect(manager.getSettings().channels.music.volume).toBe(0.5);
    expect(music(engine)).toBeCloseTo(0.15);
  });

  it('restores only when every overlapping voice has finished', async () => {
    const { engine, manager } = setup();
    await manager.play('voice.d.hello');
    await manager.play('voice.d.again');
    const [first, second] = engine.voices as [FakeVoice, FakeVoice];
    first.finish();
    await tick();
    expect(music(engine)).toBeCloseTo(0.15);
    second.finish();
    await tick();
    expect(music(engine)).toBe(0.5);
  });

  it('restores when narration is interrupted', async () => {
    const { engine, manager } = setup();
    const voice = (await manager.play('voice.d.hello'))!;
    manager.stop('voice.d.hello');
    await tick();
    expect(voice.state).toBe('ended');
    expect(music(engine)).toBe(0.5);
  });

  it('restores when the scope that owns the voice is disposed', async () => {
    const { engine, manager } = setup();
    const scope = manager.createScope('story');
    await scope.play('voice.d.hello');
    expect(music(engine)).toBeCloseTo(0.15);
    scope.dispose();
    await tick();
    expect(music(engine)).toBe(0.5);
  });

  it('restores when the browser fails the voice', async () => {
    const { engine, manager } = setup();
    await manager.play('voice.d.hello');
    engine.voices[0]!.finish('failed');
    await tick();
    expect(music(engine)).toBe(0.5);
  });

  it('respects mute: a muted channel stays silent through ducking and returns to its level', async () => {
    const { engine, manager } = setup();
    const voice = (await manager.play('voice.d.hello'))!;
    manager.muteChannel('music', true);
    expect(music(engine)).toBe(0);
    manager.muteChannel('music', false);
    expect(music(engine)).toBeCloseTo(0.15);
    voice.stop();
    await tick();
    expect(music(engine)).toBe(0.5);
  });

  it('follows a volume change made while ducked', async () => {
    const { engine, manager } = setup();
    await manager.play('voice.d.hello');
    manager.setChannelVolume('music', 0.8);
    expect(music(engine)).toBeCloseTo(0.24);
  });

  it('other channels do not duck music', async () => {
    const { engine, manager } = setup();
    await manager.play('sfx.d.pop');
    expect(music(engine)).toBe(0.5);
  });

  it('the amount, timing and targets are configurable, and it can be switched off', async () => {
    const { engine, manager } = setup();
    manager.setDucking({
      level: 0.25,
      attackMs: 100,
      releaseMs: 300,
      targets: ['music', 'ambient'],
    });
    const voice = (await manager.play('voice.d.hello'))!;
    expect(music(engine)).toBeCloseTo(0.125);
    expect(engine.channelGains.get('ambient')).toBeCloseTo(0.125);
    expect(engine.gainLog.at(-1)?.rampMs).toBe(100);
    voice.stop();
    await tick();
    expect(lastRamp(engine)).toBe(300);
    manager.setDucking({ enabled: false });
    await manager.play('voice.d.again');
    expect(music(engine)).toBe(0.5);
    expect(manager.getDucking().level).toBe(0.25);
  });
});

describe('manual ducking', () => {
  it('holds stack by the lowest level and release independently', () => {
    const { engine, manager } = setup();
    const a = manager.duck('music', { level: 0.5 });
    const b = manager.duck('music', { level: 0.2 });
    expect(music(engine)).toBeCloseTo(0.1);
    b.release();
    expect(music(engine)).toBeCloseTo(0.25);
    a.release();
    expect(music(engine)).toBe(0.5);
    expect(a.active).toBe(false);
  });

  it('release is idempotent and survives disposal', () => {
    const { manager } = setup();
    const hold = manager.duck('music');
    manager.dispose();
    expect(() => hold.release()).not.toThrow();
    expect(manager.duck('music').active).toBe(false);
  });
});
