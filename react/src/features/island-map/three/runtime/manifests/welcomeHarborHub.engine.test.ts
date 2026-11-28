import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirstPersonController } from '@lai/game-engine/movement';
import { mount, named, standAt, standingBox, walk, type Drive } from '../testing/engineHarness';
import { WELCOME_HARBOR_MANIFEST } from './welcomeHarbor';

/**
 * LAI-2201 through the real generic runtime: the bridge is built broken or repaired from world
 * state, and a child can only cross once it is repaired. Only the renderer, assets and clock are
 * faked.
 */

const FACE_EAST = Math.PI / 2;
const REPAIRED = { worldChangeKeys: ['BRIDGE_REPAIRED'] };

function mountHarbor(worldState?: { worldChangeKeys: string[] }) {
  return mount({
    manifest: WELCOME_HARBOR_MANIFEST,
    loadModel: async () => standingBox(),
    worldState,
  });
}

/** Starts on the west bank at the bridge, then walks east. */
function crossFromWestBank(): Drive {
  let placed = false;
  const east = walk(FACE_EAST);
  return (controller: FirstPersonController, delta: number) => {
    if (!placed) {
      standAt(8.5, 0, FACE_EAST)(controller, delta);
      placed = true;
    }
    east(controller, delta);
  };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());

describe('Welcome Harbor hub on the generic runtime (LAI-2201)', () => {
  it('builds the broken bridge, or the repaired deck, from world state', () => {
    const broken = mountHarbor();
    broken.runFrames(1);
    expect(broken.scene().getObjectByName('harbor-bridge-stubs')).toBeDefined();
    expect(broken.scene().getObjectByName('harbor-bridge-fallen-plank')).toBeDefined();
    expect(broken.scene().getObjectByName('harbor-bridge-deck')).toBeUndefined();

    const repaired = mountHarbor(REPAIRED);
    repaired.runFrames(1);
    expect(repaired.scene().getObjectByName('harbor-bridge-stubs')).toBeUndefined();
    expect(repaired.scene().getObjectByName('harbor-bridge-fallen-plank')).toBeUndefined();
    expect(repaired.scene().getObjectByName('harbor-bridge-deck')).toBeDefined();
  });

  it('stops a child at the gap while the bridge is broken', () => {
    const harness = mountHarbor();
    harness.setDrive(crossFromWestBank());
    harness.runFrames(300);
    expect(harness.camera().position.x).toBeLessThan(10);
  });

  it('lets a child cross once the bridge is repaired', () => {
    const harness = mountHarbor(REPAIRED);
    harness.setDrive(crossFromWestBank());
    harness.runFrames(300);
    expect(harness.camera().position.x).toBeGreaterThan(10.5);
  });

  it('enters the unmarked tide pool zone and the forest zone by walking in', () => {
    const harness = mountHarbor();
    harness.setDrive(standAt(7, 3, 0));
    harness.runFrames(2);
    expect(named(harness.events, 'PlayerEnteredZone')).toContainEqual({
      zoneId: 'harbor-tide-pool',
    });
    const forest = mountHarbor();
    forest.setDrive(standAt(-10.5, 2.5, 0));
    forest.runFrames(2);
    expect(named(forest.events, 'PlayerEnteredZone')).toContainEqual({ zoneId: 'forest-entrance' });
  });

  it('lets a child focus and use the harbor door', async () => {
    const harness = mountHarbor();
    await harness.engine.ready;
    harness.setDrive(standAt(-9.2, -4.5, -FACE_EAST));
    harness.runFrames(2);
    expect(named(harness.events, 'InteractableFocused')).toEqual([{ entityId: 'harbor-door' }]);
    harness.engine.interact();
    expect(named(harness.events, 'ObjectInteracted')).toEqual([
      { entityId: 'harbor-door', interactionId: 'harbor-door:interact' },
    ]);
  });
});
