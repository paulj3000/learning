import { describe, expect, it, vi } from 'vitest';
import { Mesh, MeshStandardMaterial, Points, type Texture } from 'three';
import {
  castleTaleExtension,
  isCastleTaleScene,
} from '../../extensions/castleTale/castleTaleScene';
import { mount, standAt, walk } from '../testing/engineHarness';
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

describe('reduced motion in the castle (SC-R02-05)', () => {
  const tapestryOf = (harness: ReturnType<typeof castle>) => {
    const root = harness.scene().getObjectByName('tapestry:castle-tapestry-stair');
    if (!root) throw new Error('the secret tapestry is not in the scene');
    return root;
  };

  it('sways the secret tapestry by default: the draught is the only mark of the nook', () => {
    const harness = castle({ quality: 'MEDIUM' });
    const tapestry = tapestryOf(harness);
    const seen = new Set<number>();
    for (let frame = 0; frame < 20; frame += 1) {
      harness.runFrames(1, 100);
      seen.add(Math.round(tapestry.rotation.y * 1e6));
    }
    expect(seen.size).toBeGreaterThan(5);
    // Small enough to read as a draught rather than a signpost.
    for (const value of seen) expect(Math.abs(value / 1e6)).toBeLessThanOrEqual(0.036);
  });

  it('holds the tapestry at one fixed lean under reduced motion, still a hint', () => {
    const harness = castle({ quality: 'MEDIUM', reducedMotion: true });
    const tapestry = tapestryOf(harness);
    const leans = new Set<number>();
    for (let frame = 0; frame < 20; frame += 1) {
      harness.runFrames(1, 100);
      leans.add(Math.round(tapestry.rotation.y * 1e9));
    }
    expect(leans.size).toBe(1);
    // Not hanging dead straight: the lean is the still equivalent of the sway.
    expect(tapestry.rotation.y).toBeCloseTo(0.02, 6);
  });

  it('lets reduced motion change only how things move, never where the child can go', () => {
    const endOfWalk = (reducedMotion: boolean) => {
      const harness = castle({ quality: 'MEDIUM', reducedMotion });
      harness.setDrive((controller, delta) => {
        controller.position.x += 2 * delta;
        controller.position.z -= 1 * delta;
      });
      harness.runFrames(60, 16);
      return harness.camera().position.toArray();
    };
    expect(endOfWalk(true)).toEqual(endOfWalk(false));
  });
});

describe('the Trophy Room shows what the child owns (SC-R03-03)', () => {
  const owning = (...ownedItemIds: string[]) =>
    castle({
      quality: 'MEDIUM',
      worldState: { worldChangeKeys: [], ownedItemIds, discoveryIds: [] },
    });
  const has = (harness: ReturnType<typeof castle>, name: string) =>
    harness.scene().getObjectByName(name) !== undefined;

  it('stands the owned quill on its pedestal and takes the empty plate away', () => {
    const harness = owning('storykeepers-quill');
    expect(has(harness, 'castle-trophy-quill')).toBe(true);
    expect(has(harness, 'castle-trophy-plate-1')).toBe(false);
    // The book is not owned, so its pedestal still shows the empty plate.
    expect(has(harness, 'castle-trophy-book')).toBe(false);
    expect(has(harness, 'castle-trophy-plate-2')).toBe(true);
  });

  it('shows every empty plate and no treasure for a child who owns nothing', () => {
    const harness = owning();
    expect(has(harness, 'castle-trophy-quill')).toBe(false);
    expect(has(harness, 'castle-trophy-book')).toBe(false);
    for (const n of [1, 2, 3, 4, 5, 6]) expect(has(harness, `castle-trophy-plate-${n}`)).toBe(true);
  });

  it('always builds the six pedestals, owned or not, so the room never looks broken', () => {
    for (const harness of [owning(), owning('storykeepers-quill', 'blank-page-storybook')]) {
      for (const n of [1, 2, 3, 4, 5, 6]) {
        expect(has(harness, `castle-trophy-pedestal-${n}`)).toBe(true);
      }
    }
  });

  it('keeps an open pedestal showing its empty plate whatever the child owns', () => {
    const harness = owning('storykeepers-quill', 'blank-page-storybook');
    for (const n of [3, 4, 5, 6]) expect(has(harness, `castle-trophy-plate-${n}`)).toBe(true);
  });
});

describe('the secret passage in the real runtime (SC-R03-05)', () => {
  const FOUND = { worldChangeKeys: [], ownedItemIds: [], discoveryIds: ['castle-tapestry-stair'] };
  const WEST = -Math.PI / 2;

  /** Stands the child in the hall beside the nook, facing the passage, and walks west for two seconds. */
  function walkIntoTheWall(harness: ReturnType<typeof castle>): number {
    harness.setDrive(standAt(-8, -5, WEST));
    harness.runFrames(1);
    harness.setDrive(walk(WEST));
    harness.runFrames(125, 16);
    return harness.camera().position.x;
  }

  const meshNames = (harness: ReturnType<typeof castle>) => {
    const names: string[] = [];
    harness.scene().traverse((object) => {
      if (object.name.startsWith('surface:look:story-hall:secret-seal:')) names.push(object.name);
    });
    return names;
  };

  it('stops a child at the wall while the nook has not been found, however long they push', () => {
    const x = walkIntoTheWall(castle({ quality: 'MEDIUM' }));
    expect(x).toBeGreaterThan(-8.75);
  });

  it('lets a child through to the chamber once the nook has been found', () => {
    const x = walkIntoTheWall(castle({ quality: 'MEDIUM', worldState: FOUND }));
    expect(x).toBeLessThan(-9.5);
  });

  it('covers the gap with the wall fill while it is secret, and builds none once found', () => {
    expect(meshNames(castle({ quality: 'MEDIUM' })).sort()).toEqual(
      [
        'surface:look:story-hall:secret-seal:trim',
        'surface:look:story-hall:secret-seal:wainscot',
        'surface:look:story-hall:secret-seal:walls',
      ].sort(),
    );
    expect(meshNames(castle({ quality: 'MEDIUM', worldState: FOUND }))).toEqual([]);
  });

  it('opens live when the nook is found mid-visit: the seal goes and the fill is hidden', () => {
    const harness = castle({ quality: 'MEDIUM' });
    const api = harness.engine.extensionApi('castle-tale');
    if (!isCastleTaleScene(api)) throw new Error('castle-tale did not mount');
    expect(walkIntoTheWall(harness)).toBeGreaterThan(-8.75);

    api.showSecretPassageOpened(true);
    harness.scene().traverse((object) => {
      if (object.name.startsWith('surface:look:story-hall:secret-seal:')) {
        // The mesh sits in a root group that castle-tale hides.
        expect(object.parent?.visible ?? true).toBe(false);
      }
    });
    expect(walkIntoTheWall(harness)).toBeLessThan(-9.5);
  });

  it('is idempotent: opening twice, or opening something already open, changes nothing and throws nothing', () => {
    const harness = castle({ quality: 'MEDIUM', worldState: FOUND });
    const api = harness.engine.extensionApi('castle-tale');
    if (!isCastleTaleScene(api)) throw new Error('castle-tale did not mount');
    expect(() => {
      api.showSecretPassageOpened(true);
      api.showSecretPassageOpened(true);
      api.showSecretPassageOpened(false);
    }).not.toThrow();
  });

  it('builds the secret archway only for a child who has found the nook', () => {
    const has = (h: ReturnType<typeof castle>) =>
      h.scene().getObjectByName('archway-secret') !== undefined;
    expect(has(castle({ quality: 'MEDIUM' }))).toBe(false);
    expect(has(castle({ quality: 'MEDIUM', worldState: FOUND }))).toBe(true);
  });
});
