import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioSettingsApi, LoadedAudioSettings } from '../../api/audio/audioSettingsApi';
import { createDefaultSettings } from '../AudioChannels';
import { createSoundManager } from '../SoundManager';
import type { SoundSettings } from '../AudioTypes';
import { FakeEngine } from '../testing/fakes';
import { createPreferenceSync, SAVE_DEBOUNCE_MS } from './AudioPreferencesSync';

/**
 * SC-R06-02: a session-only default (Sprouts' calmer castle). It applies only when the server says
 * the child has no saved mix, is never saved on its own, and gives way to anything the child sets.
 */
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(remote: LoadedAudioSettings | Error, options: { deferred?: boolean } = {}) {
  const manager = createSoundManager({ engine: new FakeEngine() });
  const saves: SoundSettings[] = [];
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const api: AudioSettingsApi = {
    get: vi.fn(async () => {
      if (options.deferred) await gate;
      if (remote instanceof Error) throw remote;
      return remote;
    }),
    save: vi.fn(async (settings) => {
      saves.push(settings);
      return settings;
    }),
  };
  return { manager, api, saves, release: () => release?.() };
}

const nothingSaved = (): LoadedAudioSettings => ({ ...createDefaultSettings(), saved: false });
const somethingSaved = (): LoadedAudioSettings => ({ ...createDefaultSettings(), saved: true });
const quiet = () => vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 3);

describe('session defaults (SC-R06-02)', () => {
  it('applies when nothing is saved, and is never saved on its own', async () => {
    const { manager, api, saves } = setup(nothingSaved());
    const sync = createPreferenceSync({ manager, api });
    await sync.start();
    expect(sync.hasSavedMix).toBe(false);
    sync.applySessionDefault({ reducedIntensity: true });
    expect(manager.getSettings().reducedIntensity).toBe(true);
    await quiet();
    sync.dispose();
    expect(saves).toHaveLength(0);
  });

  it('never applies over a saved mix', async () => {
    const { manager, api } = setup(somethingSaved());
    const sync = createPreferenceSync({ manager, api });
    await sync.start();
    expect(sync.hasSavedMix).toBe(true);
    sync.applySessionDefault({ reducedIntensity: true });
    expect(manager.getSettings().reducedIntensity).toBe(false);
  });

  it('never applies when the server cannot say (failed load, or an older server)', async () => {
    for (const remote of [new Error('offline'), createDefaultSettings()]) {
      const { manager, api } = setup(remote);
      const sync = createPreferenceSync({ manager, api });
      await sync.start();
      sync.applySessionDefault({ reducedIntensity: true });
      expect(manager.getSettings().reducedIntensity).toBe(false);
    }
  });

  it('asked before the load answers, it waits and then applies', async () => {
    const { manager, api, release } = setup(nothingSaved(), { deferred: true });
    const sync = createPreferenceSync({ manager, api });
    const started = sync.start();
    sync.applySessionDefault({ reducedIntensity: true });
    expect(manager.getSettings().reducedIntensity).toBe(false);
    release();
    await started;
    expect(manager.getSettings().reducedIntensity).toBe(true);
  });

  it('gives way to a change the child made before the load answered', async () => {
    const { manager, api, release } = setup(nothingSaved(), { deferred: true });
    const sync = createPreferenceSync({ manager, api });
    const started = sync.start();
    sync.applySessionDefault({ reducedIntensity: true });
    manager.setMasterVolume(0.3);
    release();
    await started;
    expect(manager.getSettings().reducedIntensity).toBe(false);
  });

  it('the undo puts the previous value back, unless the child changed something since', async () => {
    const first = setup(nothingSaved());
    const sync = createPreferenceSync({ manager: first.manager, api: first.api });
    await sync.start();
    sync.applySessionDefault({ reducedIntensity: true })();
    expect(first.manager.getSettings().reducedIntensity).toBe(false);
    await quiet();
    expect(first.saves).toHaveLength(0);

    const second = setup(nothingSaved());
    const kept = createPreferenceSync({ manager: second.manager, api: second.api });
    await kept.start();
    const undo = kept.applySessionDefault({ reducedIntensity: true });
    second.manager.setMasterVolume(0.5); // the child's own choice: the whole mix they see stands
    undo();
    expect(second.manager.getSettings().reducedIntensity).toBe(true);
  });

  it('a pending default dropped by its undo never applies', async () => {
    const { manager, api, release } = setup(nothingSaved(), { deferred: true });
    const sync = createPreferenceSync({ manager, api });
    const started = sync.start();
    sync.applySessionDefault({ reducedIntensity: true })();
    release();
    await started;
    expect(manager.getSettings().reducedIntensity).toBe(false);
  });

  it('without an API (nothing is ever saved) it applies at once', () => {
    const manager = createSoundManager({ engine: new FakeEngine() });
    const sync = createPreferenceSync({ manager, api: null });
    const undo = sync.applySessionDefault({ reducedIntensity: true });
    expect(manager.getSettings().reducedIntensity).toBe(true);
    undo();
    expect(manager.getSettings().reducedIntensity).toBe(false);
  });
});
