import { describe, expect, it } from 'vitest';
import { FACE_NORTH, FACE_SOUTH, mount, named, standAt, walk } from '../testing/engineHarness';
import { CASTLE_WRITING_ROOM_MANIFEST as MANIFEST } from './castleWritingRoom';

/**
 * SC-R10-02: the real runtime against the real Writing Room manifest. No
 * extension is involved: everything here is the generic engine.
 */
function room(options: Parameters<typeof mount>[0] = {}) {
  return mount({ manifest: MANIFEST, ...options });
}

describe('The Writing Room on the generic runtime', () => {
  it('spawns a first-time child just inside the door, at eye height', () => {
    const harness = room();
    harness.runFrames(1);
    expect(harness.camera().position.y).toBe(1.6);
    expect(harness.camera().position.x).toBeCloseTo(-2.5, 1);
    expect(harness.camera().position.z).toBeCloseTo(0, 1);
  });

  it('keeps the child inside the room', () => {
    const east = room();
    east.setDrive(standAt(0, 0, Math.PI / 2));
    east.runFrames(1);
    east.setDrive(walk(Math.PI / 2));
    east.runFrames(400);
    expect(east.camera().position.x).toBeLessThanOrEqual(5);

    const north = room();
    north.setDrive(standAt(-3.8, 0, FACE_NORTH));
    north.runFrames(1);
    north.setDrive(walk(FACE_NORTH));
    north.runFrames(400);
    // The north shelves are solid.
    expect(north.camera().position.z).toBeLessThan(4.6);
    const south = room();
    south.setDrive(standAt(0, 0, FACE_SOUTH));
    south.runFrames(1);
    south.setDrive(walk(FACE_SOUTH));
    south.runFrames(400);
    expect(south.camera().position.z).toBeGreaterThanOrEqual(-5);
  });

  it('stops the child at a cut corner rather than letting them into it', () => {
    const harness = room();
    harness.setDrive(standAt(4.5, 2.9, FACE_NORTH));
    harness.runFrames(1);
    harness.setDrive(walk(FACE_NORTH));
    harness.runFrames(400);
    // The north-east corner block starts at z = 3.8.
    expect(harness.camera().position.z).toBeLessThan(3.8);
  });

  it('fires the exit zone when the child walks to the west door', () => {
    const harness = room();
    harness.setDrive(standAt(-3, 0, -Math.PI / 2));
    harness.runFrames(1);
    harness.setDrive(walk(-Math.PI / 2));
    harness.runFrames(200);
    expect(named(harness.events, 'PlayerEnteredZone')).toContainEqual({
      zoneId: 'writing-room-castle-exit',
    });
  });

  it('focuses the desk, and a tap on it raises ObjectInteracted for the shared interaction', async () => {
    const harness = room();
    await harness.engine.ready;
    harness.setDrive(standAt(0.9, -1, Math.PI / 2));
    harness.runFrames(1);
    expect(named(harness.events, 'InteractableFocused')).toContainEqual({
      entityId: 'writing-room-desk',
    });
    harness.engine.interact();
    expect(named(harness.events, 'ObjectInteracted')).toHaveLength(1);
  });

  it('puts the optional low steps in the scene without gating anything on them', async () => {
    const harness = room();
    await harness.engine.ready;
    harness.runFrames(2);
    expect(MANIFEST.platforming?.platforms).toHaveLength(2);
    expect(named(harness.events, 'CourseCheckpointReached')).toEqual([]);
  });

  it('disposes cleanly', () => {
    const harness = room();
    harness.runFrames(2);
    harness.engine.dispose();
    expect(harness.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(harness.controls.dispose).toHaveBeenCalledTimes(1);
  });
});
