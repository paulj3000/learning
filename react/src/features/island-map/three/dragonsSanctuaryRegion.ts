import {
  DRAGONS_SANCTUARY_CHECKPOINTS,
  DRAGONS_SANCTUARY_REGION_ID,
} from '../../discovery/checkpoints';

/**
 * Pure content and geometry for the Dragon's Sanctuary
 * (`docs/regions/dragons-sanctuary-roadmap.md` Phase 1, "Minimum Explorable
 * Sanctuary", and Phase 2's "Rekindle the Forge").
 *
 * Plain numbers rather than `THREE.Vector3`/`THREE.Box3`, the same split
 * `clockworkHarborRegion.ts` and `welcomeHarborRegion.ts` use: this file
 * stays unit-testable with no rendering context, and
 * `dragonsSanctuaryScene.ts` is the only place these numbers become `three`
 * objects.
 *
 * ## This region has no 2D counterpart
 *
 * Per ADR-021 the sanctuary is authored first-person and 3D only. The 2D
 * Phaser artefacts that carry the same name (`dragonsSanctuaryTilemap.ts`,
 * `dragonsSanctuaryZones.ts`, `dragonsSanctuaryDecor.ts`) are the previous
 * one-screen arrival scene and are superseded, not extended. Nothing here
 * imports them, and no durable state crosses between them: the location
 * registration, the `DRAGON_OF_EMBER_MOUNTAIN_COMPLETE` gate, and the
 * dragon-and-egg fiction all live outside the tilemap.
 *
 * ## What is walkable, and what is only visible
 *
 * Phase 1 names eight locations and asks that "several locations should
 * initially be visible but inaccessible so the player can see future
 * progression opportunities". Phase 1 lists the forge among the locked ones
 * while Phase 2 sends the child inside it to investigate, and the MVP scope
 * list resolves the contradiction in favour of Phase 2: it names "Ember
 * Forge" as reachable and "one locked future area" as not. So the forge is
 * enterable and *dormant* - the building opens, the hearth does not light -
 * and the crystal cavern and hatchery are sealed behind gates a child can
 * walk up to, look at, and not open.
 *
 * The Sky Cliffs are the third kind: Phase 1 calls them "Distant", so they
 * are scenery beyond the north wall with a lookout ledge inside it. A child
 * can stand where they are seen. They are not somewhere to go, and nothing
 * pretends otherwise.
 *
 * Checkpoint *positions* live in `src/features/discovery/checkpoints.ts`,
 * per ADR-008: the World Engine may depend downward on World State, never
 * the other way round.
 */

export const REGION_ID = DRAGONS_SANCTUARY_REGION_ID;

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

/**
 * A valley plot, wider than Clockwork Harbor's 22: Phase 1 puts eight
 * locations on it, four of them out at the edges, and the walk between them
 * is meant to feel like crossing a valley rather than a courtyard.
 */
export const GROUND_HALF_EXTENT = 26;
const WALL_THICKNESS = 1;

/**
 * The valley walls. Mountain rather than masonry in the scene, but the same
 * job: the sanctuary is a bowl in the rock, and its rim is where the world
 * stops.
 */
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
 * Phase 1's eight locations as trigger volumes.
 *
 * Entering one fires `PlayerEnteredZone`, which the view turns into a HUD
 * toast naming the place - the same mechanism every region since Welcome
 * Harbor has used. They are authored disjoint (asserted in the tests) so one
 * step never fires two toasts, with deliberate gaps of bare valley floor
 * between them rather than shared edges.
 */
export const AREA_ZONES: readonly RectZone[] = [
  { id: 'dragons-sanctuary:zone:gate', minX: -7, maxX: 7, minZ: 17, maxZ: 25 },
  { id: 'dragons-sanctuary:zone:valley', minX: -12, maxX: 12, minZ: -8, maxZ: 16 },
  { id: 'dragons-sanctuary:zone:roost', minX: -7, maxX: 7, minZ: -21, maxZ: -9 },
  { id: 'dragons-sanctuary:zone:lodge', minX: -25, maxX: -13, minZ: -4, maxZ: 10 },
  { id: 'dragons-sanctuary:zone:forge', minX: 13, maxX: 25, minZ: -4, maxZ: 10 },
  { id: 'dragons-sanctuary:zone:crystal-cavern', minX: -25, maxX: -13, minZ: -24, maxZ: -8 },
  { id: 'dragons-sanctuary:zone:hatchery', minX: 13, maxX: 25, minZ: -24, maxZ: -8 },
  { id: 'dragons-sanctuary:zone:sky-cliff-view', minX: -7, maxX: 7, minZ: -25.5, maxZ: -22.5 },
];

/** Child-facing names for the area toasts. Readable aloud (CLAUDE.md section 13). */
export const AREA_LABELS: Readonly<Record<string, string>> = {
  'dragons-sanctuary:zone:gate': 'the sanctuary gate',
  'dragons-sanctuary:zone:valley': 'the central valley',
  'dragons-sanctuary:zone:roost': "Ember's roost",
  'dragons-sanctuary:zone:lodge': 'the Dragon Keeper Lodge',
  'dragons-sanctuary:zone:forge': 'the forge',
  'dragons-sanctuary:zone:crystal-cavern': 'the crystal cavern gate',
  'dragons-sanctuary:zone:hatchery': 'the old hatchery',
  'dragons-sanctuary:zone:sky-cliff-view': 'the sky cliff lookout',
};

export type WallSide = 'north' | 'south' | 'east' | 'west';

/** A building a child walks into: four wall runs with one side left out as the doorway. */
export interface Building {
  id: string;
  label: string;
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
  height: number;
  /** The omitted side is the doorway - a real gap in the collision geometry, never a scripted door. */
  wallSides: readonly WallSide[];
  interiorZone: RectZone;
}

/** How thick a wall collider is either side of its centre line. Shared by both buildings. */
export const WALL_HALF_THICKNESS = 0.25;

/**
 * The Dragon Keeper Lodge (Phase 1). Open to the east, so a child crossing
 * the valley westward walks straight in.
 *
 * Phase 6 eventually puts the hatchery's preparation work here; in this
 * phase it is a shelter with a cold fireplace, which is the Keeper's absence
 * stated as a room rather than as a line of dialogue.
 */
export const KEEPER_LODGE: Building = {
  id: 'keeper-lodge',
  label: 'the Dragon Keeper Lodge',
  x: -19,
  z: 3,
  halfWidth: 5,
  halfDepth: 5,
  height: 5,
  wallSides: ['north', 'south', 'west'],
  interiorZone: {
    id: 'dragons-sanctuary:lodge:interior',
    minX: -23.5,
    maxX: -14.5,
    minZ: -1.5,
    maxZ: 7.5,
  },
};

/**
 * The forge (Phase 2). Open to the west, facing the valley, for the same
 * reason: the child is sent here by Ember and should not have to hunt for
 * the way in.
 */
export const FORGE: Building = {
  id: 'forge',
  label: 'the forge',
  x: 19,
  z: 3,
  halfWidth: 5,
  halfDepth: 5,
  height: 6,
  wallSides: ['north', 'south', 'east'],
  interiorZone: {
    id: 'dragons-sanctuary:forge:interior',
    minX: 14.5,
    maxX: 23.5,
    minZ: -1.5,
    maxZ: 7.5,
  },
};

/** One wall-segment collider per built side; the omitted side is the doorway. */
export function buildingWallColliders(building: Building): RectZone[] {
  const { x, z, halfWidth, halfDepth } = building;
  const t = WALL_HALF_THICKNESS;
  return building.wallSides.map((side) => {
    switch (side) {
      case 'north':
        return {
          id: `collider:${building.id}:north`,
          minX: x - halfWidth,
          maxX: x + halfWidth,
          minZ: z - halfDepth - t,
          maxZ: z - halfDepth + t,
        };
      case 'south':
        return {
          id: `collider:${building.id}:south`,
          minX: x - halfWidth,
          maxX: x + halfWidth,
          minZ: z + halfDepth - t,
          maxZ: z + halfDepth + t,
        };
      case 'east':
        return {
          id: `collider:${building.id}:east`,
          minX: x + halfWidth - t,
          maxX: x + halfWidth + t,
          minZ: z - halfDepth,
          maxZ: z + halfDepth,
        };
      default:
        return {
          id: `collider:${building.id}:west`,
          minX: x - halfWidth - t,
          maxX: x - halfWidth + t,
          minZ: z - halfDepth,
          maxZ: z + halfDepth,
        };
    }
  });
}

/**
 * The dormant forge hearth: Phase 2's interactive object, and the thing the
 * whole first quest is about.
 *
 * A stable interaction id rather than a mesh reference, per ADR-008's rule
 * that durable state is keyed by semantic ids. The challenge behind it is
 * chosen by the adaptive layer from the child's demonstrated skill, not
 * authored into the geometry.
 */
export const FORGE_HEARTH = {
  id: 'dragons-sanctuary:prop:forge-hearth',
  label: 'the forge hearth',
  x: 21,
  z: 3,
};

/**
 * The three fire runes (Phase 2, "Locate three missing fire runes").
 *
 * Placed where exploration rather than a quest marker finds them - round the
 * back of the lodge, half-buried among the valley boulders, and out at the
 * sky cliff lookout - matching Phase 10's rule that not every secret belongs
 * on the map. Each is one walk away from a place the child already has a
 * reason to be, which is what keeps "go and look" from becoming "go and
 * search".
 *
 * They are also authored far apart, and that invariant is asserted: an
 * earlier placement put the ember rune on the roost ridge, ten meters from
 * the sky rune, which collapsed two of the child's three searches into one
 * walk.
 */
export const FIRE_RUNE_SPOTS: readonly { id: string; label: string; x: number; z: number }[] = [
  { id: 'dragons-sanctuary:prop:rune-stone', label: 'the stone rune', x: -21, z: 9 },
  { id: 'dragons-sanctuary:prop:rune-ember', label: 'the ember rune', x: 9, z: 12 },
  { id: 'dragons-sanctuary:prop:rune-sky', label: 'the sky rune', x: -4, z: -24 },
];

/**
 * The three rune sockets on the hearth wall, where the runes are placed.
 *
 * Inside the forge, so the last step of the quest happens where the payoff
 * is visible: a child sets the third rune and the hearth lights in front of
 * them, rather than somewhere else and being told about it.
 */
export const RUNE_SOCKET_SPOTS: readonly { id: string; x: number; z: number }[] = [
  { id: 'dragons-sanctuary:prop:socket-1', x: 21, z: 1 },
  { id: 'dragons-sanctuary:prop:socket-2', x: 22, z: 3 },
  { id: 'dragons-sanctuary:prop:socket-3', x: 21, z: 5 },
];

/** A gate a child can walk up to and cannot open. Locked areas describe what would open them, never refuse. */
export interface SealedGate {
  id: string;
  label: string;
  x: number;
  z: number;
  halfWidth: number;
  height: number;
  /**
   * What the child is told when they try it. Describes what they can see and
   * hints at what would open it - the rule `DiscoveryDefinition.lockedMessage`
   * follows, and CLAUDE.md pillar 7's "no dark patterns": a locked door is a
   * promise, not a scolding.
   */
  lockedMessage: string;
}

/**
 * The two sealed gates, each spanning its whole area from the valley side to
 * the valley wall.
 *
 * `halfWidth` is 7 rather than the 4 an earlier draft used, and the reason is
 * worth keeping: an area zone is 12 meters across and the plot wall is at 26,
 * so a 4-meter half-width left a walkable gap at either end. A child would
 * have strolled round the side of a door the region had just told them was
 * shut, which is worse than having no door - it teaches them that the
 * sanctuary's promises are decorative.
 */
export const SEALED_GATES: readonly SealedGate[] = [
  {
    id: 'dragons-sanctuary:prop:crystal-cavern-gate',
    label: 'the crystal cavern gate',
    x: -19,
    z: -16,
    halfWidth: 7,
    height: 5,
    lockedMessage:
      'Cold blue light glows through the cracks in this door. Something inside is still awake. The forge fire might be warm enough to open it one day.',
  },
  {
    id: 'dragons-sanctuary:prop:hatchery-gate',
    label: 'the hatchery gate',
    x: 19,
    z: -16,
    halfWidth: 7,
    height: 5,
    lockedMessage:
      'Through the gap you can see round stone nests, all of them empty. Ember says the hatchery needs to be warm before anyone can go in.',
  },
];

/**
 * Ember, and where she stands (Phase 2, "Meet Ember").
 *
 * At her roost rather than at the gate. A child walks the length of the
 * valley to reach her, past the forge and the lodge and the two sealed
 * gates, which means they have seen what is broken before anyone tells them
 * about it.
 */
/**
 * Ember's NPC id, which is the one the island already authored
 * (`npc/content/islandNpcs.ts`) rather than a new one for this region. She
 * has existed since the Ember Mountain story ended here, and giving the 3D
 * region a second `ember` would have handed the child a dragon who had
 * forgotten them.
 */
export const EMBER_ID = 'ember-dragon';

export const NPC_SPOTS: readonly { id: string; label: string; x: number; z: number }[] = [
  { id: EMBER_ID, label: 'Ember', x: 0, z: -16 },
];

/**
 * The ring of nest stones at Ember's roost. Solid, and arranged as an open
 * horseshoe rather than a circle: a child can walk in to stand beside her.
 */
export const ROOST_STONES: readonly { id: string; x: number; z: number; halfSize: number }[] = [
  { id: 'roost-stone-w', x: -4.5, z: -16, halfSize: 1.2 },
  { id: 'roost-stone-nw', x: -3, z: -19.5, halfSize: 1.2 },
  { id: 'roost-stone-n', x: 0, z: -20.5, halfSize: 1.2 },
  { id: 'roost-stone-ne', x: 3, z: -19.5, halfSize: 1.2 },
  { id: 'roost-stone-e', x: 4.5, z: -16, halfSize: 1.2 },
];

/**
 * Boulders scattered down the valley. Solid, and the only thing between the
 * gate and the roost that a child has to walk around - enough to make the
 * valley a place rather than a corridor, not enough to make it a maze.
 */
export const VALLEY_BOULDERS: readonly { id: string; x: number; z: number; halfSize: number }[] = [
  { id: 'boulder-1', x: -8, z: 12, halfSize: 1.5 },
  { id: 'boulder-2', x: 7, z: 9, halfSize: 1.8 },
  { id: 'boulder-3', x: -6, z: 0, halfSize: 1.3 },
  { id: 'boulder-4', x: 9, z: -5, halfSize: 1.6 },
  { id: 'boulder-5', x: -10, z: -6, halfSize: 1.4 },
];

/**
 * Dragon scales, the sanctuary's first collectible family (Phase 10).
 *
 * Three of them, all found by looking rather than by being sent: behind the
 * lodge, on the approach to the hatchery gate, and on the ledge at the sky
 * cliff lookout. The hatchery one sits on the near side of the gate - the
 * ground past it is sealed in this phase, and a collectible a child can see
 * and never pick up is a tease rather than a secret. `y` because a scale sits on the ground or on a ledge rather than
 * at eye height, the same as Clockwork Harbor's golden gears.
 */
export const DRAGON_SCALE_SPOTS: readonly { id: string; x: number; y: number; z: number }[] = [
  { id: 'dragon-scale-01', x: -24, y: 0.4, z: 9 },
  { id: 'dragon-scale-02', x: 15.5, y: 0.4, z: -11 },
  { id: 'dragon-scale-03', x: 5.5, y: 0.5, z: -24.5 },
];

/**
 * The Sky Cliffs: scenery beyond the north wall, seen from the lookout and
 * never reached. Phase 8.3 eventually makes them playable with flight; until
 * then they are the horizon, and the region is honest about that by putting
 * no zone, no gate, and no interaction on them.
 */
export const SKY_CLIFFS: readonly {
  id: string;
  x: number;
  z: number;
  halfWidth: number;
  height: number;
}[] = [
  { id: 'sky-cliff-west', x: -14, z: -33, halfWidth: 9, height: 22 },
  { id: 'sky-cliff-centre', x: 2, z: -38, halfWidth: 11, height: 30 },
  { id: 'sky-cliff-east', x: 17, z: -32, halfWidth: 8, height: 19 },
];

/**
 * A dragon circling the cliffs, far off. Decorative, never interactive - the
 * same job Welcome Harbor's gull does, and the same warning: it is not one
 * of Phase 4's dragons, and a child cannot go to it.
 */
export const AMBIENT_DRAGON_PATH: readonly { x: number; y: number; z: number }[] = [
  { x: -12, y: 16, z: -30 },
  { x: 10, y: 19, z: -34 },
  { x: 16, y: 15, z: -26 },
  { x: -6, y: 18, z: -24 },
];

export const DRAGONS_SANCTUARY_REGION_CHECKPOINTS = DRAGONS_SANCTUARY_CHECKPOINTS;

function blockColliders(
  blocks: readonly { id: string; x: number; z: number; halfSize: number }[],
): RectZone[] {
  return blocks.map((block) => ({
    id: `collider:${block.id}`,
    minX: block.x - block.halfSize,
    maxX: block.x + block.halfSize,
    minZ: block.z - block.halfSize,
    maxZ: block.z + block.halfSize,
  }));
}

/**
 * Every solid the first-person controller collides with, as authored rects.
 *
 * Building walls are derived here rather than rebuilt in the scene, which is
 * the one place this region deliberately departs from `clockworkHarborScene.
 * ts`: that file computes its lighthouse wall boxes itself, so the walls a
 * child bumps into are not covered by any unit test. Deriving them from
 * `wallSides` in the region module means the "no checkpoint is inside a
 * collider" and "the doorway is really open" invariants test the same
 * geometry the controller uses.
 */
export const COLLIDERS: readonly RectZone[] = [
  ...BOUNDARY_WALLS,
  ...buildingWallColliders(KEEPER_LODGE),
  ...buildingWallColliders(FORGE),
  ...blockColliders(ROOST_STONES),
  ...blockColliders(VALLEY_BOULDERS),
  ...SEALED_GATES.map((gate) => ({
    id: `collider:${gate.id}`,
    minX: gate.x - gate.halfWidth,
    maxX: gate.x + gate.halfWidth,
    minZ: gate.z - WALL_HALF_THICKNESS,
    maxZ: gate.z + WALL_HALF_THICKNESS,
  })),
];

export function findAreaZone(zoneId: string): RectZone | undefined {
  return AREA_ZONES.find((zone) => zone.id === zoneId);
}
