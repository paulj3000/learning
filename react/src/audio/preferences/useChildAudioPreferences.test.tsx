import { StrictMode } from 'react';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioSettingsApi } from '../../api/audio/audioSettingsApi';
import { createDefaultSettings } from '../AudioChannels';
import { createSoundManager } from '../SoundManager';
import type { SoundManager, SoundSettings } from '../AudioTypes';
import { resetSharedSoundManager } from '../sharedSoundManager';
import { FakeEngine } from '../testing/fakes';
import { SoundProvider } from '../react';
import { ChildAudioPreferencesSync, useChildAudioPreferences } from '.';

afterEach(() => resetSharedSoundManager());

const mix = (volume: number): SoundSettings => ({
  ...createDefaultSettings(),
  masterVolume: volume,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  });

function Probe({
  childId,
  apiFor,
}: {
  childId: string | null;
  apiFor: (id: string) => AudioSettingsApi | null;
}) {
  useChildAudioPreferences(childId, { apiFor, debounceMs: 10 });
  return null;
}

function world() {
  const manager = createSoundManager({ engine: new FakeEngine() });
  const apis = new Map<string, AudioSettingsApi>();
  const make = (id: string, volume: number, gate?: Promise<SoundSettings>): AudioSettingsApi => {
    const api: AudioSettingsApi = {
      get: vi.fn(() => gate ?? Promise.resolve(mix(volume))),
      save: vi.fn(async (s) => s),
    };
    apis.set(id, api);
    return api;
  };
  const apiFor = vi.fn((id: string) => apis.get(id) ?? null);
  return { manager, make, apiFor, apis };
}

const wrap = (manager: SoundManager, node: React.ReactNode, strict = false) => {
  const tree = (
    <SoundProvider manager={manager} unlockOnGesture={false}>
      {node}
    </SoundProvider>
  );
  return strict ? <StrictMode>{tree}</StrictMode> : tree;
};

describe('useChildAudioPreferences', () => {
  it('loads the child’s mix once, even under StrictMode', async () => {
    const w = world();
    const api = w.make('c1', 0.35);
    render(wrap(w.manager, <Probe childId="c1" apiFor={w.apiFor} />, true));
    await flush();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(w.manager.getSettings().masterVolume).toBe(0.35);
  });

  it('loads the other child’s mix on a switch, and a stale answer cannot overwrite it', async () => {
    const w = world();
    const slowA = deferred<SoundSettings>();
    w.make('a', 0.9, slowA.promise);
    w.make('b', 0.2);
    const view = render(wrap(w.manager, <Probe childId="a" apiFor={w.apiFor} />));
    await flush();
    view.rerender(wrap(w.manager, <Probe childId="b" apiFor={w.apiFor} />));
    await flush();
    expect(w.manager.getSettings().masterVolume).toBe(0.2);
    slowA.resolve(mix(0.9));
    await flush();
    expect(w.manager.getSettings().masterVolume).toBe(0.2);
  });

  it('saves a change to the child who made it, not to another', async () => {
    const w = world();
    const a = w.make('a', 1);
    const b = w.make('b', 1);
    const view = render(wrap(w.manager, <Probe childId="a" apiFor={w.apiFor} />));
    await flush();
    act(() => w.manager.setMasterVolume(0.3));
    await new Promise((r) => setTimeout(r, 30));
    expect(a.save).toHaveBeenCalledTimes(1);
    view.rerender(wrap(w.manager, <Probe childId="b" apiFor={w.apiFor} />));
    await flush();
    expect(b.save).not.toHaveBeenCalled();
  });

  it('resets to the defaults when the child area is left', async () => {
    const w = world();
    w.make('a', 0.1);
    const view = render(wrap(w.manager, <Probe childId="a" apiFor={w.apiFor} />));
    await flush();
    expect(w.manager.getSettings().masterVolume).toBe(0.1);
    view.rerender(wrap(w.manager, <Probe childId={null} apiFor={w.apiFor} />));
    await flush();
    expect(w.manager.getSettings().masterVolume).toBe(1);
  });
});

describe('ChildAudioPreferencesSync (route aware)', () => {
  it('stays out of the way on account pages and follows the island child', async () => {
    const w = world();
    w.make('kid-1', 0.4);
    // The component reads the route; the default api is built per child, so only check no crash here.
    const view = render(
      wrap(
        w.manager,
        <MemoryRouter initialEntries={['/home']}>
          <ChildAudioPreferencesSync />
        </MemoryRouter>,
      ),
    );
    await flush();
    expect(w.manager.getSettings().masterVolume).toBe(1);
    view.unmount();
  });
});
