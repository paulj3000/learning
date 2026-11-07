import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioSettingsApi } from '../../api/audio/audioSettingsApi';
import { createDefaultSettings } from '../AudioChannels';
import { createSoundManager } from '../SoundManager';
import type { SoundSettings } from '../AudioTypes';
import { FakeEngine } from '../testing/fakes';
import { createPreferenceSync, SAVE_DEBOUNCE_MS } from './AudioPreferencesSync';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function mix(change: (s: SoundSettings) => void): SoundSettings {
  const s = createDefaultSettings();
  change(s);
  return s;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(remote: SoundSettings | Error = createDefaultSettings()) {
  const engine = new FakeEngine();
  const manager = createSoundManager({ engine });
  const saves: SoundSettings[] = [];
  const api: AudioSettingsApi = {
    get: vi.fn(async () => {
      if (remote instanceof Error) throw remote;
      return remote;
    }),
    save: vi.fn(async (settings) => {
      saves.push(settings);
      return settings;
    }),
  };
  return { engine, manager, api, saves };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

describe('loading', () => {
  it('applies the saved mix, keeping a muted channel’s remembered volume', async () => {
    const remote = mix((s) => {
      s.masterVolume = 0.4;
      s.channels.music = { volume: 0.2, muted: true };
      s.reducedIntensity = true;
    });
    const { manager, api } = setup(remote);
    const sync = createPreferenceSync({ manager, api });
    await sync.start();
    const live = manager.getSettings();
    expect(live.masterVolume).toBe(0.4);
    expect(live.channels.music).toEqual({ volume: 0.2, muted: true });
    expect(live.reducedIntensity).toBe(true);
    expect(sync.state).toBe('ready');
    manager.muteChannel('music', false);
    expect(manager.getSettings().channels.music.volume).toBe(0.2);
  });

  it('resets the previous child’s mix to the defaults before loading', async () => {
    const { manager, api } = setup(createDefaultSettings());
    manager.setMasterVolume(0.1);
    manager.muteChannel('sfx', true);
    await createPreferenceSync({ manager, api }).start();
    expect(manager.getSettings().masterVolume).toBe(1);
    expect(manager.getSettings().channels.sfx.muted).toBe(false);
  });

  it('does not save what it just applied', async () => {
    const { manager, api, saves } = setup(mix((s) => (s.masterVolume = 0.3)));
    await createPreferenceSync({ manager, api }).start();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 3);
    expect(saves).toHaveLength(0);
  });

  it('plays on with the defaults when the load fails, and reports it once', async () => {
    const { manager, api } = setup(new Error('offline'));
    const onError = vi.fn();
    const sync = createPreferenceSync({ manager, api, onError });
    await expect(sync.start()).resolves.toBeUndefined();
    expect(sync.state).toBe('failed');
    expect(onError).toHaveBeenCalledWith('load');
    expect(manager.getSettings().masterVolume).toBe(1);
  });

  it('does nothing without an api (a build without Django)', async () => {
    const { manager } = setup();
    manager.setMasterVolume(0.6);
    const sync = createPreferenceSync({ manager, api: null });
    await sync.start();
    sync.dispose();
    expect(manager.getSettings().masterVolume).toBe(0.6);
  });

  it('keeps a change made before the load answered, and saves it over the old mix', async () => {
    const gate = deferred<SoundSettings>();
    const { manager, api, saves } = setup();
    vi.mocked(api.get).mockReturnValue(gate.promise);
    const sync = createPreferenceSync({ manager, api });
    const started = sync.start();
    await settle();
    manager.setMasterVolume(0.2);
    gate.resolve(mix((s) => (s.masterVolume = 0.9)));
    await started;
    expect(manager.getSettings().masterVolume).toBe(0.2);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(saves.at(-1)?.masterVolume).toBe(0.2);
  });
});

describe('saving', () => {
  it('saves a slider drag once, with the last value', async () => {
    const { manager, api, saves } = setup();
    await createPreferenceSync({ manager, api }).start();
    for (const v of [0.9, 0.8, 0.7, 0.6]) {
      manager.setChannelVolume('music', v);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(saves).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(saves).toHaveLength(1);
    expect(saves[0]?.channels.music.volume).toBe(0.6);
  });

  it('saves a master mute, and unmuting restores the volume', async () => {
    const { manager, api, saves } = setup();
    await createPreferenceSync({ manager, api }).start();
    manager.setMasterVolume(0.7);
    manager.setMuted(true);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(saves.at(-1)).toMatchObject({ masterVolume: 0.7, masterMuted: true });
    manager.setMuted(false);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(saves.at(-1)).toMatchObject({ masterVolume: 0.7, masterMuted: false });
  });

  it('survives a failed save without a retry loop, and tries again on the next change', async () => {
    const { manager, api } = setup();
    const onError = vi.fn();
    vi.mocked(api.save).mockRejectedValueOnce(new Error('offline'));
    await createPreferenceSync({ manager, api, onError }).start();
    manager.setMasterVolume(0.5);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 5);
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('save');
    manager.setMasterVolume(0.4);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(api.save).toHaveBeenCalledTimes(2);
  });

  it('applies changes to what is playing without restarting it', async () => {
    const { engine, manager, api } = setup();
    manager.register({ id: 'music.test.loop', channel: 'music', url: 'x', loop: true });
    await manager.play('music.test.loop');
    const voices = engine.voices.length;
    await createPreferenceSync({ manager, api }).start();
    manager.setChannelVolume('music', 0.1);
    manager.muteChannel('music', true);
    manager.muteChannel('music', false);
    expect(engine.voices).toHaveLength(voices);
    expect(engine.channelGains.get('music')).toBe(0.1);
  });
});

describe('leaving and switching', () => {
  it('saves a pending change for its own child on dispose, then resets to the defaults', async () => {
    const { manager, api, saves } = setup();
    const sync = createPreferenceSync({ manager, api });
    await sync.start();
    manager.setMasterVolume(0.3);
    sync.dispose();
    expect(saves).toHaveLength(1);
    expect(saves[0]?.masterVolume).toBe(0.3);
    expect(manager.getSettings().masterVolume).toBe(1);
  });

  it('ignores a late answer after dispose, so an old child cannot overwrite a newer one', async () => {
    const gate = deferred<SoundSettings>();
    const first = setup();
    vi.mocked(first.api.get).mockReturnValue(gate.promise);
    const manager = first.manager;
    const a = createPreferenceSync({ manager, api: first.api });
    const startedA = a.start();
    await settle();
    a.dispose();
    const b = setup(mix((s) => (s.masterVolume = 0.25)));
    const syncB = createPreferenceSync({ manager, api: b.api });
    await syncB.start();
    gate.resolve(mix((s) => (s.masterVolume = 0.9)));
    await startedA;
    expect(manager.getSettings().masterVolume).toBe(0.25);
    expect(first.saves).toHaveLength(0);
  });

  it('dispose is idempotent and stops listening', async () => {
    const { manager, api, saves } = setup();
    const sync = createPreferenceSync({ manager, api });
    await sync.start();
    sync.dispose();
    sync.dispose();
    manager.setMasterVolume(0.1);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);
    expect(saves).toHaveLength(0);
  });
});
