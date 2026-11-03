import { describe, expect, it, vi } from 'vitest';
import { Mesh, MeshStandardMaterial, PointLight, Points, type Texture } from 'three';
import { mount as mountEngine } from '../testing/engineHarness';
import { WELCOME_HARBOR_MANIFEST } from '../manifests/welcomeHarbor';
import type { LightSpec, ThreeLocationManifest } from '../locationManifest';
import { validateLocationManifest } from '../validateLocationManifest';
import { SOURCE_MANIFEST_REGISTRIES } from '../sourceManifestRegistries';
import { RENDER_QUALITY_PRESETS } from './renderQuality';

/**
 * The SC-R02-01 visual system inside the real location runtime: surfaces,
 * shared material presets, motes, light budgets, reduced motion, disposal,
 * and the promise that a quality tier never changes gameplay.
 */

const area = (id: string, minX: number, maxX: number, minZ: number, maxZ: number) => ({
  id,
  minX,
  maxX,
  minZ,
  maxZ,
});

const MANY_LIGHTS: LightSpec[] = Array.from({ length: 18 }, (_, index) => ({
  id: `test-light-${index}`,
  kind: 'POINT',
  position: { x: index - 9, y: 2.5, z: 0 },
  color: 0xffe0b0,
  intensity: 2,
  priority: index < 2 ? 10 : 0,
}));

function visualManifest(): ThreeLocationManifest {
  return {
    ...WELCOME_HARBOR_MANIFEST,
    lights: MANY_LIGHTS,
    materials: [
      { id: 'test-flagstone', pattern: 'FLAGSTONE', baseColor: 0xb59a7a, metersPerRepeat: 2 },
      { id: 'test-plaster', pattern: 'PLASTER', baseColor: 0xe8d8bc, metersPerRepeat: 3 },
    ],
    surfaces: [
      {
        id: 'test-floor',
        materialId: 'test-flagstone',
        faces: [
          { kind: 'FLOOR', area: area('test-floor:a', -4, 0, -4, 0), y: 0.01 },
          { kind: 'FLOOR', area: area('test-floor:b', 0, 4, -4, 0), y: 0.01 },
        ],
      },
      {
        id: 'test-wall',
        materialId: 'test-plaster',
        faces: [{ kind: 'WALL', area: area('test-wall:a', -4, 4, -4.25, -4), minY: 0, maxY: 3 }],
      },
      {
        id: 'test-gated',
        materialId: 'test-plaster',
        requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: 'NEVER_HAPPENS' }],
        faces: [{ kind: 'FLOOR', area: area('test-gated:a', 6, 8, 6, 8), y: 0 }],
      },
    ],
    effects: [
      {
        kind: 'MOTES',
        id: 'test-dust',
        area: area('test-dust:area', -4, 4, -4, 0),
        minY: 0.5,
        maxY: 2.5,
        color: 0xfff0c0,
        count: 30,
      },
    ],
  };
}

/** Mounts and renders one frame, which is what the harness reads its scene from. */
function mount(options: Parameters<typeof mountEngine>[0]) {
  const harness = mountEngine(options);
  harness.runFrames(1);
  return harness;
}

/** A procedural surface texture's width (a `DataTexture`'s image is `{ data, width, height }`). */
function textureWidthOf(material: MeshStandardMaterial): number | undefined {
  return (material.map?.image as { width?: number } | undefined)?.width;
}

function surfaceMeshes(harness: ReturnType<typeof mount>): Mesh[] {
  const found: Mesh[] = [];
  harness.scene().traverse((object) => {
    if (object instanceof Mesh && object.name.startsWith('surface:')) found.push(object);
  });
  return found;
}

function countOf<T>(harness: ReturnType<typeof mount>, type: new (...args: never[]) => T): number {
  let total = 0;
  harness.scene().traverse((object) => {
    if (object instanceof type) total += 1;
  });
  return total;
}

describe('visual system in the location runtime', () => {
  it('validates as a manifest, and a dangling preset or bad face is reported', () => {
    expect(validateLocationManifest(visualManifest(), SOURCE_MANIFEST_REGISTRIES)).toEqual([]);
    const broken: ThreeLocationManifest = {
      ...visualManifest(),
      materials: [{ id: 'x', pattern: 'NOPE' as never, baseColor: -1, metersPerRepeat: 0 }],
      surfaces: [
        {
          id: 'y',
          materialId: 'missing',
          faces: [{ kind: 'WALL', area: area('y:a', 1, 0, 0, 1), minY: 2, maxY: 1 }],
        },
      ],
      effects: [],
    };
    const paths = validateLocationManifest(broken, SOURCE_MANIFEST_REGISTRIES).map(
      (issue) => issue.path,
    );
    expect(paths).toEqual(
      expect.arrayContaining([
        'materials[0].pattern',
        'materials[0].baseColor',
        'materials[0].metersPerRepeat',
        'surfaces[0].materialId',
        'surfaces[0].faces[0].area',
        'surfaces[0].faces[0]',
      ]),
    );
  });

  it('builds one merged, textured mesh per surface, sharing a material per preset', () => {
    const harness = mount({ manifest: visualManifest(), quality: 'MEDIUM' });
    const meshes = surfaceMeshes(harness);
    expect(meshes.map((mesh) => mesh.name).sort()).toEqual([
      'surface:test-floor',
      'surface:test-wall',
    ]);
    const floor = meshes.find((mesh) => mesh.name === 'surface:test-floor');
    const material = floor?.material as MeshStandardMaterial;
    expect(textureWidthOf(material)).toBe(RENDER_QUALITY_PRESETS.MEDIUM.textureSize);
    // Two floor faces, one draw call.
    expect(floor?.geometry.getIndex()?.count).toBe(12);
  });

  it('leaves out a surface whose requirements do not hold', () => {
    const harness = mount({ manifest: visualManifest() });
    expect(surfaceMeshes(harness).map((mesh) => mesh.name)).not.toContain('surface:test-gated');
  });

  it('sizes textures by tier', () => {
    const textureWidth = (quality: 'LOW' | 'HIGH') => {
      const floor = surfaceMeshes(mount({ manifest: visualManifest(), quality })).find(
        (mesh) => mesh.name === 'surface:test-floor',
      );
      return floor ? textureWidthOf(floor.material as MeshStandardMaterial) : undefined;
    };
    expect(textureWidth('LOW')).toBe(64);
    expect(textureWidth('HIGH')).toBe(256);
  });

  it('caps placed lights by tier, keeping the high-priority ones', () => {
    const low = mount({ manifest: visualManifest(), quality: 'LOW' });
    expect(countOf(low, PointLight)).toBe(RENDER_QUALITY_PRESETS.LOW.maxPlacedLights);
    const names: string[] = [];
    low.scene().traverse((object) => {
      if (object instanceof PointLight) names.push(object.name);
    });
    expect(names).toEqual(expect.arrayContaining(['test-light-0', 'test-light-1']));
    expect(countOf(mount({ manifest: visualManifest(), quality: 'HIGH' }), PointLight)).toBe(18);
  });

  it('adds motes that drift, but not at LOW and not under reduced motion', () => {
    expect(countOf(mount({ manifest: visualManifest(), quality: 'LOW' }), Points)).toBe(0);

    const positionsOf = (harness: ReturnType<typeof mount>) => {
      let found: number[] = [];
      harness.scene().traverse((object) => {
        if (object instanceof Points) {
          found = Array.from(object.geometry.getAttribute('position').array as Float32Array);
        }
      });
      return found;
    };

    const moving = mount({ manifest: visualManifest(), quality: 'MEDIUM' });
    moving.runFrames(1);
    const before = positionsOf(moving);
    moving.runFrames(10, 50);
    expect(positionsOf(moving)).not.toEqual(before);

    const still = mount({ manifest: visualManifest(), quality: 'MEDIUM', reducedMotion: true });
    still.runFrames(1);
    const stillBefore = positionsOf(still);
    expect(stillBefore.length).toBeGreaterThan(0);
    still.runFrames(10, 50);
    expect(positionsOf(still)).toEqual(stillBefore);
  });

  it('disposes surface geometry, preset materials, textures and motes on unmount', async () => {
    const harness = mount({ manifest: visualManifest(), quality: 'MEDIUM' });
    await harness.engine.ready;
    const spies: ReturnType<typeof vi.fn>[] = [];
    harness.scene().traverse((object) => {
      if (object instanceof Mesh && object.name.startsWith('surface:')) {
        spies.push(vi.spyOn(object.geometry, 'dispose'));
        const material = object.material as MeshStandardMaterial;
        spies.push(vi.spyOn(material, 'dispose'));
        if (material.map) spies.push(vi.spyOn(material.map as Texture, 'dispose'));
      }
      if (object instanceof Points) {
        spies.push(vi.spyOn(object.geometry, 'dispose'));
      }
    });
    expect(spies.length).toBeGreaterThanOrEqual(5);
    harness.engine.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalled();
  });

  it('never changes gameplay: the same walk ends in the same place at every tier', () => {
    const endOfWalk = (quality: 'LOW' | 'MEDIUM' | 'HIGH') => {
      const harness = mount({ manifest: visualManifest(), quality });
      harness.setDrive((controller, delta) => {
        controller.position.x += 2 * delta;
        controller.position.z -= 1 * delta;
      });
      harness.runFrames(60, 16);
      return harness.camera().position.toArray();
    };
    const medium = endOfWalk('MEDIUM');
    expect(endOfWalk('LOW')).toEqual(medium);
    expect(endOfWalk('HIGH')).toEqual(medium);
  });
});
