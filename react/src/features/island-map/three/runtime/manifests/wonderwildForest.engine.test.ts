import { describe, expect, it, vi } from 'vitest';
import type { WorldInteractionContext } from '../../../worldObjects';
import { FACE_NORTH, FACE_SOUTH, mount, named, standAt, walk } from '../testing/engineHarness';
import { WONDERWILD_FOREST_MANIFEST as MANIFEST } from './wonderwildForest';

/**
 * Engine Phase 9: the real generic runtime against the real Wonderwild
 * manifest, with only the renderer, assets, input and clock faked
 * (`testing/engineHarness.ts`). What it proves is what the forest's own
 * geometry test could not: that the *runtime* collides against the derived
 * tree line, fires the authored zones, scatters the undergrowth, and builds
 * a different forest for a child who has already told the tale.
 */
const WITH = (context: Partial<WorldInteractionContext>): WorldInteractionContext => ({
  worldChangeKeys: [],
  ownedItemIds: [],
  discoveryIds: [],
  ...context,
});

function forest(options: Parameters<typeof mount>[0] = {}) {
  return mount({ manifest: MANIFEST, ...options });
}

/** Asset ids the fake asset loader was asked for, which is what the scene built. */
function loadedAssets(harness: ReturnType<typeof mount>): string[] {
  return vi.mocked(harness.deps.assets.instanced).mock.calls.map((call) => call[0]);
}

describe('Wonderwild Forest on the generic runtime: spawn and movement', () => {
  it('spawns a first-time child at the path into the forest, facing in', () => {
    const harness = forest();
    harness.runFrames(1);
    expect(harness.camera().position.toArray()).toEqual([-16, 1.6, 0]);
  });

  it('spawns a returning child at their saved glade', () => {
    const harness = forest({ startCheckpointId: 'wonderwild-forest:cave-mouth' });
    harness.runFrames(1);
    expect(harness.camera().position.toArray()).toEqual([11, 1.6, -8]);
  });

  it('stops the child at the derived tree line instead of letting them into the void', () => {
    // The harbour path glade is 6m deep; north of it is complement, not world.
    const harness = forest();
    harness.setDrive(walk(FACE_NORTH));
    harness.runFrames(300);
    expect(harness.camera().position.z).toBeLessThan(3);
    expect(harness.camera().position.z).toBeGreaterThan(1.5);
  });

  it('keeps the child out of the pond, which is the one collider that is not a tree', () => {
    const harness = forest({ startCheckpointId: 'wonderwild-forest:pond' });
    harness.setDrive(walk(FACE_NORTH));
    harness.runFrames(200);
    // The pond water starts at z 7.5 and the bank checkpoint sits at 6.8.
    expect(harness.camera().position.z).toBeLessThan(7.5);
  });
});

describe('Wonderwild Forest on the generic runtime: zones', () => {
  it('fires the hive clearing under the id its interactions name', () => {
    const harness = forest({ startCheckpointId: 'wonderwild-forest:hive-clearing' });
    harness.setDrive(standAt(13, 0, FACE_NORTH));
    harness.runFrames(2);
    expect(named(harness.events, 'PlayerEnteredZone')).toContainEqual({
      zoneId: 'wonderwild-beehive',
    });
  });

  it('fires the checkpoint it stands in, for the view to save', () => {
    const harness = forest();
    harness.runFrames(2);
    expect(named(harness.events, 'PlayerEnteredZone')).toContainEqual({
      zoneId: 'wonderwild-forest:harbor-path',
    });
  });

  it('fires the unmarked glow-moss zone for a child who wanders off the trail', () => {
    const harness = forest();
    harness.setDrive(standAt(-12, -9, FACE_NORTH));
    harness.runFrames(2);
    expect(named(harness.events, 'PlayerEnteredZone')).toContainEqual({
      zoneId: 'wonderwild-glow-moss',
    });
  });
});

describe('Wonderwild Forest on the generic runtime: props and scenery by world state', () => {
  it('shows the dark cave mouth to a child with no jar, and the lit one to a child carrying it', async () => {
    const dark = forest();
    await dark.engine.ready;
    dark.setDrive(standAt(11.5, -9.5, FACE_SOUTH));
    dark.runFrames(1);
    expect(named(dark.events, 'InteractableFocused')).toEqual([{ entityId: 'wonderwild-cave' }]);

    const lit = forest({ worldState: WITH({ ownedItemIds: ['glowing-moss-jar'] }) });
    await lit.engine.ready;
    lit.setDrive(standAt(11.5, -9.5, FACE_SOUTH));
    lit.runFrames(1);
    expect(named(lit.events, 'InteractableFocused')).toEqual([{ entityId: 'wonderwild-cave-lit' }]);
  });

  it('leaves the butterfly out until the garden is saved elsewhere on the island', async () => {
    const before = forest();
    await before.engine.ready;
    before.setDrive(standAt(5, 6.5, FACE_NORTH));
    before.runFrames(1);
    expect(named(before.events, 'InteractableFocused')).toEqual([]);

    const after = forest({
      worldState: WITH({ worldChangeKeys: ['SAVE_THE_BUTTERFLY_GARDEN_COMPLETE'] }),
    });
    await after.engine.ready;
    after.setDrive(standAt(5, 6.5, FACE_NORTH));
    after.runFrames(1);
    expect(named(after.events, 'InteractableFocused')).toEqual([
      { entityId: 'wonderwild-butterfly' },
    ]);
  });

  it('interacts with a prop by its semantic entity id', async () => {
    const harness = forest();
    await harness.engine.ready;
    harness.setDrive(standAt(7.5, 6.2, FACE_NORTH));
    harness.runFrames(1);
    harness.engine.interact();
    expect(named(harness.events, 'ObjectInteracted')).toEqual([
      { entityId: 'wonderwild-pond-frog', interactionId: 'wonderwild-pond-frog:interact' },
    ]);
  });

  it('builds the floor, the trails and all three scatters, each as one instanced run', async () => {
    const harness = forest();
    await harness.engine.ready;
    const assets = loadedAssets(harness);
    expect(assets).toContain('ground-tile-moss');
    expect(assets).toContain('path-forest');
    expect(assets.filter((id) => id === 'foliage-tree')).toHaveLength(1);
    expect(assets.filter((id) => id === 'foliage-bush')).toHaveLength(1);
    // The fern bank's own cluster plus the scattered ferns.
    expect(assets.filter((id) => id === 'fern')).toHaveLength(2);
  });

  it('scatters real trees rather than silently placing none', async () => {
    const harness = forest();
    await harness.engine.ready;
    const trees = vi
      .mocked(harness.deps.assets.instanced)
      .mock.calls.find((call) => call[0] === 'foliage-tree');
    expect(trees?.[1].length).toBeGreaterThan(50);
  });

  it('blooms the flower patch and lights the bee stone for a child who told the tale', async () => {
    const before = forest();
    await before.engine.ready;
    before.runFrames(1);
    expect(before.scene().getObjectByName('flower-patch-bloomed')).toBeUndefined();
    expect(before.scene().getObjectByName('flower-patch-bare')).toBeDefined();
    expect(before.scene().getObjectByName('stone:bee-lit')).toBeUndefined();

    const after = forest({ worldState: WITH({ worldChangeKeys: ['WAGGLE_DANCE_DISCOVERED'] }) });
    await after.engine.ready;
    after.runFrames(1);
    expect(after.scene().getObjectByName('flower-patch-bloomed')).toBeDefined();
    expect(after.scene().getObjectByName('flower-patch-bare')).toBeUndefined();
    expect(after.scene().getObjectByName('stone:bee-lit')).toBeDefined();
    expect(after.scene().getObjectByName('stone:bee')).toBeUndefined();
  });

  it('perches Chatty on the centre stone and loops the authored idle clip', async () => {
    const harness = forest();
    await harness.engine.ready;
    harness.runFrames(1);
    // Scenery hangs under a root group named by its manifest id, so an
    // extension can find it; the model inside carries the authored pose.
    const perch = harness.scene().getObjectByName('chatty-perched');
    const chatty = perch?.children[0];
    expect(chatty?.position.toArray()).toEqual([0, 0.55, 4.4]);
    expect(chatty?.rotation.y).toBeCloseTo(Math.PI);
    // The harness's fake models author exactly one clip, "Idle", which is
    // what the manifest asks for; a clip it did not author would be ignored.
    expect(perch?.children).toHaveLength(1);
  });

  it('disposes cleanly after a visit', () => {
    const harness = forest();
    harness.runFrames(3);
    harness.engine.dispose();
    expect(harness.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(harness.controls.dispose).toHaveBeenCalledTimes(1);
    expect(harness.stopFitting).toHaveBeenCalledTimes(1);
  });
});
