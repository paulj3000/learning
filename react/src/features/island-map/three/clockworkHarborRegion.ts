import {
  CLOCKWORK_HARBOR_CHECKPOINTS,
  CLOCKWORK_HARBOR_REGION_ID,
} from '../../discovery/checkpoints';

/**
 * Pure content and geometry for Clockwork Harbor (`docs/regions/clockwork.md`
 * section 5 "Region Layout" and section 9 "Phase 3 - Clockwork Harbor MVP
 * Environment").
 *
 * Plain numbers rather than `THREE.Vector3`/`THREE.Box3`, the same split
 * `welcomeHarborRegion.ts` and `wonderwildForestRegion.ts` use: this file
 * stays unit-testable with no rendering context, and
 * `clockworkHarborScene.ts` is the only place these numbers become `three`
 * objects.
 *
 * Section 9 is explicit about not building the whole town first. What is
 * authored here is its list and nothing beyond it: harbor entrance, dock,
 * lighthouse exterior, lighthouse interior, a basic marketplace, and the
 * initial NPCs. The districts section 5 puts past the drawbridge (Inventor
 * District, Menagerie, Workshop, tunnels, Heart of the Harbor) are
 * deliberately absent rather than stubbed - an empty room a child can walk
 * into is a worse promise than a gate that has not opened yet.
 *
 * Checkpoint *positions* live in `src/features/discovery/checkpoints.ts`, per
 * ADR-008: the World Engine may depend downward on World State, never the
 * other way round.
 */

export const REGION_ID = CLOCKWORK_HARBOR_REGION_ID;

/** A rectangular footprint or trigger volume on the ground plane, in world x/z meters. */
export interface RectZone {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function isInsideRect(x: number, z: number, zone: RectZone): boolean {
  return x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ;
}

/** The harbor is a wider plot than Welcome Harbor's: section 5 puts four reachable districts on it rather than one green. */
export const GROUND_HALF_EXTENT = 22;
const WALL_THICKNESS = 1;

export const BOUNDARY_WALLS: readonly RectZone[] = [
  {
    id: 'boundary-north',
    minX: -GROUND_HALF_EXTENT,
    maxX: GROUND_HALF_EXTENT,
    minZ: -GROUND_HALF_EXTENT - WALL_THICKNESS,
    maxZ: -GROUND_HALF_EXTENT,
  },
  {
    id: 'boundary-south',
    minX: -GROUND_HALF_EXTENT,
    maxX: GROUND_HALF_EXTENT,
    minZ: GROUND_HALF_EXTENT,
    maxZ: GROUND_HALF_EXTENT + WALL_THICKNESS,
  },
  {
    id: 'boundary-east',
    minX: GROUND_HALF_EXTENT,
    maxX: GROUND_HALF_EXTENT + WALL_THICKNESS,
    minZ: -GROUND_HALF_EXTENT,
    maxZ: GROUND_HALF_EXTENT,
  },
  {
    id: 'boundary-west',
    minX: -GROUND_HALF_EXTENT - WALL_THICKNESS,
    maxX: -GROUND_HALF_EXTENT,
    minZ: -GROUND_HALF_EXTENT,
    maxZ: GROUND_HALF_EXTENT,
  },
];

/**
 * The four districts a child can currently walk into, as trigger volumes.
 *
 * Entering one fires `PlayerEnteredZone`, which the view turns into a HUD
 * toast naming the place - the same mechanism Welcome Harbor's buildings use.
 * These are the "room triggers" section 30 of the castle roadmap established
 * and this region reuses.
 */
export const DISTRICT_ZONES: readonly RectZone[] = [
  { id: 'clockwork-harbor:zone:harbor-entrance', minX: -6, maxX: 6, minZ: 14, maxZ: 21 },
  { id: 'clockwork-harbor:zone:docks', minX: -8, maxX: 8, minZ: 4, maxZ: 14 },
  { id: 'clockwork-harbor:zone:lighthouse', minX: -21, maxX: -10, minZ: -5, maxZ: 6 },
  { id: 'clockwork-harbor:zone:marketplace', minX: 0, maxX: 14, minZ: -13, maxZ: -2 },
];

/** Child-facing names for the district toasts. Readable aloud (CLAUDE.md section 13). */
export const DISTRICT_LABELS: Readonly<Record<string, string>> = {
  'clockwork-harbor:zone:harbor-entrance': 'the harbor gate',
  'clockwork-harbor:zone:docks': 'the docks',
  'clockwork-harbor:zone:lighthouse': 'the lighthouse',
  'clockwork-harbor:zone:marketplace': 'the marketplace',
};

/**
 * The lighthouse: a round tower with a machine room a child walks into.
 *
 * Authored as four wall runs with the east side left out, so the doorway is a
 * real gap in the collision geometry rather than a door that opens by script -
 * the rule Welcome Harbor's buildings established, and the reason
 * `wallSides` omits `east`.
 */
export const LIGHTHOUSE = {
  id: 'lighthouse',
  label: 'the lighthouse',
  x: -16,
  z: 0,
  halfWidth: 4,
  halfDepth: 4,
  height: 9,
  wallSides: ['north', 'south', 'west'] as readonly ('north' | 'south' | 'east' | 'west')[],
  interiorZone: {
    id: 'clockwork-harbor:lighthouse:interior',
    minX: -19.5,
    maxX: -12.5,
    minZ: -3.5,
    maxZ: 3.5,
  } satisfies RectZone,
};

/**
 * The dock deck: a walkable platform over the water at the harbor mouth.
 *
 * Not a collider - a child walks along it. The water either side of it is
 * (`WATER_ZONES`).
 */
export const DOCK_DECK: RectZone = {
  id: 'clockwork-harbor:dock-deck',
  minX: -3,
  maxX: 3,
  minZ: 4,
  maxZ: 15,
};

/**
 * Open water, which is a collider: a child who could stroll into the harbor
 * would fall out of the world. Section 12's finale floods the harbor, so this
 * boundary matters to the story as well as to the physics.
 */
export const WATER_ZONES: readonly RectZone[] = [
  { id: 'clockwork-harbor:water-west', minX: -9, maxX: -3, minZ: 6, maxZ: 21 },
  { id: 'clockwork-harbor:water-east', minX: 3, maxX: 9, minZ: 6, maxZ: 21 },
];

/**
 * Market stalls (section 9's "Basic marketplace", section 11's witnesses stand
 * at them). Each is a solid block a child walks around, not enterable.
 */
export const MARKET_STALLS: readonly { id: string; x: number; z: number; halfSize: number }[] = [
  { id: 'stall-baker', x: 3, z: -5, halfSize: 1.2 },
  { id: 'stall-fisherman', x: 8, z: -4.5, halfSize: 1.2 },
  { id: 'stall-clockmaker', x: 11.5, z: -8, halfSize: 1.2 },
  { id: 'stall-merchant', x: 4.5, z: -10, halfSize: 1.2 },
];

/** The clock tower, section 5's landmark off the marketplace. Solid; its interior is not part of this milestone. */
export const CLOCK_TOWER = { id: 'clock-tower', x: 13, z: -12, halfSize: 2.5, height: 12 };

/**
 * Where the initial NPCs stand (section 9, "Initial NPCs"; section 4).
 *
 * The Harbor Master opens the region and hands out chapter one, so he stands
 * between the gate and the dock where a child arriving at
 * `clockwork-harbor:harbor-entrance` will walk straight into him.
 *
 * Professor Ticktock is placed at the marketplace edge rather than in his
 * workshop: the workshop is past the drawbridge (section 5) and so is not
 * built yet, and an NPC section 15 makes the harbor's hint-giver needs to be
 * reachable from the first chapter.
 */
export const NPC_SPOTS: readonly {
  id: string;
  label: string;
  x: number;
  z: number;
  /**
   * The manifest asset each one wears. Both pointed at `npc-pip` until the
   * Modular Men import, which is why the Harbor Master and Professor
   * Ticktock used to be the same pirate as each other. Ticktock's is a
   * stand-in, not his final model - see `docs/MODELS_NEEDED.md` section 7.
   */
  assetId: string;
}[] = [
  { id: 'harbor-master', label: 'the Harbor Master', x: 0, z: 12, assetId: 'npc-harbor-master' },
  {
    id: 'professor-ticktock',
    label: 'Professor Ticktock',
    x: 2,
    z: -3,
    assetId: 'npc-professor-ticktock',
  },
];

export const HARBOR_MASTER_ID = 'harbor-master';
export const PROFESSOR_TICKTOCK_ID = 'professor-ticktock';

/**
 * The lighthouse power mechanism: chapter one's interactive object
 * (section 10, "Player discovers the lighthouse power mechanism").
 *
 * A stable interaction id rather than a mesh reference, per ADR-008's rule
 * that durable state is keyed by semantic ids. The challenge behind it is
 * chosen by the Adaptive Challenge Engine, not authored into the geometry.
 */
export const LIGHTHOUSE_MECHANISM = {
  id: 'clockwork-harbor:prop:lighthouse-mechanism',
  label: 'the lighthouse machine',
  x: -16,
  z: -1.5,
};

/** The harbor gate, shut until the lighthouse turns (section 10's completion event opens it). */
export const HARBOR_GATE = {
  id: 'clockwork-harbor:prop:harbor-gate',
  label: 'the harbor gate',
  x: 0,
  z: 20,
  halfWidth: 6,
  height: 5,
};

/**
 * Instanced crate and barrel clutter along the dock, generated rather than
 * hand-listed since the shape (a loose double row) is what matters. Instanced
 * for the same reason Welcome Harbor's crates are: one draw call.
 */
export const DOCK_CLUTTER: readonly { x: number; z: number }[] = Array.from(
  { length: 12 },
  (_, index) => ({
    /*
      Just inside the deck's edges (it spans x -3..3), not outside them. These
      were at +/-4.2, which is inside `WATER_ZONES` - so once the water became
      visible the crates were floating on it. The original test only asserted
      they were clear of the deck, which they were; `isInsideRect` against the
      water zones is the invariant that actually catches this, and is now
      asserted too.
    */
    x: index % 2 === 0 ? -2.6 : 2.6,
    z: 5 + Math.floor(index / 2) * 1.6,
  }),
);

/**
 * The three Golden Gears reachable in this milestone (section 21 hides twelve
 * across the finished region).
 *
 * Placed where exploration rather than a quest marker finds them - behind the
 * lighthouse, under the dock's far end, on the roof line of the clock tower -
 * matching section 21's rule that some require "exploration" and section 26's
 * "secrets without quest markers".
 */
export const GOLDEN_GEAR_SPOTS: readonly { id: string; x: number; y: number; z: number }[] = [
  { id: 'golden-gear-01', x: -20, y: 0.5, z: -4 },
  { id: 'golden-gear-02', x: 2.4, y: 0.4, z: 14.2 },
  { id: 'golden-gear-03', x: 13, y: 1.2, z: -14.6 },
];

/** A looping gull flight over the harbor mouth. Decorative, never interactive. */
export const AMBIENT_GULL_PATH: readonly { x: number; y: number; z: number }[] = [
  { x: -6, y: 6, z: 16 },
  { x: 6, y: 7, z: 14 },
  { x: 5, y: 6, z: 20 },
  { x: -5, y: 7, z: 20 },
];

export const CLOCKWORK_HARBOR_REGION_CHECKPOINTS = CLOCKWORK_HARBOR_CHECKPOINTS;

/** Every solid the first-person controller collides with, as authored rects. */
export const COLLIDERS: readonly RectZone[] = [
  ...BOUNDARY_WALLS,
  ...WATER_ZONES,
  ...MARKET_STALLS.map((stall) => ({
    id: `collider:${stall.id}`,
    minX: stall.x - stall.halfSize,
    maxX: stall.x + stall.halfSize,
    minZ: stall.z - stall.halfSize,
    maxZ: stall.z + stall.halfSize,
  })),
  {
    id: `collider:${CLOCK_TOWER.id}`,
    minX: CLOCK_TOWER.x - CLOCK_TOWER.halfSize,
    maxX: CLOCK_TOWER.x + CLOCK_TOWER.halfSize,
    minZ: CLOCK_TOWER.z - CLOCK_TOWER.halfSize,
    maxZ: CLOCK_TOWER.z + CLOCK_TOWER.halfSize,
  },
];

export function findDistrictZone(zoneId: string): RectZone | undefined {
  return DISTRICT_ZONES.find((zone) => zone.id === zoneId);
}
