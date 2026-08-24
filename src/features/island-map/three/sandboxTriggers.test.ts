import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { hasApproached, isInRange, isInsideZone } from './sandboxTriggers';

describe('isInsideZone', () => {
  it('is true when the position is within the box', () => {
    const zone = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    expect(isInsideZone(new Vector3(0, 0, 0), zone)).toBe(true);
  });

  it('is false when the position is outside the box', () => {
    const zone = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    expect(isInsideZone(new Vector3(5, 0, 0), zone)).toBe(false);
  });
});

describe('isInRange', () => {
  it('is true at exactly the threshold distance', () => {
    expect(isInRange(new Vector3(0, 0, 0), new Vector3(2, 0, 0), 2)).toBe(true);
  });

  it('is false beyond the threshold distance', () => {
    expect(isInRange(new Vector3(0, 0, 0), new Vector3(2.5, 0, 0), 2)).toBe(false);
  });
});

describe('hasApproached', () => {
  it('is true the first frame the player enters range', () => {
    const result = hasApproached(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 2, false);
    expect(result).toBe(true);
  });

  it('is false on subsequent frames while still in range (edge-triggered, not level-triggered)', () => {
    const result = hasApproached(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 2, true);
    expect(result).toBe(false);
  });

  it('is false while out of range', () => {
    const result = hasApproached(new Vector3(0, 0, 0), new Vector3(10, 0, 0), 2, false);
    expect(result).toBe(false);
  });

  it('fires again after leaving and re-entering range', () => {
    // Mirrors real caller usage: track "was in range" via `isInRange` each
    // frame, independent of `hasApproached`'s edge-triggered return value.
    const nearby = new Vector3(1, 0, 0);
    let wasInRange = false;

    const near = new Vector3(0, 0, 0);
    const first = hasApproached(near, nearby, 2, wasInRange);
    wasInRange = isInRange(near, nearby, 2);

    const stillNear = hasApproached(near, nearby, 2, wasInRange);
    wasInRange = isInRange(near, nearby, 2);

    const far = new Vector3(20, 0, 0);
    const leftRange = hasApproached(far, nearby, 2, wasInRange);
    wasInRange = isInRange(far, nearby, 2);

    const reapproached = hasApproached(near, nearby, 2, wasInRange);

    expect(first).toBe(true);
    expect(stillNear).toBe(false);
    expect(leftRange).toBe(false);
    expect(reapproached).toBe(true);
  });
});
