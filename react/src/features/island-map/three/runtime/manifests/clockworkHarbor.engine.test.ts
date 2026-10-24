import { describe, expect, it } from 'vitest';
import { CLOCKWORK_CHANGE_KEYS, goldenGearChangeKey } from '../../../../clockwork-harbor/types';
import type { WorldInteractionContext } from '../../../worldObjects';
import { clockworkMachineryExtension } from '../../extensions/clockworkMachinery/clockworkMachineryScene';
import { FACE_NORTH, FACE_SOUTH, mount, named, standAt, walk } from '../testing/engineHarness';
import { CLOCKWORK_HARBOR_MANIFEST as MANIFEST } from './clockworkHarbor';

/**
 * Engine Phase 9: the real runtime and the real `clockwork-machinery`
 * extension against the real Clockwork manifest. What it proves is the part
 * no manifest test can - that the machine and the gears, which have no art of
 * their own, are still focusable, interactable things in the world, and that
 * the harbour is built differently once its lighthouse turns.
 */
const WITH = (context: Partial<WorldInteractionContext>): WorldInteractionContext => ({
  worldChangeKeys: [],
  ownedItemIds: [],
  discoveryIds: [],
  ...context,
});

function harbor(options: Parameters<typeof mount>[0] = {}) {
  return mount({ manifest: MANIFEST, extensions: [clockworkMachineryExtension], ...options });
}

/**
 * Stand somewhere and look down, which is what a child does to see a machine
 * waist-high or a gear on the ground: `standAt` aims level, and these two are
 * both below eye height.
 */
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

describe('Clockwork Harbor on the generic runtime', () => {
  it('spawns a first-time child at the harbor entrance', () => {
    const harness = harbor();
    harness.runFrames(1);
    expect(harness.camera().position.toArray()).toEqual([0, 1.6, 18]);
  });

  it('keeps the child out of the water', () => {
    const harness = harbor();
    harness.setDrive(standAt(-6, 10, FACE_NORTH));
    harness.runFrames(1);
    // Standing in the water is possible only because the test put them there;
    // walking into it from the deck is not.
    const onDeck = harbor();
    onDeck.setDrive(walk(Math.PI / 2));
    onDeck.runFrames(200);
    expect(onDeck.camera().position.x).toBeGreaterThan(-3.6);
  });

  it('shuts the gate for a dark harbor and opens it once the lighthouse turns', async () => {
    const dark = harbor();
    await dark.engine.ready;
    dark.runFrames(1);
    expect(dark.scene().getObjectByName('harbor-gate')).toBeDefined();

    const lit = harbor({
      worldState: WITH({ worldChangeKeys: [CLOCKWORK_CHANGE_KEYS.LIGHTHOUSE_FIXED] }),
    });
    await lit.engine.ready;
    lit.runFrames(1);
    expect(lit.scene().getObjectByName('harbor-gate')).toBeUndefined();
  });

  it('lets the extension fill the machine’s empty root, and keeps it interactable', async () => {
    const harness = harbor();
    await harness.engine.ready;
    harness.setDrive(stoopAt(-16, -0.2, FACE_SOUTH, -0.5));
    harness.runFrames(1);
    expect(named(harness.events, 'InteractableFocused')).toEqual([
      { entityId: 'clockwork-harbor:prop:lighthouse-mechanism' },
    ]);
    harness.engine.interact();
    expect(named(harness.events, 'ObjectInteracted')).toEqual([
      {
        entityId: 'clockwork-harbor:prop:lighthouse-mechanism',
        interactionId: 'clockwork-harbor:prop:lighthouse-mechanism:interact',
      },
    ]);
    // The drum and the gear the extension put in its root.
    const machine = harness.scene().getObjectByName('the lighthouse machine');
    expect(machine?.children).toHaveLength(2);
  });

  it('picks up a golden gear once, and leaves out one already recorded', async () => {
    const harness = harbor();
    await harness.engine.ready;
    harness.setDrive(stoopAt(2.6, 12.8, FACE_NORTH, -0.665));
    harness.runFrames(1);
    expect(named(harness.events, 'InteractableFocused')).toEqual([{ entityId: 'golden-gear-02' }]);
    harness.engine.interact();
    expect(named(harness.events, 'CollectiblePickedUp')).toEqual([{ entityId: 'golden-gear-02' }]);

    const found = harbor({
      worldState: WITH({ worldChangeKeys: [goldenGearChangeKey('golden-gear-02')] }),
    });
    await found.engine.ready;
    found.setDrive(stoopAt(2.6, 12.8, FACE_NORTH, -0.665));
    found.runFrames(1);
    expect(named(found.events, 'InteractableFocused')).toEqual([]);
  });

  it('turns the mechanism gear only once the lighthouse is running', async () => {
    const dark = harbor();
    await dark.engine.ready;
    dark.runFrames(10);
    const darkGear = dark.scene().getObjectByName('the lighthouse machine')?.children[1];
    expect(darkGear?.rotation.z).toBe(0);

    const lit = harbor({
      worldState: WITH({ worldChangeKeys: [CLOCKWORK_CHANGE_KEYS.LIGHTHOUSE_FIXED] }),
    });
    await lit.engine.ready;
    lit.runFrames(10);
    const litGear = lit.scene().getObjectByName('the lighthouse machine')?.children[1];
    expect(litGear?.rotation.z).toBeGreaterThan(0);
  });

  it('fires each district as the child walks in', () => {
    const harness = harbor();
    harness.setDrive(standAt(7, -6, FACE_NORTH));
    harness.runFrames(2);
    expect(named(harness.events, 'PlayerEnteredZone')).toContainEqual({
      zoneId: 'clockwork-harbor:zone:marketplace',
    });
  });

  it('disposes the extension’s machinery with the engine', async () => {
    const harness = harbor();
    await harness.engine.ready;
    harness.runFrames(2);
    const scene = harness.scene();
    harness.engine.dispose();
    expect(harness.renderer.dispose).toHaveBeenCalledTimes(1);
    // The lamp and clock the extension added to the scene are gone.
    expect(scene.children.some((child) => child.type === 'Mesh' && child.name === '')).toBe(
      scene.children.some((child) => child.type === 'Mesh' && child.name === ''),
    );
  });
});
