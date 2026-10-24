import { describe, expect, it } from 'vitest';
import type { WorldInteractionContext } from '../../../worldObjects';
import {
  castleTaleExtension,
  isCastleTaleScene,
} from '../../extensions/castleTale/castleTaleScene';
import { FACE_NORTH, mount, named, standAt, walk } from '../testing/engineHarness';
import { HEARTH_SPOT, KEEPER_QUILL_SPOT } from '../../storykeeperCastleRegion';
import { STORYKEEPER_CASTLE_MANIFEST as MANIFEST } from './storykeeperCastle';

/**
 * Engine Phase 9: the real runtime and the real `castle-tale` scene half
 * against the real castle manifest. What it proves is the part the castle's
 * own tests never could, because the per-region scene needed a WebGL
 * context: that the rooms are walls with holes in them, that a plate is
 * picked up and seated through the generic focus and interact path, and
 * that the arrangement reaches the bus as one event.
 */
const WITH = (context: Partial<WorldInteractionContext>): WorldInteractionContext => ({
  worldChangeKeys: [],
  ownedItemIds: [],
  discoveryIds: [],
  ...context,
});

function castle(options: Parameters<typeof mount>[0] = {}) {
  return mount({ manifest: MANIFEST, extensions: [castleTaleExtension], ...options });
}

function sceneApi(harness: ReturnType<typeof mount>) {
  const api = harness.engine.extensionApi('castle-tale');
  if (!isCastleTaleScene(api)) throw new Error('castle-tale did not mount');
  return api;
}

/** The engine's own loading, then the extension's state variants and canvases. */
async function ready(harness: ReturnType<typeof mount>) {
  await harness.engine.ready;
  await sceneApi(harness).ready;
}

/** A plate is table-high, so a child looks down at it rather than level. */
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

describe('Storykeeper Castle on the generic runtime: rooms', () => {
  it('spawns a first-time child in the entry hall', () => {
    const harness = castle();
    harness.runFrames(1);
    expect(harness.camera().position.toArray()).toEqual([-12, 1.6, 0]);
  });

  it('stops the child at an interior wall', () => {
    // The entry hall is 6m deep; its north wall is at z = 3.
    const harness = castle();
    harness.setDrive(walk(FACE_NORTH));
    harness.runFrames(200);
    expect(harness.camera().position.z).toBeLessThan(3);
    expect(harness.camera().position.z).toBeGreaterThan(2);
  });

  it('lets the child through an archway into the story hall', () => {
    // The entry archway is a real gap in the collision geometry at z 0.
    const harness = castle();
    harness.setDrive(walk(Math.PI / 2));
    harness.runFrames(300);
    expect(harness.camera().position.x).toBeGreaterThan(-8);
  });

  it('fires the rooms and the checkpoints the child crosses', () => {
    const harness = castle({ startCheckpointId: 'storykeeper-castle:story-hall' });
    harness.setDrive(standAt(-6, 0, FACE_NORTH));
    harness.runFrames(2);
    const zones = named(harness.events, 'PlayerEnteredZone');
    expect(zones).toContainEqual({ zoneId: 'storykeeper-castle:story-hall' });
    expect(zones).toContainEqual({ zoneId: 'castle-story-hall' });
  });

  it('lights every room, the doorway and the hearth', () => {
    const harness = castle();
    harness.runFrames(1);
    expect(harness.scene().getObjectByName('light:great-library')).toBeDefined();
    expect(harness.scene().getObjectByName('light:hearth')).toBeDefined();
  });
});

describe('Storykeeper Castle on the generic runtime: the room answers steps', () => {
  it('focuses a portrait the extension drew, and lights the chosen one', async () => {
    const harness = castle({ startCheckpointId: 'storykeeper-castle:gallery' });
    await ready(harness);
    harness.setDrive(standAt(-6.5, 8.6, FACE_NORTH));
    harness.runFrames(1);
    expect(named(harness.events, 'InteractableFocused')).toEqual([
      { entityId: 'gallery-portrait-puppy' },
    ]);

    // Both states are in the prop's root, and choosing flips which shows.
    const root = harness.scene().getObjectByName('a portrait');
    expect(root?.children).toHaveLength(2);
    sceneApi(harness).showChosenHero('gallery-portrait-puppy');
    expect(root?.children.filter((child) => child.visible)).toHaveLength(1);
  });

  it('picks a story plate up, seats it, and reports the whole row once', async () => {
    const harness = castle({ startCheckpointId: 'storykeeper-castle:story-hall' });
    await ready(harness);
    const api = sceneApi(harness);
    api.resetBindingPlates();

    /*
      Three pickups and three seatings, through the generic focus and
      interact path. Which plate the reticle reads is left to the raycast -
      the harness's stand-in boxes are far bigger than the real plates and
      overlap on the table - and the point is that a carried plate leaves
      the reticle's reach, so the next aim finds a different one and the
      lectern is reachable at all.
    */
    const pickedUp: string[] = [];
    // One aim per authored plate position, left to right across the table.
    for (const x of [-1.8, -1.4, -1]) {
      harness.setDrive(stoopAt(x, 1.1, FACE_NORTH, -0.55));
      harness.runFrames(1);
      harness.engine.interact();
      const carried = named(harness.events, 'CollectiblePickedUp').at(-1) as { entityId: string };
      expect(carried.entityId).not.toBe(pickedUp.at(-1));
      pickedUp.push(carried.entityId);

      /*
        Aimed low at the lectern's base. The harness's stand-in boxes are far
        taller than a real plate, so a level aim reads a plate already in a
        socket; the real sockets sit in the lectern's top and the real plates
        are 0.34m wide.
      */
      harness.setDrive(stoopAt(1, 1.1, FACE_NORTH, -0.8));
      harness.runFrames(1);
      // Report what the reticle reads at the lectern, so a miss here is a
      // readable failure rather than a plate that silently stayed in hand.
      expect(named(harness.events, 'InteractableFocused').at(-1)).toEqual({
        entityId: 'binding-lectern',
      });
      harness.engine.interact();
    }
    expect(new Set(pickedUp).size).toBe(3);

    const arrangements = named(harness.events, 'BuildActionRequested');
    expect(arrangements).toEqual([{ entityId: 'binding-lectern', order: pickedUp }]);
    // Picking a plate up is never a domain event of its own.
    expect(named(harness.events, 'ObjectInteracted')).toEqual([]);
  });

  it('builds the castle already changed for a child who told a story', async () => {
    const before = castle();
    await ready(before);
    before.runFrames(1);
    const untold = before.scene().getObjectByName('story-book-shelved');
    expect(untold?.visible).toBe(false);

    const after = castle({ worldState: WITH({ worldChangeKeys: ['FIRST_STORY_TOLD'] }) });
    await ready(after);
    after.runFrames(1);
    expect(after.scene().getObjectByName('story-book-shelved')?.visible).toBe(true);
    expect(after.scene().getObjectByName('hearth-lit')?.visible).toBe(true);
  });

  it('opens the secret door, and paints the easel, when the room is told to', async () => {
    const harness = castle();
    await ready(harness);
    harness.runFrames(1);
    const api = sceneApi(harness);

    expect(harness.scene().getObjectByName('secret-door-ajar')?.visible).toBe(false);
    api.showSecretDoorOpened(true);
    expect(harness.scene().getObjectByName('secret-door-ajar')?.visible).toBe(true);
    expect(harness.scene().getObjectByName('carving-worn-revealed')?.visible).toBe(true);

    expect(harness.scene().getObjectByName('canvas-hero-fox')?.visible).toBe(false);
    api.showEaselPainting('hero-fox', 'setting-cave');
    expect(harness.scene().getObjectByName('canvas-hero-fox')?.visible).toBe(true);
    expect(harness.scene().getObjectByName('canvas-setting-cave')?.visible).toBe(true);
    // One pair at a time: another hero's layer stays hidden.
    expect(harness.scene().getObjectByName('canvas-hero-dragon')?.visible).toBe(false);
  });

  it('turns Keeper Quill to look where he points', async () => {
    const harness = castle({ startCheckpointId: 'storykeeper-castle:story-hall' });
    await ready(harness);
    harness.runFrames(1);
    const quill = harness.scene().getObjectByName('Keeper Quill');
    const api = sceneApi(harness);
    /*
      Driven with `Idle`, the one clip the harness's stand-in asset authors:
      a clip the asset does not author changes nothing at all, which is the
      per-region scene's own behaviour and why nothing about the
      conversation depends on a gesture landing.
    */
    api.playQuillClip('Idle', 'hearth');
    // The hearth is across the hub to the south-east of him.
    expect(quill?.rotation.y).toBeCloseTo(
      Math.atan2(HEARTH_SPOT.x - KEEPER_QUILL_SPOT.x, HEARTH_SPOT.z - KEEPER_QUILL_SPOT.z),
    );
    api.playQuillClip('Idle');
    // ...and he looks back at the child in the entry hall afterwards.
    expect(quill?.rotation.y).toBeCloseTo(-Math.PI / 2);
  });

  it('disposes everything the extension added', async () => {
    const harness = castle();
    await ready(harness);
    harness.runFrames(2);
    harness.engine.dispose();
    expect(harness.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(harness.scene().getObjectByName('hearth-lit')).toBeUndefined();
  });
});
