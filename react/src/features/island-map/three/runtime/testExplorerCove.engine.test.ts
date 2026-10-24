import { describe, expect, it, vi } from 'vitest';
import { FACE_NORTH, FACE_SOUTH, mount, named, standAt, walk } from './testing/engineHarness';
import {
  COVE_NPC_ENTITY_ID,
  COVE_SHELL_ENTITY_ID,
  COVE_SHELL_FOUND,
  COVE_SIGNPOST_ENTITY_ID,
  COVE_TIDE_POOL_ZONE_ID,
  TEST_EXPLORER_COVE_MANIFEST as MANIFEST,
} from './testing/testExplorerCove';

/**
 * Engine Phase 17: the real runtime building a location it has never seen.
 * Nothing here is registered for the cove except its checkpoints, which the
 * World State catalogue owns (see `testing/testExplorerCove.ts`).
 */
vi.mock('../../../discovery/checkpoints', async (importOriginal) => {
  const { withTestExplorerCoveCheckpoints } = await import('./testing/testExplorerCove');
  return withTestExplorerCoveCheckpoints(await importOriginal());
});

function cove(options: Parameters<typeof mount>[0] = {}) {
  return mount({ manifest: MANIFEST, ...options });
}

describe('Test Explorer Cove on the generic runtime (engine Phase 17)', () => {
  it('spawns a first-time child at the landing, and reports it as a checkpoint', () => {
    const harness = cove();
    harness.runFrames(2);
    expect(harness.camera().position.toArray()).toEqual([0, 1.6, 8]);
    expect(named(harness.events, 'PlayerEnteredZone')).toEqual([
      { zoneId: 'test-explorer-cove:landing' },
    ]);
  });

  it('spawns a returning child at the checkpoint they saved', () => {
    const harness = cove({ startCheckpointId: 'test-explorer-cove:rock-pools' });
    harness.runFrames(1);
    expect(harness.camera().position.toArray()).toEqual([-6, 1.6, -6]);
  });

  it('stops the child at the sea wall the manifest declares', () => {
    const harness = cove();
    harness.setDrive(walk(FACE_NORTH));
    harness.runFrames(400);
    expect(harness.camera().position.z).toBeLessThan(10.5);
  });

  it('fires the tide pool zone when the child walks into it', () => {
    const harness = cove({ startCheckpointId: 'test-explorer-cove:rock-pools' });
    harness.runFrames(2);
    expect(named(harness.events, 'PlayerEnteredZone')).toContainEqual({
      zoneId: COVE_TIDE_POOL_ZONE_ID,
    });
  });

  it('reports meeting Pip as the child walks past', () => {
    const harness = cove();
    harness.setDrive(standAt(4, 4, FACE_SOUTH));
    harness.runFrames(2);
    expect(named(harness.events, 'NpcApproached')).toEqual([{ entityId: COVE_NPC_ENTITY_ID }]);
  });

  it('focuses and interacts with Pip and the signpost by their entity ids', async () => {
    const harness = cove();
    await harness.engine.ready;
    harness.setDrive(standAt(4, 4, FACE_SOUTH));
    harness.runFrames(1);
    expect(named(harness.events, 'InteractableFocused').at(-1)).toEqual({
      entityId: COVE_NPC_ENTITY_ID,
    });
    harness.engine.interact();

    harness.setDrive(standAt(-4, 4, FACE_SOUTH));
    harness.runFrames(1);
    expect(named(harness.events, 'InteractableFocused').at(-1)).toEqual({
      entityId: COVE_SIGNPOST_ENTITY_ID,
    });
    harness.engine.interact();

    expect(named(harness.events, 'ObjectInteracted')).toEqual([
      expect.objectContaining({ entityId: COVE_NPC_ENTITY_ID }),
      expect.objectContaining({ entityId: COVE_SIGNPOST_ENTITY_ID }),
    ]);
  });

  it('lets the child pick the shell up once, and leaves it out once it is found', async () => {
    const harness = cove();
    await harness.engine.ready;
    harness.setDrive(standAt(8, -6, FACE_SOUTH));
    harness.runFrames(1);
    harness.engine.interact();
    harness.engine.interact();
    expect(named(harness.events, 'CollectiblePickedUp')).toEqual([
      { entityId: COVE_SHELL_ENTITY_ID },
    ]);

    const found = cove({
      worldState: { worldChangeKeys: [COVE_SHELL_FOUND], ownedItemIds: [], discoveryIds: [] },
    });
    await found.engine.ready;
    found.setDrive(standAt(8, -6, FACE_SOUTH));
    found.runFrames(1);
    found.engine.interact();
    expect(named(found.events, 'CollectiblePickedUp')).toEqual([]);
  });

  it('cleans up after itself', () => {
    const harness = cove();
    harness.runFrames(1);
    harness.engine.dispose();
    expect(harness.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(harness.controls.dispose).toHaveBeenCalledTimes(1);
  });
});
