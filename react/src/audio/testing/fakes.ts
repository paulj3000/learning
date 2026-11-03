import type {
  AudioEngine,
  EngineState,
  EngineVoice,
  LoadedSound,
  LoadOptions,
  VoiceEndReason,
  VoiceOptions,
} from '../AudioEngine';
import { AudioError, type AudioChannel } from '../AudioTypes';

/** A scriptable engine for manager tests. No browser APIs. */
export class FakeVoice implements EngineVoice {
  paused = false;
  stopped = false;
  stopFadeMs: number | undefined;
  volume: number;
  rate: number;

  readonly options: VoiceOptions;
  private readonly onEnded: (reason: VoiceEndReason) => void;

  constructor(options: VoiceOptions, onEnded: (reason: VoiceEndReason) => void) {
    this.options = options;
    this.onEnded = onEnded;
    this.volume = options.volume;
    this.rate = options.playbackRate;
  }

  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
  }
  stop(fadeOutMs: number): void {
    if (this.stopped) return;
    this.stopped = true;
    this.stopFadeMs = fadeOutMs;
  }
  setVolume(volume: number): void {
    this.volume = volume;
  }
  setPlaybackRate(rate: number): void {
    this.rate = rate;
  }
  /** Simulates the sound reaching its end (or the browser failing it). */
  finish(reason: VoiceEndReason = 'finished'): void {
    this.onEnded(reason);
  }
}

export class FakeEngine implements AudioEngine {
  state: EngineState = 'running';
  voices: FakeVoice[] = [];
  loads: Array<{
    url: string;
    options: LoadOptions;
    resolve: () => void;
    reject: (e: unknown) => void;
  }> = [];
  autoLoad = true;
  failLoad: AudioError | undefined;
  /** Errors handed out one per load, oldest first, before loads start succeeding. */
  failNext: AudioError[] = [];
  loadLog: Array<{ url: string; options: LoadOptions }> = [];
  failPlay = false;
  unlockResult = true;
  unlockCalls = 0;
  disposed = false;
  masterGain = 1;
  channelGains = new Map<AudioChannel, number>();
  /** Every channel gain change with the ramp it asked for, oldest first. */
  gainLog: Array<{ channel: AudioChannel; gain: number; rampMs: number | undefined }> = [];
  private listeners = new Set<() => void>();

  onStateChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setState(state: EngineState): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }

  async unlock(): Promise<boolean> {
    this.unlockCalls += 1;
    if (this.unlockResult) this.setState('running');
    return this.unlockResult;
  }

  load(url: string, options: LoadOptions): Promise<LoadedSound> {
    this.loadLog.push({ url, options });
    const next = this.failNext.shift();
    if (next) return Promise.reject(next);
    if (this.failLoad) return Promise.reject(this.failLoad);
    const loaded: LoadedSound = { kind: options.stream ? 'stream' : 'buffer', url };
    if (this.autoLoad) return Promise.resolve(loaded);
    return new Promise<LoadedSound>((resolve, reject) => {
      const entry = {
        url,
        options,
        resolve: () => resolve(loaded),
        reject,
      };
      options.signal.addEventListener('abort', () =>
        reject(new AudioError('aborted', 'cancelled')),
      );
      this.loads.push(entry);
    });
  }

  play(
    _sound: LoadedSound,
    options: VoiceOptions,
    onEnded: (reason: VoiceEndReason) => void,
  ): EngineVoice {
    if (this.failPlay) throw new AudioError('playback-failed', 'boom');
    const voice = new FakeVoice(options, onEnded);
    this.voices.push(voice);
    return voice;
  }

  setMasterGain(gain: number): void {
    this.masterGain = gain;
  }
  setChannelGain(channel: AudioChannel, gain: number, rampMs?: number): void {
    this.channelGains.set(channel, gain);
    this.gainLog.push({ channel, gain, rampMs });
  }
  getContext(): AudioContext | null {
    return null;
  }
  dispose(): void {
    this.disposed = true;
  }
}

// ---- Web Audio fakes (engine-level tests) -----------------------------------------------

export class FakeParam {
  value: number;
  calls: Array<[string, ...number[]]> = [];
  constructor(value = 1) {
    this.value = value;
  }
  cancelScheduledValues(t: number): void {
    this.calls.push(['cancel', t]);
  }
  setValueAtTime(v: number, t: number): void {
    this.calls.push(['set', v, t]);
    this.value = v;
  }
  linearRampToValueAtTime(v: number, t: number): void {
    this.calls.push(['ramp', v, t]);
    this.value = v;
  }
}

export class FakeNode {
  connected: unknown[] = [];
  disconnected = false;
  connect(target: unknown): unknown {
    this.connected.push(target);
    return target;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

export class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  playbackRate = new FakeParam(1);
  onended: (() => void) | null = null;
  starts: Array<{ when: number; offset: number }> = [];
  stops: number[] = [];
  private readonly ctx: FakeContext;
  constructor(ctx: FakeContext) {
    super();
    this.ctx = ctx;
  }
  start(when = 0, offset = 0): void {
    this.starts.push({ when, offset });
  }
  stop(when?: number): void {
    this.stops.push(when ?? this.ctx.currentTime);
  }
  /** Fires `onended` like the browser does after a stop or a natural end. */
  end(): void {
    this.onended?.();
  }
}

export class FakeContext {
  state: 'suspended' | 'running' | 'closed' | 'interrupted' = 'suspended';
  currentTime = 0;
  destination = new FakeNode();
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  resumeBehaviour: 'resolve' | 'reject' | 'hang' = 'resolve';
  decodeFails = false;
  closeCalls = 0;
  private statechange = new Set<() => void>();

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource(this);
    this.sources.push(source);
    return source;
  }
  createMediaElementSource(): FakeNode {
    return new FakeNode();
  }
  addEventListener(type: string, listener: () => void): void {
    if (type === 'statechange') this.statechange.add(listener);
  }
  setState(state: FakeContext['state']): void {
    this.state = state;
    for (const listener of this.statechange) listener();
  }
  resume(): Promise<void> {
    if (this.resumeBehaviour === 'hang') return new Promise(() => undefined);
    if (this.resumeBehaviour === 'reject') return Promise.reject(new Error('not allowed'));
    this.setState('running');
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closeCalls += 1;
    this.state = 'closed';
    return Promise.resolve();
  }
  decodeAudioData(_data: ArrayBuffer): Promise<unknown> {
    if (this.decodeFails) return Promise.reject(new Error('bad data'));
    return Promise.resolve({ length: 1000, numberOfChannels: 2, duration: 4 });
  }
}

export function okResponse(bytes = 8): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(bytes)),
  } as Response;
}
