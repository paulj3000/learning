import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { ADVENTURE_TEMPLATES } from '../../../../adventures/content';
import { STORYBOOK_PAGES } from '../../../../great-storybook/pages';
import { STORYKEEPER_CASTLE_CHECKPOINTS } from '../../../../discovery/checkpoints';
import { FirstPersonController, type MoveInput } from '../../firstPersonController';
import { resolveJumpConfiguration } from '../../jumpConfiguration';
import { CASTLE_DOORS, CASTLE_ROOMS, DOOR_ENTRY_OFFSET_METERS } from '../../castleLayout';
import { CASTLE_CHOICE_BINDINGS } from '../../castleChoiceBindings';
import { WALL_HEIGHT } from '../../sceneKit';
import { OBSERVATORY_CHART_STAR_COUNT } from '../../castleObservatory';
import { ROOMS, WALL_SEGMENTS, isBlocked, isWalkable } from '../../storykeeperCastleRegion';
import { PlatformSystem, worldSignal } from '../../platforms/platformSystem';
import { PLATFORM_LIMITS, type PlatformSpec } from '../../platforms/platformSpec';
import { SOURCE_MANIFEST_REGISTRIES } from '../sourceManifestRegistries';
import { validateLocationManifest } from '../validateLocationManifest';
import { manifestForBand } from '../manifestForBand';
import type { RectZone } from '../locationManifest';
import {
  CASTLE_MAX_PLATFORM_TOP,
  CASTLE_MIN_FOOTPRINT,
  CASTLE_PAD_ZONES,
  CASTLE_PLATFORMING,
  CASTLE_PLATFORMING_SPROUT,
  CASTLE_PLATFORM_GROUPS,
  CASTLE_PLATFORM_REGISTRY,
  PATHWAY_PAGES,
  STORYBOOK_PATHWAY_GROUP,
  buildCastlePlatforming,
  buildSproutPlatforming,
  isPadZoneId,
  padFootprint,
  padPlatformId,
  padZoneId,
  platformGroupsForAdventure,
  worldSignalName,
  type CastlePlatformGroup,
} from './castleRooms/castlePlatforms';
import { STORYKEEPER_CASTLE_MANIFEST as MANIFEST } from './storykeeperCastle';

/**
 * The castle's platforms against the real castle (SC-JMP): every pad is inside its room and
 * clear of walls, doorways, safe spots, live zones and colliders; low enough that the jump
 * keeps the eye under the ceiling; and nothing here can reach a wall, a gate or the outside.
 */

const WALL_GAP = 0.15;
const COLLIDER_GAP = 0.15;
const DOOR_GAP = 0.2;
// GE-072: the shared controller gives the child a 0.37 m body (ADR-060), so a spot a child is sent
// to (safe spot, checkpoint, door arrival) needs the body plus a margin clear of every pad.
const SAFE_SPOT_RADIUS = 0.45;
const PROP_RADIUS = 0.3;
const CEILING_BOTTOM = WALL_HEIGHT + 0.1;
const EYE = 1.6;

const overlaps = (a: RectZone, b: RectZone, margin = 0): boolean =>
  a.minX < b.maxX + margin && b.minX < a.maxX + margin && a.minZ < b.maxZ + margin && b.minZ < a.maxZ + margin;

const grow = (rect: RectZone, by: number): RectZone => ({
  ...rect,
  minX: rect.minX - by,
  maxX: rect.maxX + by,
  minZ: rect.minZ - by,
  maxZ: rect.maxZ + by,
});

const roomFloor = (roomId: string) => ROOMS.find((room) => room.id === roomId)!.floor;

/** Every pad of every group, with its footprint. */
const PADS = CASTLE_PLATFORM_GROUPS.flatMap((group) =>
  group.pads.map((pad) => ({ group, pad, footprint: padFootprint(group, pad) })),
);

/** The zones something listens to: an approach interaction's, or a bound choice's. */
const LIVE_ZONE_IDS = new Set<string>([
  ...MANIFEST.interactions
    .filter((interaction) => interaction.trigger === 'APPROACH')
    .map((interaction) => interaction.zoneId ?? interaction.id),
  ...CASTLE_CHOICE_BINDINGS.flatMap((binding) => [binding.entityId, `${binding.entityId}:approach`]),
]);

const SAFE_SPOTS = [
  ...CASTLE_ROOMS.map((room) => room.safeSpot),
  ...STORYKEEPER_CASTLE_CHECKPOINTS.filter((cp) => cp.regionId === MANIFEST.regionId).map((cp) => ({ x: cp.x, z: cp.z })),
  // Where a child lands on coming through each door (GE-072): the tower's first stone stood there.
  ...CASTLE_DOORS.flatMap((door) => Object.values(door.arrival).map((arrival) => ({ x: arrival.x, z: arrival.z }))),
];

const box3 = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Box3 =>
  new Box3(new Vector3(minX, minY, minZ), new Vector3(maxX, maxY, maxZ));

const platformOf = (id: string): PlatformSpec => CASTLE_PLATFORMING.platforms.find((platform) => platform.id === id)!;

describe('castle platform groups: geometry', () => {
  it('puts every pad inside its own room, clear of every wall', () => {
    for (const { group, pad, footprint } of PADS) {
      const floor = roomFloor(group.roomId);
      const label = `${group.id}/${pad.key}`;
      expect(footprint.minX, label).toBeGreaterThanOrEqual(floor.minX);
      expect(footprint.maxX, label).toBeLessThanOrEqual(floor.maxX);
      expect(footprint.minZ, label).toBeGreaterThanOrEqual(floor.minZ);
      expect(footprint.maxZ, label).toBeLessThanOrEqual(floor.maxZ);
      for (const wall of WALL_SEGMENTS) {
        expect(overlaps(grow(footprint, WALL_GAP), wall), `${label} is too close to ${wall.id}`).toBe(false);
      }
    }
  });

  it('keeps every pad clear of every doorway and the way in and out of it', () => {
    for (const { group, pad, footprint } of PADS) {
      for (const door of CASTLE_DOORS) {
        const vertical = door.gap.maxX - door.gap.minX < door.gap.maxZ - door.gap.minZ;
        const approach: RectZone = vertical
          ? { ...door.gap, minX: door.centre.x - DOOR_ENTRY_OFFSET_METERS, maxX: door.centre.x + DOOR_ENTRY_OFFSET_METERS }
          : { ...door.gap, minZ: door.centre.z - DOOR_ENTRY_OFFSET_METERS, maxZ: door.centre.z + DOOR_ENTRY_OFFSET_METERS };
        expect(overlaps(grow(footprint, DOOR_GAP), approach), `${group.id}/${pad.key} blocks ${door.id}`).toBe(false);
      }
    }
  });

  it('keeps every safe spot and checkpoint off a pad, so a child sent back never lands inside one', () => {
    for (const { group, pad, footprint } of PADS) {
      for (const spot of SAFE_SPOTS) {
        const inside =
          spot.x > footprint.minX - SAFE_SPOT_RADIUS &&
          spot.x < footprint.maxX + SAFE_SPOT_RADIUS &&
          spot.z > footprint.minZ - SAFE_SPOT_RADIUS &&
          spot.z < footprint.maxZ + SAFE_SPOT_RADIUS;
        expect(inside, `${group.id}/${pad.key} is on the safe spot at ${spot.x}, ${spot.z}`).toBe(false);
      }
    }
  });

  it('keeps every pad clear of every collider, prop and character', () => {
    for (const { group, pad, footprint } of PADS) {
      const label = `${group.id}/${pad.key}`;
      for (const collider of MANIFEST.colliders) {
        expect(overlaps(grow(footprint, COLLIDER_GAP), collider.rect), `${label} touches ${collider.rect.id}`).toBe(false);
      }
      for (const prop of MANIFEST.props) {
        const at = { id: prop.entityId, minX: prop.position.x, maxX: prop.position.x, minZ: prop.position.z, maxZ: prop.position.z };
        expect(overlaps(grow(footprint, PROP_RADIUS), at), `${label} covers prop ${prop.entityId}`).toBe(false);
      }
      for (const npc of MANIFEST.npcs) {
        const at = { id: npc.entityId, minX: npc.position.x, maxX: npc.position.x, minZ: npc.position.z, maxZ: npc.position.z };
        expect(overlaps(grow(footprint, PROP_RADIUS), at), `${label} covers ${npc.entityId}`).toBe(false);
      }
    }
  });

  it('keeps every pad off every zone something listens to, except its own answer zone', () => {
    const ownZone = (groupId: string, key: string) => padZoneId(groupId, key);
    for (const { group, pad, footprint } of PADS) {
      for (const zone of MANIFEST.zones) {
        if (zone.rect.id === ownZone(group.id, pad.key)) continue;
        const live = LIVE_ZONE_IDS.has(zone.rect.id) || isPadZoneId(zone.rect.id);
        if (!live) continue;
        expect(overlaps(footprint, zone.rect), `${group.id}/${pad.key} overlaps zone ${zone.rect.id}`).toBe(false);
      }
    }
  });

  it('keeps pads off each other, so no two answer zones touch', () => {
    for (let a = 0; a < PADS.length; a += 1) {
      for (let b = a + 1; b < PADS.length; b += 1) {
        expect(overlaps(PADS[a].footprint, PADS[b].footprint), `${PADS[a].footprint.id} and ${PADS[b].footprint.id}`).toBe(false);
      }
    }
  });
});

describe('castle platform presets: height and kind', () => {
  const all = CASTLE_PLATFORMING.platforms;

  it('has unique ids, at least 0.8 m of top, and a top no higher than 0.5 m', () => {
    expect(new Set(all.map((platform) => platform.id)).size).toBe(all.length);
    expect(all.length).toBeLessThanOrEqual(PLATFORM_LIMITS.maxPlatforms);
    for (const platform of all) {
      expect(platform.size.width, platform.id).toBeGreaterThanOrEqual(CASTLE_MIN_FOOTPRINT);
      expect(platform.size.depth, platform.id).toBeGreaterThanOrEqual(CASTLE_MIN_FOOTPRINT);
      expect(platform.position.y + platform.size.height, platform.id).toBeLessThanOrEqual(CASTLE_MAX_PLATFORM_TOP);
    }
  });

  it('is static: no bounce, no vanish, no motion, no spin, no lift in the castle', () => {
    for (const platform of all) {
      expect(platform.bounce, platform.id).toBeUndefined();
      expect(platform.vanish, platform.id).toBeUndefined();
      expect(platform.motion, platform.id).toBeUndefined();
      expect(platform.spin, platform.id).toBeUndefined();
      // The only thing a castle platform may wait for is a recorded page (the pathway).
      if (platform.activation) {
        expect(platform.id.startsWith(padPlatformId(STORYBOOK_PATHWAY_GROUP.id, '')), platform.id).toBe(true);
      }
    }
  });

  it('keeps the eye under the ceiling at the top of a jump from the highest pad', () => {
    const jump = resolveJumpConfiguration(MANIFEST.movement?.jump);
    const highest = Math.max(...all.map((platform) => platform.position.y + platform.size.height));
    expect(highest + jump.jumpHeight + EYE).toBeLessThan(CEILING_BOTTOM);
    // The camera is held under the slab as well (`player.camera.maxHeight`).
    expect(MANIFEST.player?.camera?.maxHeight ?? 0).toBeLessThan(CEILING_BOTTOM);
  });

  it('really peaks under the ceiling when the real controller jumps from the highest pad', () => {
    const jump = resolveJumpConfiguration(MANIFEST.movement?.jump);
    const tall = platformOf('castle-pad:library-measure:brass');
    const top = tall.position.y + tall.size.height;
    const platform = box3(tall.position.x - 0.4, 0, tall.position.z - 0.4, tall.position.x + 0.4, top, tall.position.z + 0.4);
    const controller = new FirstPersonController({ colliders: [platform], jumpableColliders: new Set([platform]), jump: jump });
    controller.position.set(tall.position.x, top, tall.position.z);
    controller.update(1 / 60, { forward: 0, strafe: 0 });
    controller.pressJump();
    let peak = controller.position.y;
    for (let i = 0; i < 90; i += 1) {
      controller.update(1 / 60, { forward: 0, strafe: 0 });
      peak = Math.max(peak, controller.position.y);
    }
    expect(peak).toBeGreaterThan(top + 0.4);
    expect(peak + EYE).toBeLessThan(CEILING_BOTTOM);
  });

  it('never makes a wall, a gate or the world edge jumpable', () => {
    for (const collider of MANIFEST.colliders) {
      expect(collider.jumpable, collider.rect.id).not.toBe(true);
    }
    const jump = resolveJumpConfiguration(MANIFEST.movement?.jump);
    for (const wall of MANIFEST.colliders.filter((collider) => collider.rect.id.startsWith('wall:'))) {
      expect(wall.maxY ?? WALL_HEIGHT).toBeGreaterThanOrEqual(WALL_HEIGHT);
      // Even from the top of the highest pad, a jump cannot clear a wall.
      expect(CASTLE_MAX_PLATFORM_TOP + jump.jumpHeight).toBeLessThan(wall.maxY ?? WALL_HEIGHT);
    }
  });
});

describe('castle platforming in the manifest', () => {
  it('validates with the real registries, for every band', () => {
    expect(validateLocationManifest(MANIFEST, SOURCE_MANIFEST_REGISTRIES)).toEqual([]);
    expect(MANIFEST.platforming).toBe(CASTLE_PLATFORMING);
  });

  it('adds only `pad:*` zones, one for each pad that answers a step, each exactly the pad', () => {
    const padZones = MANIFEST.zones.filter((zone) => isPadZoneId(zone.rect.id));
    expect(padZones).toEqual(CASTLE_PAD_ZONES);
    const answering = CASTLE_PLATFORM_GROUPS.filter((group) => group.answers).flatMap((group) => group.pads.map((pad) => padZoneId(group.id, pad.key)));
    expect(padZones.map((zone) => zone.rect.id)).toEqual(answering);
    for (const zone of padZones) {
      const entry = PADS.find((candidate) => padZoneId(candidate.group.id, candidate.pad.key) === zone.rect.id)!;
      expect(zone.rect).toMatchObject({ minX: entry.footprint.minX, maxX: entry.footprint.maxX, minZ: entry.footprint.minZ, maxZ: entry.footprint.maxZ });
    }
  });

  it('gives Sprouts flat markers with no colliders, at the same places, answering through the same zones', () => {
    const sprout = manifestForBand(MANIFEST, 'SPROUT');
    expect(sprout.platforming).toBe(CASTLE_PLATFORMING_SPROUT);
    expect(sprout.platforming?.platforms).toEqual([]);
    expect((sprout.platforming?.pressurePlates ?? []).length).toBeGreaterThan(0);
    const system = new PlatformSystem(sprout.platforming!, {
      colliders: [],
      jumpable: new Set(),
      worldState: { worldChangeKeys: [] },
      zones: new Map(),
    });
    expect(system.platforms).toHaveLength(0);
    for (const plate of CASTLE_PLATFORMING_SPROUT.pressurePlates ?? []) {
      const [, groupId, key] = plate.id.split(':');
      const pad = PADS.find((entry) => entry.group.id === groupId && entry.pad.key === key)!;
      expect(plate.position).toEqual({ x: pad.pad.x, z: pad.pad.z });
      // Only a group that answers a step has an answer zone; an optional one (the chamber ledge) has none.
      if (pad.group.answers) {
        expect(MANIFEST.zones.some((zone) => zone.rect.id === padZoneId(groupId, key))).toBe(true);
      }
    }
    // Pathfinders and Explorers keep the solid pads.
    expect(manifestForBand(MANIFEST, 'PATHFINDER').platforming).toBe(CASTLE_PLATFORMING);
    expect(manifestForBand(MANIFEST, 'EXPLORER').platforming).toBe(CASTLE_PLATFORMING);
  });

  it('holds every band’s variant to the same validation as the default', () => {
    const broken = {
      ...MANIFEST,
      platformingByBand: {
        SPROUT: { platforms: [], pressurePlates: [{ id: 'bad-marker', position: { x: 500, z: 500 } }] },
      },
    };
    const issues = validateLocationManifest(broken, SOURCE_MANIFEST_REGISTRIES);
    expect(issues.some((issue) => issue.path.startsWith('platformingByBand.SPROUT'))).toBe(true);
  });

  it('rebuilds the same spec from the same groups (pure builders)', () => {
    expect(buildCastlePlatforming()).toEqual(CASTLE_PLATFORMING);
    expect(buildSproutPlatforming()).toEqual(CASTLE_PLATFORMING_SPROUT);
  });
});

describe('the Observatory star stones', () => {
  it('has stones where the tower has room (at most one per gold star on the chart), and answers nothing', () => {
    const group = CASTLE_PLATFORM_GROUPS.find((candidate) => candidate.id === 'observatory') as CastlePlatformGroup;
    expect(group.pads.length).toBeGreaterThanOrEqual(1);
    expect(group.pads.length).toBeLessThanOrEqual(OBSERVATORY_CHART_STAR_COUNT);
    expect(group.answers).toBe(false);
    expect(MANIFEST.zones.some((zone) => zone.rect.id.startsWith('pad:observatory'))).toBe(false);
  });
});

describe('the Great Storybook pathway follows the restored pages', () => {
  const fakePlayer = {
    position: { x: 0, y: 0, z: 0 },
    grounded: true,
    supportingBox: () => null,
    carry() {},
    inheritVelocity() {},
    launch() {},
    recover() {},
  };
  function pathwayAt(worldChangeKeys: string[], discoveryIds: string[] = []) {
    const system = new PlatformSystem(CASTLE_PLATFORMING, {
      colliders: [],
      jumpable: new Set(),
      worldState: { worldChangeKeys, discoveryIds },
      zones: new Map(),
    });
    system.update(1 / 60, fakePlayer);
    return STORYBOOK_PATHWAY_GROUP.pads.map((pad) => system.platforms.find((p) => p.spec.id === padPlatformId(STORYBOOK_PATHWAY_GROUP.id, pad.key))!);
  }

  it('has one pad for each page, in page order, and no more', () => {
    expect(STORYBOOK_PATHWAY_GROUP.pads.length).toBe(PATHWAY_PAGES.length);
    expect(PATHWAY_PAGES).toEqual(STORYBOOK_PAGES);
    expect(STORYBOOK_PAGES.length).toBeLessThanOrEqual(6);
  });

  it('shows no pad before any page is back', () => {
    expect(pathwayAt([]).every((state) => !state.present)).toBe(true);
  });

  it('shows exactly the pads of the pages whose records exist, on entry (persists on reload)', () => {
    const keys = ['FIRST_STORY_TOLD', 'STUDIO_PAGE_MENDED'];
    const states = pathwayAt(keys);
    STORYBOOK_PAGES.forEach((page, index) => {
      const restored = page.source.kind === 'WORLD_CHANGE' && keys.includes(page.source.changeKey);
      expect(states[index].present, page.id).toBe(restored);
    });
  });

  it('shows the hidden bonus page only once its discovery is found', () => {
    const bonusIndex = STORYBOOK_PAGES.findIndex((page) => page.source.kind === 'DISCOVERY');
    expect(pathwayAt([])[bonusIndex].present).toBe(false);
    expect(pathwayAt([], ['castle-tapestry-stair'])[bonusIndex].present).toBe(true);
  });

  it('raises a pad live when the view signals the page’s world change', () => {
    const system = new PlatformSystem(CASTLE_PLATFORMING, {
      colliders: [],
      jumpable: new Set(),
      worldState: { worldChangeKeys: [] },
      zones: new Map(),
    });
    system.update(1 / 60, fakePlayer);
    const first = system.platforms.find((p) => p.spec.id === padPlatformId(STORYBOOK_PATHWAY_GROUP.id, 'p1'))!;
    expect(first.present).toBe(false);
    system.signal(worldSignal('FIRST_STORY_TOLD'));
    system.update(1 / 60, fakePlayer);
    expect(first.present).toBe(true);
    // Signalling again changes nothing: the pad is already there, nothing is granted.
    system.signal(worldSignal('FIRST_STORY_TOLD'));
    system.update(1 / 60, fakePlayer);
    expect(first.present).toBe(true);
  });

  it('names its signal the way the shared runtime does', () => {
    expect(worldSignalName('FIRST_STORY_TOLD')).toBe(worldSignal('FIRST_STORY_TOLD'));
  });
});

describe('jumping near an edge', () => {
  const STILL: MoveInput = { forward: 0, strafe: 0 };

  function castleController() {
    const colliders = MANIFEST.colliders.map((collider) =>
      box3(collider.rect.minX, collider.minY ?? 0, collider.rect.minZ, collider.rect.maxX, collider.maxY ?? WALL_HEIGHT, collider.rect.maxZ),
    );
    const jumpable = new Set<Box3>();
    const system = new PlatformSystem(CASTLE_PLATFORMING, {
      colliders,
      jumpable,
      worldState: { worldChangeKeys: [] },
      zones: new Map(),
    });
    const controller = new FirstPersonController({
      colliders,
      jumpableColliders: jumpable,
      jump: resolveJumpConfiguration(MANIFEST.movement?.jump),
      isSafeGround: (x, y, z) => system.isSafeGround(x, y, z),
      recoveryPoint: () => system.recoveryPoint(),
    });
    return { controller, system };
  }

  it('never leaves the room by walking and jumping into a wall, in any room with pads', () => {
    for (const roomId of new Set(CASTLE_PLATFORM_GROUPS.map((group) => group.roomId))) {
      const floor = roomFloor(roomId);
      // A few starting rows where the east wall is solid (not a doorway) and the start is clear.
      const rows = [-0.75, 0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, -2.5, -4.5, -5.5, -6.5, -7.5, -8.5]
        .filter((z) => z > floor.minZ + 0.6 && z < floor.maxZ - 0.6)
        .filter((z) => isBlocked(floor.maxX, z) && isWalkable(floor.maxX - 1.2, z))
        .slice(0, 3);
      expect(rows.length, roomId).toBeGreaterThan(0);
      for (const startZ of rows) {
        const { controller, system } = castleController();
        controller.position.set(floor.maxX - 1.2, 0, startZ);
        controller.yaw = Math.PI / 2;
        for (let i = 0; i < 300; i += 1) {
          if (i % 40 === 0) controller.pressJump();
          system.update(1 / 60, controller);
          controller.update(1 / 60, { forward: 1, strafe: 0 });
        }
        expect(controller.position.x, `${roomId} z ${startZ}`).toBeLessThan(floor.maxX);
        expect(isWalkable(controller.position.x, controller.position.z), `${roomId} z ${startZ}`).toBe(true);
      }
    }
  });

  it('recovers to a safe place when lost, and changes nothing but position', () => {
    const { controller, system } = castleController();
    controller.position.set(7, 0, 7);
    controller.update(1 / 60, STILL);
    const before = { x: controller.position.x, z: controller.position.z };
    controller.position.set(7, -40, 7);
    system.update(1 / 60, controller);
    controller.update(1 / 60, STILL);
    expect(Number.isFinite(controller.position.y)).toBe(true);
    expect(controller.position.y).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(controller.position.x - before.x, controller.position.z - before.z)).toBeLessThan(2);
  });
});

describe('every castle adventure has a platform configuration', () => {
  const CASTLE_LOCATIONS = new Set(['storykeeper-castle', 'castle-secret-passage']);
  // Vitest runs from `react/`; the inventory lives in the repository's `docs/`.
  const INVENTORY = readFileSync(
    resolve(process.cwd(), '..', 'docs', 'regions', 'storykeeper_castle_jumping_inventory.md'),
    'utf8',
  );
  /** Exceptions are lines in the inventory: `OWNER-APPROVED EXCEPTION: <slug> (reason)`. */
  const EXCEPTIONS = new Set(
    [...INVENTORY.matchAll(/^OWNER-APPROVED EXCEPTION: ([a-z0-9-]+)/gm)].map((match) => match[1]),
  );

  const castleAdventures = ADVENTURE_TEMPLATES.filter((template) => CASTLE_LOCATIONS.has(template.locationSlug));

  it('finds the castle adventures the inventory lists', () => {
    const slugs = castleAdventures.map((adventure) => adventure.slug).sort();
    expect(slugs).toEqual(
      [
        'quills-picture-story',
        'secret-door-chapter-1-three-clues',
        'secret-door-chapter-2-pattern-lock',
        'the-painted-words',
        'the-painted-words-again',
        'the-storykeepers-tale',
      ].sort(),
    );
  });

  it('gives each one a registered platform group, unless the inventory lists an owner-approved exception', () => {
    for (const adventure of castleAdventures) {
      if (EXCEPTIONS.has(adventure.slug)) continue;
      const groups = platformGroupsForAdventure(adventure.slug);
      expect(groups.length, `${adventure.slug} has no platform configuration`).toBeGreaterThan(0);
      for (const id of groups) {
        expect(CASTLE_PLATFORM_GROUPS.some((group) => group.id === id), `${adventure.slug}: unknown group ${id}`).toBe(true);
      }
    }
  });

  it('registers only adventures that exist, and every inventory exception names a real adventure', () => {
    for (const entry of CASTLE_PLATFORM_REGISTRY) {
      expect(castleAdventures.some((adventure) => adventure.slug === entry.adventureSlug), entry.adventureSlug).toBe(true);
    }
    for (const slug of EXCEPTIONS) {
      expect(castleAdventures.some((adventure) => adventure.slug === slug), slug).toBe(true);
    }
  });

  it('documents every registered adventure in the inventory', () => {
    for (const entry of CASTLE_PLATFORM_REGISTRY) {
      expect(INVENTORY, entry.adventureSlug).toContain(`\`${entry.adventureSlug}\``);
      expect(INVENTORY, entry.groupId).toContain(`\`${entry.groupId}\``);
    }
  });
});
