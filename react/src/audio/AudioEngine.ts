import { AUDIO_CHANNELS } from './AudioChannels';
import { AudioError, type AudioChannel } from './AudioTypes';

/**
 * The playback engine abstraction. The manager owns policy (ids, scopes,
 * volumes, muting, limits); an engine only turns "play this loaded sound
 * with these gains" into audible output. Tests drive the manager with a
 * fake engine; production uses `createWebAudioEngine`.
 */

/** `unavailable`: no Web Audio at all. `suspended`: exists, waiting for a gesture. */
export type EngineState = 'unavailable' | 'suspended' | 'running' | 'closed';

/** Opaque to the manager: whatever the engine needs to start a voice. */
export interface LoadedSound {
  readonly kind: 'buffer' | 'stream';
  readonly url: string;
}

export interface LoadOptions {
  stream: boolean;
  signal: AbortSignal;
  /**
   * A stable key for this audio (a published asset version), so the same sound is cached once
   * even though its signed url changes every half hour. Defaults to the url.
   */
  cacheKey?: string;
}

export interface VoiceOptions {
  channel: AudioChannel;
  loop: boolean;
  volume: number;
  playbackRate: number;
  fadeInMs: number;
}

export type VoiceEndReason = 'finished' | 'failed';

export interface EngineVoice {
  pause(): void;
  resume(): void;
  /** Fades out over `fadeOutMs` then releases every node. Idempotent. */
  stop(fadeOutMs: number): void;
  setVolume(volume: number, fadeMs: number): void;
  setPlaybackRate(rate: number): void;
}

export interface AudioEngine {
  readonly state: EngineState;
  onStateChange(listener: () => void): () => void;
  /** Tries to resume the context. Resolves to whether it is running. Never rejects. */
  unlock(): Promise<boolean>;
  /** Rejects with an `AudioError` ('aborted' when `signal` fires first). */
  load(url: string, options: LoadOptions): Promise<LoadedSound>;
  /** Starts a voice. `onEnded` fires at most once, only for a natural end or a failure. */
  play(
    sound: LoadedSound,
    options: VoiceOptions,
    onEnded: (reason: VoiceEndReason) => void,
  ): EngineVoice;
  setMasterGain(gain: number): void;
  /** `rampMs` overrides the short default smoothing (used for ducking attack and release). */
  setChannelGain(channel: AudioChannel, gain: number, rampMs?: number): void;
  /** The shared context, for a future Three.js `AudioListener`. `null` until created or when unavailable. */
  getContext(): AudioContext | null;
  dispose(): void;
}

export interface WebAudioEngineOptions {
  /** Defaults to `AudioContext` (or `webkitAudioContext`) from the global scope. */
  createContext?: () => AudioContext;
  fetchImpl?: typeof fetch;
  /** Defaults to `new Audio()`. Used for `stream` sounds. */
  createElement?: () => HTMLAudioElement;
  /** Upper bound for decoded audio kept in memory. Default 32 MiB. */
  maxCacheBytes?: number;
  /** How long `unlock` waits for `resume()` before reporting the current state. Default 1000. */
  unlockTimeoutMs?: number;
}

const DEFAULT_CACHE_BYTES = 32 * 1024 * 1024;
const GAIN_SMOOTHING_S = 0.015;

interface CacheEntry {
  buffer: AudioBuffer;
  bytes: number;
}

interface Inflight {
  promise: Promise<AudioBuffer>;
  controller: AbortController;
  waiters: number;
}

function defaultContextFactory(): (() => AudioContext) | undefined {
  const scope = globalThis as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  return Ctor ? () => new Ctor() : undefined;
}

function abortError(): AudioError {
  return new AudioError('aborted', 'load cancelled');
}

/** Ramps a param to `target`, replacing any ramp already in flight (this is what makes fades cancellable). */
function rampTo(
  param: AudioParam,
  context: BaseAudioContext,
  target: number,
  durationMs: number,
): void {
  const now = context.currentTime;
  const current = param.value;
  param.cancelScheduledValues(now);
  param.setValueAtTime(current, now);
  if (durationMs > 0) param.linearRampToValueAtTime(target, now + durationMs / 1000);
  else param.setValueAtTime(target, now);
}

export function createWebAudioEngine(options: WebAudioEngineOptions = {}): AudioEngine {
  const contextFactory = options.createContext ?? defaultContextFactory();
  const fetchImpl =
    options.fetchImpl ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
  const createElement =
    options.createElement ?? (typeof Audio === 'function' ? () => new Audio() : undefined);
  const maxCacheBytes = options.maxCacheBytes ?? DEFAULT_CACHE_BYTES;
  const unlockTimeoutMs = options.unlockTimeoutMs ?? 1000;

  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  const channelNodes = new Map<AudioChannel, GainNode>();
  let initFailed = !contextFactory;
  let closed = false;

  // Gains requested before the graph exists are applied when it is built.
  let masterGain = 1;
  const channelGains = new Map<AudioChannel, number>();

  const listeners = new Set<() => void>();
  const cache = new Map<string, CacheEntry>();
  let cacheBytes = 0;
  const inflight = new Map<string, Inflight>();
  const liveVoices = new Set<EngineVoice>();
  // The decoded buffer behind each loaded sound, so eviction from the cache cannot orphan a pending play.
  const loadedBuffers = new WeakMap<LoadedSound, AudioBuffer>();

  function notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A listener must never break audio.
      }
    }
  }

  /** Builds the context and mixer graph once. Failure is remembered, never retried in a loop. */
  function ensureContext(): AudioContext | null {
    if (context || initFailed || closed || !contextFactory) return context;
    try {
      const created = contextFactory();
      const masterNode = created.createGain();
      masterNode.gain.value = masterGain;
      masterNode.connect(created.destination);
      for (const channel of AUDIO_CHANNELS) {
        const node = created.createGain();
        node.gain.value = channelGains.get(channel.id) ?? channel.defaultVolume;
        node.connect(masterNode);
        channelNodes.set(channel.id, node);
      }
      context = created;
      master = masterNode;
      created.addEventListener?.('statechange', notify);
    } catch {
      initFailed = true;
      context = null;
    }
    return context;
  }

  function currentState(): EngineState {
    if (closed) return 'closed';
    if (initFailed) return 'unavailable';
    if (!context) return 'suspended';
    if (context.state === 'running') return 'running';
    if (context.state === 'closed') return 'closed';
    return 'suspended'; // 'suspended' and Safari's 'interrupted'
  }

  function evictIfNeeded(keep: string): void {
    for (const [url, entry] of cache) {
      if (cacheBytes <= maxCacheBytes) return;
      if (url === keep) continue;
      cache.delete(url);
      cacheBytes -= entry.bytes;
    }
  }

  function decode(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
    return new Promise<AudioBuffer>((resolve, reject) => {
      try {
        // Older Safari only supports the callback form; modern browsers return a promise too.
        const result = ctx.decodeAudioData(data, resolve, reject) as
          Promise<AudioBuffer> | undefined;
        result?.then?.(resolve, reject);
      } catch (cause) {
        reject(cause);
      }
    });
  }

  async function fetchAndDecode(url: string, signal: AbortSignal): Promise<AudioBuffer> {
    const ctx = ensureContext();
    if (!ctx) throw new AudioError('engine-unavailable', 'Web Audio is not available');
    if (!fetchImpl) throw new AudioError('load-failed', 'fetch is not available');
    let response: Response;
    try {
      response = await fetchImpl(url, { signal });
    } catch (cause) {
      if (signal.aborted) throw abortError();
      throw new AudioError('load-failed', `could not fetch ${url}`, { cause });
    }
    if (!response.ok) {
      throw new AudioError('load-failed', `HTTP ${response.status} for ${url}`, {
        status: response.status,
      });
    }
    let data: ArrayBuffer;
    try {
      data = await response.arrayBuffer();
    } catch (cause) {
      if (signal.aborted) throw abortError();
      throw new AudioError('load-failed', `could not read ${url}`, { cause });
    }
    if (signal.aborted) throw abortError();
    try {
      return await decode(ctx, data);
    } catch (cause) {
      throw new AudioError('decode-failed', `could not decode ${url}`, { cause });
    }
  }

  /** Shares one fetch between callers; the fetch is aborted only when every caller has given up. */
  function loadBuffer(url: string, key: string, signal: AbortSignal): Promise<AudioBuffer> {
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key); // re-insert so the map order is least-recently-used first
      cache.set(key, cached);
      return Promise.resolve(cached.buffer);
    }

    let shared = inflight.get(key);
    if (!shared) {
      const controller = new AbortController();
      const created: Inflight = {
        controller,
        waiters: 0,
        promise: fetchAndDecode(url, controller.signal).then(
          (buffer) => {
            inflight.delete(key);
            const bytes = buffer.length * buffer.numberOfChannels * 4;
            if (!closed) {
              cache.set(key, { buffer, bytes });
              cacheBytes += bytes;
              evictIfNeeded(key);
            }
            return buffer;
          },
          (error: unknown) => {
            inflight.delete(key);
            throw error;
          },
        ),
      };
      // A fetch nobody is waiting for any more must not become an unhandled rejection.
      created.promise.catch(() => undefined);
      inflight.set(key, created);
      shared = created;
    }

    const entry = shared;
    entry.waiters += 1;
    return new Promise<AudioBuffer>((resolve, reject) => {
      let done = false; // each waiter leaves exactly once, by result or by abort
      const onAbort = (): void => {
        if (done) return;
        done = true;
        entry.waiters -= 1;
        if (entry.waiters === 0 && inflight.get(key) === entry) {
          inflight.delete(key);
          entry.controller.abort();
        }
        reject(abortError());
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      entry.promise.then(
        (buffer) => {
          if (done) return;
          done = true;
          signal.removeEventListener('abort', onAbort);
          entry.waiters -= 1;
          resolve(buffer);
        },
        (error: unknown) => {
          if (done) return;
          done = true;
          signal.removeEventListener('abort', onAbort);
          entry.waiters -= 1;
          reject(error);
        },
      );
    });
  }

  function bufferVoice(
    ctx: AudioContext,
    buffer: AudioBuffer,
    voiceOptions: VoiceOptions,
    channelNode: GainNode,
    onEnded: (reason: VoiceEndReason) => void,
  ): EngineVoice {
    const gain = ctx.createGain();
    gain.connect(channelNode);
    let rate = voiceOptions.playbackRate;
    let source: AudioBufferSourceNode | null = null;
    let offset = 0; // seconds into the buffer when `startedAt` was recorded
    let startedAt = 0; // context time
    let paused = false;
    let released = false;

    const position = (): number => {
      const elapsed = (ctx.currentTime - startedAt) * rate + offset;
      if (buffer.duration <= 0) return 0;
      return voiceOptions.loop ? elapsed % buffer.duration : Math.min(elapsed, buffer.duration);
    };

    const release = (): void => {
      if (released) return;
      released = true;
      liveVoices.delete(voice);
      if (source) {
        source.onended = null;
        try {
          source.stop();
        } catch {
          // Already stopped.
        }
        source.disconnect();
        source = null;
      }
      gain.disconnect();
    };

    const begin = (fromOffset: number): void => {
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.loop = voiceOptions.loop;
      node.playbackRate.value = rate;
      node.connect(gain);
      node.onended = () => {
        if (released || source !== node) return;
        release();
        onEnded('finished');
      };
      offset = fromOffset;
      startedAt = ctx.currentTime;
      source = node;
      node.start(0, fromOffset);
    };

    const voice: EngineVoice = {
      pause() {
        if (released || paused || !source) return;
        offset = position();
        const node = source;
        source = null;
        paused = true;
        node.onended = null;
        try {
          node.stop();
        } catch {
          // Already stopped.
        }
        node.disconnect();
      },
      resume() {
        if (released || !paused) return;
        paused = false;
        if (!voiceOptions.loop && offset >= buffer.duration) {
          release();
          onEnded('finished');
          return;
        }
        begin(offset);
      },
      stop(fadeOutMs) {
        if (released) return;
        if (fadeOutMs > 0 && source && !paused) {
          const node = source;
          rampTo(gain.gain, ctx, 0, fadeOutMs);
          node.onended = () => release();
          node.stop(ctx.currentTime + fadeOutMs / 1000);
        } else {
          release();
        }
      },
      setVolume(volume, fadeMs) {
        if (released) return;
        rampTo(gain.gain, ctx, volume, fadeMs);
      },
      setPlaybackRate(next) {
        if (released) return;
        if (source && !paused) {
          offset = position();
          startedAt = ctx.currentTime;
          source.playbackRate.value = next;
        }
        rate = next;
      },
    };

    liveVoices.add(voice);
    if (voiceOptions.fadeInMs > 0) {
      gain.gain.setValueAtTime(0, ctx.currentTime);
      rampTo(gain.gain, ctx, voiceOptions.volume, voiceOptions.fadeInMs);
    } else {
      gain.gain.value = voiceOptions.volume;
    }
    begin(0);
    return voice;
  }

  function streamVoice(
    ctx: AudioContext,
    url: string,
    voiceOptions: VoiceOptions,
    channelNode: GainNode,
    onEnded: (reason: VoiceEndReason) => void,
  ): EngineVoice {
    if (!createElement) throw new AudioError('unsupported', 'HTMLAudioElement is not available');
    const element = createElement();
    element.crossOrigin = 'anonymous';
    element.preload = 'auto';
    element.loop = voiceOptions.loop;
    element.playbackRate = voiceOptions.playbackRate;
    element.src = url;

    const gain = ctx.createGain();
    const mediaSource = ctx.createMediaElementSource(element);
    mediaSource.connect(gain);
    gain.connect(channelNode);

    let released = false;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;

    const release = (): void => {
      if (released) return;
      released = true;
      liveVoices.delete(voice);
      if (stopTimer !== undefined) clearTimeout(stopTimer);
      element.onended = null;
      element.onerror = null;
      element.pause();
      element.removeAttribute('src');
      element.load?.();
      mediaSource.disconnect();
      gain.disconnect();
    };

    element.onended = () => {
      if (released) return;
      release();
      onEnded('finished');
    };
    element.onerror = () => {
      if (released) return;
      release();
      onEnded('failed');
    };

    const voice: EngineVoice = {
      pause() {
        if (!released) element.pause();
      },
      resume() {
        if (!released) void element.play().catch(() => undefined);
      },
      stop(fadeOutMs) {
        if (released) return;
        if (fadeOutMs > 0) {
          rampTo(gain.gain, ctx, 0, fadeOutMs);
          if (stopTimer !== undefined) clearTimeout(stopTimer);
          stopTimer = setTimeout(release, fadeOutMs);
        } else {
          release();
        }
      },
      setVolume(volume, fadeMs) {
        if (!released) rampTo(gain.gain, ctx, volume, fadeMs);
      },
      setPlaybackRate(next) {
        if (!released) element.playbackRate = next;
      },
    };

    liveVoices.add(voice);
    if (voiceOptions.fadeInMs > 0) {
      gain.gain.setValueAtTime(0, ctx.currentTime);
      rampTo(gain.gain, ctx, voiceOptions.volume, voiceOptions.fadeInMs);
    } else {
      gain.gain.value = voiceOptions.volume;
    }
    void element.play().catch(() => {
      if (released) return;
      release();
      onEnded('failed');
    });
    return voice;
  }

  const engine: AudioEngine = {
    get state() {
      return currentState();
    },

    onStateChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async unlock() {
      const ctx = ensureContext();
      if (!ctx || closed) return false;
      if (ctx.state === 'running') return true;
      try {
        await Promise.race([
          ctx.resume(),
          new Promise<void>((resolve) => setTimeout(resolve, unlockTimeoutMs)),
        ]);
      } catch {
        // Autoplay policy still blocking; report the state below.
      }
      notify();
      return currentState() === 'running';
    },

    async load(url, loadOptions) {
      if (closed) throw new AudioError('disposed', 'engine disposed');
      if (loadOptions.signal.aborted) throw abortError();
      if (!ensureContext()) {
        throw new AudioError('engine-unavailable', 'Web Audio is not available');
      }
      if (loadOptions.stream) return { kind: 'stream', url };
      const buffer = await loadBuffer(url, loadOptions.cacheKey ?? url, loadOptions.signal);
      const loaded: LoadedSound = { kind: 'buffer', url };
      loadedBuffers.set(loaded, buffer);
      return loaded;
    },

    play(sound, voiceOptions, onEnded) {
      const ctx = ensureContext();
      const channelNode = channelNodes.get(voiceOptions.channel);
      if (!ctx || !channelNode || closed) {
        throw new AudioError('engine-unavailable', 'Web Audio is not available');
      }
      if (sound.kind === 'stream') {
        return streamVoice(ctx, sound.url, voiceOptions, channelNode, onEnded);
      }
      const buffer = loadedBuffers.get(sound);
      if (!buffer) throw new AudioError('playback-failed', 'sound was not loaded by this engine');
      return bufferVoice(ctx, buffer, voiceOptions, channelNode, onEnded);
    },

    setMasterGain(gain) {
      masterGain = gain;
      if (master && context) rampTo(master.gain, context, gain, GAIN_SMOOTHING_S * 1000);
    },

    setChannelGain(channel, gain, rampMs) {
      channelGains.set(channel, gain);
      const node = channelNodes.get(channel);
      if (node && context) {
        rampTo(node.gain, context, gain, rampMs ?? GAIN_SMOOTHING_S * 1000);
      }
    },

    getContext() {
      return context;
    },

    dispose() {
      if (closed) return;
      for (const voice of [...liveVoices]) voice.stop(0);
      liveVoices.clear();
      for (const shared of inflight.values()) shared.controller.abort();
      inflight.clear();
      cache.clear();
      cacheBytes = 0;
      closed = true;
      const ctx = context;
      context = null;
      master = null;
      channelNodes.clear();
      listeners.clear();
      if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
    },
  };

  return engine;
}
