import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWebAudioEngine, type AudioEngine, type LoadedSound } from './AudioEngine';
import { AudioError } from './AudioTypes';
import { FakeContext, okResponse, type FakeSource } from './testing/fakes';

function setup(
  options: { fetchImpl?: typeof fetch; maxCacheBytes?: number; contextFails?: boolean } = {},
) {
  const contexts: FakeContext[] = [];
  const fetchImpl = vi.fn(options.fetchImpl ?? (async () => okResponse()));
  const engine = createWebAudioEngine({
    createContext: () => {
      if (options.contextFails) throw new Error('no audio hardware');
      const context = new FakeContext();
      contexts.push(context);
      return context as unknown as AudioContext;
    },
    fetchImpl: fetchImpl as unknown as typeof fetch,
    maxCacheBytes: options.maxCacheBytes,
    unlockTimeoutMs: 20,
  });
  return { engine, contexts, fetchImpl };
}

const signal = () => new AbortController().signal;

async function loadAndPlay(
  engine: AudioEngine,
  overrides: Partial<Parameters<AudioEngine['play']>[1]> = {},
  url = 'test://a',
) {
  const loaded: LoadedSound = await engine.load(url, { stream: false, signal: signal() });
  const ended = vi.fn();
  const voice = engine.play(
    loaded,
    { channel: 'sfx', loop: false, volume: 1, playbackRate: 1, fadeInMs: 0, ...overrides },
    ended,
  );
  return { voice, ended };
}

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.useRealTimers());

describe('availability', () => {
  it('is unavailable when there is no AudioContext at all', async () => {
    const engine = createWebAudioEngine({ createContext: undefined, fetchImpl: vi.fn() });
    // jsdom has no AudioContext, so the default factory is absent.
    expect(engine.state).toBe('unavailable');
    await expect(engine.load('x', { stream: false, signal: signal() })).rejects.toMatchObject({
      code: 'engine-unavailable',
    });
    await expect(engine.unlock()).resolves.toBe(false);
  });

  it('becomes unavailable, once, when the context constructor throws', async () => {
    const create = vi.fn(() => {
      throw new Error('blocked');
    });
    const engine = createWebAudioEngine({ createContext: create, fetchImpl: vi.fn() });
    await expect(engine.unlock()).resolves.toBe(false);
    await expect(engine.unlock()).resolves.toBe(false);
    expect(engine.state).toBe('unavailable');
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('context lifecycle', () => {
  it('creates the context lazily and exactly once', async () => {
    const { engine, contexts } = setup();
    expect(contexts).toHaveLength(0);
    expect(engine.state).toBe('suspended');
    await engine.unlock();
    await engine.unlock();
    await engine.load('test://a', { stream: false, signal: signal() });
    expect(contexts).toHaveLength(1);
    expect(engine.getContext()).toBe(contexts[0]);
  });

  it('resumes a suspended context and reports running', async () => {
    const { engine, contexts } = setup();
    const changes = vi.fn();
    engine.onStateChange(changes);
    await expect(engine.unlock()).resolves.toBe(true);
    expect(contexts[0]?.state).toBe('running');
    expect(engine.state).toBe('running');
    expect(changes).toHaveBeenCalled();
  });

  it('survives a resume that rejects (autoplay policy)', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    contexts[0]!.setState('suspended');
    contexts[0]!.resumeBehaviour = 'reject';
    await expect(engine.unlock()).resolves.toBe(false);
    expect(engine.state).toBe('suspended');
  });

  it('does not hang when resume never settles', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    contexts[0]!.setState('suspended');
    contexts[0]!.resumeBehaviour = 'hang';
    await expect(engine.unlock()).resolves.toBe(false);
  });

  it('treats an interrupted context as locked and recovers on resume', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    contexts[0]!.setState('interrupted');
    expect(engine.state).toBe('suspended');
    await expect(engine.unlock()).resolves.toBe(true);
  });

  it('closes the context on dispose and refuses further loads', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    engine.dispose();
    engine.dispose();
    expect(contexts[0]?.closeCalls).toBe(1);
    expect(engine.state).toBe('closed');
    await expect(engine.load('x', { stream: false, signal: signal() })).rejects.toMatchObject({
      code: 'disposed',
    });
  });
});

describe('mixer graph', () => {
  it('applies gains requested before the graph existed', async () => {
    const { engine, contexts } = setup();
    engine.setMasterGain(0.25);
    engine.setChannelGain('music', 0.1);
    await engine.unlock();
    const gains = contexts[0]!.gains; // master first, then the five channels in order
    expect(gains[0]!.gain.value).toBe(0.25);
    expect(gains[1]!.gain.value).toBe(0.1);
  });

  it('smooths later gain changes instead of jumping', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    engine.setMasterGain(0);
    const calls = contexts[0]!.gains[0]!.gain.calls.map((call) => call[0]);
    expect(calls).toContain('ramp');
  });
});

describe('loading', () => {
  it('fetches and decodes once, caching by url', async () => {
    const { engine, fetchImpl } = setup();
    await engine.load('test://a', { stream: false, signal: signal() });
    await engine.load('test://a', { stream: false, signal: signal() });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('shares one fetch between concurrent callers', async () => {
    const { engine, fetchImpl } = setup();
    await Promise.all([
      engine.load('test://a', { stream: false, signal: signal() }),
      engine.load('test://a', { stream: false, signal: signal() }),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('bounds the cache by evicting the least recently used buffer', async () => {
    // Each fake buffer is 1000 frames x 2 channels x 4 bytes = 8000 bytes.
    const { engine, fetchImpl } = setup({ maxCacheBytes: 9000 });
    await engine.load('test://a', { stream: false, signal: signal() });
    await engine.load('test://b', { stream: false, signal: signal() });
    await engine.load('test://a', { stream: false, signal: signal() }); // a was evicted: fetched again
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('maps HTTP failures to load-failed', async () => {
    const { engine } = setup({ fetchImpl: async () => ({ ok: false, status: 404 }) as Response });
    await expect(
      engine.load('test://a', { stream: false, signal: signal() }),
    ).rejects.toMatchObject({
      code: 'load-failed',
    });
  });

  it('maps network failures to load-failed', async () => {
    const { engine } = setup({
      fetchImpl: async () => {
        throw new TypeError('offline');
      },
    });
    await expect(
      engine.load('test://a', { stream: false, signal: signal() }),
    ).rejects.toMatchObject({
      code: 'load-failed',
    });
  });

  it('maps decode failures to decode-failed and does not cache them', async () => {
    const { engine, contexts, fetchImpl } = setup();
    await engine.unlock();
    contexts[0]!.decodeFails = true;
    await expect(
      engine.load('test://a', { stream: false, signal: signal() }),
    ).rejects.toMatchObject({
      code: 'decode-failed',
    });
    contexts[0]!.decodeFails = false;
    await engine.load('test://a', { stream: false, signal: signal() });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects with aborted when the signal fires first, and aborts an orphaned fetch', async () => {
    let fetchSignal: AbortSignal | undefined;
    const { engine } = setup({
      fetchImpl: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          fetchSignal = init?.signal ?? undefined;
          fetchSignal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    });
    const controller = new AbortController();
    const pending = engine.load('test://a', { stream: false, signal: controller.signal });
    await vi.waitFor(() => expect(fetchSignal).toBeDefined());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
    expect(fetchSignal?.aborted).toBe(true);
  });

  it('keeps a shared fetch alive while another caller still waits', async () => {
    let release: (() => void) | undefined;
    let fetchSignal: AbortSignal | undefined;
    const { engine } = setup({
      fetchImpl: (_url, init) => {
        fetchSignal = init?.signal ?? undefined;
        return new Promise<Response>((resolve) => {
          release = () => resolve(okResponse());
        });
      },
    });
    const first = new AbortController();
    const a = engine.load('test://a', { stream: false, signal: first.signal });
    const b = engine.load('test://a', { stream: false, signal: signal() });
    await vi.waitFor(() => expect(release).toBeDefined());
    first.abort();
    await expect(a).rejects.toBeInstanceOf(AudioError);
    expect(fetchSignal?.aborted).toBe(false);
    release?.();
    await expect(b).resolves.toMatchObject({ kind: 'buffer' });
  });

  it('rejects immediately for an already-aborted signal', async () => {
    const { engine, fetchImpl } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(
      engine.load('test://a', { stream: false, signal: controller.signal }),
    ).rejects.toMatchObject({
      code: 'aborted',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not fetch stream sounds', async () => {
    const { engine, fetchImpl } = setup();
    await expect(
      engine.load('test://s', { stream: true, signal: signal() }),
    ).resolves.toMatchObject({
      kind: 'stream',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('cache keys and http errors', () => {
  it('caches one decoded buffer for a sound whose signed url changed', async () => {
    const { engine, fetchImpl } = setup();
    await engine.load('signed://one', { stream: false, signal: signal(), cacheKey: 'coin@v1' });
    await engine.load('signed://two', { stream: false, signal: signal(), cacheKey: 'coin@v1' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await engine.load('signed://three', { stream: false, signal: signal(), cacheKey: 'coin@v2' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reports the http status so an expired url can be told from a broken file', async () => {
    const { engine } = setup({ fetchImpl: async () => ({ ok: false, status: 404 }) as Response });
    await expect(
      engine.load('test://a', { stream: false, signal: signal() }),
    ).rejects.toMatchObject({ code: 'load-failed', status: 404 });
  });
});

describe('buffer voices', () => {
  it('plays one source per voice so the same sound can overlap', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    await loadAndPlay(engine);
    await loadAndPlay(engine);
    expect(contexts[0]!.sources).toHaveLength(2);
    expect(contexts[0]!.sources.every((s) => s.starts.length === 1)).toBe(true);
  });

  it('loops and applies rate and starting volume', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    await loadAndPlay(engine, { loop: true, playbackRate: 1.5, volume: 0.4 });
    const source = contexts[0]!.sources[0]!;
    expect(source.loop).toBe(true);
    expect(source.playbackRate.value).toBe(1.5);
    const voiceGain = contexts[0]!.gains.at(-1)!;
    expect(voiceGain.gain.value).toBe(0.4);
  });

  it('reports a natural end once and releases nodes', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    const { ended } = await loadAndPlay(engine);
    contexts[0]!.sources[0]!.end();
    contexts[0]!.sources[0]!.end();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(ended).toHaveBeenCalledWith('finished');
    expect(contexts[0]!.gains.at(-1)!.disconnected).toBe(true);
  });

  it('stops immediately without reporting a natural end', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    const { voice, ended } = await loadAndPlay(engine);
    voice.stop(0);
    voice.stop(0);
    contexts[0]!.sources[0]!.end();
    expect(ended).not.toHaveBeenCalled();
    expect(contexts[0]!.sources[0]!.stops).toHaveLength(1);
  });

  it('fades in from silence', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    await loadAndPlay(engine, { fadeInMs: 500, volume: 0.8 });
    const calls = contexts[0]!.gains.at(-1)!.gain.calls;
    expect(calls[0]).toEqual(['set', 0, 0]);
    expect(calls).toContainEqual(['ramp', 0.8, 0.5]);
  });

  it('fades out then stops the source at the end of the fade', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    contexts[0]!.currentTime = 10;
    const { voice } = await loadAndPlay(engine);
    voice.stop(400);
    const source = contexts[0]!.sources[0]!;
    expect(contexts[0]!.gains.at(-1)!.gain.calls).toContainEqual(['ramp', 0, 10.4]);
    expect(source.stops).toEqual([10.4]);
    source.end();
    expect(contexts[0]!.gains.at(-1)!.disconnected).toBe(true);
  });

  it('cancels an in-flight fade when volume is set again', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    const { voice } = await loadAndPlay(engine, { fadeInMs: 1000, volume: 1 });
    voice.setVolume(0.2, 0);
    const calls = contexts[0]!.gains.at(-1)!.gain.calls.map((c) => c[0]);
    expect(calls.lastIndexOf('cancel')).toBeGreaterThan(calls.indexOf('ramp'));
    expect(contexts[0]!.gains.at(-1)!.gain.value).toBe(0.2);
  });

  it('pauses by stopping the source and resumes from the elapsed position', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    const { voice } = await loadAndPlay(engine); // buffer duration 4s
    contexts[0]!.currentTime = 1.5;
    voice.pause();
    contexts[0]!.currentTime = 99;
    voice.resume();
    const sources: FakeSource[] = contexts[0]!.sources;
    expect(sources).toHaveLength(2);
    expect(sources[0]!.stops).toHaveLength(1);
    expect(sources[1]!.starts[0]!.offset).toBeCloseTo(1.5);
  });

  it('wraps the resume position for looping sounds', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    const { voice } = await loadAndPlay(engine, { loop: true });
    contexts[0]!.currentTime = 9; // 9s into a 4s loop = 1s
    voice.pause();
    voice.resume();
    expect(contexts[0]!.sources[1]!.starts[0]!.offset).toBeCloseTo(1);
  });

  it('finishes instead of restarting when resumed past the end', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    const { voice, ended } = await loadAndPlay(engine);
    contexts[0]!.currentTime = 50;
    voice.pause();
    voice.resume();
    expect(ended).toHaveBeenCalledWith('finished');
    expect(contexts[0]!.sources).toHaveLength(1);
  });

  it('ignores controls after release', async () => {
    const { engine } = setup();
    await engine.unlock();
    const { voice } = await loadAndPlay(engine);
    voice.stop(0);
    expect(() => {
      voice.pause();
      voice.resume();
      voice.setVolume(0.1, 100);
      voice.setPlaybackRate(2);
    }).not.toThrow();
  });

  it('stops every live voice when the engine is disposed', async () => {
    const { engine, contexts } = setup();
    await engine.unlock();
    const { ended } = await loadAndPlay(engine);
    engine.dispose();
    expect(contexts[0]!.sources[0]!.stops).toHaveLength(1);
    expect(ended).not.toHaveBeenCalled();
  });

  it('throws an AudioError when asked to play without a context', () => {
    const { engine } = setup({ contextFails: true });
    expect(() =>
      engine.play(
        { kind: 'buffer', url: 'x' },
        { channel: 'sfx', loop: false, volume: 1, playbackRate: 1, fadeInMs: 0 },
        vi.fn(),
      ),
    ).toThrow(AudioError);
  });
});

describe('stream voices', () => {
  function streamSetup() {
    const elements: Array<Record<string, unknown> & { play: ReturnType<typeof vi.fn> }> = [];
    const contexts: FakeContext[] = [];
    const engine = createWebAudioEngine({
      createContext: () => {
        const context = new FakeContext();
        contexts.push(context);
        return context as unknown as AudioContext;
      },
      createElement: () => {
        const element = {
          play: vi.fn(() => Promise.resolve()),
          pause: vi.fn(),
          load: vi.fn(),
          removeAttribute: vi.fn(),
        } as Record<string, unknown> & { play: ReturnType<typeof vi.fn> };
        elements.push(element);
        return element as unknown as HTMLAudioElement;
      },
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    return { engine, elements, contexts };
  }

  const options = {
    channel: 'music',
    loop: true,
    volume: 0.5,
    playbackRate: 1,
    fadeInMs: 0,
  } as const;

  it('streams through an audio element with loop and rate, without fetching', async () => {
    const { engine, elements } = streamSetup();
    const loaded = await engine.load('test://song', { stream: true, signal: signal() });
    engine.play(loaded, options, vi.fn());
    expect(elements[0]).toMatchObject({ src: 'test://song', loop: true, playbackRate: 1 });
    expect(elements[0]!.play).toHaveBeenCalled();
  });

  it('reports failure when the element errors', async () => {
    const { engine, elements } = streamSetup();
    const loaded = await engine.load('test://song', { stream: true, signal: signal() });
    const ended = vi.fn();
    engine.play(loaded, options, ended);
    (elements[0]!.onerror as () => void)();
    expect(ended).toHaveBeenCalledWith('failed');
  });

  it('reports failure when the browser refuses to start the element', async () => {
    const engine = createWebAudioEngine({
      createContext: () => new FakeContext() as unknown as AudioContext,
      createElement: () =>
        ({
          play: vi.fn(() => Promise.reject(new Error('NotAllowedError'))),
          pause: vi.fn(),
          load: vi.fn(),
          removeAttribute: vi.fn(),
        }) as unknown as HTMLAudioElement,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    const loaded = await engine.load('test://song', { stream: true, signal: signal() });
    const ended = vi.fn();
    engine.play(loaded, options, ended);
    await vi.waitFor(() => expect(ended).toHaveBeenCalledWith('failed'));
  });

  it('pauses, resumes and releases the element on stop', async () => {
    const { engine, elements } = streamSetup();
    const loaded = await engine.load('test://song', { stream: true, signal: signal() });
    const voice = engine.play(loaded, options, vi.fn());
    voice.pause();
    expect(elements[0]!.pause).toHaveBeenCalledTimes(1);
    voice.resume();
    expect(elements[0]!.play).toHaveBeenCalledTimes(2);
    voice.stop(0);
    expect(elements[0]!.removeAttribute).toHaveBeenCalledWith('src');
  });

  it('fades out on a timer before releasing', async () => {
    vi.useFakeTimers();
    const { engine, elements } = streamSetup();
    const loaded = await engine.load('test://song', { stream: true, signal: signal() });
    const voice = engine.play(loaded, options, vi.fn());
    voice.stop(300);
    expect(elements[0]!.removeAttribute).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(elements[0]!.removeAttribute).toHaveBeenCalledWith('src');
  });
});
