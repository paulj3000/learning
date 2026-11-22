import { describe, expect, it } from 'vitest';
import { Mesh, type MeshStandardMaterial } from 'three';
import { castleTaleExtension } from '../../extensions/castleTale/castleTaleScene';
import { mount } from '../testing/engineHarness';
import { countBoxDrawCalls, groupStaticBoxes, isStaticBox } from '../staticBoxBatches';
import { manifestForBand } from '../manifestForBand';
import { PlatformSystem } from '../../platforms/platformSystem';
import { PLATFORM_LIMITS } from '../../platforms/platformSpec';
import { CASTLE_ROOMS } from '../../castleLayout';
import { isBlocked, ROOMS, WALL_SEGMENTS } from '../../storykeeperCastleRegion';
import baseline from './castleOptimisationBaseline.json';
import {
  baselineCollidersWithMoves,
  gameplaySnapshot,
  roundedColliders,
} from './castleOptimisationSnapshot';
import {
  CASTLE_MAX_PLATFORM_TOP,
  CHAMBER_LEDGE_GROUP,
  CHAMBER_VIEW_ZONE_ID,
  padFootprint,
} from './castleRooms/castlePlatforms';
import { STORYKEEPER_CASTLE_MANIFEST as MANIFEST } from './storykeeperCastle';
import { LIVE_DECOR_IDS } from './storykeeperCastleVisuals';
import { estimateDrawCalls } from './storykeeperCastleBudgets.test';

/**
 * WS-C: the castle's rendering optimisation changes how decor is drawn and
 * nothing about how the castle plays. The baseline fixture was captured from
 * the manifest before the optimisation; the only additions allowed since are
 * the optional Secret Chamber ledge's own pads, markers and view zone.
 */

const isChamberAddition = (id: string) =>
  id.startsWith('castle-pad:chamber:') ||
  id.startsWith('castle-marker:chamber:') ||
  id.startsWith('view:chamber:');

describe('colliders, zones, interactions and ids are unchanged by the optimisation', () => {
  const now = gameplaySnapshot(MANIFEST) as Record<string, unknown[]>;
  const before = baseline as unknown as Record<string, unknown[]>;

  it('keeps colliders identical, in order, apart from the reviewed moves', () => {
    expect(roundedColliders(now.colliders)).toEqual(baselineCollidersWithMoves(before.colliders));
  });

  it.each(['interactions', 'checkpoints', 'props', 'npcs', 'collectibles', 'sceneryIds'])(
    'keeps %s identical, in order',
    (key) => {
      expect(now[key]).toEqual(before[key]);
    },
  );

  it('keeps every zone, adding only the optional ledge view zone', () => {
    const zoneId = (zone: unknown) => (zone as [string])[0];
    expect(now.zones.filter((zone) => !isChamberAddition(zoneId(zone)))).toEqual(before.zones);
    expect(now.zones.filter((zone) => isChamberAddition(zoneId(zone))).map(zoneId)).toEqual([
      CHAMBER_VIEW_ZONE_ID,
    ]);
  });

  it('keeps every platform, adding only the optional chamber stones', () => {
    // GE-072: the one deliberate removal since the baseline. The first Observatory star stone no
    // longer fits beside the child's 0.37 m body (ADR-060); see castlePlatforms.ts.
    const removed = new Set(['castle-pad:observatory:s1']);
    expect(now.platforms.filter((id) => !isChamberAddition(id as string))).toEqual(
      before.platforms.filter((id) => !removed.has(id as string)),
    );
    expect(now.pressurePlates.filter((id) => !isChamberAddition(id as string))).toEqual(
      before.pressurePlates,
    );
    expect(now.courseCheckpoints).toEqual(before.courseCheckpoints);
  });

  it('keeps every interactive and prop entity id out of the batched boxes', () => {
    const batched = new Set(
      MANIFEST.scenery.filter((item) => isStaticBox(item)).map((item) => item.id),
    );
    for (const id of [
      ...MANIFEST.interactions.map((interaction) => interaction.id),
      ...MANIFEST.props.map((prop) => prop.entityId),
      ...LIVE_DECOR_IDS,
    ]) {
      expect(batched.has(id), id).toBe(false);
    }
  });
});

describe('static decor batching', () => {
  it('batches most decor boxes, but never one an extension recolours or hides', () => {
    const boxes = MANIFEST.scenery.filter((item) => item.kind === 'BOX');
    const staticBoxes = boxes.filter(isStaticBox);
    expect(staticBoxes.length).toBeGreaterThan(100);
    for (const item of boxes) {
      expect(isStaticBox(item), item.id).toBe(!LIVE_DECOR_IDS.has(item.id));
    }
  });

  it('draws far fewer calls than one per box', () => {
    const boxes = MANIFEST.scenery.filter((item) => item.kind === 'BOX').length;
    expect(countBoxDrawCalls(MANIFEST.scenery)).toBeLessThan(boxes * 0.6);
  });

  it('builds one merged mesh and one shared material per batch inside the engine', () => {
    const harness = mount({ manifest: MANIFEST, extensions: [castleTaleExtension] });
    harness.runFrames(1);
    const batches: Mesh[] = [];
    harness.scene().traverse((object) => {
      if (object instanceof Mesh && object.name.startsWith('static-boxes:')) batches.push(object);
    });
    // Boxes gated on world state (trophies, the chamber find) are absent in a fresh world, and the
    // estimate counts them anyway, so it errs high.
    const groups = groupStaticBoxes(MANIFEST.scenery.filter((item) => !item.requirements));
    expect(batches.length).toBeLessThanOrEqual(groupStaticBoxes(MANIFEST.scenery).size);
    expect(batches).toHaveLength(groups.size);
    const materials = new Set(batches.map((mesh) => mesh.material as MeshStandardMaterial));
    const colours = new Set([...groups.values()].map((boxes) => boxes[0].color));
    expect(materials.size).toBe(colours.size);
    // Every box is 24 vertices; none is lost in the merge.
    const vertices = batches.reduce(
      (sum, mesh) => sum + mesh.geometry.getAttribute('position').count,
      0,
    );
    const boxCount = [...groups.values()].reduce((sum, boxes) => sum + boxes.length, 0);
    expect(vertices).toBe(boxCount * 24);
    harness.engine.dispose();
  });

  it('still registers a named, empty root for every batched box, and keeps live boxes as meshes', () => {
    const harness = mount({ manifest: MANIFEST, extensions: [castleTaleExtension] });
    harness.runFrames(1);
    const dais = harness.scene().getObjectByName('castle-dais');
    expect(dais).toBeDefined();
    expect(dais!.children).toHaveLength(0);
    for (const id of LIVE_DECOR_IDS) {
      const root = harness.scene().getObjectByName(id);
      expect(root?.children.length, id).toBeGreaterThan(0);
    }
    harness.engine.dispose();
  });

  it('releases the merged geometry and shared materials on dispose', () => {
    const harness = mount({ manifest: MANIFEST, extensions: [castleTaleExtension] });
    harness.runFrames(1);
    const batches: Mesh[] = [];
    harness.scene().traverse((object) => {
      if (object instanceof Mesh && object.name.startsWith('static-boxes:')) batches.push(object);
    });
    let disposed = 0;
    for (const mesh of batches) {
      mesh.geometry.addEventListener('dispose', () => (disposed += 1));
    }
    harness.engine.dispose();
    expect(disposed).toBe(batches.length);
  });
});

describe('the draw-call estimate (an estimate, not a measurement)', () => {
  it('stays at or under the unchanged 300 budget with real headroom', () => {
    const estimate = estimateDrawCalls(MANIFEST);
    expect(estimate).toBeLessThanOrEqual(300);
    expect(300 - estimate).toBeGreaterThanOrEqual(20);
  });
});

describe('the optional Secret Chamber ledge', () => {
  const secretFloor = ROOMS.find((room) => room.id === 'secret-chamber')!.floor;
  const pads = CHAMBER_LEDGE_GROUP.pads.map((pad) => ({
    pad,
    rect: padFootprint(CHAMBER_LEDGE_GROUP, pad),
  }));

  it('is two low stepping stones and a ledge, all inside the chamber and no higher than a castle pad may be', () => {
    expect(pads).toHaveLength(3);
    const heights = pads.map(({ pad }) => pad.height!);
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
    for (const { rect, pad } of pads) {
      expect(pad.height!).toBeLessThanOrEqual(CASTLE_MAX_PLATFORM_TOP);
      expect(rect.minX).toBeGreaterThanOrEqual(secretFloor.minX);
      expect(rect.maxX).toBeLessThanOrEqual(secretFloor.maxX);
      expect(rect.minZ).toBeGreaterThanOrEqual(secretFloor.minZ);
      expect(rect.maxZ).toBeLessThanOrEqual(secretFloor.maxZ);
    }
    // Each step up is no more than the shared runtime's walkable rise allows a jump to cover.
    expect(pads[0].pad.height!).toBeLessThan(PLATFORM_LIMITS.minTop);
  });

  it('is never required: nothing answers, grants or unlocks, and no interaction or objective names it', () => {
    expect(CHAMBER_LEDGE_GROUP.answers).toBe(false);
    expect(MANIFEST.zones.some((zone) => zone.rect.id.startsWith('pad:chamber'))).toBe(false);
    const named = JSON.stringify(MANIFEST.interactions);
    expect(named).not.toContain('chamber:');
    expect(named).not.toContain('view:chamber');
    expect(MANIFEST.checkpoints.ids.some((id) => id.includes('chamber-ledge'))).toBe(false);
    expect(
      MANIFEST.platforming?.platforms.filter((platform) =>
        platform.id.startsWith('castle-pad:chamber:'),
      ),
    ).toHaveLength(3);
  });

  it('has an observation-only view: one narration zone over the ledge and no interaction', () => {
    const zone = MANIFEST.zones.find((candidate) => candidate.rect.id === CHAMBER_VIEW_ZONE_ID)!;
    const ledge = pads[2].rect;
    expect(zone.enterMessage).toMatch(/view/i);
    expect(zone.rect).toMatchObject({
      minX: ledge.minX,
      maxX: ledge.maxX,
      minZ: ledge.minZ,
      maxZ: ledge.maxZ,
    });
    expect(MANIFEST.interactions.some((i) => (i.zoneId ?? i.id) === CHAMBER_VIEW_ZONE_ID)).toBe(
      false,
    );
  });

  it('shows Sprouts flat markers instead of solid pads, at the same places, with the view still reachable on foot', () => {
    const sprout = manifestForBand(MANIFEST, 'SPROUT');
    expect(sprout.platforming?.platforms).toEqual([]);
    const markers = (sprout.platforming?.pressurePlates ?? []).filter((plate) =>
      plate.id.startsWith('castle-marker:chamber:'),
    );
    expect(markers.map((marker) => marker.position)).toEqual(
      CHAMBER_LEDGE_GROUP.pads.map((pad) => ({ x: pad.x, z: pad.z })),
    );
    expect(sprout.zones.some((zone) => zone.rect.id === CHAMBER_VIEW_ZONE_ID)).toBe(true);
    const system = new PlatformSystem(sprout.platforming!, {
      colliders: [],
      jumpable: new Set(),
      worldState: { worldChangeKeys: [] },
      zones: new Map(),
    });
    expect(system.platforms).toHaveLength(0);
  });

  it('keeps Pathfinders and Explorers on the solid pads', () => {
    for (const band of ['PATHFINDER', 'EXPLORER'] as const) {
      const platforms = manifestForBand(MANIFEST, band).platforming?.platforms ?? [];
      expect(
        platforms.filter((platform) => platform.id.startsWith('castle-pad:chamber:')),
      ).toHaveLength(3);
    }
  });

  it('keeps the chamber walkable: no pad sits on a wall, the passage or a collider', () => {
    for (const { rect } of pads) {
      for (const wall of WALL_SEGMENTS) {
        const touches =
          rect.minX < wall.maxX &&
          wall.minX < rect.maxX &&
          rect.minZ < wall.maxZ &&
          wall.minZ < rect.maxZ;
        expect(touches, `${rect.id} touches ${wall.id}`).toBe(false);
      }
      expect(isBlocked((rect.minX + rect.maxX) / 2, (rect.minZ + rect.maxZ) / 2)).toBe(false);
    }
    expect(CASTLE_ROOMS.some((room) => room.id === 'secret-chamber')).toBe(true);
  });
});
