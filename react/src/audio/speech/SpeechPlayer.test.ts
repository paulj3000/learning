import { describe, expect, it, vi } from 'vitest';
import { createSoundManager } from '../SoundManager';
import { FakeEngine, type FakeVoice } from '../testing/fakes';
import {
  createSpeechPlayer,
  type SpeechClipInfo,
  type SpeechReference,
  type SpeechSource,
} from './SpeechPlayer';

const tick = () => new Promise((r) => setTimeout(r, 0));
const REF: SpeechReference = { kind: 'line', id: 'quill-hello' };
const clip = (text = 'Welcome to the castle library.'): SpeechClipInfo => ({
  url: 'https://speech.test/clip.mp3',
  expiresInSeconds: 900,
  text,
  voiceProfile: 'keeper-quill',
  cached: false,
});

function setup(source: SpeechSource | null | 'default' = 'default') {
  const engine = new FakeEngine();
  const manager = createSoundManager({ engine });
  manager.register({ id: 'music.s.bed', channel: 'music', url: 'm', loop: true });
  const scope = manager.createScope('speech');
  const request = vi.fn(async (_ref: SpeechReference, _signal: AbortSignal) => clip());
  const fake: SpeechSource | null = source === 'default' ? { request } : source;
  const speech = createSpeechPlayer({ manager, player: scope, source: fake });
  const voices = () => engine.voices.filter((v) => v.options.channel === 'voice');
  const live = () => voices().filter((v) => !v.stopped);
  return { engine, manager, scope, speech, request, voices, live };
}

describe('speaking', () => {
  it('shows the text at once, then the server text, and plays on the voice channel', async () => {
    const s = setup();
    const gate = new Promise<SpeechClipInfo>((resolve) =>
      setTimeout(() => resolve(clip('Server words.')), 5),
    );
    s.request.mockReturnValueOnce(gate);
    const done = s.speech.speak({ reference: REF, fallbackText: 'Authored words.' });
    await Promise.resolve();
    expect(s.speech.getState()).toMatchObject({
      phase: 'loading',
      caption: 'Authored words.',
      captionFrom: 'fallback',
    });
    await new Promise((r) => setTimeout(r, 15));
    expect(s.speech.getState()).toMatchObject({
      phase: 'playing',
      caption: 'Server words.',
      captionFrom: 'speech',
      canReplay: true,
    });
    expect(s.live()).toHaveLength(1);
    s.live()[0]!.finish('finished');
    await done;
    expect(s.speech.getState().phase).toBe('idle');
    expect(s.speech.getState().caption).toBe('Server words.'); // still readable afterwards
  });

  it('asks the server by reference, never with text', async () => {
    const s = setup();
    void s.speech.speak({ reference: REF, fallbackText: 'Authored words.' });
    await tick();
    expect(s.request.mock.calls[0]?.[0]).toEqual(REF);
  });

  it('ducks the music while it talks and restores it after', async () => {
    const s = setup();
    await s.manager.play('music.s.bed');
    const done = s.speech.speak({ reference: REF });
    await tick();
    expect(s.engine.channelGains.get('music')).toBeCloseTo(0.15);
    s.live()[0]!.finish('finished');
    await done;
    await tick();
    expect(s.engine.channelGains.get('music')).toBe(0.5);
  });

  it('uses the child’s voice volume and mute, and the caption stays when muted', async () => {
    const s = setup();
    s.manager.setChannelVolume('voice', 0.4);
    s.manager.muteChannel('voice', true);
    void s.speech.speak({ reference: REF, fallbackText: 'Hello' });
    await tick();
    expect(s.engine.channelGains.get('voice')).toBe(0);
    expect(s.speech.getState().caption).toBe('Welcome to the castle library.');
    s.manager.muteChannel('voice', false);
    expect(s.engine.channelGains.get('voice')).toBe(0.4);
  });

  it('releases the temporary sound when it ends, leaving nothing registered', async () => {
    const s = setup();
    const registered = () =>
      [...Array(500).keys()].filter((n) => s.manager.has(`voice.speech.u${n}`));
    const done = s.speech.speak({ reference: REF });
    await tick();
    expect(registered()).toHaveLength(1);
    s.live()[0]!.finish('finished');
    await done;
    expect(registered()).toHaveLength(0);
  });

  it('is narration by default (flat) and placed only when asked', async () => {
    const s = setup();
    void s.speech.speak({ reference: REF });
    await tick();
    expect(s.voices()[0]?.options.spatial).toBeUndefined();
    void s.speech.speak({ reference: REF, position: { position: [3, 1, 2], maxDistance: 20 } });
    await tick();
    expect(s.voices()[1]?.options.spatial).toMatchObject({ position: [3, 1, 2], maxDistance: 20 });
    expect(s.voices()[1]?.options.channel).toBe('voice');
  });
});

describe('text only', () => {
  it('shows the text and plays nothing when there is no speech source', async () => {
    const s = setup(null);
    await s.speech.speak({ reference: REF, fallbackText: 'Read this.' });
    expect(s.speech.getState()).toMatchObject({
      phase: 'failed',
      caption: 'Read this.',
      textOnly: true,
    });
    expect(s.engine.voices).toHaveLength(0);
  });

  it('keeps the text when the request fails, without throwing', async () => {
    const s = setup();
    s.request.mockRejectedValueOnce(new Error('offline'));
    await expect(
      s.speech.speak({ reference: REF, fallbackText: 'Read this.' }),
    ).resolves.toBeUndefined();
    expect(s.speech.getState()).toMatchObject({
      phase: 'failed',
      caption: 'Read this.',
      textOnly: true,
    });
  });

  it('keeps the text when the browser cannot play it', async () => {
    const s = setup();
    s.engine.failPlay = true;
    await s.speech.speak({ reference: REF, fallbackText: 'Read this.' });
    expect(s.speech.getState()).toMatchObject({ phase: 'failed', textOnly: true });
    expect(s.speech.getState().caption).toBe('Welcome to the castle library.');
  });

  it('keeps the text when playback fails part way', async () => {
    const s = setup();
    const done = s.speech.speak({ reference: REF, fallbackText: 'Read this.' });
    await tick();
    s.live()[0]!.finish('failed');
    await done;
    expect(s.speech.getState()).toMatchObject({ phase: 'failed', textOnly: true });
  });

  it('showText displays a caption with no audio and stops any speech', async () => {
    const s = setup();
    void s.speech.speak({ reference: REF });
    await tick();
    s.speech.showText('Just read me.');
    expect(s.live()).toHaveLength(0);
    expect(s.speech.getState()).toMatchObject({
      caption: 'Just read me.',
      textOnly: true,
      phase: 'idle',
    });
  });
});

describe('controls', () => {
  it('stop ends the voice and the queue but keeps the caption', async () => {
    const s = setup();
    const first = s.speech.speak({ reference: REF });
    const second = s.speech.speak({ reference: { kind: 'line', id: 'b' }, mode: 'queue' });
    await tick();
    s.speech.stop();
    await Promise.all([first, second]);
    expect(s.live()).toHaveLength(0);
    expect(s.speech.getState()).toMatchObject({ phase: 'idle', queued: 0 });
    expect(s.speech.getState().caption).toBeTruthy();
  });

  it('a new utterance interrupts the current one', async () => {
    const s = setup();
    const first = s.speech.speak({ reference: REF });
    await tick();
    const firstVoice = s.live()[0] as FakeVoice;
    const second = s.speech.speak({ reference: { kind: 'line', id: 'b' } });
    await first;
    await tick();
    expect(firstVoice.stopped).toBe(true);
    expect(s.live()).toHaveLength(1);
    s.live()[0]!.finish('finished');
    await second;
  });

  it('queued utterances wait their turn, in order', async () => {
    const s = setup();
    s.request.mockImplementation(async (ref) => clip(`line ${(ref as { id: string }).id}`));
    const a = s.speech.speak({ reference: { kind: 'line', id: 'a' } });
    const b = s.speech.speak({ reference: { kind: 'line', id: 'b' }, mode: 'queue' });
    await tick();
    expect(s.speech.getState()).toMatchObject({ queued: 1, caption: 'line a' });
    s.live()[0]!.finish('finished');
    await a;
    await tick();
    expect(s.speech.getState().caption).toBe('line b');
    s.live()[0]!.finish('finished');
    await b;
  });

  it('skip moves on to the next queued utterance', async () => {
    const s = setup();
    s.request.mockImplementation(async (ref) => clip(`line ${(ref as { id: string }).id}`));
    void s.speech.speak({ reference: { kind: 'line', id: 'a' } });
    void s.speech.speak({ reference: { kind: 'line', id: 'b' }, mode: 'queue' });
    await tick();
    s.speech.skip();
    await tick();
    expect(s.speech.getState().caption).toBe('line b');
  });

  it('pauses and resumes the same voice', async () => {
    const s = setup();
    void s.speech.speak({ reference: REF });
    await tick();
    const voice = s.live()[0] as FakeVoice;
    s.speech.pause();
    expect(voice.paused).toBe(true);
    expect(s.speech.getState().phase).toBe('paused');
    s.speech.resume();
    expect(voice.paused).toBe(false);
    expect(s.speech.getState().phase).toBe('playing');
  });

  it('replays the last utterance by asking again', async () => {
    const s = setup();
    const done = s.speech.speak({ reference: REF });
    await tick();
    s.live()[0]!.finish('finished');
    await done;
    const again = s.speech.replay();
    await tick();
    expect(s.request).toHaveBeenCalledTimes(2);
    expect(s.live()).toHaveLength(1);
    s.live()[0]!.finish('finished');
    await again;
  });
});

describe('cancellation and cleanup', () => {
  it('a response that arrives after stop never starts audio', async () => {
    const s = setup();
    let release!: (value: SpeechClipInfo) => void;
    s.request.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const done = s.speech.speak({ reference: REF });
    await tick();
    s.speech.stop();
    release(clip());
    await done;
    await tick();
    expect(s.engine.voices).toHaveLength(0);
  });

  it('aborts the request it is replacing', async () => {
    const s = setup();
    const signals: AbortSignal[] = [];
    s.request.mockImplementation((_ref, signal) => {
      signals.push(signal);
      return new Promise<SpeechClipInfo>(() => undefined);
    });
    void s.speech.speak({ reference: REF });
    await tick();
    void s.speech.speak({ reference: { kind: 'line', id: 'b' } });
    await tick();
    expect(signals[0]?.aborted).toBe(true);
  });

  it('dispose stops the voice, ignores late answers and resolves everything waiting', async () => {
    const s = setup();
    let release!: (value: SpeechClipInfo) => void;
    s.request.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const a = s.speech.speak({ reference: REF });
    const b = s.speech.speak({ reference: { kind: 'line', id: 'b' }, mode: 'queue' });
    await tick();
    s.speech.dispose();
    release(clip());
    await Promise.all([a, b]);
    await tick();
    expect(s.engine.voices).toHaveLength(0);
    await expect(s.speech.speak({ reference: REF })).resolves.toBeUndefined();
    expect(s.engine.voices).toHaveLength(0);
  });

  it('disposing the scope stops the voice and a later answer cannot restart it', async () => {
    const s = setup();
    const done = s.speech.speak({ reference: REF });
    await tick();
    s.scope.dispose();
    await tick();
    expect(s.live()).toHaveLength(0);
    await done;
    expect(s.speech.getState().phase).not.toBe('playing');
  });

  it('restores the music when the voice is cut off', async () => {
    const s = setup();
    await s.manager.play('music.s.bed');
    void s.speech.speak({ reference: REF });
    await tick();
    s.speech.stop();
    await tick();
    await tick();
    expect(s.engine.channelGains.get('music')).toBe(0.5);
  });
});

describe('subscription', () => {
  it('tells subscribers about each change and survives a throwing subscriber', async () => {
    const s = setup();
    const seen: string[] = [];
    s.speech.subscribe(() => {
      throw new Error('bad subscriber');
    });
    s.speech.subscribe(() => seen.push(s.speech.getState().phase));
    const done = s.speech.speak({ reference: REF });
    await tick();
    s.live()[0]!.finish('finished');
    await done;
    expect(seen).toContain('loading');
    expect(seen).toContain('playing');
    expect(seen.at(-1)).toBe('idle');
  });
});
