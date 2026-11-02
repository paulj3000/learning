/**
 * Shared contracts for the Sound Manager (docs/audio/SOUND_MANAGER_ARCHITECTURE.md).
 *
 * This file is pure types plus one error class. It imports nothing, so any
 * game, React component or future Three.js scene can depend on it without
 * pulling in the engine.
 *
 * Vocabulary:
 * - a **sound id** names a `SoundDefinition` (what a sound is);
 * - an **instance id** names one `SoundHandle` (one playback of it);
 * - a **scope** owns the instances and pending loads a game started, so it
 *   can stop its own audio without touching anyone else's.
 */

export type AudioChannel = 'music' | 'ambient' | 'sfx' | 'voice' | 'ui';

export interface SoundDefinition {
  /** Stable, dotted id such as `ui.button.click`. The only thing games ever name. */
  id: string;
  /** Asset-manager id, resolved to a published url through a `SoundAssetResolver`. */
  assetId?: string;
  /** A literal url (tests, bundled files). Used when there is no `assetId`, or as the fallback for one. */
  url?: string;
  channel: AudioChannel;
  loop?: boolean;
  /** Linear gain 0..1 applied to this sound before the channel and master gains. Default 1. */
  defaultVolume?: number;
  /** Higher survives voice-limit stealing. Defaults to the channel's priority. */
  priority?: number;
  /** Long-form audio (music, narration): played through an HTMLAudioElement instead of a decoded buffer. */
  stream?: boolean;
  /** At most this many copies at once; a further play resolves `null`. Default: no limit. */
  maxConcurrent?: number;
  /** Ignore a play that starts less than this many ms after the previous start of this sound. */
  cooldownMs?: number;
  /** Used when `PlayOptions.fadeInMs` is absent. */
  fadeInMs?: number;
  /** Used when `stop` is called without `fadeOutMs`. */
  fadeOutMs?: number;
}

export interface PlayOptions {
  volume?: number;
  loop?: boolean;
  playbackRate?: number;
  fadeInMs?: number;
}

export interface StopOptions {
  fadeOutMs?: number;
}

export type PlaybackState = 'playing' | 'paused' | 'ended';

/** Why an instance ended. `failed` means the browser stopped it (decode or element error). */
export type EndReason = 'finished' | 'stopped' | 'failed' | 'disposed';

/** One playback instance. Every method is safe to call after the instance has ended. */
export interface SoundHandle {
  readonly instanceId: string;
  readonly soundId: string;
  readonly channel: AudioChannel;
  readonly state: PlaybackState;
  stop(options?: StopOptions): void;
  pause(): void;
  resume(): void;
  /** Sets this instance's own gain (0..1). Does not touch the channel or master volume. */
  setVolume(volume: number, fadeMs?: number): void;
  setPlaybackRate(rate: number): void;
  /** Resolves once, when the instance ends for any reason. Never rejects. */
  whenEnded(): Promise<EndReason>;
}

/** The part of the manager a game uses. A scope narrows `stop` and `stopAll` to what it started. */
export interface SoundPlayer {
  /** Resolves to `null` (never rejects) when the sound cannot or should not play. */
  play(soundId: string, options?: PlayOptions): Promise<SoundHandle | null>;
  /** Stops every instance of the definition and cancels its pending loads, within this player's ownership. */
  stop(soundId: string, options?: StopOptions): void;
  stopAll(options?: StopOptions): void;
}

export interface SoundScope extends SoundPlayer {
  readonly id: string;
  readonly disposed: boolean;
  /** Stops and cancels everything this scope started. Idempotent. Later `play` calls resolve to `null`. */
  dispose(options?: StopOptions): void;
}

export interface ChannelSettings {
  volume: number;
  muted: boolean;
}

/** Serializable mixer state. Muting never overwrites `volume`. */
export interface SoundSettings {
  masterVolume: number;
  masterMuted: boolean;
  channels: Record<AudioChannel, ChannelSettings>;
}

export interface SoundSettingsPatch {
  masterVolume?: number;
  masterMuted?: boolean;
  channels?: Partial<Record<AudioChannel, Partial<ChannelSettings>>>;
}

/** `locked`: the browser has not yet allowed audio (waiting for a user gesture). */
export type AudioStatus = 'ready' | 'locked' | 'unavailable' | 'disposed';

export type AudioErrorCode =
  | 'missing-sound'
  | 'missing-asset'
  | 'load-failed'
  | 'decode-failed'
  | 'unsupported'
  | 'engine-unavailable'
  | 'locked'
  | 'playback-failed'
  | 'voice-limit'
  | 'invalid-manifest'
  | 'manifest-failed'
  | 'aborted'
  | 'disposed';

export class AudioError extends Error {
  readonly code: AudioErrorCode;
  /** The HTTP status when a fetch was answered with an error. */
  readonly status: number | undefined;

  constructor(
    code: AudioErrorCode,
    message: string,
    options?: { cause?: unknown; status?: number },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'AudioError';
    this.code = code;
    this.status = options?.status;
  }
}

/** A non-fatal problem, kept in a small ring buffer for development and future telemetry. */
export interface AudioDiagnostic {
  code: AudioErrorCode;
  soundId?: string;
  message: string;
  /** Milliseconds since the epoch of the first occurrence. */
  at: number;
  /** How many times the same code and sound id repeated. */
  count: number;
}

export type AudioDiagnosticSink = (diagnostic: AudioDiagnostic) => void;

export interface SoundManager extends SoundPlayer {
  register(definition: SoundDefinition): void;
  registerAll(definitions: readonly SoundDefinition[]): void;
  unregister(soundId: string): void;
  has(soundId: string): boolean;
  /**
   * Replaces everything `owner` registered before with `definitions`, atomically. Definitions
   * owned by others (including the app's own `register` calls) are never touched; an id owned
   * by someone else is refused. Instances already playing keep the definition they started with.
   * Returns the ids that were refused.
   */
  replaceDefinitions(owner: string, definitions: readonly SoundDefinition[]): string[];
  /** Removes every definition `owner` registered. */
  releaseDefinitions(owner: string): void;
  /** Where `assetId`s are turned into urls. `undefined` leaves only literal urls playable. */
  setAssetResolver(resolver: SoundAssetResolver | undefined): void;
  /** Records a non-fatal problem in the same de-duplicated ring as the manager's own. */
  reportIssue(code: AudioErrorCode, message: string, soundId?: string): void;

  createScope(name?: string): SoundScope;

  /** Resume the audio context. Call from a user gesture. Resolves to whether audio is now running. */
  unlock(): Promise<boolean>;
  /** Listens for the first pointer, touch or key event and unlocks. Returns an uninstaller. Idempotent per target. */
  installGestureUnlock(target?: GestureTarget): () => void;
  getStatus(): AudioStatus;

  setMasterVolume(volume: number): void;
  setMuted(muted: boolean): void;
  setChannelVolume(channel: AudioChannel, volume: number): void;
  muteChannel(channel: AudioChannel, muted: boolean): void;
  applySettings(patch: SoundSettingsPatch): void;
  /** The same object until a setting or the status changes (safe for `useSyncExternalStore`). */
  getSettings(): SoundSettings;
  /** Fires on settings or status changes only, never per playback. */
  subscribe(listener: () => void): () => void;

  getDiagnostics(): readonly AudioDiagnostic[];
  clearDiagnostics(): void;

  dispose(): void;
  readonly disposed: boolean;
}

/**
 * Turns an asset reference into a url. The same shape as the 3D `AssetResolver`, so the Django
 * asset resolver plugs in unchanged.
 */
export interface SoundAssetResolver {
  resolve(
    assetId: string,
    options?: { forceRefresh?: boolean },
  ): Promise<{ id: string; url: string; cacheKey?: string }>;
}

export interface GestureTarget {
  addEventListener(type: string, listener: () => void, options?: { capture?: boolean }): void;
  removeEventListener(type: string, listener: () => void, options?: { capture?: boolean }): void;
}
