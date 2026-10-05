import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Box3, Group, Mesh, Vector3, type Object3D } from 'three';
import type { LoadedModel } from './createLocationEngine';
import type { WorldExtension, WorldExtensionContext } from './extensionRegistry';
import type { ThreeLocationManifest } from './locationManifest';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import {
  FACE_NORTH,
  FACE_SOUTH,
  mount,
  named,
  pipChildHeights,
  standAt,
  standingBox,
  walk,
} from './testing/engineHarness';

/**
 * The generic runtime driven entirely through injected fakes: a renderer
 * that records `render` calls, assets that resolve to simple boxes, manual
 * frame stepping and a manual clock, and "controls" that let each test move
 * the player directly. Everything else (scene graph, colliders, raycasts,
 * triggers, disposal) is the real code. Covers the world-runtime acceptance
 * tests in `docs/engine/11_ACCEPTANCE_TESTS.md` (W1 to W7, AS3, B4).
 */

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
});

describe('createLocationEngine: spawn and checkpoints', () => {
  it('spawns a first-time child at the region’s first authored checkpoint (W1)', () => {
    const harness = mount();
    harness.runFrames(1);
    expect(harness.camera().position.toArray()).toEqual([0, 1.6, 8]);
  });

  it('spawns a returning child at their saved checkpoint', () => {
    const harness = mount({ startCheckpointId: 'welcome-harbor:shed' });
    harness.runFrames(1);
    expect(harness.camera().position.toArray()).toEqual([7, 1.6, -3]);
  });

  it('ignores a saved checkpoint from another region', () => {
    const harness = mount({ startCheckpointId: 'pirate-builder-bay:dock' });
    harness.runFrames(1);
    expect(harness.camera().position.toArray()).toEqual([0, 1.6, 8]);
  });

  it('reports the authored checkpoint id it stands in, for the view to save (W2)', () => {
    const harness = mount();
    harness.runFrames(2);
    expect(named(harness.events, 'PlayerEnteredZone')).toEqual([{ zoneId: 'welcome-harbor:dock' }]);
  });
});

describe('createLocationEngine: movement, collision and zones', () => {
  it('stops the player at the manifest boundary (W3)', () => {
    const harness = mount();
    harness.setDrive(walk(FACE_NORTH));
    harness.runFrames(400);
    const z = harness.camera().position.z;
    expect(z).toBeLessThan(12);
    expect(z).toBeGreaterThan(11);
  });

  it('lets the player through a doorway, fires the interior zone, then stops at the back wall (W4)', () => {
    const harness = mount({ startCheckpointId: 'welcome-harbor:lookout' });
    harness.setDrive(walk(FACE_SOUTH));
    harness.runFrames(200);
    expect(named(harness.events, 'PlayerEnteredZone')).toEqual([
      { zoneId: 'welcome-harbor:lookout' },
      { zoneId: 'lookout-tower:interior' },
    ]);
    expect(harness.camera().position.z).toBeGreaterThan(-7.8);
  });

  it('reports approaching an NPC once as the player walks past (W5)', () => {
    const harness = mount();
    harness.setDrive(walk(FACE_SOUTH));
    harness.runFrames(400);
    expect(named(harness.events, 'NpcApproached')).toEqual([{ entityId: 'pirate-pip' }]);
  });
});

describe('createLocationEngine: focus and interaction', () => {
  it('focuses and interacts with an NPC by its semantic entity id (W6)', async () => {
    const harness = mount();
    await harness.engine.ready;
    harness.setDrive(standAt(1.5, 1, FACE_SOUTH));
    harness.runFrames(1);
    expect(named(harness.events, 'InteractableFocused')).toEqual([{ entityId: 'pirate-pip' }]);

    harness.engine.interact();
    harness.pressInteractKey();
    expect(named(harness.events, 'ObjectInteracted')).toEqual([
      { entityId: 'pirate-pip', interactionId: 'pirate-pip:talk' },
      { entityId: 'pirate-pip', interactionId: 'pirate-pip:talk' },
    ]);
  });

  it('picks a collectible up once and removes it from the world', async () => {
    const harness = mount();
    await harness.engine.ready;
    harness.setDrive(standAt(-1.5, -1, FACE_SOUTH));
    harness.runFrames(1);
    expect(named(harness.events, 'InteractableFocused')).toEqual([
      { entityId: 'harbor-collectible-gem' },
    ]);

    harness.engine.interact();
    harness.engine.interact();
    harness.runFrames(1);
    expect(named(harness.events, 'CollectiblePickedUp')).toEqual([
      { entityId: 'harbor-collectible-gem' },
    ]);
    expect(named(harness.events, 'InteractableFocused').at(-1)).toEqual({ entityId: null });
  });

  it('leaves out a collectible whose world change the child has already recorded (Phase 8)', async () => {
    // What keeps a picked-up thing picked up: the scene is simply not built
    // with it next time, so it cannot be focused or collected twice.
    const manifest: ThreeLocationManifest = {
      ...WELCOME_HARBOR_MANIFEST,
      collectibles: WELCOME_HARBOR_MANIFEST.collectibles.map((collectible) => ({
        ...collectible,
        requirements: [{ type: 'WORLD_CHANGE_ABSENT', changeKey: 'HARBOR_GEM_FOUND' }],
        worldChange: { changeType: 'COLLECTIBLE_FOUND', changeKey: 'HARBOR_GEM_FOUND' },
      })),
    };
    const stillThere = mount({ manifest });
    await stillThere.engine.ready;
    stillThere.setDrive(standAt(-1.5, -1, FACE_SOUTH));
    stillThere.runFrames(1);
    expect(named(stillThere.events, 'InteractableFocused')).toEqual([
      { entityId: 'harbor-collectible-gem' },
    ]);

    const alreadyFound = mount({
      manifest,
      worldState: { worldChangeKeys: ['HARBOR_GEM_FOUND'], ownedItemIds: [], discoveryIds: [] },
    });
    await alreadyFound.engine.ready;
    alreadyFound.setDrive(standAt(-1.5, -1, FACE_SOUTH));
    alreadyFound.runFrames(1);
    // Nothing to focus, so not even a focus change: the gem is not in the scene.
    expect(named(alreadyFound.events, 'InteractableFocused')).toEqual([]);
    alreadyFound.engine.interact();
    expect(named(alreadyFound.events, 'CollectiblePickedUp')).toEqual([]);
  });

  it('does nothing when interacting with empty air', async () => {
    const harness = mount();
    await harness.engine.ready;
    harness.setDrive(standAt(0, 8, FACE_NORTH));
    harness.runFrames(1);
    harness.engine.interact();
    expect(named(harness.events, 'ObjectInteracted')).toEqual([]);
  });
});

describe('createLocationEngine: indoor vocabulary (Phase 9)', () => {
  /** A harbour with a placed light, a wall-mounted prop and a ceiling. */
  function indoorManifest(): ThreeLocationManifest {
    return {
      ...WELCOME_HARBOR_MANIFEST,
      lights: [
        {
          id: 'hearth-light',
          kind: 'POINT',
          position: { x: 0, y: 1.5, z: 0 },
          color: 0xffb066,
          intensity: 9,
          distance: 12,
        },
        {
          id: 'doorway-glow',
          kind: 'POINT',
          position: { x: 2, y: 1.5, z: 0 },
          color: 0xffffff,
          intensity: 4,
          requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: 'DOOR_OPEN' }],
        },
      ],
      props: [
        {
          entityId: 'wall-portrait',
          assetId: 'gem',
          position: { x: 3, z: 3 },
          elevation: 1.5,
          label: 'a portrait',
          interactionId: 'meet-pirate-pip',
        },
      ],
      scenery: [
        {
          kind: 'TILED_GROUND',
          id: 'ceiling',
          assetId: 'ground-tile',
          area: { id: 'ceiling:area', minX: -4, maxX: 4, minZ: -4, maxZ: 4 },
          tileSize: 4,
          y: 3,
        },
      ],
    };
  }

  it('places a light, and leaves out one whose requirements are not met', () => {
    const dark = mount({ manifest: indoorManifest() });
    dark.runFrames(1);
    const hearth = dark.scene().getObjectByName('hearth-light');
    expect(hearth?.type).toBe('PointLight');
    expect(dark.scene().getObjectByName('doorway-glow')).toBeUndefined();

    const open = mount({
      manifest: indoorManifest(),
      worldState: { worldChangeKeys: ['DOOR_OPEN'], ownedItemIds: [], discoveryIds: [] },
    });
    open.runFrames(1);
    expect(open.scene().getObjectByName('doorway-glow')).toBeDefined();
  });

  it('mounts a wall-mounted prop at its authored height', async () => {
    const harness = mount({ manifest: indoorManifest() });
    await harness.engine.ready;
    harness.runFrames(1);
    expect(harness.scene().getObjectByName('a portrait')?.position.toArray()).toEqual([3, 1.5, 3]);
  });

  it('tiles a ceiling at its own height', async () => {
    const harness = mount({ manifest: indoorManifest() });
    await harness.engine.ready;
    const ceiling = vi
      .mocked(harness.deps.assets.instanced)
      .mock.calls.find((call) => call[0] === 'ground-tile');
    expect(ceiling?.[1].every((placement) => placement.position.y === 3)).toBe(true);
  });

  it('lets an extension take over what interacting with an entity does', async () => {
    const handled: string[] = [];
    const extension: WorldExtension = {
      id: 'puzzle',
      mount(context: WorldExtensionContext) {
        const stop = context.interceptInteract((entityId) => {
          if (entityId !== 'pirate-pip') return false;
          handled.push(entityId);
          return true;
        });
        return { dispose: stop };
      },
    };
    const manifest: ThreeLocationManifest = {
      ...WELCOME_HARBOR_MANIFEST,
      extensions: [{ extensionId: 'puzzle', config: {} }],
    };
    const harness = mount({ manifest, extensions: [extension] });
    await harness.engine.ready;
    harness.setDrive(standAt(1.5, 1, FACE_SOUTH));
    harness.runFrames(1);
    harness.engine.interact();
    expect(handled).toEqual(['pirate-pip']);
    // The runtime emitted nothing: the extension owns this one.
    expect(named(harness.events, 'ObjectInteracted')).toEqual([]);
  });

  it('hands an extension an NPC’s own animation state', async () => {
    let clips: readonly { name: string }[] = [];
    const extension: WorldExtension = {
      id: 'puzzle',
      mount(context: WorldExtensionContext) {
        // Asked after the model loads, which is why this waits a frame.
        context.onFrame(() => {
          clips = context.npcAnimator('pirate-pip')?.clips ?? [];
        });
      },
    };
    const manifest: ThreeLocationManifest = {
      ...WELCOME_HARBOR_MANIFEST,
      extensions: [{ extensionId: 'puzzle', config: {} }],
    };
    const harness = mount({ manifest, extensions: [extension] });
    await harness.engine.ready;
    harness.runFrames(1);
    expect(clips.map((clip) => clip.name)).toEqual(['Idle']);
  });
});

describe('createLocationEngine: assets', () => {
  it('keeps an NPC’s placeholder when its model fails to load, without failing the region (AS3)', async () => {
    const harness = mount({
      loadModel: async (assetId) => {
        if (assetId === 'npc-pip') throw new Error('404');
        return standingBox();
      },
    });
    await expect(harness.engine.ready).resolves.toBeUndefined();
    harness.runFrames(1);
    expect(pipChildHeights(harness.scene())).toEqual([0.6]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('npc pirate-pip'), expect.any(Error));
  });

  it('swaps the placeholder for the loaded model once it resolves', async () => {
    const harness = mount();
    await harness.engine.ready;
    harness.runFrames(1);
    expect(pipChildHeights(harness.scene())).toEqual([1.8]);
  });

  it('builds every scenery kind from the manifest', async () => {
    const harness = mount();
    await harness.engine.ready;
    // Ground, rocks, bushes, fence and the three building pieces are instanced; trees are LOD.
    expect(harness.deps.assets.instanced).toHaveBeenCalledWith('ground-tile', expect.any(Array));
    expect(harness.deps.assets.instanced).toHaveBeenCalledWith('wall', expect.any(Array));
    expect(harness.deps.assets.instanced).toHaveBeenCalledWith('fence', expect.any(Array));
    expect(harness.deps.assets.withLod).toHaveBeenCalledTimes(3);
  });
});

describe('createLocationEngine: ambient movers', () => {
  it('moves an ambient creature along its loop', () => {
    const harness = mount();
    harness.runFrames(1);
    const scene = harness.scene();
    const gull = scene.children.find(
      (child: Object3D) =>
        child instanceof Group && child.children[0] instanceof Mesh && child.position.y > 3,
    );
    const before = gull?.position.clone();
    harness.runFrames(30);
    expect(gull).toBeDefined();
    expect(gull?.position.equals(before!)).toBe(false);
  });
});

describe('createLocationEngine: extensions', () => {
  it('mounts a declared extension by id with its config, and cleans it up once (B4)', () => {
    const cleanup = vi.fn();
    const onFrame = vi.fn();
    const extension: WorldExtension = {
      id: 'test-bell',
      mount: vi.fn((context: WorldExtensionContext) => {
        context.onFrame(onFrame);
        return { dispose: cleanup, api: { rings: 'ding' } };
      }),
    };
    const harness = mount({
      manifest: {
        ...WELCOME_HARBOR_MANIFEST,
        extensions: [{ extensionId: 'test-bell', config: { rings: 3 } }],
      },
      extensions: [extension],
    });
    expect(extension.mount).toHaveBeenCalledWith(expect.objectContaining({ config: { rings: 3 } }));
    harness.runFrames(3);
    expect(onFrame).toHaveBeenCalledTimes(3);

    expect(harness.engine.extensionApi('test-bell')).toEqual({ rings: 'ding' });
    expect(harness.engine.extensionApi('not-mounted')).toBeUndefined();

    harness.engine.dispose();
    harness.engine.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('lets an extension add a collider the player cannot pass', () => {
    const harness = mount({
      manifest: {
        ...WELCOME_HARBOR_MANIFEST,
        extensions: [{ extensionId: 'test-gate', config: {} }],
      },
      extensions: [
        {
          id: 'test-gate',
          mount: (context) => {
            context.addCollider(new Box3(new Vector3(-3, -1, 9.5), new Vector3(3, 3, 10.5)));
          },
        },
      ],
    });
    harness.setDrive(walk(FACE_NORTH));
    harness.runFrames(200);
    expect(harness.camera().position.z).toBeLessThan(9.5);
  });

  it('skips an unknown extension instead of failing the region', () => {
    const harness = mount({
      manifest: {
        ...WELCOME_HARBOR_MANIFEST,
        extensions: [{ extensionId: 'not-registered', config: {} }],
      },
    });
    harness.runFrames(1);
    expect(harness.renderer.render).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not-registered'));
  });
});

describe('createLocationEngine: cleanup (W7)', () => {
  it('stops the loop and releases the renderer, input and resize observer', () => {
    const harness = mount();
    harness.runFrames(3);
    const renders = harness.renderer.render.mock.calls.length;

    harness.engine.dispose();
    expect(harness.deps.cancelFrame).toHaveBeenCalled();
    expect(harness.controls.dispose).toHaveBeenCalledTimes(1);
    expect(harness.stopFitting).toHaveBeenCalledTimes(1);
    expect(harness.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(harness.parent.contains(harness.renderer.domElement)).toBe(false);

    harness.runFrames(5);
    expect(harness.renderer.render.mock.calls.length).toBe(renders);
  });

  it('leaves nothing behind across repeated mounts in the same container', () => {
    const parent = document.createElement('div');
    for (let round = 0; round < 3; round += 1) {
      const harness = mount({ parent });
      harness.runFrames(2);
      expect(parent.children).toHaveLength(1);
      harness.engine.dispose();
      expect(parent.children).toHaveLength(0);
    }
  });

  it('does not add a model that finishes loading after dispose', async () => {
    let resolveModel: (model: LoadedModel) => void = () => undefined;
    const harness = mount({
      loadModel: (assetId) =>
        assetId === 'npc-pip'
          ? new Promise<LoadedModel>((resolve) => {
              resolveModel = resolve;
            })
          : Promise.resolve(standingBox()),
    });
    harness.runFrames(1);
    const pip = harness.scene().getObjectByName('Pip');
    harness.engine.dispose();
    resolveModel(standingBox());
    await harness.engine.ready;
    expect(pip?.children).toHaveLength(1);
    expect(harness.scene().children).toHaveLength(0);
  });
});
