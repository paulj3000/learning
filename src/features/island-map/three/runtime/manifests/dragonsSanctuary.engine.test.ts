import { describe, expect, it } from 'vitest';
import { SANCTUARY_CHANGE_KEYS, fireRuneChangeKey } from '../../../../dragons-sanctuary/types';
import type { WorldInteractionContext } from '../../../worldObjects';
import { sanctuaryArtExtension } from '../../extensions/sanctuaryArt/sanctuaryArtScene';
import { FACE_NORTH, FACE_SOUTH, mount, named, standAt, walk } from '../testing/engineHarness';
import { DRAGONS_SANCTUARY_MANIFEST as MANIFEST } from './dragonsSanctuary';

/**
 * Engine Phase 9: the real runtime and the real `sanctuary-art` extension
 * against the real sanctuary manifest. The interesting part is the two
 * collectible families - a rune and a scale have no art of their own, and
 * must still be things a child can look at, take, and find gone next time.
 */
const WITH = (context: Partial<WorldInteractionContext>): WorldInteractionContext => ({
  worldChangeKeys: [],
  ownedItemIds: [],
  discoveryIds: [],
  ...context,
});

function sanctuary(options: Parameters<typeof mount>[0] = {}) {
  return mount({ manifest: MANIFEST, extensions: [sanctuaryArtExtension], ...options });
}

const STONE_RUNE = 'dragons-sanctuary:prop:rune-stone';

/** A rune stone is knee-high, so a child looks down at it rather than level. */
function stoopAt(x: number, z: number, yaw: number, pitch: number) {
  return (controller: {
    position: { set(x: number, y: number, z: number): void };
    yaw: number;
    pitch: number;
  }) => {
    controller.position.set(x, 0, z);
    controller.yaw = yaw;
    controller.pitch = pitch;
  };
}

describe("The Dragon's Sanctuary on the generic runtime", () => {
  it('spawns a first-time child at the sanctuary gate', () => {
    const harness = sanctuary();
    harness.runFrames(1);
    expect(harness.camera().position.y).toBe(1.6);
    expect(harness.camera().position.z).toBeGreaterThan(14);
  });

  it('stops the child at a sealed gate rather than letting them round it', () => {
    // The gate spans its whole valley: `halfWidth` 7 against a 12m area.
    const harness = sanctuary({ startCheckpointId: 'dragons-sanctuary:roost' });
    harness.setDrive(standAt(-19, -13, FACE_SOUTH));
    harness.runFrames(1);
    const before = harness.camera().position.z;
    harness.setDrive(walk(FACE_SOUTH));
    harness.runFrames(200);
    expect(harness.camera().position.z).toBeGreaterThan(-16);
    expect(harness.camera().position.z).toBeLessThan(before);
  });

  it('lets the extension fill a rune’s root, and the runtime take it', async () => {
    const harness = sanctuary();
    await harness.engine.ready;
    harness.setDrive(stoopAt(-21, 10.2, FACE_SOUTH, -0.8));
    harness.runFrames(1);
    expect(named(harness.events, 'InteractableFocused')).toEqual([{ entityId: STONE_RUNE }]);

    harness.engine.interact();
    expect(named(harness.events, 'CollectiblePickedUp')).toEqual([{ entityId: STONE_RUNE }]);
    // Taken once: the runtime removed it from the scene.
    harness.engine.interact();
    expect(named(harness.events, 'CollectiblePickedUp')).toHaveLength(1);
  });

  it('leaves a rune out of the valley once it is found, and once the forge burns', async () => {
    const found = sanctuary({
      worldState: WITH({ worldChangeKeys: [fireRuneChangeKey(STONE_RUNE)] }),
    });
    await found.engine.ready;
    found.setDrive(stoopAt(-21, 10.2, FACE_SOUTH, -0.8));
    found.runFrames(1);
    expect(named(found.events, 'InteractableFocused')).toEqual([]);

    const lit = sanctuary({
      worldState: WITH({ worldChangeKeys: [SANCTUARY_CHANGE_KEYS.FORGE_LIT] }),
    });
    await lit.engine.ready;
    lit.setDrive(stoopAt(-21, 10.2, FACE_SOUTH, -0.8));
    lit.runFrames(1);
    expect(named(lit.events, 'InteractableFocused')).toEqual([]);
  });

  it('keeps the hearth interactable, and lights its bowl when the forge burns', async () => {
    const cold = sanctuary();
    await cold.engine.ready;
    cold.setDrive(standAt(21, 1.6, FACE_NORTH));
    cold.runFrames(1);
    expect(named(cold.events, 'InteractableFocused')).toEqual([
      { entityId: 'dragons-sanctuary:prop:forge-hearth' },
    ]);
    const coldHearth = cold.scene().getObjectByName('the forge hearth');
    // The block and the bowl the extension put in its root, and no firelight.
    expect(coldHearth?.children).toHaveLength(2);

    const lit = sanctuary({
      worldState: WITH({ worldChangeKeys: [SANCTUARY_CHANGE_KEYS.FORGE_LIT] }),
    });
    await lit.engine.ready;
    lit.runFrames(1);
    const litHearth = lit.scene().getObjectByName('the forge hearth');
    expect(litHearth?.children).toHaveLength(3);
    expect(litHearth?.children.some((child) => child.type === 'PointLight')).toBe(true);
  });

  it('fires each authored area as the child walks in', () => {
    const harness = sanctuary();
    harness.setDrive(standAt(-19, 3, FACE_NORTH));
    harness.runFrames(2);
    expect(named(harness.events, 'PlayerEnteredZone')).toContainEqual({
      zoneId: 'dragons-sanctuary:zone:lodge',
    });
    expect(named(harness.events, 'PlayerEnteredZone')).toContainEqual({
      zoneId: 'dragons-sanctuary:lodge:interior',
    });
  });

  it('walks in through the lodge doorway and stops at its back wall', () => {
    // The lodge is open to the east, which is a real gap in the geometry.
    const harness = sanctuary();
    harness.setDrive(standAt(-13, 3, FACE_NORTH));
    harness.runFrames(1);
    harness.setDrive(walk(-Math.PI / 2));
    harness.runFrames(300);
    expect(harness.camera().position.x).toBeLessThan(-15);
    expect(harness.camera().position.x).toBeGreaterThan(-24.5);
  });

  it('disposes cleanly', () => {
    const harness = sanctuary();
    harness.runFrames(2);
    harness.engine.dispose();
    expect(harness.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(harness.controls.dispose).toHaveBeenCalledTimes(1);
  });
});
