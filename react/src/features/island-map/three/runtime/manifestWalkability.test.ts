import { describe, expect, it } from 'vitest';
import { isReachable, unreachableTargets } from '@lai/game-engine/navigation';
import type { WorldInteractionContext } from '../../worldObjects';
import {
  isFixedPlatform,
  manifestSpawnPoint,
  manifestWalkability,
  walkHazardsOf,
  walkPlatformsOf,
  walkTargetsOf,
} from './manifestWalkability';
import { manifestForBand } from './manifestForBand';
import { PIRATE_BUILDER_BAY_MANIFEST } from './manifests/pirateBuilderBay';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import { WONDERWILD_FOREST_MANIFEST } from './manifests/wonderwildForest';

/**
 * LAI-2104S B1: the reachability helper over real location manifests. Walking links only, flat
 * ground, hazard areas never crossed (see docs/engineering/game-engine/guided-movement.md).
 */

describe('manifestWalkability', () => {
  it('turns a manifest into colliders, bounds and targets for the engine helper', () => {
    const input = manifestWalkability(WELCOME_HARBOR_MANIFEST);
    expect(input.colliders.length).toBeGreaterThan(4);
    expect(input.bounds?.maxX).toBeGreaterThan(WELCOME_HARBOR_MANIFEST.bounds.halfExtentX);
    const ids = (input.targets ?? []).map((target) => target.id);
    for (const npc of WELCOME_HARBOR_MANIFEST.npcs) expect(ids).toContain(npc.entityId);
    for (const interaction of WELCOME_HARBOR_MANIFEST.interactions) {
      expect(ids).toContain(interaction.id);
    }
  });

  it('every Welcome Harbor interaction is reachable from the spawn on walking links', () => {
    const input = manifestWalkability(WELCOME_HARBOR_MANIFEST);
    const start = manifestSpawnPoint(WELCOME_HARBOR_MANIFEST);
    expect(unreachableTargets(input, start)).toEqual([]);
  });

  it('Wonderwild Forest: all ten forest interactions are reachable from the spawn (WF-10)', () => {
    const interactions = WONDERWILD_FOREST_MANIFEST.interactions.map((item) => item.id);
    expect(interactions).toHaveLength(10);
    const input = manifestWalkability(WONDERWILD_FOREST_MANIFEST);
    const start = manifestSpawnPoint(WONDERWILD_FOREST_MANIFEST);
    expect(unreachableTargets(input, start, interactions)).toEqual([]);
    expect(unreachableTargets(input, start)).toEqual([]);
  });

  it('reads the world state: the Pirate Bay bridge gate shuts the far shore until it is mended', () => {
    const manifest = manifestForBand(PIRATE_BUILDER_BAY_MANIFEST, 'SPROUT');
    const start = manifestSpawnPoint(manifest);
    const broken = manifestWalkability(manifest);
    expect(unreachableTargets(broken, start)).toEqual(['cove-treasure', 'bay-tide-tunnel']);
    const mended: WorldInteractionContext = {
      worldChangeKeys: ['BRIDGE_REPAIRED'],
      ownedItemIds: [],
      discoveryIds: [],
    };
    const open = manifestWalkability(manifest, mended);
    expect(unreachableTargets(open, start)).toEqual([]);
    expect(isReachable(open, start, { id: 'cove-treasure' }).reachable).toBe(true);
  });

  it('treats only a static, always-present platform as a surface (never moving or switched)', () => {
    const base = {
      id: 'p',
      size: { width: 2, height: 0.1, depth: 2 },
      position: { x: 0, y: 0, z: 0 },
    };
    expect(isFixedPlatform(base)).toBe(true);
    expect(isFixedPlatform({ ...base, motion: { path: [{ x: 1, y: 0, z: 0 }], speed: 1 } })).toBe(
      false,
    );
    expect(isFixedPlatform({ ...base, spin: { degreesPerSecond: 10 } })).toBe(false);
    expect(isFixedPlatform({ ...base, bounce: { height: 2 } })).toBe(false);
    expect(isFixedPlatform({ ...base, activation: { trigger: 'SWITCH', source: 's' } })).toBe(
      false,
    );
    expect(walkPlatformsOf(undefined)).toEqual([]);
    expect(walkHazardsOf(undefined)).toEqual([]);
    const [platform] = walkPlatformsOf({ platforms: [base] });
    expect(platform).toMatchObject({
      min: { x: -1, y: 0, z: -1 },
      max: { x: 1, y: 0.1, z: 1 },
      fixed: true,
    });
    expect(walkTargetsOf(WELCOME_HARBOR_MANIFEST).length).toBeGreaterThan(0);
  });

  it('turns hazards into walk hazards with their depth', () => {
    const [hazard] = walkHazardsOf({
      platforms: [],
      hazards: [{ id: 'h', rect: { id: 'h', minX: 0, maxX: 1, minZ: 2, maxZ: 3 }, belowY: 0.3 }],
    });
    expect(hazard).toEqual({ id: 'h', minX: 0, maxX: 1, minZ: 2, maxZ: 3, belowY: 0.3 });
  });
});
