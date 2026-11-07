import { StrictMode, createRef } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSoundManager } from '../../../../../audio/SoundManager';
import { resetSharedSoundManager } from '../../../../../audio/sharedSoundManager';
import { SoundProvider } from '../../../../../audio/react';
import { FakeEngine } from '../../../../../audio/testing/fakes';
import { getSpeechBinding, setSpeechBinding } from '../../../../../audio/speech/speechBinding';
import type { SpeechClipInfo, SpeechSource } from '../../../../../audio/speech';
import type { CastleTaleSceneApi } from './castleTaleScene';
import { useCastleSpeech } from './useCastleSpeech';

afterEach(() => {
  setSpeechBinding(null);
  resetSharedSoundManager();
});

const QUILL = 'keeper-quill';
const tick = () =>
  act(async () => {
    for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
const clip = (text: string): SpeechClipInfo => ({
  url: 'https://s.test/a.mp3',
  expiresInSeconds: 900,
  text,
  voiceProfile: 'p',
  cached: false,
});

function world(options: { strict?: boolean; scene?: boolean } = {}) {
  const engine = new FakeEngine();
  const manager = createSoundManager({ engine });
  const request = vi.fn(async (ref: unknown) =>
    clip(
      JSON.stringify(ref).includes('quill-greeting')
        ? 'Welcome to the library.'
        : 'Once upon a time.',
    ),
  );
  const source: SpeechSource = { request };
  const sceneRef = createRef<CastleTaleSceneApi | null>() as { current: CastleTaleSceneApi | null };
  sceneRef.current =
    options.scene === false
      ? null
      : ({
          quillPositionReader: () => (out: [number, number, number]) => {
            out[0] = 4;
            out[1] = 0;
            out[2] = -2;
            return true;
          },
        } as unknown as CastleTaleSceneApi);
  let latest: ReturnType<typeof useCastleSpeech> | undefined;
  function Probe() {
    latest = useCastleSpeech('kid', QUILL, sceneRef, source);
    return <p>{latest.speaker ?? 'nobody'}</p>;
  }
  const tree = (
    <SoundProvider manager={manager} unlockOnGesture={false}>
      <Probe />
    </SoundProvider>
  );
  const view = render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { engine, request, view, state: () => latest! };
}

const turn = (spokenText: string) => ({
  turn: { spokenText },
  speech: { utteranceId: '8f1b7c0e-6f0e-4b9e-9d3f-0a7a1b2c3d4e', voiceProfile: 'chatty' },
});

describe('useCastleSpeech', () => {
  it('registers a speech binding while the castle is mounted, and removes it on exit', async () => {
    const w = world();
    await tick();
    expect(getSpeechBinding()).not.toBeNull();
    w.view.unmount();
    expect(getSpeechBinding()).toBeNull();
  });

  it('puts Keeper Quill’s voice where he stands, in distance and direction', async () => {
    const w = world();
    await tick();
    await act(
      async () =>
        void getSpeechBinding()!.speakNpcNode(QUILL, 'quill-greeting', 'Welcome to the library.'),
    );
    await tick();
    const voice = w.engine.voices.find((v) => v.options.channel === 'voice');
    expect(voice?.options.spatial).toMatchObject({
      position: [4, 0, -2],
      refDistance: 2.5,
      maxDistance: 20,
    });
    expect(w.request).toHaveBeenCalledWith(
      { kind: 'npcNode', npcId: QUILL, nodeId: 'quill-greeting' },
      expect.anything(),
    );
    expect(w.state().speaker).toBe('Keeper Quill');
  });

  it('keeps story narration flat so every child hears it clearly', async () => {
    const w = world();
    await tick();
    await act(async () => void getSpeechBinding()!.speakTurn(turn('Once upon a time.')));
    await tick();
    const voice = w.engine.voices.find((v) => v.options.channel === 'voice');
    expect(voice).toBeDefined();
    expect(voice?.options.spatial).toBeUndefined();
    expect(w.state().speaker).toBe('Chatty');
    expect(w.state().speech.state.caption).toBe('Once upon a time.');
  });

  it('speaks Quill’s re-voiced line from him too', async () => {
    const w = world();
    await tick();
    await act(
      async () =>
        void getSpeechBinding()!.speakTurn(turn('Welcome back, author!'), { npcId: QUILL }),
    );
    await tick();
    expect(
      w.engine.voices.find((v) => v.options.channel === 'voice')?.options.spatial,
    ).toMatchObject({
      position: [4, 0, -2],
    });
  });

  it('plays flat when the scene is not up yet, and still shows the words', async () => {
    const w = world({ scene: false });
    await tick();
    await act(async () => void getSpeechBinding()!.speakNpcNode(QUILL, 'quill-greeting', 'Hi'));
    await tick();
    expect(
      w.engine.voices.find((v) => v.options.channel === 'voice')?.options.spatial,
    ).toBeUndefined();
    expect(w.state().speech.state.caption).toBe('Welcome to the library.');
  });

  it('stops speaking when the conversation ends, and when the castle is left', async () => {
    const w = world();
    await tick();
    await act(async () => void getSpeechBinding()!.speakTurn(turn('Once upon a time.')));
    await tick();
    expect(w.engine.voices.filter((v) => !v.stopped && v.options.channel === 'voice')).toHaveLength(
      1,
    );
    act(() => getSpeechBinding()!.stop());
    expect(w.engine.voices.filter((v) => !v.stopped)).toHaveLength(0);
    await act(async () => void getSpeechBinding()!.speakTurn(turn('Once upon a time.')));
    await tick();
    w.view.unmount();
    expect(w.engine.voices.filter((v) => !v.stopped)).toHaveLength(0);
  });

  it('is safe under StrictMode: one binding, one voice', async () => {
    const w = world({ strict: true });
    await tick();
    await act(async () => void getSpeechBinding()!.speakTurn(turn('Once upon a time.')));
    await tick();
    expect(w.request).toHaveBeenCalledTimes(1);
    expect(w.engine.voices.filter((v) => !v.stopped && v.options.channel === 'voice')).toHaveLength(
      1,
    );
  });

  it('restores whatever binding was there before', async () => {
    const earlier = { speakTurn: vi.fn(), speakNpcNode: vi.fn(), stop: vi.fn() };
    setSpeechBinding(earlier as never);
    const w = world();
    await tick();
    w.view.unmount();
    expect(getSpeechBinding()).toBe(earlier);
  });
});
