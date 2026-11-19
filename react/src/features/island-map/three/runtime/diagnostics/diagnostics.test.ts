import { describe, expect, it, vi } from 'vitest';
import {
  createEngineDiagnostics,
  diagnosticsRequested,
  EMPTY_FRAME_STATS,
  EMPTY_LIFECYCLE_COUNTS,
  EMPTY_LOAD_TIMELINE,
  bump,
  isBalanced,
  loadDurations,
  markLoad,
  recordAssetDuration,
  reduceFrame,
  snapshotInfo,
} from './index';

function feed(deltas: number[], capacity?: number) {
  return deltas.reduce((state, delta) => reduceFrame(state, delta, capacity), EMPTY_FRAME_STATS);
}

describe('frameStats', () => {
  it('is all zeros when empty', () => {
    expect(EMPTY_FRAME_STATS).toMatchObject({ count: 0, mean: 0, p95: 0, worst: 0 });
  });

  it('keeps arrival order, mean, worst and the slow-frame count', () => {
    const state = feed([16, 17, 40, 16]);
    expect(state.ring).toEqual([16, 17, 40, 16]);
    expect(state.count).toBe(4);
    expect(state.mean).toBeCloseTo(22.25);
    expect(state.worst).toBe(40);
    expect(state.over33msCount).toBe(1);
  });

  it('wraps the ring, forgetting old frames in the window but not in the totals', () => {
    const state = feed([100, 10, 10, 10, 10], 4);
    expect(state.ring).toHaveLength(4);
    expect(state.worst).toBe(10);
    expect(state.count).toBe(5);
    expect(state.over33msCount).toBe(1);
  });

  it('computes p95 by nearest rank', () => {
    const state = feed(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(state.p95).toBe(95);
  });

  it('ignores NaN, infinite and negative deltas', () => {
    const state = feed([16, Number.NaN, -3, Number.POSITIVE_INFINITY]);
    expect(state.count).toBe(1);
    expect(state.ring).toEqual([16]);
  });

  it('does not mutate the state it was given', () => {
    const before = feed([16]);
    reduceFrame(before, 20);
    expect(before.ring).toEqual([16]);
  });
});

describe('rendererSnapshot', () => {
  it('copies the counts and never reports garbage', () => {
    const info = {
      render: { calls: 41, triangles: 5200 },
      memory: { geometries: 12, textures: Number.NaN },
    };
    const snap = snapshotInfo(info);
    expect(snap).toEqual({ calls: 41, triangles: 5200, geometries: 12, textures: 0 });
    info.render.calls = 99;
    expect(snap.calls).toBe(41);
  });
});

describe('loadTimeline', () => {
  it('gives durations from mount once marks exist, and null before', () => {
    let t = markLoad(EMPTY_LOAD_TIMELINE, 'mount', 100);
    expect(loadDurations(t)).toEqual({ assetsMs: null, timeToFirstWalkableFrameMs: null });
    t = markLoad(t, 'assetsSettled', 400);
    t = markLoad(t, 'firstWalkableFrame', 450);
    expect(loadDurations(t)).toEqual({ assetsMs: 300, timeToFirstWalkableFrameMs: 350 });
  });

  it('keeps the first mark of each name and ignores non-finite times', () => {
    let t = markLoad(EMPTY_LOAD_TIMELINE, 'mount', 10);
    t = markLoad(t, 'mount', 99);
    t = markLoad(t, 'assetsSettled', Number.NaN);
    expect(t.marks).toEqual({ mount: 10 });
  });

  it('records asset durations by catalogue id and rejects bad ones', () => {
    let t = recordAssetDuration(EMPTY_LOAD_TIMELINE, 'castle-wall', 120);
    t = recordAssetDuration(t, 'bad', -1);
    expect(t.assetMs).toEqual({ 'castle-wall': 120 });
  });
});

describe('lifecycleCounts', () => {
  it('is balanced only when created equals released', () => {
    let c = bump(EMPTY_LIFECYCLE_COUNTS, 'mixersCreated', 2);
    expect(isBalanced(c)).toBe(false);
    c = bump(c, 'mixersStopped', 2);
    expect(isBalanced(c)).toBe(true);
  });
});

describe('engineDiagnostics', () => {
  it('is requested in dev or with ?lai-diag=1 only', () => {
    expect(diagnosticsRequested(true, '')).toBe(true);
    expect(diagnosticsRequested(false, '')).toBe(false);
    expect(diagnosticsRequested(false, '?lai-diag=0')).toBe(false);
    expect(diagnosticsRequested(false, '?x=1&lai-diag=1')).toBe(true);
  });

  it('reports locally, installs window.__laiDiag, and removes it on finish', () => {
    const target = {} as Window;
    const diag = createEngineDiagnostics('region-x', target, false);
    expect(target.__laiDiag).toBeDefined();
    diag.mark('mount', 0);
    diag.frame(16, { render: { calls: 3, triangles: 9 }, memory: { geometries: 1, textures: 2 } });
    const report = diag.report();
    expect(report.frames.count).toBe(1);
    expect(report.renderer?.calls).toBe(3);
    // No ring buffer internals and nothing child-identifying in the report.
    expect(Object.keys(report.frames)).not.toContain('ring');
    diag.finish();
    expect(target.__laiDiag).toBeUndefined();
  });

  it('prints one console table on finish when asked, and sends nothing anywhere', () => {
    const table = vi.spyOn(console, 'table').mockImplementation(() => undefined);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    createEngineDiagnostics('r', undefined, true).finish();
    expect(table).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    table.mockRestore();
  });
});
