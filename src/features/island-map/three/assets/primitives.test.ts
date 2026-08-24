import { describe, expect, it } from 'vitest';
import {
  buildBoxPrimitive,
  buildConePrimitive,
  buildCylinderPrimitive,
  buildGroundPlanePrimitive,
  buildPlanePrimitive,
  buildTorusPrimitive,
} from './primitives';

function yBounds(positions: readonly number[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 1; i < positions.length; i += 3) {
    min = Math.min(min, positions[i]);
    max = Math.max(max, positions[i]);
  }
  return { min, max };
}

function assertWellFormed(mesh: { positions: number[]; normals: number[]; indices: number[] }): void {
  expect(mesh.positions.length % 3).toBe(0);
  expect(mesh.normals.length).toBe(mesh.positions.length);
  expect(mesh.indices.length % 3).toBe(0);
  const vertexCount = mesh.positions.length / 3;
  for (const index of mesh.indices) {
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(vertexCount);
  }
}

describe('buildBoxPrimitive', () => {
  it('produces 24 vertices (4 per face) and 36 indices (6 faces * 2 triangles)', () => {
    const mesh = buildBoxPrimitive(1, 2, 3);
    assertWellFormed(mesh);
    expect(mesh.positions.length / 3).toBe(24);
    expect(mesh.indices.length).toBe(36);
  });

  it('is ground-pivoted: y spans [0, height], not centered on the origin', () => {
    const mesh = buildBoxPrimitive(1, 2, 3);
    const bounds = yBounds(mesh.positions);
    expect(bounds.min).toBeCloseTo(0);
    expect(bounds.max).toBeCloseTo(2);
  });

  it('centers x and z on the origin', () => {
    const mesh = buildBoxPrimitive(2, 1, 4);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      expect(Math.abs(mesh.positions[i])).toBeLessThanOrEqual(1 + 1e-9);
      expect(Math.abs(mesh.positions[i + 2])).toBeLessThanOrEqual(2 + 1e-9);
    }
  });
});

describe('buildConePrimitive', () => {
  it('is ground-pivoted with the apex at the top', () => {
    const mesh = buildConePrimitive(0.5, 1.4, 8);
    assertWellFormed(mesh);
    const bounds = yBounds(mesh.positions);
    expect(bounds.min).toBeCloseTo(0);
    expect(bounds.max).toBeCloseTo(1.4);
  });

  it('has no separate top cap (a cone has only a base cap)', () => {
    const withoutCap = buildConePrimitive(0.5, 1, 6);
    const cylinderBothCaps = buildCylinderPrimitive(0.5, 0.5, 1, 6);
    // A cone's vertex count is smaller than an equivalent cylinder's, since
    // it has one cap instead of two.
    expect(withoutCap.positions.length).toBeLessThan(cylinderBothCaps.positions.length);
  });
});

describe('buildCylinderPrimitive', () => {
  it('is ground-pivoted: y spans [0, height]', () => {
    const mesh = buildCylinderPrimitive(0.3, 0.3, 1.2, 8);
    assertWellFormed(mesh);
    const bounds = yBounds(mesh.positions);
    expect(bounds.min).toBeCloseTo(0);
    expect(bounds.max).toBeCloseTo(1.2);
  });

  it('has no caps when openEnded is true (a tunnel mouth)', () => {
    const open = buildCylinderPrimitive(0.9, 0.9, 0.4, 12, true);
    const capped = buildCylinderPrimitive(0.9, 0.9, 0.4, 12, false);
    assertWellFormed(open);
    expect(open.positions.length).toBeLessThan(capped.positions.length);
  });
});

describe('buildTorusPrimitive', () => {
  it('is ground-pivoted: its lowest point sits at y=0', () => {
    const mesh = buildTorusPrimitive(0.25, 0.08, 8, 16);
    assertWellFormed(mesh);
    const bounds = yBounds(mesh.positions);
    expect(bounds.min).toBeCloseTo(0, 5);
    expect(bounds.max).toBeCloseTo(0.16, 5);
  });

  it('rings lie in the x/z plane (a flat coil, not the x/y plane)', () => {
    const mesh = buildTorusPrimitive(1, 0.1, 4, 4);
    let maxRadiusXZ = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      maxRadiusXZ = Math.max(maxRadiusXZ, Math.hypot(mesh.positions[i], mesh.positions[i + 2]));
    }
    expect(maxRadiusXZ).toBeCloseTo(1.1, 5);
  });
});

describe('buildPlanePrimitive', () => {
  it('produces a single ground-pivoted quad facing +z', () => {
    const mesh = buildPlanePrimitive(2, 3);
    assertWellFormed(mesh);
    expect(mesh.positions.length / 3).toBe(4);
    expect(mesh.indices.length).toBe(6);
    const bounds = yBounds(mesh.positions);
    expect(bounds.min).toBeCloseTo(0);
    expect(bounds.max).toBeCloseTo(3);
    for (let i = 2; i < mesh.normals.length; i += 3) {
      expect(mesh.normals[i]).toBeCloseTo(1);
    }
  });
});

describe('buildGroundPlanePrimitive', () => {
  it('produces a single quad already flat on the ground (y=0 everywhere), facing +y', () => {
    const mesh = buildGroundPlanePrimitive(4, 4);
    assertWellFormed(mesh);
    expect(mesh.positions.length / 3).toBe(4);
    for (let i = 1; i < mesh.positions.length; i += 3) {
      expect(mesh.positions[i]).toBe(0);
    }
    for (let i = 1; i < mesh.normals.length; i += 3) {
      expect(mesh.normals[i]).toBeCloseTo(1);
    }
  });
});
