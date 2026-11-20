/**
 * Development diagnostics: frame timing, counters and a bounded warning log.
 *
 * Privacy rule (CLAUDE.md section 13; security policy): diagnostics hold engine facts only,
 * such as frame times, step counts, entity counts, renderer statistics and semantic content
 * ids. They never hold child names, free text, audio, profile ids or session ids. `warn()`
 * accepts a code and a details record of primitives so nothing else can be passed in.
 *
 * Diagnostics are cheap enough to leave on in development; production hosts may pass
 * `enabled: false`, which turns every call into a no-op.
 */

export type DiagnosticPrimitive = string | number | boolean | null;

export interface DiagnosticWarning {
  code: string;
  details: Readonly<Record<string, DiagnosticPrimitive>>;
  /** Simulated seconds when it was raised. */
  at: number;
  /** How many times this code repeated since it was first logged. */
  repeats: number;
}

export interface FrameStats {
  frames: number;
  /** Mean frame time over the rolling window, ms. */
  meanFrameMs: number;
  /** Worst frame time in the window, ms. */
  maxFrameMs: number;
  /** Frames per second derived from the mean. */
  fps: number;
  /** Simulation steps dropped by the fixed-timestep clamp (a slow device or a paused tab). */
  droppedSeconds: number;
}

export interface DiagnosticsSnapshot {
  frame: FrameStats;
  counters: Readonly<Record<string, number>>;
  gauges: Readonly<Record<string, number>>;
  warnings: readonly DiagnosticWarning[];
  systemTimingsMs: Readonly<Record<string, number>>;
}

export interface Diagnostics {
  readonly enabled: boolean;
  recordFrame(frameMs: number, droppedSeconds?: number): void;
  count(name: string, by?: number): void;
  gauge(name: string, value: number): void;
  warn(code: string, details?: Record<string, DiagnosticPrimitive>, at?: number): void;
  setSystemTimings(timings: ReadonlyMap<string, number>): void;
  snapshot(): DiagnosticsSnapshot;
  reset(): void;
}

export interface DiagnosticsOptions {
  enabled?: boolean;
  /** Frames in the rolling timing window. Default 120. */
  window?: number;
  /** Distinct warnings kept. Default 50. */
  maxWarnings?: number;
}

const EMPTY_SNAPSHOT: DiagnosticsSnapshot = Object.freeze({
  frame: { frames: 0, meanFrameMs: 0, maxFrameMs: 0, fps: 0, droppedSeconds: 0 },
  counters: {},
  gauges: {},
  warnings: [],
  systemTimingsMs: {},
});

export function createDiagnostics(options: DiagnosticsOptions = {}): Diagnostics {
  const enabled = options.enabled ?? true;
  const windowSize = Math.max(1, options.window ?? 120);
  const maxWarnings = Math.max(1, options.maxWarnings ?? 50);
  let samples: number[] = [];
  let frames = 0;
  let dropped = 0;
  let counters: Record<string, number> = {};
  let gauges: Record<string, number> = {};
  let warnings: DiagnosticWarning[] = [];
  let timings: Record<string, number> = {};

  if (!enabled) {
    return {
      enabled,
      recordFrame() {},
      count() {},
      gauge() {},
      warn() {},
      setSystemTimings() {},
      snapshot: () => EMPTY_SNAPSHOT,
      reset() {},
    };
  }

  return {
    enabled,
    recordFrame(frameMs, droppedSeconds = 0) {
      if (!Number.isFinite(frameMs) || frameMs < 0) {
        return;
      }
      frames += 1;
      dropped += droppedSeconds;
      samples.push(frameMs);
      if (samples.length > windowSize) {
        samples = samples.slice(samples.length - windowSize);
      }
    },
    count(name, by = 1) {
      counters[name] = (counters[name] ?? 0) + by;
    },
    gauge(name, value) {
      gauges[name] = value;
    },
    warn(code, details = {}, at = 0) {
      const existing = warnings.find((w) => w.code === code);
      if (existing) {
        existing.repeats += 1;
        return;
      }
      const safe: Record<string, DiagnosticPrimitive> = {};
      for (const [key, value] of Object.entries(details)) {
        // Runtime guard as well as the type: drop anything that is not a primitive.
        if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
          safe[key] = value;
        }
      }
      warnings.push({ code, details: Object.freeze(safe), at, repeats: 0 });
      if (warnings.length > maxWarnings) {
        warnings = warnings.slice(warnings.length - maxWarnings);
      }
    },
    setSystemTimings(map) {
      timings = Object.fromEntries(map);
    },
    snapshot() {
      const mean = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
      return {
        frame: {
          frames,
          meanFrameMs: mean,
          maxFrameMs: samples.length ? Math.max(...samples) : 0,
          fps: mean > 0 ? 1000 / mean : 0,
          droppedSeconds: dropped,
        },
        counters: { ...counters },
        gauges: { ...gauges },
        warnings: warnings.map((w) => ({ ...w })),
        systemTimingsMs: { ...timings },
      };
    },
    reset() {
      samples = [];
      frames = 0;
      dropped = 0;
      counters = {};
      gauges = {};
      warnings = [];
      timings = {};
    },
  };
}
