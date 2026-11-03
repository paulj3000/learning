import { createWebAudioEngine, type AudioEngine, type EngineVoice } from './AudioEngine';
import { resolveSoundSource } from './AudioAssetResolver';
import {
  clampPlaybackRate,
  clampVolume,
  createDefaultSettings,
  DEFAULT_DUCKING,
  effectiveChannelGain,
  effectiveMasterGain,
  getChannelConfig,
  CHANNEL_IDS,
} from './AudioChannels';
import { LifecycleRegistry } from './AudioLifecycle';
import { AudioRegistry } from './AudioRegistry';
import {
  AudioError,
  type AudioDiagnostic,
  type AudioDiagnosticSink,
  type AudioErrorCode,
  type AudioStatus,
  type AudioChannel,
  type DuckHandle,
  type DuckingConfig,
  type DuckOptions,
  type EndReason,
  type GestureTarget,
  type PlayOptions,
  type SoundAssetResolver,
  type SoundDefinition,
  type SoundHandle,
  type SoundManager,
  type SoundScope,
  type SoundSettings,
  type SoundSettingsPatch,
  type StopOptions,
} from './AudioTypes';

export interface SoundManagerOptions {
  /** Defaults to the Web Audio engine. Tests pass a fake. */
  engine?: AudioEngine;
  /** Resolves `assetId`s to urls. Absent: only literal `url`s play. */
  resolver?: SoundAssetResolver;
  definitions?: readonly SoundDefinition[];
  settings?: SoundSettingsPatch;
  /** Receives the first occurrence of each distinct problem. Production telemetry attaches here later. */
  onDiagnostic?: AudioDiagnosticSink;
  /** Total simultaneous instances. When full, the lowest priority is stolen or the new sound is dropped. Default 24. */
  maxVoices?: number;
  now?: () => number;
}

const APP_SCOPE = 'app';
const DEFAULT_MAX_VOICES = 24;
const STEAL_FADE_MS = 20;
const MAX_DIAGNOSTICS = 50;
const EXPIRED_STATUSES = [401, 403, 404, 410];
const GESTURE_EVENTS = ['pointerdown', 'touchend', 'keydown', 'click'] as const;

function cloneSettings(settings: SoundSettings): SoundSettings {
  const channels = {} as SoundSettings['channels'];
  for (const id of CHANNEL_IDS) channels[id] = { ...settings.channels[id] };
  return { ...settings, channels };
}

/** An explicit fade-out from the caller, or `undefined` to use the sound's own default. */
function fadeOf(options: StopOptions | undefined): number | undefined {
  return options?.fadeOutMs === undefined ? undefined : nonNegative(options.fadeOutMs);
}

function nonNegative(ms: number | undefined): number {
  return ms !== undefined && Number.isFinite(ms) && ms > 0 ? ms : 0;
}

/**
 * The Sound Manager. See docs/audio/SOUND_MANAGER_ARCHITECTURE.md.
 *
 * Contract highlights:
 * - `play` never rejects and never throws; a sound that cannot play yields `null`.
 * - Every instance and pending load belongs to a scope; disposing a scope
 *   cancels its loads before they can start anything.
 * - Volumes and mutes are stored here and pushed to the engine as gains, so
 *   muting never loses the configured volume.
 */
export function createSoundManager(options: SoundManagerOptions = {}): SoundManager {
  const engine = options.engine ?? createWebAudioEngine();
  let resolver = options.resolver;
  const registry = new AudioRegistry();
  const lifecycle = new LifecycleRegistry();
  const maxVoices = Math.max(1, options.maxVoices ?? DEFAULT_MAX_VOICES);
  const now = options.now ?? Date.now;

  let settings = createDefaultSettings();
  let disposed = false;
  let nextInstance = 0;
  let nextLoad = 0;
  let nextScope = 0;
  let nextOrder = 0;

  const listeners = new Set<() => void>();
  const gestureInstalls = new Map<GestureTarget, () => void>();
  const lastStart = new Map<string, number>();
  const diagnostics: AudioDiagnostic[] = [];
  const diagnosticIndex = new Map<string, AudioDiagnostic>();

  // ---- diagnostics ------------------------------------------------------------------

  function report(code: AudioErrorCode, message: string, soundId?: string): void {
    const key = `${code}:${soundId ?? ''}`;
    const existing = diagnosticIndex.get(key);
    if (existing) {
      existing.count += 1; // repeats are counted, not re-emitted, so a hot loop cannot flood anything
      return;
    }
    const entry: AudioDiagnostic = { code, soundId, message, at: now(), count: 1 };
    diagnostics.push(entry);
    diagnosticIndex.set(key, entry);
    if (diagnostics.length > MAX_DIAGNOSTICS) {
      const dropped = diagnostics.shift();
      if (dropped) diagnosticIndex.delete(`${dropped.code}:${dropped.soundId ?? ''}`);
    }
    try {
      options.onDiagnostic?.(entry);
    } catch {
      // A sink must never break audio.
    }
  }

  // ---- settings -------------------------------------------------------------------------

  function notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // Subscribers cannot break audio.
      }
    }
  }

  // ---- ducking (a temporary multiplier on a channel, never a setting) ---------------------

  interface DuckHold {
    channel: AudioChannel;
    level: number;
    releaseMs: number;
  }
  const holds = new Set<DuckHold>();
  let ducking: DuckingConfig = {
    ...DEFAULT_DUCKING,
    triggers: [...DEFAULT_DUCKING.triggers],
    targets: [...DEFAULT_DUCKING.targets],
  };

  function duckLevel(channel: AudioChannel): number {
    let level = 1;
    for (const hold of holds) if (hold.channel === channel) level = Math.min(level, hold.level);
    return level;
  }

  function pushChannel(channel: AudioChannel, rampMs?: number): void {
    engine.setChannelGain(
      channel,
      effectiveChannelGain(settings, channel) * duckLevel(channel),
      rampMs,
    );
  }

  function pushGains(): void {
    engine.setMasterGain(effectiveMasterGain(settings));
    for (const channel of CHANNEL_IDS) pushChannel(channel);
  }

  function acquireDuck(channel: AudioChannel, duckOptions: DuckOptions = {}): DuckHandle {
    const level = clampVolume(duckOptions.level ?? ducking.level) ?? ducking.level;
    const hold: DuckHold = {
      channel,
      level,
      releaseMs: nonNegative(duckOptions.releaseMs ?? ducking.releaseMs),
    };
    if (disposed || !CHANNEL_IDS.includes(channel)) return { active: false, release() {} };
    holds.add(hold);
    pushChannel(channel, nonNegative(duckOptions.attackMs ?? ducking.attackMs));
    return {
      get active() {
        return holds.has(hold);
      },
      release(releaseMs) {
        if (!holds.delete(hold) || disposed) return;
        pushChannel(channel, releaseMs === undefined ? hold.releaseMs : nonNegative(releaseMs));
      },
    };
  }

  function updateSettings(change: (draft: SoundSettings) => void): void {
    if (disposed) return;
    const draft = cloneSettings(settings);
    change(draft);
    settings = draft;
    pushGains();
    notify();
  }

  function applyPatch(draft: SoundSettings, patch: SoundSettingsPatch): void {
    if (patch.masterVolume !== undefined) {
      const volume = clampVolume(patch.masterVolume);
      if (volume !== undefined) draft.masterVolume = volume;
    }
    if (patch.masterMuted !== undefined) draft.masterMuted = Boolean(patch.masterMuted);
    if (patch.reducedIntensity !== undefined) {
      draft.reducedIntensity = Boolean(patch.reducedIntensity);
    }
    for (const channel of CHANNEL_IDS) {
      const channelPatch = patch.channels?.[channel];
      if (!channelPatch) continue;
      if (channelPatch.volume !== undefined) {
        const volume = clampVolume(channelPatch.volume);
        if (volume !== undefined) draft.channels[channel].volume = volume;
      }
      if (channelPatch.muted !== undefined) {
        draft.channels[channel].muted = Boolean(channelPatch.muted);
      }
    }
  }

  // ---- status ---------------------------------------------------------------------------

  function status(): AudioStatus {
    if (disposed) return 'disposed';
    const state = engine.state;
    if (state === 'running') return 'ready';
    if (state === 'suspended') return 'locked';
    return 'unavailable';
  }

  // The settings snapshot must change identity when the status does, so a store subscriber re-reads it.
  let lastStatus = status();
  const stopEngineListener = engine.onStateChange(() => {
    const next = status();
    if (next === lastStatus) return;
    lastStatus = next;
    settings = cloneSettings(settings);
    notify();
  });

  // ---- playback -------------------------------------------------------------------------

  function makeHandle(
    definition: SoundDefinition,
    scopeId: string,
    voiceFor: (end: (reason: EndReason) => void) => EngineVoice,
    priority: number,
  ): SoundHandle {
    const instanceId = `snd-${(nextInstance += 1)}`;
    let state: SoundHandle['state'] = 'playing';
    let voice: EngineVoice | undefined;
    let settle: (reason: EndReason) => void = () => undefined;
    const ended = new Promise<EndReason>((resolve) => {
      settle = resolve;
    });

    const finish = (reason: EndReason, fadeOutMs: number | undefined): void => {
      if (state === 'ended') return;
      state = 'ended';
      lifecycle.removeInstance(instanceId);
      try {
        // A natural end has already released its nodes; stop is then a harmless no-op.
        voice?.stop(
          reason === 'finished' || reason === 'failed'
            ? 0
            : (fadeOutMs ?? nonNegative(definition.fadeOutMs)),
        );
      } catch {
        // Releasing nodes must not throw into game code.
      }
      settle(reason);
    };

    voice = voiceFor((reason) => finish(reason, 0));

    lifecycle.addInstance({
      instanceId,
      soundId: definition.id,
      scopeId,
      channel: definition.channel,
      priority,
      order: (nextOrder += 1),
      end: finish,
    });

    const guard = (action: (active: EngineVoice) => void): void => {
      if (state === 'ended' || !voice) return;
      try {
        action(voice);
      } catch {
        report('playback-failed', 'the browser rejected a playback control', definition.id);
      }
    };

    return {
      instanceId,
      soundId: definition.id,
      channel: definition.channel,
      get state() {
        return state;
      },
      stop(stopOptions) {
        finish('stopped', fadeOf(stopOptions));
      },
      pause() {
        if (state !== 'playing') return;
        guard((active) => active.pause());
        state = 'paused';
      },
      resume() {
        if (state !== 'paused') return;
        guard((active) => active.resume());
        state = 'playing';
      },
      setVolume(volume, fadeMs) {
        const clamped = clampVolume(volume);
        if (clamped === undefined) return;
        guard((active) => active.setVolume(clamped, nonNegative(fadeMs)));
      },
      setPlaybackRate(rate) {
        const clamped = clampPlaybackRate(rate);
        if (clamped === undefined) return;
        guard((active) => active.setPlaybackRate(clamped));
      },
      whenEnded: () => ended,
    };
  }

  async function playIn(
    scopeId: string,
    isScopeOpen: () => boolean,
    soundId: string,
    playOptions: PlayOptions = {},
  ): Promise<SoundHandle | null> {
    if (disposed || !isScopeOpen()) return null;

    const definition = registry.get(soundId);
    if (!definition) {
      report('missing-sound', `no sound is registered as "${soundId}"`, soundId);
      return null;
    }
    if (engine.state === 'unavailable' || engine.state === 'closed') {
      report('engine-unavailable', 'audio is not available in this browser', soundId);
      return null;
    }

    if (definition.cooldownMs) {
      const previous = lastStart.get(soundId);
      if (previous !== undefined && now() - previous < definition.cooldownMs) return null;
      lastStart.set(soundId, now());
    }
    if (definition.maxConcurrent !== undefined) {
      const running =
        lifecycle.instancesMatching({ soundId }).length +
        lifecycle.loadsMatching({ soundId }).length;
      if (running >= definition.maxConcurrent) {
        report('voice-limit', 'too many copies of this sound are playing', soundId);
        return null;
      }
    }

    const controller = new AbortController();
    const loadId = `load-${(nextLoad += 1)}`;
    lifecycle.addLoad({
      loadId,
      soundId,
      scopeId,
      cancel: () => controller.abort(),
    });

    try {
      const load = async (refresh: boolean) => {
        const source = await resolveSoundSource(definition, resolver, { forceRefresh: refresh });
        if (controller.signal.aborted) throw new AudioError('aborted', 'load cancelled');
        return engine.load(source.url, {
          stream: definition.stream === true,
          signal: controller.signal,
          cacheKey: source.cacheKey,
        });
      };
      let loaded;
      try {
        loaded = await load(false);
      } catch (cause) {
        // A signed url can expire between being issued and being fetched: ask for a new one once.
        const expired =
          cause instanceof AudioError &&
          cause.code === 'load-failed' &&
          cause.status !== undefined &&
          EXPIRED_STATUSES.includes(cause.status);
        if (!expired || !definition.assetId || !resolver) throw cause;
        loaded = await load(true);
      }
      if (controller.signal.aborted || disposed || !isScopeOpen()) return null;

      const loop = playOptions.loop ?? definition.loop ?? false;

      if (engine.state !== 'running') {
        // Ask once, without waiting: outside a user gesture this may stay pending.
        void engine.unlock();
        if (!loop) {
          // A one-shot played into a locked context would burst out later, long after it mattered.
          report('locked', 'audio is waiting for the first tap or key press', soundId);
          return null;
        }
        // A loop is harmless to queue: it simply begins once the browser unlocks audio.
      }

      const priority = definition.priority ?? getChannelConfig(definition.channel).defaultPriority;
      if (lifecycle.instanceCount >= maxVoices) {
        const victim = lifecycle.stealCandidate();
        if (!victim || victim.priority > priority) {
          report('voice-limit', 'too many sounds are playing', soundId);
          return null;
        }
        victim.end('stopped', STEAL_FADE_MS);
      }

      const volume = clampVolume(playOptions.volume ?? definition.defaultVolume ?? 1) ?? 1;
      const playbackRate = clampPlaybackRate(playOptions.playbackRate ?? 1) ?? 1;

      let handle: SoundHandle;
      try {
        handle = makeHandle(
          definition,
          scopeId,
          (end) =>
            engine.play(
              loaded,
              {
                channel: definition.channel,
                loop,
                volume,
                playbackRate,
                fadeInMs: nonNegative(playOptions.fadeInMs ?? definition.fadeInMs),
              },
              (reason) => end(reason),
            ),
          priority,
        );
      } catch (cause) {
        const code = cause instanceof AudioError ? cause.code : 'playback-failed';
        report(code, 'the browser could not start this sound', soundId);
        return null;
      }
      duckFor(definition.channel, handle);
      return handle;
    } catch (cause) {
      if (cause instanceof AudioError && cause.code === 'aborted') return null;
      const code: AudioErrorCode = cause instanceof AudioError ? cause.code : 'load-failed';
      report(code, cause instanceof Error ? cause.message : 'sound failed to load', soundId);
      return null;
    } finally {
      lifecycle.removeLoad(loadId);
    }
  }

  /** While a trigger channel's sound plays (any way it ends), the target channels are ducked. */
  function duckFor(channel: AudioChannel, handle: SoundHandle): void {
    if (!ducking.enabled || !ducking.triggers.includes(channel)) return;
    const taken = ducking.targets
      .filter((target) => target !== channel)
      .map((target) => acquireDuck(target));
    if (taken.length === 0) return;
    void handle.whenEnded().then(() => {
      for (const hold of taken) hold.release();
    });
  }

  function makePlayer(scopeId: string, isScopeOpen: () => boolean) {
    return {
      play: (soundId: string, playOptions?: PlayOptions) =>
        playIn(scopeId, isScopeOpen, soundId, playOptions).catch(() => null),
      stop: (soundId: string, stopOptions?: StopOptions) =>
        lifecycle.endMatching(
          { soundId, scopeId: scopeId === APP_SCOPE ? undefined : scopeId },
          'stopped',
          fadeOf(stopOptions),
        ),
      stopAll: (stopOptions?: StopOptions) =>
        lifecycle.endMatching(
          { scopeId: scopeId === APP_SCOPE ? undefined : scopeId },
          'stopped',
          fadeOf(stopOptions),
        ),
    };
  }

  // ---- gesture unlock -----------------------------------------------------------------

  function resolveGestureTarget(target?: GestureTarget): GestureTarget | undefined {
    if (target) return target;
    return typeof document !== 'undefined' ? document : undefined;
  }

  // ---- public surface -------------------------------------------------------------------

  const appPlayer = makePlayer(APP_SCOPE, () => !disposed);

  const manager: SoundManager = {
    ...appPlayer,

    register(definition) {
      registry.register(definition);
    },
    registerAll(definitions) {
      registry.registerAll(definitions);
    },
    unregister(soundId) {
      registry.unregister(soundId);
    },
    has: (soundId) => registry.has(soundId),
    replaceDefinitions(owner, definitions) {
      if (disposed) return definitions.map((definition) => definition.id);
      return registry.replaceOwned(owner, definitions);
    },
    releaseDefinitions(owner) {
      registry.releaseOwned(owner);
    },
    setAssetResolver(next: SoundAssetResolver | undefined) {
      resolver = next;
    },
    reportIssue: report,

    duck: acquireDuck,
    setDucking(config) {
      ducking = {
        ...ducking,
        ...config,
        triggers: [...(config.triggers ?? ducking.triggers)],
        targets: [...(config.targets ?? ducking.targets)],
        level: clampVolume(config.level ?? ducking.level) ?? ducking.level,
        attackMs: nonNegative(config.attackMs ?? ducking.attackMs),
        releaseMs: nonNegative(config.releaseMs ?? ducking.releaseMs),
      };
    },
    getDucking: () => ({
      ...ducking,
      triggers: [...ducking.triggers],
      targets: [...ducking.targets],
    }),

    createScope(name) {
      const id = `${name ?? 'scope'}#${(nextScope += 1)}`;
      let scopeDisposed = false;
      const player = makePlayer(id, () => !scopeDisposed && !disposed);
      const scope: SoundScope = {
        id,
        get disposed() {
          return scopeDisposed || disposed;
        },
        ...player,
        dispose(stopOptions) {
          if (scopeDisposed) return;
          scopeDisposed = true;
          lifecycle.endMatching({ scopeId: id }, 'disposed', fadeOf(stopOptions));
        },
      };
      return scope;
    },

    async unlock() {
      if (disposed) return false;
      try {
        return await engine.unlock();
      } catch {
        return false;
      }
    },

    installGestureUnlock(target) {
      const resolved = resolveGestureTarget(target);
      if (!resolved || disposed) return () => undefined;
      const existing = gestureInstalls.get(resolved);
      if (existing) return existing;

      const uninstall = (): void => {
        for (const type of GESTURE_EVENTS)
          resolved.removeEventListener(type, onGesture, { capture: true });
        gestureInstalls.delete(resolved);
      };
      const onGesture = (): void => {
        void manager.unlock().then((running) => {
          if (running) uninstall();
        });
      };
      for (const type of GESTURE_EVENTS)
        resolved.addEventListener(type, onGesture, { capture: true });
      gestureInstalls.set(resolved, uninstall);
      return uninstall;
    },

    getStatus: status,

    setMasterVolume(volume) {
      const clamped = clampVolume(volume);
      if (clamped === undefined) return;
      updateSettings((draft) => {
        draft.masterVolume = clamped;
      });
    },
    setMuted(muted) {
      updateSettings((draft) => {
        draft.masterMuted = Boolean(muted);
      });
    },
    setChannelVolume(channel, volume) {
      const clamped = clampVolume(volume);
      if (clamped === undefined || !CHANNEL_IDS.includes(channel)) return;
      updateSettings((draft) => {
        draft.channels[channel].volume = clamped;
      });
    },
    muteChannel(channel, muted) {
      if (!CHANNEL_IDS.includes(channel)) return;
      updateSettings((draft) => {
        draft.channels[channel].muted = Boolean(muted);
      });
    },
    applySettings(patch) {
      updateSettings((draft) => applyPatch(draft, patch));
    },
    getSettings: () => settings,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getDiagnostics: () => diagnostics.map((entry) => ({ ...entry })),
    clearDiagnostics() {
      diagnostics.length = 0;
      diagnosticIndex.clear();
    },

    dispose() {
      if (disposed) return;
      lifecycle.endMatching({}, 'disposed', 0);
      disposed = true;
      holds.clear();
      for (const uninstall of [...gestureInstalls.values()]) uninstall();
      stopEngineListener();
      try {
        engine.dispose();
      } catch {
        // Closing a context twice or on an odd browser must not throw.
      }
      notify();
      listeners.clear();
    },
    get disposed() {
      return disposed;
    },
  };

  if (options.settings) manager.applySettings(options.settings);
  else pushGains();
  if (options.definitions) manager.registerAll(options.definitions);

  return manager;
}
