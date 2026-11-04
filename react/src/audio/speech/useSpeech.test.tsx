import { StrictMode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSoundManager } from '../SoundManager';
import { resetSharedSoundManager } from '../sharedSoundManager';
import { SoundProvider } from '../react';
import { FakeEngine } from '../testing/fakes';
import type { SoundManager } from '../AudioTypes';
import { SpeechCaption } from './SpeechCaption';
import type { SpeechClipInfo, SpeechSource } from './SpeechPlayer';
import { useSpeech } from './useSpeech';

afterEach(() => resetSharedSoundManager());
const tick = () =>
  act(async () => {
    for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
const clip = (text = 'Welcome!'): SpeechClipInfo => ({
  url: 'https://s.test/a.mp3',
  expiresInSeconds: 900,
  text,
  voiceProfile: 'p',
  cached: false,
});

function Probe({
  source,
  onReady,
}: {
  source: SpeechSource | null;
  onReady?: (speech: ReturnType<typeof useSpeech>) => void;
}) {
  const speech = useSpeech({ childId: 'kid', source });
  onReady?.(speech);
  return (
    <div>
      <button
        onClick={() =>
          void speech.speak({ reference: { kind: 'line', id: 'x' }, fallbackText: 'Authored.' })
        }
      >
        go
      </button>
      <SpeechCaption
        state={speech.state}
        onReplay={() => void speech.replay()}
        onStop={speech.stop}
        onPause={speech.pause}
        onResume={speech.resume}
      />
    </div>
  );
}

function world(strict = false) {
  const engine = new FakeEngine();
  const manager = createSoundManager({ engine });
  const request = vi.fn(async () => clip());
  const source: SpeechSource = { request };
  const wrap = (node: React.ReactNode, m: SoundManager = manager) => {
    const tree = (
      <SoundProvider manager={m} unlockOnGesture={false}>
        {node}
      </SoundProvider>
    );
    return strict ? <StrictMode>{tree}</StrictMode> : tree;
  };
  return { engine, manager, request, source, wrap };
}

describe('useSpeech', () => {
  it('speaks and captions through the voice channel', async () => {
    const w = world();
    render(w.wrap(<Probe source={w.source} />));
    await tick();
    act(() => screen.getByText('go').click());
    await tick();
    expect(screen.getByRole('status')).toHaveTextContent('Welcome!');
    expect(w.engine.voices.filter((v) => v.options.channel === 'voice')).toHaveLength(1);
  });

  it('is safe under StrictMode: one request, one voice', async () => {
    const w = world(true);
    render(w.wrap(<Probe source={w.source} />));
    await tick();
    act(() => screen.getByText('go').click());
    await tick();
    expect(w.request).toHaveBeenCalledTimes(1);
    expect(w.engine.voices.filter((v) => !v.stopped)).toHaveLength(1);
  });

  it('stops the voice when the component unmounts, and nothing late can start', async () => {
    const w = world();
    let release!: (value: SpeechClipInfo) => void;
    w.request.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const view = render(w.wrap(<Probe source={w.source} />));
    await tick();
    act(() => screen.getByText('go').click());
    await tick();
    view.unmount();
    release(clip());
    await tick();
    expect(w.engine.voices).toHaveLength(0);
  });

  it('shows the words with no speech source (a text-only build)', async () => {
    const w = world();
    render(w.wrap(<Probe source={null} />));
    await tick();
    act(() => screen.getByText('go').click());
    await tick();
    expect(screen.getByRole('status')).toHaveTextContent('Authored.');
    expect(w.engine.voices).toHaveLength(0);
  });

  it('text shown before the player is ready is not lost', async () => {
    const w = world();
    let api: ReturnType<typeof useSpeech> | undefined;
    render(w.wrap(<Probe source={null} onReady={(s) => (api = s)} />));
    // Called during the first render, before the effect built the player.
    await act(async () => void api?.showText('Early words.'));
    await tick();
    expect(screen.getByRole('status')).toHaveTextContent('Early words.');
  });

  it('keeps working after a failed request (no dialog, words still shown)', async () => {
    const w = world();
    w.request.mockRejectedValue(new Error('offline'));
    render(w.wrap(<Probe source={w.source} />));
    await tick();
    act(() => screen.getByText('go').click());
    await tick();
    expect(screen.getByRole('status')).toHaveTextContent('Authored.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
