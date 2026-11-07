import { describe, expect, it, vi } from 'vitest';
import { createSoundManager } from './SoundManager';
import { AudioError, type SoundDefinition } from './AudioTypes';
import { FakeEngine } from './testing/fakes';

const click: SoundDefinition = { id: 'ui.click', url: 'test://click', channel: 'ui' };
const coin: SoundDefinition = { id: 'sfx.coin', url: 'test://coin', channel: 'sfx' };
const theme: SoundDefinition = {
  id: 'music.theme',
  url: 'test://theme',
  channel: 'music',
  loop: true,
  stream: true,
};

function setup(overrides: Parameters<typeof createSoundManager>[0] = {}) {
  const engine = new FakeEngine();
  const manager = createSoundManager({ engine, definitions: [click, coin, theme], ...overrides });
  return { engine, manager };
}

describe('registration', () => {
  it('registers, looks up and unregisters by stable id', () => {
    const { manager } = setup();
    expect(manager.has('ui.click')).toBe(true);
    manager.unregister('ui.click');
    expect(manager.has('ui.click')).toBe(false);
  });

  it('rejects invalid definitions without registering any of a batch', () => {
    const { manager } = setup();
    expect(() =>
      manager.registerAll([
        { id: 'a', channel: 'sfx', url: 'x' },
        { id: 'b', channel: 'nope' as never, url: 'x' },
      ]),
    ).toThrow(RangeError);
    expect(manager.has('a')).toBe(false);
    expect(() => manager.register({ id: '', channel: 'sfx' })).toThrow(RangeError);
  });
});

describe('missing sounds and assets', () => {
  it('resolves null for an unknown sound id and records one diagnostic', async () => {
    const onDiagnostic = vi.fn();
    const { manager } = setup({ onDiagnostic });
    await expect(manager.play('nope')).resolves.toBeNull();
    await expect(manager.play('nope')).resolves.toBeNull();
    expect(onDiagnostic).toHaveBeenCalledTimes(1);
    const [entry] = manager.getDiagnostics();
    expect(entry).toMatchObject({ code: 'missing-sound', soundId: 'nope', count: 2 });
  });

  it('resolves null for a definition with no asset id or url', async () => {
    const { manager } = setup();
    manager.register({ id: 'empty', channel: 'sfx' });
    await expect(manager.play('empty')).resolves.toBeNull();
    expect(manager.getDiagnostics()[0]?.code).toBe('missing-asset');
  });

  it('resolves asset ids through the resolver and falls back to the literal url', async () => {
    const engine = new FakeEngine();
    const loadSpy = vi.spyOn(engine, 'load');
    const resolver = {
      resolve: vi.fn(async (id: string) => {
        if (id === 'bad') throw new Error('unpublished');
        return { id, url: `published://${id}` };
      }),
    };
    const manager = createSoundManager({
      engine,
      resolver,
      definitions: [
        { id: 'a', assetId: 'good', channel: 'sfx' },
        { id: 'b', assetId: 'bad', url: 'test://fallback', channel: 'sfx' },
        { id: 'c', assetId: 'bad', channel: 'sfx' },
      ],
    });
    await manager.play('a');
    await manager.play('b');
    await expect(manager.play('c')).resolves.toBeNull();
    expect(loadSpy.mock.calls.map((call) => call[0])).toEqual([
      'published://good',
      'test://fallback',
    ]);
  });

  it.each(['load-failed', 'decode-failed', 'unsupported'] as const)(
    'resolves null when the engine reports %s',
    async (code) => {
      const { manager, engine } = setup();
      engine.failLoad = new AudioError(code, 'x');
      await expect(manager.play('ui.click')).resolves.toBeNull();
      expect(manager.getDiagnostics()[0]?.code).toBe(code);
    },
  );

  it('resolves null when the engine throws while starting playback', async () => {
    const { manager, engine } = setup();
    engine.failPlay = true;
    await expect(manager.play('ui.click')).resolves.toBeNull();
    expect(manager.getDiagnostics()[0]?.code).toBe('playback-failed');
  });
});

describe('playback instances', () => {
  it('creates a handle per play and lets the same sound overlap', async () => {
    const { manager, engine } = setup();
    const first = await manager.play('sfx.coin');
    const second = await manager.play('sfx.coin');
    expect(first && second).toBeTruthy();
    expect(first?.instanceId).not.toBe(second?.instanceId);
    expect(first?.soundId).toBe('sfx.coin');
    expect(first?.channel).toBe('sfx');
    expect(engine.voices).toHaveLength(2);
  });

  it('stops one instance without touching the others', async () => {
    const { manager, engine } = setup();
    const first = await manager.play('sfx.coin');
    const second = await manager.play('sfx.coin');
    const other = await manager.play('ui.click');
    first?.stop();
    expect(first?.state).toBe('ended');
    expect(second?.state).toBe('playing');
    expect(other?.state).toBe('playing');
    expect(engine.voices[0]?.stopped).toBe(true);
    expect(engine.voices[1]?.stopped).toBe(false);
    first?.stop(); // idempotent
    expect(await first?.whenEnded()).toBe('stopped');
  });

  it('stop(soundId) ends every instance of that sound only', async () => {
    const { manager } = setup();
    const a = await manager.play('sfx.coin');
    const b = await manager.play('sfx.coin');
    const c = await manager.play('ui.click');
    manager.stop('sfx.coin');
    expect([a?.state, b?.state, c?.state]).toEqual(['ended', 'ended', 'playing']);
  });

  it('stopAll ends everything', async () => {
    const { manager } = setup();
    const handles = await Promise.all([manager.play('sfx.coin'), manager.play('ui.click')]);
    manager.stopAll();
    expect(handles.map((h) => h?.state)).toEqual(['ended', 'ended']);
  });

  it('pauses and resumes, ignoring calls in the wrong state', async () => {
    const { manager, engine } = setup();
    const handle = await manager.play('sfx.coin');
    handle?.resume(); // not paused: no-op
    handle?.pause();
    expect(handle?.state).toBe('paused');
    expect(engine.voices[0]?.paused).toBe(true);
    handle?.resume();
    expect(handle?.state).toBe('playing');
    handle?.stop();
    handle?.pause();
    expect(handle?.state).toBe('ended');
  });

  it('reports a natural end and frees the instance', async () => {
    const { manager, engine } = setup();
    const handle = await manager.play('sfx.coin');
    engine.voices[0]?.finish();
    expect(await handle?.whenEnded()).toBe('finished');
    expect(handle?.state).toBe('ended');
  });

  it('clamps per-instance volume and rate and ignores invalid numbers', async () => {
    const { manager, engine } = setup();
    const handle = await manager.play('sfx.coin', { volume: 5, playbackRate: 99 });
    expect(engine.voices[0]?.options.volume).toBe(1);
    expect(engine.voices[0]?.options.playbackRate).toBe(4);
    handle?.setVolume(-3);
    expect(engine.voices[0]?.volume).toBe(0);
    handle?.setVolume(Number.NaN);
    expect(engine.voices[0]?.volume).toBe(0);
    handle?.setPlaybackRate(0.01);
    expect(engine.voices[0]?.rate).toBe(0.25);
  });

  it('honours looping from the definition and from play options', async () => {
    const { manager, engine } = setup();
    await manager.play('music.theme');
    await manager.play('sfx.coin');
    await manager.play('sfx.coin', { loop: true });
    await manager.play('music.theme', { loop: false });
    expect(engine.voices.map((v) => v.options.loop)).toEqual([true, false, true, false]);
  });

  it('passes the fade-in through and fades out on stop', async () => {
    const { manager, engine } = setup();
    const handle = await manager.play('music.theme', { fadeInMs: 500 });
    expect(engine.voices[0]?.options.fadeInMs).toBe(500);
    handle?.stop({ fadeOutMs: 300 });
    expect(engine.voices[0]?.stopFadeMs).toBe(300);
  });
});

describe('mixer', () => {
  it('keeps independent channel volumes and pushes them to the engine', () => {
    const { manager, engine } = setup();
    manager.setChannelVolume('music', 0.2);
    manager.setChannelVolume('voice', 0.9);
    expect(engine.channelGains.get('music')).toBe(0.2);
    expect(engine.channelGains.get('voice')).toBe(0.9);
    expect(engine.channelGains.get('sfx')).toBe(0.8);
  });

  it('clamps volumes and ignores non-finite values', () => {
    const { manager } = setup();
    manager.setMasterVolume(7);
    expect(manager.getSettings().masterVolume).toBe(1);
    manager.setMasterVolume(-1);
    expect(manager.getSettings().masterVolume).toBe(0);
    manager.setMasterVolume(0.4);
    manager.setMasterVolume(Number.NaN);
    expect(manager.getSettings().masterVolume).toBe(0.4);
    manager.setChannelVolume('sfx', Number.POSITIVE_INFINITY);
    expect(manager.getSettings().channels.sfx.volume).toBe(0.8);
  });

  it('applies master volume and master mute without losing the volume', () => {
    const { manager, engine } = setup();
    manager.setMasterVolume(0.5);
    expect(engine.masterGain).toBe(0.5);
    manager.setMuted(true);
    expect(engine.masterGain).toBe(0);
    expect(manager.getSettings().masterVolume).toBe(0.5);
    manager.setMuted(false);
    expect(engine.masterGain).toBe(0.5);
  });

  it('mutes one channel and restores its configured volume', () => {
    const { manager, engine } = setup();
    manager.setChannelVolume('music', 0.3);
    manager.muteChannel('music', true);
    expect(engine.channelGains.get('music')).toBe(0);
    expect(engine.channelGains.get('sfx')).toBe(0.8);
    expect(manager.getSettings().channels.music).toEqual({ volume: 0.3, muted: true });
    manager.muteChannel('music', false);
    expect(engine.channelGains.get('music')).toBe(0.3);
  });

  it('ignores unknown channels', () => {
    const { manager } = setup();
    expect(() => manager.setChannelVolume('bogus' as never, 0.5)).not.toThrow();
    expect(() => manager.muteChannel('bogus' as never, true)).not.toThrow();
  });

  it('applies a settings patch and starts from supplied settings', () => {
    const { manager } = setup({
      settings: { masterVolume: 0.6, channels: { voice: { muted: true } } },
    });
    expect(manager.getSettings().masterVolume).toBe(0.6);
    expect(manager.getSettings().channels.voice.muted).toBe(true);
    manager.applySettings({ channels: { sfx: { volume: 2 } } });
    expect(manager.getSettings().channels.sfx.volume).toBe(1);
  });

  it('notifies subscribers on change only and hands out a stable snapshot between changes', () => {
    const { manager } = setup();
    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);
    const before = manager.getSettings();
    expect(manager.getSettings()).toBe(before);
    manager.setMasterVolume(0.3);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(manager.getSettings()).not.toBe(before);
    unsubscribe();
    manager.setMasterVolume(0.2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify subscribers for playback', async () => {
    const { manager } = setup();
    const listener = vi.fn();
    manager.subscribe(listener);
    const handle = await manager.play('sfx.coin');
    handle?.stop();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('scopes and lifecycle', () => {
  it('disposing a scope stops only that scope', async () => {
    const { manager } = setup();
    const game = manager.createScope('treasure-rush');
    const inGame = await game.play('music.theme');
    const inGame2 = await game.play('sfx.coin');
    const global = await manager.play('ui.click');
    game.dispose();
    expect(inGame?.state).toBe('ended');
    expect(inGame2?.state).toBe('ended');
    expect(global?.state).toBe('playing');
    expect(await inGame?.whenEnded()).toBe('disposed');
  });

  it('a scope stop and stopAll leave other owners alone', async () => {
    const { manager } = setup();
    const game = manager.createScope('g');
    const mine = await game.play('sfx.coin');
    const theirs = await manager.play('sfx.coin');
    game.stop('sfx.coin');
    expect(mine?.state).toBe('ended');
    expect(theirs?.state).toBe('playing');
    const mine2 = await game.play('ui.click');
    game.stopAll();
    expect(mine2?.state).toBe('ended');
    expect(theirs?.state).toBe('playing');
  });

  it('a disposed scope plays nothing, and dispose is idempotent', async () => {
    const { manager, engine } = setup();
    const scope = manager.createScope();
    scope.dispose();
    scope.dispose();
    expect(scope.disposed).toBe(true);
    await expect(scope.play('ui.click')).resolves.toBeNull();
    expect(engine.voices).toHaveLength(0);
  });

  it('cancels a pending load when its scope is disposed, so nothing plays late', async () => {
    const { manager, engine } = setup();
    engine.autoLoad = false;
    const scope = manager.createScope();
    const pending = scope.play('sfx.coin');
    await Promise.resolve();
    await Promise.resolve();
    expect(engine.loads).toHaveLength(1);
    scope.dispose();
    await expect(pending).resolves.toBeNull();
    expect(engine.voices).toHaveLength(0);
    expect(manager.getDiagnostics()).toHaveLength(0); // cancellation is not an error
  });

  it('cancels a pending load on stop(soundId)', async () => {
    const { manager, engine } = setup();
    engine.autoLoad = false;
    const pending = manager.play('sfx.coin');
    await Promise.resolve();
    await Promise.resolve();
    manager.stop('sfx.coin');
    await expect(pending).resolves.toBeNull();
    expect(engine.voices).toHaveLength(0);
  });

  it('does not start a load that finished after the scope closed', async () => {
    const { manager, engine } = setup();
    engine.autoLoad = false;
    const scope = manager.createScope();
    const pending = scope.play('sfx.coin');
    await Promise.resolve();
    await Promise.resolve();
    // Resolve the load at the same moment the scope closes: the guard after the await must hold.
    engine.loads[0]?.resolve();
    scope.dispose();
    await expect(pending).resolves.toBeNull();
    expect(engine.voices.filter((v) => !v.stopped)).toHaveLength(0);
  });

  it('plays nothing after the manager is disposed, and disposal is safe to repeat', async () => {
    const { manager, engine } = setup();
    const live = await manager.play('music.theme');
    manager.dispose();
    manager.dispose();
    expect(manager.disposed).toBe(true);
    expect(engine.disposed).toBe(true);
    expect(live?.state).toBe('ended');
    expect(engine.voices[0]?.stopped).toBe(true);
    await expect(manager.play('ui.click')).resolves.toBeNull();
    expect(manager.getStatus()).toBe('disposed');
    manager.setMasterVolume(0.1); // no throw, no effect
    expect(manager.getSettings().masterVolume).toBe(1);
  });

  it('cancels pending loads on manager disposal', async () => {
    const { manager, engine } = setup();
    engine.autoLoad = false;
    const pending = manager.play('sfx.coin');
    await Promise.resolve();
    await Promise.resolve();
    manager.dispose();
    await expect(pending).resolves.toBeNull();
    expect(engine.voices).toHaveLength(0);
  });

  it('handle controls are safe after disposal', async () => {
    const { manager } = setup();
    const handle = await manager.play('sfx.coin');
    manager.dispose();
    expect(() => {
      handle?.pause();
      handle?.resume();
      handle?.setVolume(0.5);
      handle?.setPlaybackRate(2);
      handle?.stop();
    }).not.toThrow();
  });
});

describe('browser unlocking', () => {
  it('drops a one-shot while locked and asks the engine to unlock', async () => {
    const { manager, engine } = setup();
    engine.state = 'suspended';
    engine.unlockResult = false;
    await expect(manager.play('ui.click')).resolves.toBeNull();
    expect(engine.unlockCalls).toBe(1);
    expect(manager.getDiagnostics()[0]?.code).toBe('locked');
    expect(manager.getStatus()).toBe('locked');
  });

  it('queues a loop while locked so it begins when audio unlocks', async () => {
    const { manager, engine } = setup();
    engine.state = 'suspended';
    engine.unlockResult = false;
    const handle = await manager.play('music.theme');
    expect(handle?.state).toBe('playing');
    expect(engine.voices).toHaveLength(1);
  });

  it('plays normally once unlock succeeds and reports status changes', async () => {
    const { manager, engine } = setup();
    engine.setState('suspended');
    const listener = vi.fn();
    manager.subscribe(listener);
    const before = manager.getSettings();
    await expect(manager.unlock()).resolves.toBe(true);
    expect(manager.getStatus()).toBe('ready');
    expect(listener).toHaveBeenCalled();
    expect(manager.getSettings()).not.toBe(before);
    await expect(manager.play('ui.click')).resolves.not.toBeNull();
  });

  it('never rejects when the engine unlock throws', async () => {
    const { manager, engine } = setup();
    vi.spyOn(engine, 'unlock').mockRejectedValue(new Error('denied'));
    await expect(manager.unlock()).resolves.toBe(false);
  });

  it('resolves null and reports once when audio is unavailable', async () => {
    const { manager, engine } = setup();
    engine.state = 'unavailable';
    expect(manager.getStatus()).toBe('unavailable');
    await expect(manager.play('ui.click')).resolves.toBeNull();
    await expect(manager.play('ui.click')).resolves.toBeNull();
    expect(manager.getDiagnostics()).toMatchObject([{ code: 'engine-unavailable', count: 2 }]);
  });

  it('installs one set of gesture listeners per target and removes them after unlocking', async () => {
    const { manager, engine } = setup();
    engine.state = 'suspended';
    const handlers = new Map<string, () => void>();
    const target = {
      addEventListener: vi.fn((type: string, fn: () => void) => handlers.set(type, fn)),
      removeEventListener: vi.fn((type: string) => handlers.delete(type)),
    };
    const uninstall = manager.installGestureUnlock(target);
    expect(manager.installGestureUnlock(target)).toBe(uninstall);
    expect([...handlers.keys()].sort()).toEqual(['click', 'keydown', 'pointerdown', 'touchend']);
    handlers.get('pointerdown')?.();
    await vi.waitFor(() => expect(handlers.size).toBe(0));
    expect(engine.unlockCalls).toBe(1);
  });

  it('keeps listening when the first gesture does not unlock', async () => {
    const { manager, engine } = setup();
    engine.state = 'suspended';
    engine.unlockResult = false;
    const handlers = new Map<string, () => void>();
    const target = {
      addEventListener: (type: string, fn: () => void) => void handlers.set(type, fn),
      removeEventListener: (type: string) => void handlers.delete(type),
    };
    manager.installGestureUnlock(target);
    handlers.get('keydown')?.();
    await vi.waitFor(() => expect(engine.unlockCalls).toBe(1));
    expect(handlers.size).toBe(4);
  });

  it('removes gesture listeners on dispose', () => {
    const { manager } = setup();
    const handlers = new Map<string, () => void>();
    const target = {
      addEventListener: (type: string, fn: () => void) => void handlers.set(type, fn),
      removeEventListener: (type: string) => void handlers.delete(type),
    };
    manager.installGestureUnlock(target);
    manager.dispose();
    expect(handlers.size).toBe(0);
  });
});

describe('voice limit', () => {
  it('steals the lowest-priority oldest voice for a higher-priority sound', async () => {
    const { manager } = setup({ maxVoices: 2 });
    const a = await manager.play('ui.click'); // ui priority 30
    const b = await manager.play('sfx.coin'); // sfx priority 20
    const c = await manager.play('music.theme'); // music priority 60
    expect(b?.state).toBe('ended');
    expect(a?.state).toBe('playing');
    expect(c?.state).toBe('playing');
  });

  it('drops a new sound that is lower priority than everything playing', async () => {
    const { manager } = setup({ maxVoices: 1 });
    const music = await manager.play('music.theme');
    await expect(manager.play('sfx.coin')).resolves.toBeNull();
    expect(music?.state).toBe('playing');
    expect(manager.getDiagnostics()[0]?.code).toBe('voice-limit');
  });
});

describe('diagnostics', () => {
  it('keeps a bounded ring and survives a throwing sink', async () => {
    const { manager } = setup({
      onDiagnostic: () => {
        throw new Error('sink bug');
      },
    });
    for (let i = 0; i < 80; i += 1) await manager.play(`missing-${i}`);
    expect(manager.getDiagnostics()).toHaveLength(50);
    manager.clearDiagnostics();
    expect(manager.getDiagnostics()).toHaveLength(0);
  });
});
