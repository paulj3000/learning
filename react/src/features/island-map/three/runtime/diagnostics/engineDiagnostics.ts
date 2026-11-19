import { EMPTY_FRAME_STATS, reduceFrame, type FrameStatsState } from './frameStats';
import {
  bump,
  EMPTY_LIFECYCLE_COUNTS,
  isBalanced,
  type LifecycleCounter,
  type LifecycleCounts,
} from './lifecycleCounts';
import {
  EMPTY_LOAD_TIMELINE,
  loadDurations,
  markLoad,
  type LoadMark,
  type LoadTimeline,
} from './loadTimeline';
import { snapshotInfo, type RendererInfoLike, type RendererSnapshot } from './rendererSnapshot';

/**
 * SC-R11 diagnostics: local, in-memory, off by default. Enabled in `vite dev` or with
 * `?lai-diag=1`, the latter so a release build on a tablet can be profiled. It records frame
 * times, `renderer.info` counts, load timings and create/release counts only: no child data,
 * no location slug beyond the manifest id, no network. Nothing reads it except the console
 * table and `window.__laiDiag` it installs.
 */
export interface EngineDiagnosticsReport {
  readonly locationId: string;
  readonly frames: Omit<FrameStatsState, 'ring' | 'next'>;
  readonly renderer: RendererSnapshot | null;
  readonly load: LoadTimeline & ReturnType<typeof loadDurations>;
  readonly lifecycle: LifecycleCounts & { readonly balanced: boolean };
  readonly activeMixers: number;
}

export interface EngineDiagnostics {
  frame(deltaMs: number, info?: RendererInfoLike): void;
  mark(mark: LoadMark, atMs: number): void;
  count(counter: LifecycleCounter, by?: number): void;
  setActiveMixers(count: number): void;
  report(): EngineDiagnosticsReport;
  /** Prints the console table and removes `window.__laiDiag` if it is still this one. */
  finish(): void;
}

declare global {
  interface Window {
    __laiDiag?: { report(): EngineDiagnosticsReport };
  }
}

export function diagnosticsRequested(dev: boolean, search: string): boolean {
  if (dev) return true;
  try {
    return new URLSearchParams(search).get('lai-diag') === '1';
  } catch {
    return false;
  }
}

export function createEngineDiagnostics(
  locationId: string,
  target?: Window,
  print = true,
): EngineDiagnostics {
  let frames = EMPTY_FRAME_STATS;
  let timeline = EMPTY_LOAD_TIMELINE;
  let lifecycle = EMPTY_LIFECYCLE_COUNTS;
  let snapshot: RendererSnapshot | null = null;
  let activeMixers = 0;

  function report(): EngineDiagnosticsReport {
    const { ring: _ring, next: _next, ...summary } = frames;
    return {
      locationId,
      frames: summary,
      renderer: snapshot,
      load: { ...timeline, ...loadDurations(timeline) },
      lifecycle: { ...lifecycle, balanced: isBalanced(lifecycle) },
      activeMixers,
    };
  }

  const api = { report };
  if (target) target.__laiDiag = api;

  return {
    frame(deltaMs, info) {
      frames = reduceFrame(frames, deltaMs);
      if (info) snapshot = snapshotInfo(info);
    },
    mark(mark, atMs) {
      timeline = markLoad(timeline, mark, atMs);
    },
    count(counter, by = 1) {
      lifecycle = bump(lifecycle, counter, by);
    },
    setActiveMixers(count) {
      activeMixers = count;
    },
    report,
    finish() {
      const final = report();
      if (print) {
        console.table({
          frames: final.frames,
          renderer: final.renderer ?? {},
          load: { ...final.load.marks, ...loadDurations(final.load) },
          lifecycle: final.lifecycle,
        });
      }
      if (target && target.__laiDiag === api) delete target.__laiDiag;
    },
  };
}
