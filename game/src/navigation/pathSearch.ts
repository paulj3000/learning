/**
 * Path search over a `WalkGrid` (LAI-2104S step B1): A* on 8 neighbours with no corner cutting,
 * then line-of-sight string pulling. Walking links only: there is no jump edge, so a path never
 * asks for a jump and any goal reachable without jumping is one tap away.
 */

import type { GroundXZ, WalkGrid } from './walkGrid';

export type WalkPathStatus =
  /** The target (or a spot within `stopWithin` of it) is reachable; the path ends there. */
  | 'REACHED'
  /** Not reachable: the path ends at the nearest reachable spot to the target. */
  | 'NEAREST'
  /** Nowhere to walk (the start is walled in). */
  | 'NONE';

export interface WalkPath {
  status: WalkPathStatus;
  /** Waypoints from the start (inclusive) to the goal. One point means "stay where you are". */
  points: GroundXZ[];
  /** Where the path ends. */
  goal: GroundXZ;
  /** Straight-line distance from `goal` to the requested target, metres. */
  goalDistance: number;
  /** Path length along `points`, metres. */
  length: number;
}

export interface FindPathOptions {
  /**
   * An object tap: stop once within this many metres of the target (its approach range). 0, the
   * default, is a ground tap: walk onto the spot itself.
   */
  stopWithin?: number;
  /** Skip string pulling (for tests that compare the raw grid path). */
  smooth?: boolean;
}

const SQRT2 = Math.SQRT2;
const NEIGHBOURS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

/** A binary min-heap of cell indices keyed by f. */
class MinHeap {
  private readonly keys: number[] = [];
  private readonly values: number[] = [];
  get size(): number {
    return this.values.length;
  }
  push(key: number, value: number): void {
    let i = this.values.length;
    this.keys.push(key);
    this.values.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.values[0];
    const lastKey = this.keys.pop() as number;
    const lastValue = this.values.pop() as number;
    if (this.values.length > 0) {
      this.keys[0] = lastKey;
      this.values[0] = lastValue;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.keys.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.keys.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
    [this.values[a], this.values[b]] = [this.values[b], this.values[a]];
  }
}

/** The free cell nearest to a point, searched in growing square rings. `null` when none is near. */
export function nearestFreeCell(
  grid: WalkGrid,
  x: number,
  z: number,
  maxRings = 12,
): { col: number; row: number } | null {
  const origin = grid.cellOf(x, z);
  if (grid.isFreeCell(origin.col, origin.row)) return origin;
  let best: { col: number; row: number } | null = null;
  let bestDistance = Infinity;
  for (let ring = 1; ring <= maxRings; ring += 1) {
    for (let dr = -ring; dr <= ring; dr += 1) {
      for (let dc = -ring; dc <= ring; dc += 1) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;
        const col = origin.col + dc;
        const row = origin.row + dr;
        if (!grid.isFreeCell(col, row)) continue;
        const c = grid.centerOf(col, row);
        const d = Math.hypot(c.x - x, c.z - z);
        if (d < bestDistance) {
          best = { col, row };
          bestDistance = d;
        }
      }
    }
    // A hit in this ring beats anything further out.
    if (best) return best;
  }
  return best;
}

function pathLength(points: readonly GroundXZ[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }
  return total;
}

/**
 * String pulling: from each anchor, jump to the furthest waypoint still in straight, free sight.
 * The first point (the child's exact position) is kept even when it sits inside a wall's margin.
 */
export function smoothPath(grid: WalkGrid, points: readonly GroundXZ[]): GroundXZ[] {
  if (points.length <= 2) return [...points];
  const out: GroundXZ[] = [points[0]];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = anchor + 1;
    // An anchor inside a margin (a spawn hugging a wall) cannot be line-tested; leave it by one hop.
    if (anchor > 0 || grid.isFreeAt(points[anchor].x, points[anchor].z)) {
      for (let j = points.length - 1; j > anchor + 1; j -= 1) {
        if (grid.segmentClear(points[anchor], points[j])) {
          next = j;
          break;
        }
      }
    }
    out.push(points[next]);
    anchor = next;
  }
  return out;
}

export function findWalkPath(
  grid: WalkGrid,
  from: GroundXZ,
  to: GroundXZ,
  options: FindPathOptions = {},
): WalkPath {
  const stopWithin = Math.max(0, options.stopWithin ?? 0);
  const startCell = nearestFreeCell(grid, from.x, from.z);
  if (!startCell) {
    return {
      status: 'NONE',
      points: [from],
      goal: from,
      goalDistance: Math.hypot(to.x - from.x, to.z - from.z),
      length: 0,
    };
  }
  const { cols, rows, cellSize } = grid;
  const count = cols * rows;
  const g = new Float32Array(count).fill(Infinity);
  const parent = new Int32Array(count).fill(-1);
  const closed = new Uint8Array(count);
  const startIndex = startCell.row * cols + startCell.col;
  // A ground tap ends in the tapped cell or any cell whose centre is within half a cell diagonal.
  const goalRadius = stopWithin > 0 ? stopWithin : cellSize * 0.75;

  const distToTarget = (index: number): number => {
    const c = grid.centerOf(index % cols, Math.floor(index / cols));
    return Math.hypot(to.x - c.x, to.z - c.z);
  };
  const heuristic = (index: number) => Math.max(0, distToTarget(index) - goalRadius);

  const open = new MinHeap();
  g[startIndex] = 0;
  open.push(heuristic(startIndex), startIndex);
  let goalIndex = -1;
  let bestIndex = startIndex;
  let bestDistance = distToTarget(startIndex);

  while (open.size > 0) {
    const current = open.pop();
    if (closed[current] === 1) continue;
    closed[current] = 1;
    const dist = distToTarget(current);
    if (
      dist < bestDistance - 1e-9 ||
      (Math.abs(dist - bestDistance) <= 1e-9 && g[current] < g[bestIndex])
    ) {
      bestDistance = dist;
      bestIndex = current;
    }
    if (dist <= goalRadius) {
      goalIndex = current;
      break;
    }
    const col = current % cols;
    const row = (current - col) / cols;
    for (const [dc, dr, cost] of NEIGHBOURS) {
      const nc = col + dc;
      const nr = row + dr;
      if (!grid.isFreeCell(nc, nr)) continue;
      // No corner cutting: a diagonal needs both orthogonal cells free.
      if (
        dc !== 0 &&
        dr !== 0 &&
        (!grid.isFreeCell(col + dc, row) || !grid.isFreeCell(col, row + dr))
      )
        continue;
      const ni = nr * cols + nc;
      if (closed[ni] === 1) continue;
      const tentative = g[current] + cost;
      if (tentative < g[ni]) {
        g[ni] = tentative;
        parent[ni] = current;
        open.push(tentative + heuristic(ni), ni);
      }
    }
  }

  const reached = goalIndex >= 0;
  const endIndex = reached ? goalIndex : bestIndex;
  const cells: GroundXZ[] = [];
  for (let i = endIndex; i !== -1; i = parent[i]) {
    cells.push(grid.centerOf(i % cols, Math.floor(i / cols)));
  }
  cells.reverse();
  // Exact start; exact end for a ground tap onto free ground, else the last cell's centre.
  let points: GroundXZ[] = [{ x: from.x, z: from.z }, ...cells];
  if (reached && stopWithin === 0 && grid.isFreeAt(to.x, to.z)) {
    points[points.length - 1] = { x: to.x, z: to.z };
  }
  if (options.smooth !== false) points = smoothPath(grid, points);
  const goal = points[points.length - 1];
  return {
    status: reached ? 'REACHED' : 'NEAREST',
    points,
    goal,
    goalDistance: Math.hypot(to.x - goal.x, to.z - goal.z),
    length: pathLength(points),
  };
}

/**
 * Every cell the child can walk to from `start`, on walking links only (the same 8-neighbour,
 * no-corner-cutting rule as `findWalkPath`). `reached[row * cols + col]` is 1 for a reachable
 * cell; all zeros when the start is walled in.
 */
export function floodReachable(grid: WalkGrid, start: GroundXZ): Uint8Array {
  const { cols, rows } = grid;
  const reached = new Uint8Array(cols * rows);
  const startCell = nearestFreeCell(grid, start.x, start.z);
  if (!startCell) return reached;
  const queue = new Int32Array(cols * rows);
  let head = 0;
  let tail = 0;
  const first = startCell.row * cols + startCell.col;
  reached[first] = 1;
  queue[tail] = first;
  tail += 1;
  while (head < tail) {
    const current = queue[head];
    head += 1;
    const col = current % cols;
    const row = (current - col) / cols;
    for (const [dc, dr] of NEIGHBOURS) {
      const nc = col + dc;
      const nr = row + dr;
      if (!grid.isFreeCell(nc, nr)) continue;
      if (
        dc !== 0 &&
        dr !== 0 &&
        (!grid.isFreeCell(col + dc, row) || !grid.isFreeCell(col, row + dr))
      )
        continue;
      const ni = nr * cols + nc;
      if (reached[ni] === 1) continue;
      reached[ni] = 1;
      queue[tail] = ni;
      tail += 1;
    }
  }
  return reached;
}
