import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { SurfaceFace, WallSide } from '../locationManifest';

/**
 * Builds a manifest `SurfaceSpec`'s faces into one merged, indexed geometry
 * with world-scaled UVs: a UV of 1 is `metersPerRepeat` metres of world, so
 * one material's texture lands at the same size on a 2 m corridor wall and
 * a 12 m hall floor. That is what the castle's scaled slabs could not do -
 * an instanced 4 m slab stretched to a 12 m room stretches its texture with
 * it.
 *
 * Every quad is single-sided and wound counter-clockwise as seen from its
 * normal: floors face up, ceilings down, and a wall box shows each side to
 * the room it faces.
 */

type Vec = readonly [number, number, number];

interface Quad {
  origin: Vec;
  /** The two edges, ordered so `edgeA × edgeB` is the face normal. */
  edgeA: Vec;
  edgeB: Vec;
  normal: Vec;
  /** Which two world axes become (u, v). */
  uvAxes: readonly [0 | 1 | 2, 0 | 1 | 2];
}

const ALL_SIDES: readonly WallSide[] = ['north', 'south', 'east', 'west'];

function faceQuads(face: SurfaceFace): Quad[] {
  const { minX, maxX, minZ, maxZ } = face.area;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  if (face.kind !== 'WALL') {
    if (width <= 0 || depth <= 0) return [];
    const floor = face.kind === 'FLOOR';
    return [
      {
        origin: [minX, face.y, minZ],
        // Floors face up (z × x = +y), ceilings down (x × z = -y).
        edgeA: floor ? [0, 0, depth] : [width, 0, 0],
        edgeB: floor ? [width, 0, 0] : [0, 0, depth],
        normal: floor ? [0, 1, 0] : [0, -1, 0],
        uvAxes: [0, 2],
      },
    ];
  }
  const height = face.maxY - face.minY;
  if (height <= 0) return [];
  const sides = face.sides ?? ALL_SIDES;
  const quads: Quad[] = [];
  for (const side of sides) {
    switch (side) {
      case 'north':
        if (width > 0)
          quads.push({
            origin: [minX, face.minY, maxZ],
            edgeA: [width, 0, 0],
            edgeB: [0, height, 0],
            normal: [0, 0, 1],
            uvAxes: [0, 1],
          });
        break;
      case 'south':
        if (width > 0)
          quads.push({
            origin: [minX, face.minY, minZ],
            edgeA: [0, height, 0],
            edgeB: [width, 0, 0],
            normal: [0, 0, -1],
            uvAxes: [0, 1],
          });
        break;
      case 'east':
        if (depth > 0)
          quads.push({
            origin: [maxX, face.minY, minZ],
            edgeA: [0, height, 0],
            edgeB: [0, 0, depth],
            normal: [1, 0, 0],
            uvAxes: [2, 1],
          });
        break;
      case 'west':
        if (depth > 0)
          quads.push({
            origin: [minX, face.minY, minZ],
            edgeA: [0, 0, depth],
            edgeB: [0, height, 0],
            normal: [-1, 0, 0],
            uvAxes: [2, 1],
          });
        break;
    }
  }
  return quads;
}

/** The number of quads `faces` produce, without building anything (for budgets). */
export function countSurfaceQuads(faces: readonly SurfaceFace[]): number {
  return faces.reduce((total, face) => total + faceQuads(face).length, 0);
}

/**
 * One geometry for every face, with `position`, `normal` and `uv`
 * attributes and an index. An empty geometry (no attributes) when every face
 * is degenerate, which the caller treats as nothing to draw.
 */
export function buildSurfaceGeometry(
  faces: readonly SurfaceFace[],
  metersPerRepeat: number,
): BufferGeometry {
  if (!(metersPerRepeat > 0)) throw new Error('metersPerRepeat must be positive');
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const face of faces) {
    for (const quad of faceQuads(face)) {
      const start = positions.length / 3;
      const corners: Vec[] = [
        quad.origin,
        add(quad.origin, quad.edgeA),
        add(add(quad.origin, quad.edgeA), quad.edgeB),
        add(quad.origin, quad.edgeB),
      ];
      for (const corner of corners) {
        positions.push(...corner);
        normals.push(...quad.normal);
        uvs.push(
          corner[quad.uvAxes[0]] / metersPerRepeat,
          corner[quad.uvAxes[1]] / metersPerRepeat,
        );
      }
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  }
  const geometry = new BufferGeometry();
  if (positions.length === 0) return geometry;
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function add(a: Vec, b: Vec): Vec {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
