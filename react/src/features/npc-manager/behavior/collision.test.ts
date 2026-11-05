import { describe, expect, it } from 'vitest';
import { advanceToward, createMoveResult, isBlockedByRects, type MoveContext } from './collision';
import { angleDelta, clampToCircle, normalizeAngle, turnToward, yawTowards } from './geometry';

const open: MoveContext = { homeX: 0, homeZ: 0, boundsRadius: 100, isBlocked: null };

function moveFrom(x: number, z: number) {
  return { pos: { x, z }, out: createMoveResult(), probe: { x: 0, z: 0 } };
}

describe('geometry', () => {
  it('normalises angles and turns the short way without overshooting', () => {
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
    expect(turnToward(0, 1, 0.25)).toBeCloseTo(0.25);
    expect(turnToward(0, 0.1, 0.25)).toBeCloseTo(0.1);
    expect(turnToward(Math.PI - 0.1, -Math.PI + 0.1, 1)).toBeCloseTo(-Math.PI + 0.1);
  });

  it('uses the first-person controller yaw convention (forward = sin, cos)', () => {
    expect(yawTowards(0, 0, 0, 1)).toBeCloseTo(0);
    expect(yawTowards(0, 0, 1, 0)).toBeCloseTo(Math.PI / 2);
  });

  it('clamps a point onto the bounds circle', () => {
    expect(clampToCircle({ x: 10, z: 0 }, 0, 0, 4)).toEqual({ x: 4, z: 0 });
    expect(clampToCircle({ x: 1, z: 1 }, 0, 0, 4)).toEqual({ x: 1, z: 1 });
  });
});

describe('isBlockedByRects (manifest collider adapter)', () => {
  it('blocks inside any rectangle, grown by the margin, and ignores Y', () => {
    // A sceneLayout.BoxBounds, as solidColliders(manifest) returns them.
    const box = { minX: 5, minY: -1, minZ: 5, maxX: 6, maxY: 3, maxZ: 6 };
    const blocked = isBlockedByRects([{ minX: 0, maxX: 1, minZ: 0, maxZ: 1 }, box], 0.25);
    expect(blocked(0.5, 0.5)).toBe(true);
    expect(blocked(-0.2, 0.5)).toBe(true);
    expect(blocked(-0.3, 0.5)).toBe(false);
    expect(blocked(5.5, 5.5)).toBe(true);
    expect(blocked(3, 3)).toBe(false);
  });

  it('blocks nothing with no rectangles', () => {
    expect(isBlockedByRects([])(0, 0)).toBe(false);
  });
});

describe('advanceToward', () => {
  it('moves at speed and stops early on arrival, reporting the time used', () => {
    const { pos, out, probe } = moveFrom(0, 0);
    advanceToward(pos, 3, 0, 2, 1, open, out, probe);
    expect(pos.x).toBeCloseTo(2);
    expect(out.arrived).toBe(false);
    advanceToward(pos, 3, 0, 2, 1, open, out, probe);
    expect(pos).toEqual({ x: 3, z: 0 });
    expect(out.arrived).toBe(true);
    expect(out.consumed).toBeCloseTo(0.5);
  });

  it('never leaves the bounds circle around home', () => {
    const { pos, out, probe } = moveFrom(0, 0);
    const ctx = { ...open, boundsRadius: 2 };
    advanceToward(pos, 10, 0, 5, 1, ctx, out, probe);
    expect(Math.hypot(pos.x, pos.z)).toBeLessThanOrEqual(2 + 1e-9);
    expect(out.blocked).toBe(true);
  });

  it('slides along a wall instead of entering it', () => {
    // A wall across x >= 1 for every z: moving diagonally slides along z.
    const ctx = { ...open, isBlocked: (x: number) => x >= 1 };
    const { pos, out, probe } = moveFrom(0.9, 0);
    advanceToward(pos, 3, 3, 1, 1, ctx, out, probe);
    expect(pos.x).toBeCloseTo(0.9);
    expect(pos.z).toBeGreaterThan(0.5);
    expect(out.blocked).toBe(false);
  });

  it('stops and reports blocked when both axes are blocked', () => {
    const ctx = { ...open, isBlocked: (x: number, z: number) => x >= 1 || z >= 1 };
    const { pos, out, probe } = moveFrom(0.95, 0.95);
    advanceToward(pos, 3, 3, 1, 1, ctx, out, probe);
    expect(out.blocked).toBe(true);
    expect(ctx.isBlocked(pos.x, pos.z)).toBe(false);
  });

  it('probes in small steps so a fast mover cannot tunnel a thin wall', () => {
    const wall = (x: number) => x >= 1 && x <= 1.2;
    const ctx = { ...open, isBlocked: (x: number, z: number) => wall(x) && Math.abs(z) < 50 };
    const { pos, out, probe } = moveFrom(0, 0);
    advanceToward(pos, 5, 0, 6, 0.25, ctx, out, probe);
    expect(pos.x).toBeLessThan(1);
    expect(out.blocked).toBe(true);
  });

  it('lets an NPC spawned inside a collider walk out', () => {
    const ctx = { ...open, isBlocked: (x: number) => x < 1 };
    const { pos, out, probe } = moveFrom(0, 0);
    advanceToward(pos, 3, 0, 1, 1, ctx, out, probe);
    expect(pos.x).toBeCloseTo(1);
  });
});
