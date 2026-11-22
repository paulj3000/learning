import { describe, expect, it } from 'vitest';
import { Fog, Scene, Vector3, type BufferAttribute } from 'three';
import {
  applyFog,
  createPrecipitation,
  createSkyRibbon,
  MAX_SKY_RIBBONS,
  PRECIPITATION_BOX,
  precipitationCountFor,
  readAtmosphere,
  readFog,
  readPrecipitation,
  readSkyRibbons,
} from './atmosphere';

const RIBBON = {
  id: 'a',
  colors: [0x5ec8b0, 0x8a6fee],
  x: 0,
  y: 60,
  z: -140,
  width: 220,
  height: 30,
};

describe('fog', () => {
  it('accepts 0 < near < far <= 1000 only', () => {
    expect(readFog({ color: 0xdde8f5, near: 40, far: 170 })).toEqual({
      color: 0xdde8f5,
      near: 40,
      far: 170,
    });
    for (const bad of [
      { color: 1, near: 0, far: 10 },
      { color: 1, near: 50, far: 50 },
      { color: 1, near: 60, far: 50 },
      { color: 1, near: 1, far: 1001 },
      { color: -1, near: 1, far: 10 },
      { color: 1, near: 'x', far: 10 },
    ]) {
      expect(readFog(bad)).toBeUndefined();
    }
  });

  it('is linear fog on the scene, and nothing when absent', () => {
    const scene = new Scene();
    applyFog(scene, undefined);
    expect(scene.fog).toBeNull();
    applyFog(scene, { color: 0xffffff, near: 10, far: 100 });
    expect(scene.fog).toBeInstanceOf(Fog);
    expect((scene.fog as Fog).near).toBe(10);
  });
});

describe('precipitation', () => {
  it('ignores unknown kinds and clamps density', () => {
    expect(readPrecipitation({ kind: 'RAIN', density: 0.5 })).toBeUndefined();
    expect(readPrecipitation({ kind: 'SNOW', density: 3 })).toEqual({ kind: 'SNOW', density: 1 });
    expect(readPrecipitation({ kind: 'SNOW', density: -1 })).toEqual({ kind: 'SNOW', density: 0 });
  });

  it('scales the tier budget by density, and halves it for reduced motion', () => {
    const spec = { density: 1 };
    expect(precipitationCountFor(spec, 'LOW', false)).toBe(0);
    expect(precipitationCountFor(spec, 'MEDIUM', false)).toBe(600);
    expect(precipitationCountFor(spec, 'HIGH', false)).toBe(1200);
    expect(precipitationCountFor({ density: 0.5 }, 'HIGH', false)).toBe(600);
    expect(precipitationCountFor(spec, 'HIGH', true)).toBe(600);
    expect(createPrecipitation({ kind: 'SNOW', density: 1 }, 'LOW', false)).toBeNull();
    expect(createPrecipitation({ kind: 'SNOW', density: 0 }, 'HIGH', false)).toBeNull();
  });

  it('is one Points that follows the camera, wraps inside its box, and disposes', () => {
    const snow = createPrecipitation({ kind: 'SNOW', density: 1 }, 'MEDIUM', false);
    if (!snow) throw new Error('expected snow');
    expect(snow.count).toBe(600);
    let disposed = 0;
    snow.points.geometry.addEventListener('dispose', () => (disposed += 1));
    const camera = new Vector3(5, 2, -7);
    for (let frame = 0; frame < 600; frame += 1) snow.update(1 / 30, camera);
    expect(snow.points.position.toArray()).toEqual([5, 2, -7]);
    const positions = snow.points.geometry.getAttribute('position') as BufferAttribute;
    for (let index = 0; index < snow.count; index += 1) {
      expect(Math.abs(positions.getY(index))).toBeLessThanOrEqual(PRECIPITATION_BOX.height / 2);
      expect(Math.abs(positions.getX(index))).toBeLessThanOrEqual(
        PRECIPITATION_BOX.width / 2 + 0.5,
      );
    }
    snow.dispose();
    expect(disposed).toBe(1);
  });

  it('falls slower and does not sway under reduced motion', () => {
    const fallen = (reduced: boolean) => {
      const snow = createPrecipitation({ kind: 'SNOW', density: 1 }, 'HIGH', reduced, 3);
      if (!snow) throw new Error('expected snow');
      const attribute = snow.points.geometry.getAttribute('position') as BufferAttribute;
      const before = [attribute.getX(0), attribute.getY(0)];
      snow.update(0.1, new Vector3());
      return { dx: attribute.getX(0) - before[0], dy: before[1] - attribute.getY(0) };
    };
    const normal = fallen(false);
    const still = fallen(true);
    expect(still.dx).toBe(0);
    expect(still.dy).toBeLessThan(normal.dy);
  });
});

describe('sky ribbons', () => {
  it('keeps at most four valid, uniquely named ribbons', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ ...RIBBON, id: `r${i}` }));
    expect(readSkyRibbons(many)).toHaveLength(MAX_SKY_RIBBONS);
    expect(readSkyRibbons([RIBBON, RIBBON])).toHaveLength(1);
    expect(
      readSkyRibbons([
        { ...RIBBON, colors: [1] },
        { ...RIBBON, width: 0 },
      ]),
    ).toEqual([]);
  });

  it('draws nothing at LOW and a still additive plane otherwise', () => {
    const spec = readSkyRibbons([RIBBON])[0];
    expect(createSkyRibbon(spec, 'LOW')).toBeNull();
    const ribbon = createSkyRibbon(spec, 'MEDIUM');
    if (!ribbon) throw new Error('expected a ribbon');
    expect(ribbon.mesh.position.toArray()).toEqual([0, 60, -140]);
    ribbon.setTime(5);
    expect(
      (ribbon.mesh.material as unknown as { uniforms: { uTime: { value: number } } }).uniforms.uTime
        .value,
    ).toBe(5);
    ribbon.dispose();
  });
});

describe('readAtmosphere', () => {
  it('is undefined when nothing usable is authored', () => {
    expect(readAtmosphere(undefined)).toBeUndefined();
    expect(readAtmosphere({ precipitation: { kind: 'HAIL', density: 1 } })).toBeUndefined();
  });
  it('keeps the valid parts', () => {
    expect(
      readAtmosphere({ fog: { color: 1, near: 2, far: 3 }, skyRibbons: [RIBBON] }),
    ).toMatchObject({ fog: { far: 3 }, skyRibbons: [{ id: 'a' }] });
  });
});
