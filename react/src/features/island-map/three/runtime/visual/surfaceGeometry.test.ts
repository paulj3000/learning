import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { buildSurfaceGeometry, countSurfaceQuads } from './surfaceGeometry';
import type { SurfaceFace } from '../locationManifest';

const area = (minX: number, maxX: number, minZ: number, maxZ: number) => ({
  id: 'a',
  minX,
  maxX,
  minZ,
  maxZ,
});

/** Each triangle's geometric normal, from its winding. */
function windingNormals(faces: readonly SurfaceFace[]): { winding: Vector3; normal: Vector3 }[] {
  const geometry = buildSurfaceGeometry(faces, 2);
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const index = geometry.getIndex();
  if (!index) throw new Error('expected an index');
  const out: { winding: Vector3; normal: Vector3 }[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const [a, b, c] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)].map((vertex) =>
      new Vector3().fromBufferAttribute(position, vertex),
    );
    out.push({
      winding: new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize(),
      normal: new Vector3().fromBufferAttribute(normal, index.getX(i)),
    });
  }
  return out;
}

describe('buildSurfaceGeometry', () => {
  it('winds every triangle counter-clockwise as seen from its normal', () => {
    const faces: SurfaceFace[] = [
      { kind: 'FLOOR', area: area(0, 4, 0, 3), y: 0 },
      { kind: 'CEILING', area: area(0, 4, 0, 3), y: 3 },
      { kind: 'WALL', area: area(0, 4, 0, 0.5), minY: 0, maxY: 3 },
    ];
    for (const { winding, normal } of windingNormals(faces)) {
      expect(winding.dot(normal)).toBeCloseTo(1, 5);
    }
  });

  it('points floors up, ceilings down, and wall sides outward', () => {
    const normals = (face: SurfaceFace) =>
      windingNormals([face]).map(({ normal }) => normal.toArray().map((n) => Math.round(n)));
    expect(normals({ kind: 'FLOOR', area: area(0, 1, 0, 1), y: 0 })[0]).toEqual([0, 1, 0]);
    expect(normals({ kind: 'CEILING', area: area(0, 1, 0, 1), y: 3 })[0]).toEqual([0, -1, 0]);
    const wall = normals({ kind: 'WALL', area: area(0, 1, 0, 1), minY: 0, maxY: 3 });
    expect(new Set(wall.map((n) => n.join(',')))).toEqual(
      new Set(['0,0,1', '0,0,-1', '1,0,0', '-1,0,0']),
    );
  });

  it('scales UVs by world metres, so a texel is one size in every room', () => {
    const small = buildSurfaceGeometry([{ kind: 'FLOOR', area: area(0, 2, 0, 2), y: 0 }], 2);
    const large = buildSurfaceGeometry([{ kind: 'FLOOR', area: area(0, 12, 0, 6), y: 0 }], 2);
    const span = (geometry: ReturnType<typeof buildSurfaceGeometry>) => {
      const uv = geometry.getAttribute('uv');
      const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i));
      const vs = Array.from({ length: uv.count }, (_, i) => uv.getY(i));
      return [Math.max(...us) - Math.min(...us), Math.max(...vs) - Math.min(...vs)];
    };
    expect(span(small)).toEqual([1, 1]);
    expect(span(large)).toEqual([6, 3]);
  });

  it('builds only the wall sides asked for, and nothing for degenerate faces', () => {
    expect(
      countSurfaceQuads([
        { kind: 'WALL', area: area(0, 1, 0, 1), minY: 0, maxY: 3, sides: ['north'] },
        { kind: 'WALL', area: area(0, 1, 0, 1), minY: 2, maxY: 2 },
      ]),
    ).toBe(1);
    expect(buildSurfaceGeometry([], 1).getAttribute('position')).toBeUndefined();
  });

  it('merges every face into one geometry with a quad per face side', () => {
    const geometry = buildSurfaceGeometry(
      [
        { kind: 'FLOOR', area: area(0, 4, 0, 4), y: 0 },
        { kind: 'WALL', area: area(0, 4, 0, 0.5), minY: 0, maxY: 3 },
      ],
      1,
    );
    expect(geometry.getAttribute('position').count).toBe(5 * 4);
    expect(geometry.getIndex()?.count).toBe(5 * 6);
  });

  it('rejects a non-positive repeat', () => {
    expect(() => buildSurfaceGeometry([], 0)).toThrow();
  });
});
