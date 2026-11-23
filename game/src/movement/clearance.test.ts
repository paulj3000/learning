import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  classifySolidBox,
  DEFAULT_CLEARANCE_MARGIN,
  groundUnderBox,
  requiredClearance,
} from './clearance';
import { DEFAULT_BODY_HEIGHT } from './firstPersonController';
import { DEFAULT_PLAYER_COLLISION, validatePlayerCollision } from './playerCollision';

function box(minY: number, maxY: number, minX = -1, maxX = 1, minZ = -1, maxZ = 1) {
  return new Box3(new Vector3(minX, minY, minZ), new Vector3(maxX, maxY, maxZ));
}

const STANDARD = requiredClearance(DEFAULT_BODY_HEIGHT);
const flat = () => 0;

describe('walk-under clearance (GE-L16)', () => {
  it('the standard avatar needs 1.7 m: its collision height, no extra margin by default', () => {
    expect(DEFAULT_CLEARANCE_MARGIN).toBe(0);
    expect(DEFAULT_PLAYER_COLLISION.clearanceMargin).toBe(DEFAULT_CLEARANCE_MARGIN);
    expect(STANDARD).toBeCloseTo(1.7, 10);
  });

  it('adds the safety margin to the avatar height, and never subtracts a negative one', () => {
    expect(requiredClearance(1.7, 0.1)).toBeCloseTo(1.8, 10);
    expect(requiredClearance(1.2, 0.05)).toBeCloseTo(1.25, 10);
    expect(requiredClearance(1.7, -1)).toBeCloseTo(1.7, 10);
  });

  it('a raised Solid with enough clearance under it is an overhead passage', () => {
    expect(classifySolidBox(box(2.2, 2.6), 0, STANDARD)).toBe('OVERHEAD');
  });

  it('a raised Solid without enough clearance is a column, however small the gap', () => {
    expect(classifySolidBox(box(1.5, 2.6), 0, STANDARD)).toBe('COLUMN');
    expect(classifySolidBox(box(0.01, 0.9), 0, STANDARD)).toBe('COLUMN'); // a fence a cm up
  });

  it('ground-level and buried-bottom Solids are columns, as they always were', () => {
    expect(classifySolidBox(box(0, 3), 0, STANDARD)).toBe('COLUMN');
    expect(classifySolidBox(box(-1, 3), 0, STANDARD)).toBe('COLUMN');
    expect(classifySolidBox(box(-1, 0), 0, STANDARD)).toBe('COLUMN');
  });

  it('a box entirely under the ground is ignored', () => {
    expect(classifySolidBox(box(-2, -0.5), 0, STANDARD)).toBe('BELOW_GROUND');
  });

  it('the boundary is inclusive: exactly the clearance is a passage, a millimetre less is not', () => {
    expect(classifySolidBox(box(1.7, 2), 0, STANDARD)).toBe('OVERHEAD');
    expect(classifySolidBox(box(1.699, 2), 0, STANDARD)).toBe('COLUMN');
    const withMargin = requiredClearance(DEFAULT_BODY_HEIGHT, 0.1);
    expect(classifySolidBox(box(1.75, 2), 0, withMargin)).toBe('COLUMN');
    expect(classifySolidBox(box(1.8, 2), 0, withMargin)).toBe('OVERHEAD');
  });

  it('depends on the avatar: a shorter collider fits under a lower part', () => {
    const lintel = box(1.4, 1.8);
    expect(classifySolidBox(lintel, 0, requiredClearance(1.2))).toBe('OVERHEAD');
    expect(classifySolidBox(lintel, 0, requiredClearance(1.7))).toBe('COLUMN');
  });

  it('measures the gap from the ground under the box, not from y 0', () => {
    const raised = box(3.5, 4);
    expect(classifySolidBox(raised, 2, STANDARD)).toBe('COLUMN'); // 1.5 m above a 2 m hill
    expect(classifySolidBox(raised, 1, STANDARD)).toBe('OVERHEAD'); // 2.5 m above a 1 m hill
    expect(classifySolidBox(box(1.5, 2.5), 2, STANDARD)).toBe('COLUMN'); // half in the hill
  });

  it('a box over a hole has no floor to walk under it on: a column', () => {
    expect(classifySolidBox(box(2.2, 2.6), null, STANDARD)).toBe('COLUMN');
  });

  it('samples the ground at the centre and the four corners and takes the highest', () => {
    const sloped = (x: number) => (x > 0 ? 1 : 0);
    expect(groundUnderBox(box(0, 1, -1, 1), sloped)).toBe(1);
    expect(groundUnderBox(box(0, 1, -3, -1), sloped)).toBe(0);
    expect(groundUnderBox(box(0, 1), flat)).toBe(0);
  });

  it('ignores holes and non-finite heights under part of the box', () => {
    const half = (x: number) => (x < 0 ? null : 0.5);
    expect(groundUnderBox(box(0, 1), half)).toBe(0.5);
    expect(groundUnderBox(box(0, 1), () => Number.NaN)).toBeNull();
    expect(groundUnderBox(box(0, 1), () => null)).toBeNull();
  });

  it('the margin is a validated movement.collision setting (0 to 0.5 m)', () => {
    expect(validatePlayerCollision({ clearanceMargin: 0.1 })).toEqual([]);
    expect(validatePlayerCollision({ clearanceMargin: 0.6 })).toEqual([
      { path: 'movement.collision.clearanceMargin', message: 'must be between 0 and 0.5' },
    ]);
    expect(validatePlayerCollision({ clearanceMargin: 'tall' })).toEqual([
      { path: 'movement.collision.clearanceMargin', message: 'must be a number' },
    ]);
  });
});
