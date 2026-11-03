import { describe, expect, it } from 'vitest';
import { CASTLE_ROOM_IDS, castleRoomAt } from '../../castleLayout';
import type { ScenerySpec, ThreeLocationManifest } from '../locationManifest';
import { countSurfaceQuads } from '../visual/surfaceGeometry';
import { RENDER_QUALITY_PRESETS } from '../visual/renderQuality';
import { STORYKEEPER_CASTLE_MANIFEST as MANIFEST } from './storykeeperCastle';

/**
 * The castle's static performance budgets (art direction section 7), as
 * tests: they are counted from the manifest, so growth is caught the moment
 * it is committed, long before a tablet is involved. **Every number here is
 * provisional.** None has been measured on target hardware; SC-R11-01's
 * profiling pass replaces them with measured values. A failing budget means
 * "decide" (merge decor, reuse a preset, or have the owner raise the
 * budget in the art direction document), never "edit the number here".
 */

/** The castle-tale extension draws these into prop roots: three portraits and three windows, plain and lit. */
const EXTENSION_VARIANT_DRAWS = 12;

/**
 * A heuristic draw-call estimate from the manifest, in the spirit of the art
 * direction's "estimated from instancing": one call per surface, per mote
 * emitter, per cluster, per placed model and per prop, NPC and collectible.
 * It is an estimate, not a measurement. Multi-part models cost more, and
 * the +12 covers the extension's variants.
 */
export function estimateDrawCalls(manifest: ThreeLocationManifest): number {
  let calls = (manifest.surfaces?.length ?? 0) + (manifest.effects?.length ?? 0);
  for (const item of manifest.scenery) {
    calls += item.kind === 'LOD_PLACEMENTS' ? item.positions.length : 1;
  }
  calls += manifest.props.length + manifest.npcs.length + manifest.collectibles.length;
  return calls + EXTENSION_VARIANT_DRAWS;
}

/**
 * Scenery allowances. The original eight rooms keep the art direction's
 * 160 as a **baseline** (it was set before the reboot and nothing here
 * raises it). A room added later gets its own explicit allowance, decided
 * when the room is designed, so a new area cannot quietly eat the old
 * rooms' headroom and the castle-wide limit grows only by what a new room
 * is allowed. The Secret Chamber's allowance is reserved now (SC-R03-05) and
 * only counts once the room exists.
 */
const SCENERY_BUDGETS: Readonly<Record<string, number>> = {
  original: 160,
  'trophy-room': 20,
  'secret-chamber': 24,
};

const ORIGINAL_ROOMS: ReadonlySet<string> = new Set(CASTLE_ROOM_IDS.slice(0, 8));

function anchorOf(item: ScenerySpec): { x: number; z: number } {
  switch (item.kind) {
    case 'MODEL':
      return item.position;
    case 'BOX':
      return { x: (item.area.minX + item.area.maxX) / 2, z: (item.area.minZ + item.area.maxZ) / 2 };
    case 'CLUSTER':
    case 'LOD_PLACEMENTS':
      return item.positions[0] ?? { x: Number.NaN, z: Number.NaN };
    default:
      return { x: Number.NaN, z: Number.NaN };
  }
}

/** Scenery counted by the room it stands in; anything outside a room counts against the original pool. */
function sceneryByRoom(scenery: readonly ScenerySpec[]): Record<string, number> {
  const counts: Record<string, number> = { original: 0 };
  for (const item of scenery) {
    const { x, z } = anchorOf(item);
    const room = castleRoomAt(x, z)?.id;
    const key = room && !ORIGINAL_ROOMS.has(room) ? room : 'original';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

const BOX_TRIANGLES = 12; // six faces, two triangles each

describe('castle static budgets (provisional, SC-R02-08)', () => {
  it('keeps distinct material presets at or under 16', () => {
    expect(MANIFEST.materials?.length ?? 0).toBeLessThanOrEqual(16);
  });

  it('holds the original eight rooms to the 160 baseline, and each later room to its own allowance', () => {
    const counts = sceneryByRoom(MANIFEST.scenery);
    expect(counts.original).toBeLessThanOrEqual(SCENERY_BUDGETS.original);
    for (const [room, allowance] of Object.entries(SCENERY_BUDGETS)) {
      if (room === 'original') continue;
      expect(
        counts[room] ?? 0,
        `${room} is over its allowance of ${allowance}`,
      ).toBeLessThanOrEqual(allowance);
    }
  });

  it('keeps the whole castle at or under the sum of the allowances of the rooms it has', () => {
    const rooms = new Set<string>(CASTLE_ROOM_IDS);
    const allowed = Object.entries(SCENERY_BUDGETS)
      .filter(([room]) => room === 'original' || rooms.has(room))
      .reduce((sum, [, allowance]) => sum + allowance, 0);
    expect(MANIFEST.scenery.length).toBeLessThanOrEqual(allowed);
  });

  it('keeps the estimated draw calls at or under 300', () => {
    expect(estimateDrawCalls(MANIFEST)).toBeLessThanOrEqual(300);
  });

  it('keeps placed lights inside the MEDIUM tier budget', () => {
    expect(MANIFEST.lights?.length ?? 0).toBeLessThanOrEqual(
      RENDER_QUALITY_PRESETS.MEDIUM.maxPlacedLights,
    );
  });

  it('keeps each mote emitter useful at MEDIUM and the total particle count small', () => {
    const cap = RENDER_QUALITY_PRESETS.MEDIUM.maxMotesPerEffect;
    const emitters = MANIFEST.effects ?? [];
    for (const effect of emitters) expect(effect.count, effect.id).toBeLessThanOrEqual(cap);
    const total = emitters.reduce((sum, effect) => sum + Math.min(effect.count, cap), 0);
    expect(total).toBeLessThanOrEqual(250);
  });

  it('keeps procedural texture memory small at the HIGH tier, mipmaps included', () => {
    const size = RENDER_QUALITY_PRESETS.HIGH.textureSize;
    const patterned = (MANIFEST.materials ?? []).filter((preset) => preset.pattern !== 'PLAIN');
    const bytes = patterned.length * size * size * 4 * (4 / 3);
    expect(bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  });

  it('gives every patterned preset its own seed, so no two paint the same texture', () => {
    const patterned = (MANIFEST.materials ?? []).filter((preset) => preset.pattern !== 'PLAIN');
    const keys = patterned.map((preset) => `${preset.pattern}:${preset.seed ?? 1}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps the triangles the runtime builds itself at or under 6000', () => {
    const surfaceTriangles = (MANIFEST.surfaces ?? []).reduce(
      (sum, surface) => sum + countSurfaceQuads(surface.faces) * 2,
      0,
    );
    const boxTriangles =
      MANIFEST.scenery.filter((item) => item.kind === 'BOX').length * BOX_TRIANGLES;
    expect(surfaceTriangles + boxTriangles).toBeLessThanOrEqual(6000);
  });

  it('keeps the serialised manifest small enough to ship in the bundle', () => {
    expect(JSON.stringify(MANIFEST).length).toBeLessThanOrEqual(250 * 1024);
  });

  it('would catch growth: a doubled scenery list breaks the scenery budget', () => {
    const doubled = { ...MANIFEST, scenery: [...MANIFEST.scenery, ...MANIFEST.scenery] };
    expect(sceneryByRoom(doubled.scenery).original).toBeGreaterThan(SCENERY_BUDGETS.original);
    expect(estimateDrawCalls(doubled)).toBeGreaterThan(estimateDrawCalls(MANIFEST));
  });
});
