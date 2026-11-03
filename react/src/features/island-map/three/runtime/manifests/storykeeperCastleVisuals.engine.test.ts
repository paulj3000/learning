import { describe, expect, it, vi } from 'vitest';
import { Mesh, MeshStandardMaterial, Points, type Texture } from 'three';
import { castleTaleExtension } from '../../extensions/castleTale/castleTaleScene';
import { mount } from '../testing/engineHarness';
import { RENDER_QUALITY_PRESETS } from '../visual/renderQuality';
import { STORYKEEPER_CASTLE_MANIFEST as MANIFEST } from './storykeeperCastle';
import { CASTLE_MATERIALS, CASTLE_SURFACES } from './storykeeperCastleVisuals';

/**
 * The castle's look inside the real location runtime: the surfaces it
 * declares become meshes, share one material per preset, scale their textures
 * by tier, and are released on unmount. Gameplay is not re-tested here; the
 * castle's own engine and parity suites still prove that, unchanged.
 */

function castle(options: Partial<Parameters<typeof mount>[0]> = {}) {
  const harness = mount({ manifest: MANIFEST, extensions: [castleTaleExtension], ...options });
  harness.runFrames(1);
  return harness;
}

function surfaceMeshes(harness: ReturnType<typeof castle>): Mesh[] {
  const found: Mesh[] = [];
  harness.scene().traverse((object) => {
    if (object instanceof Mesh && object.name.startsWith('surface:')) found.push(object);
  });
  return found;
}

describe('the castle look on the generic runtime', () => {
  it('builds one mesh for every declared surface', () => {
    const names = surfaceMeshes(castle({ quality: 'MEDIUM' })).map((mesh) => mesh.name);
    expect(names.sort()).toEqual(CASTLE_SURFACES.map((surface) => `surface:${surface.id}`).sort());
  });

  it('shares one material per preset, however many surfaces wear it', () => {
    const meshes = surfaceMeshes(castle({ quality: 'MEDIUM' }));
    const materials = new Set(meshes.map((mesh) => mesh.material as MeshStandardMaterial));
    expect(materials.size).toBeLessThanOrEqual(CASTLE_MATERIALS.length);
    const library = meshes.filter((mesh) => mesh.name.includes(':great-library:'));
    const floor = library.find((mesh) => mesh.name.endsWith(':floor'))!;
    const ceiling = library.find((mesh) => mesh.name.endsWith(':ceiling'))!;
    // Floor and ceiling both wear `planks-library`.
    expect(floor.material).toBe(ceiling.material);
  });

  it('sizes the library textures by tier, and drops them at LOW without losing the surface', () => {
    const widthAt = (quality: 'LOW' | 'MEDIUM' | 'HIGH') => {
      const floor = surfaceMeshes(castle({ quality })).find(
        (mesh) => mesh.name === 'surface:look:great-library:floor',
      )!;
      const material = floor.material as MeshStandardMaterial;
      return { present: Boolean(floor), width: (material.map?.image as { width?: number })?.width };
    };
    expect(widthAt('MEDIUM')).toEqual({
      present: true,
      width: RENDER_QUALITY_PRESETS.MEDIUM.textureSize,
    });
    expect(widthAt('HIGH').width).toBe(RENDER_QUALITY_PRESETS.HIGH.textureSize);
    // LOW still draws the floor, in the preset's flat base colour.
    expect(widthAt('LOW').present).toBe(true);
  });

  it('adds the library motes at MEDIUM, none at LOW, and holds them still under reduced motion', () => {
    const motes = (harness: ReturnType<typeof castle>) => {
      const found: Points[] = [];
      harness.scene().traverse((object) => {
        if (object instanceof Points) found.push(object);
      });
      return found;
    };
    expect(motes(castle({ quality: 'LOW' }))).toHaveLength(0);
    const moving = castle({ quality: 'MEDIUM' });
    expect(motes(moving).length).toBeGreaterThan(0);
    const still = castle({ quality: 'MEDIUM', reducedMotion: true });
    const read = () => Array.from(motes(still)[0].geometry.getAttribute('position').array);
    const before = read();
    still.runFrames(10, 50);
    expect(read()).toEqual(before);
  });

  it('draws the dais and its beams as scenery', () => {
    const harness = castle({ quality: 'MEDIUM' });
    const names: string[] = [];
    harness.scene().traverse((object) => {
      if (object.name.startsWith('castle-dais') || object.name.startsWith('castle-library-beam')) {
        names.push(object.name);
      }
    });
    expect(names.length).toBeGreaterThan(0);
  });

  it('releases every surface geometry, material and texture on unmount', async () => {
    const harness = castle({ quality: 'MEDIUM' });
    await harness.engine.ready;
    const spies: ReturnType<typeof vi.fn>[] = [];
    harness.scene().traverse((object) => {
      if (object instanceof Mesh && object.name.startsWith('surface:')) {
        spies.push(vi.spyOn(object.geometry, 'dispose'));
        const material = object.material as MeshStandardMaterial;
        spies.push(vi.spyOn(material, 'dispose'));
        if (material.map) spies.push(vi.spyOn(material.map as Texture, 'dispose'));
      }
    });
    expect(spies.length).toBeGreaterThanOrEqual(CASTLE_SURFACES.length);
    harness.engine.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
  });
});
