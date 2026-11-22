import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { PerspectiveCamera, Scene } from 'three';
import {
  createEngineRuntime,
  type CapabilityRequest,
  type EngineRuntime,
} from '@lai/game-engine/core';
import { validateGameplayEvent, type AnyGameplayEvent } from '@lai/game-engine/contracts';
import { createRendererStatsCollector } from '@lai/game-engine/engine';
import {
  createWebGLRenderer,
  HOST_EVENTS,
  HostPreferencesService,
  HostViewService,
  type GameHostStatus,
  type HostPreferences,
  type HostRenderer,
  type HostView,
  type RendererFactory,
} from './hostTypes';

/** A frame longer than this is clamped (a stalled tab must not replay as a burst). */
export const MAX_FRAME_SECONDS = 0.25;

/** Diagnostics counters the host maintains. */
export const HOST_COUNTERS = Object.freeze({
  invalidClaims: 'host.invalidGameplayClaims',
  callbackErrors: 'host.callbackErrors',
});

export interface UseEngineRuntimeOptions {
  /** Stable id of what is hosted; used for the default runtime and diagnostics. */
  runtimeId: string;
  /** Builds the runtime. Default: `createEngineRuntime({ id: runtimeId })`. */
  createRuntime?: () => EngineRuntime;
  capabilities?: readonly CapabilityRequest[];
  /** Runs after capabilities install; scene and asset loading. May be async. */
  setup?: (runtime: EngineRuntime, view: HostView) => Promise<void> | void;
  rendererFactory?: RendererFactory;
  /** Overrides the OS preference; undefined reads `prefers-reduced-motion`. */
  reducedMotion?: boolean;
  /** Validated claims only. An invalid claim is dropped and counted. */
  onGameplayEvent?: (event: AnyGameplayEvent) => void;
  /** Every other runtime and presentation event, by name. */
  onEngineEvent?: (name: string, payload: unknown) => void;
  /** Called with a safe code when start fails (never a message that could hold data). */
  onError?: (code: string) => void;
  onRuntimeReady?: (runtime: EngineRuntime, view: HostView) => void;
}

export interface EngineRuntimeState {
  containerRef: RefObject<HTMLDivElement | null>;
  status: GameHostStatus;
  /** `gameHost.error.*` message key when status is `error`. */
  errorKey: 'gameHost.error.generic' | 'gameHost.error.noGraphics' | null;
  /** True while the host has paused the engine (tab hidden or window blurred). */
  paused: boolean;
  retry(): void;
}

function readReducedMotion(override: boolean | undefined): boolean {
  if (override !== undefined) {
    return override;
  }
  try {
    return (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

/**
 * Owns one engine runtime and one renderer for the lifetime of a mounted container.
 *
 * Everything is created in the effect and torn down in its cleanup, so React StrictMode's
 * mount, unmount, mount sequence builds, disposes and rebuilds without leaking. Option
 * callbacks are read through a ref, so a new function identity never restarts the engine;
 * `retry()` and a new `runtimeId` do.
 */
export function useEngineRuntime(options: UseEngineRuntimeOptions): EngineRuntimeState {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [status, setStatus] = useState<GameHostStatus>('loading');
  const [errorKey, setErrorKey] = useState<EngineRuntimeState['errorKey']>(null);
  const [paused, setPaused] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const { runtimeId } = options;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    const opts = () => optionsRef.current;
    let cancelled = false;
    let rafId = 0;
    let lastTime: number | null = null;
    let hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    let blurred = false;
    let renderer: HostRenderer | null = null;
    let runtime: EngineRuntime | null = null;
    let observer: ResizeObserver | null = null;
    let motionQuery: MediaQueryList | null = null;
    const cleanups: (() => void)[] = [];

    setStatus('loading');
    setErrorKey(null);
    setPaused(false);

    const fail = (key: NonNullable<EngineRuntimeState['errorKey']>, code: string) => {
      if (cancelled) {
        return;
      }
      setErrorKey(key);
      setStatus('error');
      opts().onError?.(code);
    };

    const teardown = () => {
      cancelled = true;
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
      for (const run of cleanups.splice(0).reverse()) {
        try {
          run();
        } catch {
          // A failing cleanup must not stop the rest of the teardown.
        }
      }
      observer?.disconnect();
      runtime?.dispose();
      renderer?.dispose();
      renderer?.domElement.remove();
    };

    try {
      renderer = (opts().rendererFactory ?? createWebGLRenderer)();
    } catch {
      fail('gameHost.error.noGraphics', 'NO_GRAPHICS');
      return teardown;
    }

    const canvas = renderer.domElement;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.touchAction = 'none';
    container.appendChild(canvas);
    renderer.setPixelRatio(
      Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2),
    );

    const scene = new Scene();
    const view: HostView = {
      renderer,
      scene,
      camera: new PerspectiveCamera(60, 1, 0.1, 500),
      canvas,
      size: () => ({
        width: Math.max(1, container.clientWidth),
        height: Math.max(1, container.clientHeight),
      }),
    };
    const preferences: HostPreferences = { reducedMotion: readReducedMotion(opts().reducedMotion) };

    const applySize = () => {
      const { width, height } = view.size();
      renderer?.setSize(width, height, false);
      if (view.camera instanceof PerspectiveCamera) {
        view.camera.aspect = width / height;
        view.camera.updateProjectionMatrix();
      }
      runtime?.events.emit(HOST_EVENTS.resized as never, { width, height } as never);
    };
    applySize();
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(applySize);
      observer.observe(container);
    }

    try {
      runtime = opts().createRuntime?.() ?? createEngineRuntime({ id: opts().runtimeId });
    } catch {
      fail('gameHost.error.generic', 'RUNTIME_CREATE_FAILED');
      return teardown;
    }
    const engine = runtime;
    const stats = createRendererStatsCollector(renderer, engine.diagnostics);
    engine.services.provide(HostViewService, view);
    engine.services.provide(HostPreferencesService, preferences);

    // Reduced motion follows the OS setting live unless the caller pinned it.
    if (opts().reducedMotion === undefined && typeof window.matchMedia === 'function') {
      try {
        motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        const onChange = () => {
          preferences.reducedMotion = readReducedMotion(undefined);
          engine.events.emit(HOST_EVENTS.preferencesChanged as never, { ...preferences } as never);
        };
        motionQuery.addEventListener?.('change', onChange);
        const query = motionQuery;
        cleanups.push(() => query.removeEventListener?.('change', onChange));
      } catch {
        motionQuery = null;
      }
    }

    // Event bridge. Gameplay claims are untrusted until validated; React never sees a throw.
    const safeCall = (call: () => void) => {
      try {
        call();
      } catch {
        engine.diagnostics.count(HOST_COUNTERS.callbackErrors);
      }
    };
    cleanups.push(
      engine.events.onAny((name: string, payload: unknown) => {
        if (name === 'gameplay.event') {
          const result = validateGameplayEvent(payload);
          if (!result.ok) {
            engine.diagnostics.count(HOST_COUNTERS.invalidClaims);
            engine.diagnostics.warn('INVALID_GAMEPLAY_CLAIM', { issues: result.issues.length });
            return;
          }
          safeCall(() => opts().onGameplayEvent?.(result.value));
          return;
        }
        safeCall(() => opts().onEngineEvent?.(name, payload));
      }) as () => void,
    );

    const frame = (now: number) => {
      rafId = window.requestAnimationFrame(frame);
      const dt =
        lastTime === null ? 0 : Math.min(Math.max((now - lastTime) / 1000, 0), MAX_FRAME_SECONDS);
      lastTime = now;
      engine.tick(dt);
      renderer?.render(scene, view.camera);
      stats.collect();
    };
    const startLoop = () => {
      if (!rafId && !cancelled) {
        lastTime = null;
        rafId = window.requestAnimationFrame(frame);
      }
    };
    const stopLoop = () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    const syncPause = () => {
      if (cancelled || (engine.state !== 'running' && engine.state !== 'paused')) {
        return;
      }
      const shouldPause = hidden || blurred;
      if (shouldPause && engine.state === 'running') {
        engine.pause();
        stopLoop();
        engine.events.emit(HOST_EVENTS.inputReset as never, {} as never);
        setPaused(true);
      } else if (!shouldPause && engine.state === 'paused') {
        engine.resume();
        startLoop();
        setPaused(false);
      }
    };
    const onVisibility = () => {
      hidden = document.visibilityState === 'hidden';
      syncPause();
    };
    const onBlur = () => {
      blurred = true;
      syncPause();
    };
    const onFocus = () => {
      blurred = false;
      syncPause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    cleanups.push(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    });

    const requests = opts().capabilities ?? [];
    engine
      .start(requests, (started) => opts().setup?.(started, view))
      .then(() => {
        if (cancelled || engine.state === 'disposed') {
          return;
        }
        applySize();
        setStatus('ready');
        opts().onRuntimeReady?.(engine, view);
        if (hidden) {
          // Started in a background tab: stay paused until the player returns.
          syncPause();
        } else {
          startLoop();
        }
      })
      .catch(() => {
        // `start` already disposed the runtime. Only the safe code goes to the caller.
        fail('gameHost.error.generic', 'START_FAILED');
      });

    return teardown;
    // `runtimeId` and `attempt` are the only restart triggers; options are read through a ref.
  }, [runtimeId, attempt]);

  return { containerRef, status, errorKey, paused, retry };
}
