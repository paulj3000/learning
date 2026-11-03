import { describe, expect, it } from 'vitest';
import type { ThreeLocationManifest } from '../locationManifest';
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

const BOX_TRIANGLES = 12; // six faces, two triangles each

describe('castle static budgets (provisional, SC-R02-08)', () => {
  it('keeps distinct material presets at or under 16', () => {
    expect(MANIFEST.materials?.length ?? 0).toBeLessThanOrEqual(16);
  });

  it('keeps scenery items at or under 160', () => {
    expect(MANIFEST.scenery.length).toBeLessThanOrEqual(160);
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
    expect(doubled.scenery.length).toBeGreaterThan(160);
    expect(estimateDrawCalls(doubled)).toBeGreaterThan(estimateDrawCalls(MANIFEST));
  });
});
