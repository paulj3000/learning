import { BoxGeometry, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ScenerySpec } from './locationManifest';

/**
 * Static decor boxes, batched (WS-C rendering optimisation).
 *
 * A `BOX` scenery item flagged `static` is solid-colour decor nothing will
 * ever move, recolour or hide at runtime. Drawing each as its own mesh with
 * its own material cost one draw call and one material apiece. Instead the
 * engine merges every static box of one colour inside one spatial cell into
 * a single mesh with a shared material. The cell keeps frustum culling
 * useful: a merged mesh spanning the whole castle could never be culled.
 *
 * Pure geometry and counting only, so the draw-call estimator and the
 * engine agree by construction (they call the same grouping function).
 */

/** Edge of a batching cell, metres. Boxes batch by the cell holding their centre. */
export const STATIC_BOX_CELL_METERS = 12;

export type StaticBoxSpec = Extract<ScenerySpec, { kind: 'BOX' }>;

export function isStaticBox(item: ScenerySpec): item is StaticBoxSpec {
  return item.kind === 'BOX' && item.static === true;
}

export function staticBoxBatchKey(item: StaticBoxSpec): string {
  const cx = Math.floor((item.area.minX + item.area.maxX) / 2 / STATIC_BOX_CELL_METERS);
  const cz = Math.floor((item.area.minZ + item.area.maxZ) / 2 / STATIC_BOX_CELL_METERS);
  return `${item.color}:${cx}:${cz}`;
}

/** Static boxes grouped into the batches the engine will draw, in first-seen order. */
export function groupStaticBoxes(
  scenery: readonly ScenerySpec[],
): ReadonlyMap<string, readonly StaticBoxSpec[]> {
  const groups = new Map<string, StaticBoxSpec[]>();
  for (const item of scenery) {
    if (!isStaticBox(item)) continue;
    const key = staticBoxBatchKey(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

/** The draw calls a scenery list costs for its `BOX` items: one per batch, one per unbatched box. */
export function countBoxDrawCalls(scenery: readonly ScenerySpec[]): number {
  const unbatched = scenery.filter((item) => item.kind === 'BOX' && !item.static).length;
  return unbatched + groupStaticBoxes(scenery).size;
}

/** One geometry holding every box of a batch, already placed in world space. */
export function mergeStaticBoxGeometry(boxes: readonly StaticBoxSpec[]): BufferGeometry | null {
  const parts = boxes.map((item) => {
    const width = item.area.maxX - item.area.minX;
    const depth = item.area.maxZ - item.area.minZ;
    const height = item.maxY - item.minY;
    const geometry = new BoxGeometry(width, height, depth);
    geometry.translate(
      item.area.minX + width / 2,
      item.minY + height / 2,
      item.area.minZ + depth / 2,
    );
    return geometry;
  });
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged;
}
