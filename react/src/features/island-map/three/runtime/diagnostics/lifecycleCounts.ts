/** Counters for what the engine creates and releases, so a leak shows as created > released. */
export interface LifecycleCounts {
  readonly mixersCreated: number;
  readonly mixersStopped: number;
  readonly geometriesCreated: number;
  readonly geometriesDisposed: number;
  readonly materialsCreated: number;
  readonly materialsDisposed: number;
}

export type LifecycleCounter = keyof LifecycleCounts;

export const EMPTY_LIFECYCLE_COUNTS: LifecycleCounts = {
  mixersCreated: 0,
  mixersStopped: 0,
  geometriesCreated: 0,
  geometriesDisposed: 0,
  materialsCreated: 0,
  materialsDisposed: 0,
};

export function bump(counts: LifecycleCounts, counter: LifecycleCounter, by = 1): LifecycleCounts {
  return { ...counts, [counter]: counts[counter] + by };
}

/** True when everything created has been released. */
export function isBalanced(counts: LifecycleCounts): boolean {
  return (
    counts.mixersCreated === counts.mixersStopped &&
    counts.geometriesCreated === counts.geometriesDisposed &&
    counts.materialsCreated === counts.materialsDisposed
  );
}
