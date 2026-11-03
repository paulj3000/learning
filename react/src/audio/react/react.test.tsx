import { StrictMode, useEffect } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSoundManager } from '../SoundManager';
import { resetSharedSoundManager } from '../sharedSoundManager';
import type { SoundManager, SoundPlayer } from '../AudioTypes';
import { FakeEngine } from '../testing/fakes';
import {
  SoundProvider,
  useAudioStatus,
  useSound,
  useSoundManager,
  useSoundScope,
  useSoundSettings,
} from '.';

const definitions = [
  { id: 'ui.click', url: 'test://click', channel: 'ui' },
  { id: 'music.theme', url: 'test://theme', channel: 'music', loop: true },
] as const;

function build() {
  const engine = new FakeEngine();
  const manager = createSoundManager({ engine, definitions });
  return { engine, manager };
}

afterEach(() => resetSharedSoundManager());

describe('SoundProvider and hooks', () => {
  it('shares one manager with every consumer', () => {
    const { manager } = build();
    const seen: SoundManager[] = [];
    function Probe() {
      seen.push(useSoundManager());
      return null;
    }
    render(
      <SoundProvider manager={manager}>
        <Probe />
        <Probe />
      </SoundProvider>,
    );
    expect(seen).toEqual([manager, manager]);
  });

  it('falls back to the shared manager without a provider', () => {
    const seen: SoundManager[] = [];
    const record = (manager: SoundManager): void => {
      seen.push(manager);
    };
    function Probe() {
      const manager = useSoundManager();
      useEffect(() => record(manager), [manager]);
      return null;
    }
    render(<Probe />);
    render(<Probe />);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it('plays a sound from a button click', async () => {
    const { manager, engine } = build();
    function Button() {
      const { playSound } = useSound();
      return <button onClick={() => playSound('ui.click')}>Tap</button>;
    }
    render(
      <SoundProvider manager={manager}>
        <Button />
      </SoundProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Tap' }));
    await vi.waitFor(() => expect(engine.voices).toHaveLength(1));
  });

  it('keeps useSound helpers stable across re-renders', () => {
    const { manager } = build();
    const identities: SoundPlayer[] = [];
    function Probe({ tick }: { tick: number }) {
      identities.push(useSound());
      return <span>{tick}</span>;
    }
    const { rerender } = render(
      <SoundProvider manager={manager}>
        <Probe tick={1} />
      </SoundProvider>,
    );
    rerender(
      <SoundProvider manager={manager}>
        <Probe tick={2} />
      </SoundProvider>,
    );
    expect(identities[0]).toBe(identities.at(-1));
  });

  it('keeps exactly one set of gesture listeners under StrictMode and removes them on unmount', () => {
    const { manager } = build();
    const added = vi.spyOn(document, 'addEventListener');
    const removed = vi.spyOn(document, 'removeEventListener');
    const active = () =>
      added.mock.calls.filter(([type]) => type === 'pointerdown').length -
      removed.mock.calls.filter(([type]) => type === 'pointerdown').length;
    const { unmount } = render(
      <StrictMode>
        <SoundProvider manager={manager}>
          <span />
        </SoundProvider>
      </StrictMode>,
    );
    expect(active()).toBe(1);
    unmount();
    expect(active()).toBe(0);
    expect(manager.disposed).toBe(false); // the provider never disposes the manager
    added.mockRestore();
    removed.mockRestore();
  });

  it('can skip gesture unlock', () => {
    const { manager } = build();
    const install = vi.spyOn(manager, 'installGestureUnlock');
    render(
      <SoundProvider manager={manager} unlockOnGesture={false}>
        <span />
      </SoundProvider>,
    );
    expect(install).not.toHaveBeenCalled();
  });
});

describe('useSoundScope', () => {
  function Game({ onPlayer }: { onPlayer?: (player: SoundPlayer) => void }) {
    const player = useSoundScope('treasure-rush');
    useEffect(() => {
      onPlayer?.(player);
      void player.play('music.theme');
    }, [player, onPlayer]);
    return <p>playing</p>;
  }

  it('stops the component sounds on unmount but not the global ones', async () => {
    const { manager, engine } = build();
    const global = await manager.play('ui.click');
    const view = render(
      <SoundProvider manager={manager}>
        <Game />
      </SoundProvider>,
    );
    await vi.waitFor(() => expect(engine.voices).toHaveLength(2));
    view.unmount();
    expect(engine.voices[1]?.stopped).toBe(true);
    expect(global?.state).toBe('playing');
  });

  it('survives the StrictMode mount, cleanup, mount cycle and still stops on real unmount', async () => {
    const { manager, engine } = build();
    const view = render(
      <StrictMode>
        <SoundProvider manager={manager}>
          <Game />
        </SoundProvider>
      </StrictMode>,
    );
    // The simulated unmount stopped the first sound; the remount started a live one.
    await vi.waitFor(() => expect(engine.voices.some((v) => !v.stopped)).toBe(true));
    const live = engine.voices.filter((v) => !v.stopped);
    expect(live).toHaveLength(1);
    view.unmount();
    expect(engine.voices.every((v) => v.stopped)).toBe(true);
  });

  it('cannot play after unmount, and cancels a load still in flight', async () => {
    const { manager, engine } = build();
    engine.autoLoad = false;
    let player: SoundPlayer | undefined;
    const view = render(
      <SoundProvider manager={manager}>
        <Game onPlayer={(p) => (player = p)} />
      </SoundProvider>,
    );
    await vi.waitFor(() => expect(engine.loads).toHaveLength(1));
    view.unmount();
    expect(engine.voices).toHaveLength(0);
    await expect(player?.play('ui.click')).resolves.toBeNull();
  });
});

describe('settings hooks', () => {
  it('re-renders on a setting change but not on playback', async () => {
    const { manager } = build();
    const onRender = vi.fn();
    function Panel() {
      onRender();
      const settings = useSoundSettings();
      const status = useAudioStatus();
      return (
        <p>
          {settings.masterVolume}:{status}
        </p>
      );
    }
    render(
      <SoundProvider manager={manager}>
        <Panel />
      </SoundProvider>,
    );
    expect(screen.getByText('1:ready')).toBeInTheDocument();
    const baseline = onRender.mock.calls.length;
    const handle = await manager.play('ui.click');
    handle?.stop();
    expect(onRender).toHaveBeenCalledTimes(baseline);
    act(() => manager.setMasterVolume(0.5));
    expect(screen.getByText('0.5:ready')).toBeInTheDocument();
    expect(onRender).toHaveBeenCalledTimes(baseline + 1);
  });
});
