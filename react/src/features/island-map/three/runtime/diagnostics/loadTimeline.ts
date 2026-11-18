/**
 * Named load marks and the durations between them (SC-R11 diagnostics). Times are
 * `performance.now()`-style milliseconds from the caller; this module reads no clock.
 */
export type LoadMark = 'mount' | 'assetsSettled' | 'firstWalkableFrame';

export interface LoadTimeline {
  readonly marks: Readonly<Partial<Record<LoadMark, number>>>;
  /** Asset id to milliseconds from first request to completion; ids are catalogue ids only. */
  readonly assetMs: Readonly<Record<string, number>>;
}

export interface LoadDurations {
  /** mount to assetsSettled, or null until both are marked. */
  readonly assetsMs: number | null;
  /** mount to firstWalkableFrame, or null until both are marked. */
  readonly timeToFirstWalkableFrameMs: number | null;
}

export const EMPTY_LOAD_TIMELINE: LoadTimeline = { marks: {}, assetMs: {} };

/** The first mark of a name wins, so a repeated frame cannot move `firstWalkableFrame`. */
export function markLoad(timeline: LoadTimeline, mark: LoadMark, atMs: number): LoadTimeline {
  if (!Number.isFinite(atMs) || timeline.marks[mark] !== undefined) return timeline;
  return { ...timeline, marks: { ...timeline.marks, [mark]: atMs } };
}

export function recordAssetDuration(
  timeline: LoadTimeline,
  assetId: string,
  durationMs: number,
): LoadTimeline {
  if (!Number.isFinite(durationMs) || durationMs < 0) return timeline;
  return { ...timeline, assetMs: { ...timeline.assetMs, [assetId]: durationMs } };
}

export function loadDurations(timeline: LoadTimeline): LoadDurations {
  const { mount, assetsSettled, firstWalkableFrame } = timeline.marks;
  const between = (end: number | undefined) =>
    mount !== undefined && end !== undefined && end >= mount ? end - mount : null;
  return {
    assetsMs: between(assetsSettled),
    timeToFirstWalkableFrameMs: between(firstWalkableFrame),
  };
}
