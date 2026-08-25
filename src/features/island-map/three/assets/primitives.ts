/**
 * Pure vertex-math primitive builders for `docs/ROADMAP.md` Phase 34 (3D
 * Art and Asset Pipeline). No `three` import - the same math `BoxGeometry`/
 * `ConeGeometry`/`CylinderGeometry`/`TorusGeometry`/`PlaneGeometry` use
 * internally (ported from `three/src/geometries/*.js`), so
 * `scripts/generate-world-assets.ts` and `gltfAssembler.ts` can run
 * anywhere (Node, jsdom, browser) with no rendering context.
 *
 * Every solid (box/cone/cylinder) and the vertical plane use the
 * ground-pivot convention from `docs/THREE_WORLD_ASSET_CONVENTIONS.md`:
 * the shape's local origin sits at its base center (y=0 at the bottom, not
 * the middle), so placement code sets `position.y = 0` for anything
 * standing on the ground instead of computing a half-height offset. The
 * horizontal ground plane and the flat-lying torus are already at y=0 by
 * construction.
 */

export interface PrimitiveMesh {
  positions: number[];
  normals: number[];
  indices: number[];
}

function emptyMesh(): PrimitiveMesh {
  return { positions: [], normals: [], indices: [] };
}

function shiftY(mesh: PrimitiveMesh, deltaY: number): PrimitiveMesh {
  for (let i = 1; i < mesh.positions.length; i += 3) {
    mesh.positions[i] += deltaY;
  }
  return mesh;
}

type Axis = 'x' | 'y' | 'z';
type Vec3Record = Record<Axis, number>;

/** One quad face of a box, ported from `BoxGeometry.js`'s internal `buildPlane`. */
function buildBoxFace(
  mesh: PrimitiveMesh,
  u: Axis,
  v: Axis,
  w: Axis,
  udir: 1 | -1,
  vdir: 1 | -1,
  uExtent: number,
  vExtent: number,
  wSigned: number,
): void {
  const uHalf = uExtent / 2;
  const vHalf = vExtent / 2;
  const wHalf = wSigned / 2;
  const base = mesh.positions.length / 3;

  const normal: Vec3Record = { x: 0, y: 0, z: 0 };
  normal[w] = wSigned > 0 ? 1 : -1;

  for (const [iu, iv] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const vertex: Vec3Record = { x: 0, y: 0, z: 0 };
    vertex[u] = iu * uHalf * udir;
    vertex[v] = iv * vHalf * vdir;
    vertex[w] = wHalf;
    mesh.positions.push(vertex.x, vertex.y, vertex.z);
    mesh.normals.push(normal.x, normal.y, normal.z);
  }
  mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** A rectangular cuboid, base-pivoted (y in [0, height]), centered on x/z. */
export function buildBoxPrimitive(width: number, height: number, depth: number): PrimitiveMesh {
  const mesh = emptyMesh();
  buildBoxFace(mesh, 'z', 'y', 'x', -1, -1, depth, height, width); // +x
  buildBoxFace(mesh, 'z', 'y', 'x', 1, -1, depth, height, -width); // -x
  buildBoxFace(mesh, 'x', 'z', 'y', 1, 1, width, depth, height); // +y
  buildBoxFace(mesh, 'x', 'z', 'y', 1, -1, width, depth, -height); // -y
  buildBoxFace(mesh, 'x', 'y', 'z', 1, -1, width, height, depth); // +z
  buildBoxFace(mesh, 'x', 'y', 'z', -1, -1, width, height, -depth); // -z
  return shiftY(mesh, height / 2);
}

/**
 * A cylinder (or, with `radiusTop = 0`, a cone), base-pivoted (y in
 * [0, height]). One height segment only (no `heightSegments` param) - every
 * asset in the first pack is low-poly enough not to need it. Ported from
 * `CylinderGeometry.js` with `heightSegments` fixed at 1.
 */
export function buildCylinderPrimitive(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  radialSegments: number,
  openEnded = false,
): PrimitiveMesh {
  const mesh = emptyMesh();
  const halfHeight = height / 2;
  const slope = (radiusBottom - radiusTop) / height;
  let index = 0;
  const topRow: number[] = [];
  const bottomRow: number[] = [];

  for (const [v, row] of [
    [0, topRow],
    [1, bottomRow],
  ] as const) {
    const radius = v * (radiusBottom - radiusTop) + radiusTop;
    for (let x = 0; x <= radialSegments; x++) {
      const u = x / radialSegments;
      const theta = u * Math.PI * 2;
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);
      mesh.positions.push(radius * sinTheta, -v * height + halfHeight, radius * cosTheta);
      const len = Math.hypot(sinTheta, slope, cosTheta) || 1;
      mesh.normals.push(sinTheta / len, slope / len, cosTheta / len);
      row.push(index++);
    }
  }

  for (let x = 0; x < radialSegments; x++) {
    const a = topRow[x];
    const b = bottomRow[x];
    const c = bottomRow[x + 1];
    const d = topRow[x + 1];
    if (radiusTop > 0) mesh.indices.push(a, b, d);
    if (radiusBottom > 0) mesh.indices.push(b, c, d);
  }

  function generateCap(top: boolean): void {
    const centerIndexStart = index;
    const radius = top ? radiusTop : radiusBottom;
    const sign = top ? 1 : -1;
    for (let x = 1; x <= radialSegments; x++) {
      mesh.positions.push(0, halfHeight * sign, 0);
      mesh.normals.push(0, sign, 0);
      index++;
    }
    const centerIndexEnd = index;
    for (let x = 0; x <= radialSegments; x++) {
      const u = x / radialSegments;
      const theta = u * Math.PI * 2;
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);
      mesh.positions.push(radius * sinTheta, halfHeight * sign, radius * cosTheta);
      mesh.normals.push(0, sign, 0);
      index++;
    }
    for (let x = 0; x < radialSegments; x++) {
      const centerIndex = centerIndexStart + x;
      const ringIndex = centerIndexEnd + x;
      if (top) {
        mesh.indices.push(ringIndex, ringIndex + 1, centerIndex);
      } else {
        mesh.indices.push(ringIndex + 1, ringIndex, centerIndex);
      }
    }
  }

  if (!openEnded) {
    if (radiusTop > 0) generateCap(true);
    if (radiusBottom > 0) generateCap(false);
  }

  return shiftY(mesh, halfHeight);
}

/** A cone (a cylinder with `radiusTop = 0`), base-pivoted (y in [0, height], apex at the top). */
export function buildConePrimitive(
  radius: number,
  height: number,
  radialSegments: number,
): PrimitiveMesh {
  return buildCylinderPrimitive(0, radius, height, radialSegments, false);
}

/**
 * A torus lying flat on the ground (ring in the x/z plane, tube along y),
 * base-pivoted so its lowest point sits at y=0 - unlike
 * `THREE.TorusGeometry` (ring in x/y, centered on the origin), so scene
 * code placing a rope coil on the ground no longer needs
 * `rotation.x = Math.PI / 2`. Ported from `TorusGeometry.js`, re-oriented.
 */
export function buildTorusPrimitive(
  radius: number,
  tube: number,
  radialSegments: number,
  tubularSegments: number,
): PrimitiveMesh {
  const mesh = emptyMesh();
  const rows: number[][] = [];

  for (let j = 0; j <= radialSegments; j++) {
    const v = (j / radialSegments) * Math.PI * 2;
    const row: number[] = [];
    for (let i = 0; i <= tubularSegments; i++) {
      const u = (i / tubularSegments) * Math.PI * 2;
      const x = (radius + tube * Math.cos(v)) * Math.cos(u);
      const z = (radius + tube * Math.cos(v)) * Math.sin(u);
      const y = tube * Math.sin(v) + tube;
      mesh.positions.push(x, y, z);

      const centerX = radius * Math.cos(u);
      const centerZ = radius * Math.sin(u);
      const nx = x - centerX;
      const ny = y - tube;
      const nz = z - centerZ;
      const len = Math.hypot(nx, ny, nz) || 1;
      mesh.normals.push(nx / len, ny / len, nz / len);

      row.push(mesh.positions.length / 3 - 1);
    }
    rows.push(row);
  }

  for (let j = 1; j <= radialSegments; j++) {
    for (let i = 1; i <= tubularSegments; i++) {
      const a = rows[j][i - 1];
      const b = rows[j - 1][i - 1];
      const c = rows[j - 1][i];
      const d = rows[j][i];
      mesh.indices.push(a, b, d);
      mesh.indices.push(b, c, d);
    }
  }

  return mesh;
}

/**
 * A vertical quad (the x/y plane, normal +z), base-pivoted (y in
 * [0, height]) - for walls, doors, and fences, which stand up from the
 * ground. Ported from `PlaneGeometry.js`.
 */
export function buildPlanePrimitive(width: number, height: number): PrimitiveMesh {
  const widthHalf = width / 2;
  const heightHalf = height / 2;
  const mesh: PrimitiveMesh = {
    positions: [
      -widthHalf,
      heightHalf,
      0,
      widthHalf,
      heightHalf,
      0,
      -widthHalf,
      -heightHalf,
      0,
      widthHalf,
      -heightHalf,
      0,
    ],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    indices: [0, 2, 1, 2, 3, 1],
  };
  return shiftY(mesh, heightHalf);
}

/**
 * A horizontal quad (the x/z plane, normal +y) already at y=0 - for ground
 * tiles and path segments, which lie flat rather than standing up.
 */
export function buildGroundPlanePrimitive(width: number, depth: number): PrimitiveMesh {
  const widthHalf = width / 2;
  const depthHalf = depth / 2;
  return {
    positions: [
      -widthHalf,
      0,
      -depthHalf,
      widthHalf,
      0,
      -depthHalf,
      widthHalf,
      0,
      depthHalf,
      -widthHalf,
      0,
      depthHalf,
    ],
    normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    indices: [0, 1, 3, 1, 2, 3],
  };
}
