import type { WorldInteraction } from '../../../worldObjects';
import { HOME_WORLD_SLUG } from '../../../../worlds/slugs';
import {
  CLOCKWORK_HARBOR_CHECKPOINTS,
  CLOCKWORK_HARBOR_REGION_ID,
} from '../../../../discovery/checkpoints';
import { CLOCKWORK_CHANGE_KEYS, goldenGearChangeKey } from '../../../../clockwork-harbor/types';
import { DARK_LIGHTHOUSE_ADVENTURES } from '../../../../adventures/content';
import {
  AMBIENT_GULL_PATH,
  CLOCK_TOWER,
  DISTRICT_LABELS,
  DISTRICT_ZONES,
  DOCK_CLUTTER,
  DOCK_DECK,
  GOLDEN_GEAR_SPOTS,
  GROUND_HALF_EXTENT,
  HARBOR_GATE,
  LIGHTHOUSE,
  LIGHTHOUSE_MECHANISM,
  MARKET_STALLS,
  NPC_SPOTS,
  WATER_ZONES,
} from '../../clockworkHarborRegion';
import {
  LOCATION_MANIFEST_SCHEMA_VERSION,
  type ColliderSpec,
  type CollectibleSpec,
  type ScenerySpec,
  type ThreeLocationManifest,
  type ZoneSpec,
} from '../locationManifest';

/**
 * Clockwork Harbor as a manifest (engine roadmap Phase 9, ADR-025), built
 * from `clockworkHarborRegion.ts`'s own constants.
 *
 * This is the first migrated region with no authored `WorldInteraction`s of
 * its own: its per-region view dispatched on entity-id sets instead
 * (`if (NPC_LABELS[entityId])`, `entityId.startsWith('golden-gear-')`), which
 * is exactly the pattern the duplication audit flagged. The four interactions
 * below are that behaviour written in the existing vocabulary, with the same
 * ids the scene already emitted, so nothing about what a child can do changes.
 *
 * Two things the harbour needed that no manifest could say before, both now
 * generic:
 *
 * - **`environment.variants`.** The sky lifts and the light comes up once the
 *   lighthouse turns again. The per-region scene read that flag itself and
 *   picked its own clear colour; now the manifest declares both skies and the
 *   runtime resolves one against the child's world state.
 * - **`copy.statusLines`.** The one-line "the lighthouse is dark" / "turning
 *   again" status above the canvas, as data rather than a ternary in a view.
 *
 * And two things stay bespoke, behind registered extensions:
 *
 * - `clockwork-machinery` draws the mechanism, the lamp, the clock hand and
 *   the golden gears, which are code primitives standing in for the
 *   mechanical asset inventory section 21 has not authored yet.
 * - `adaptive-adventure-entrance` opens whichever Dark Lighthouse variant the
 *   child's demonstrated maths is ready for, which a `START_ADVENTURE`
 *   interaction cannot express (it names one template; this names a set).
 *
 * **One deliberate behaviour change, not a parity break:** picking up a
 * Golden Gear now records its authored world change
 * (`goldenGearChangeKey`), so it stays found. The per-region view only
 * toasted, which is the bug the audit recorded - "nothing records the
 * golden-gear change key, so gears reappear on every visit even though
 * `deriveClockworkHarborState` reads it". The key, the change type and the
 * `WORLD_CHANGE_ABSENT` gate are all declared here, and the validator
 * refuses the one without the other.
 */

const LIGHTHOUSE_FIXED = CLOCKWORK_CHANGE_KEYS.LIGHTHOUSE_FIXED;
const MECHANISM_INTERACTION_ID = 'clockwork-harbor:use-lighthouse-machine';

/** The two placed NPCs, and the machine. The ids are the ones the scene already emitted. */
const INTERACTIONS: readonly WorldInteraction[] = [
  {
    id: 'clockwork-harbor:talk-to-harbor-master',
    type: 'NPC',
    trigger: 'TAP',
    title: 'Talk to the Harbor Master',
    targetId: 'harbor-master',
    action: { kind: 'TALK_TO', npcId: 'harbor-master' },
  },
  {
    id: 'clockwork-harbor:talk-to-professor-ticktock',
    type: 'NPC',
    trigger: 'TAP',
    title: 'Talk to Professor Ticktock',
    targetId: 'professor-ticktock',
    action: { kind: 'TALK_TO', npcId: 'professor-ticktock' },
  },
  {
    /*
      The machine. `adaptive-adventure-entrance` claims this interaction and
      opens the right Dark Lighthouse variant; the `SHOW_MESSAGE` action is
      the authored fallback for a child whose extension did not load, and is
      the honest line either way - the Harbor Master is who explains it.
    */
    id: MECHANISM_INTERACTION_ID,
    type: 'ADVENTURE',
    trigger: 'TAP',
    title: 'Look at the machine inside the lighthouse',
    targetId: LIGHTHOUSE_MECHANISM.id,
    action: {
      kind: 'SHOW_MESSAGE',
      message: 'The machine is quiet. Ask the Harbor Master about it.',
    },
  },
];

const COLLIDERS: readonly ColliderSpec[] = [
  // Open water: a child who could stroll into the harbor would fall out of the world.
  ...WATER_ZONES.map((rect) => ({ rect: { ...rect } })),
  ...MARKET_STALLS.map((stall) => ({
    rect: {
      id: `collider:${stall.id}`,
      minX: stall.x - stall.halfSize,
      maxX: stall.x + stall.halfSize,
      minZ: stall.z - stall.halfSize,
      maxZ: stall.z + stall.halfSize,
    },
    minY: 0,
    maxY: 2.2,
  })),
  {
    rect: {
      id: `collider:${CLOCK_TOWER.id}`,
      minX: CLOCK_TOWER.x - CLOCK_TOWER.halfSize,
      maxX: CLOCK_TOWER.x + CLOCK_TOWER.halfSize,
      minZ: CLOCK_TOWER.z - CLOCK_TOWER.halfSize,
      maxZ: CLOCK_TOWER.z + CLOCK_TOWER.halfSize,
    },
    minY: 0,
    maxY: CLOCK_TOWER.height,
  },
  // The harbor gate, shut across the mouth until the lamp turns.
  {
    rect: {
      id: 'collider:harbor-gate',
      minX: HARBOR_GATE.x - HARBOR_GATE.halfWidth,
      maxX: HARBOR_GATE.x + HARBOR_GATE.halfWidth,
      minZ: HARBOR_GATE.z - 0.3,
      maxZ: HARBOR_GATE.z + 0.3,
    },
    minY: 0,
    maxY: HARBOR_GATE.height,
    requirements: [{ type: 'WORLD_CHANGE_ABSENT', changeKey: LIGHTHOUSE_FIXED }],
  },
];

const SCENERY: readonly ScenerySpec[] = [
  {
    kind: 'TILED_GROUND',
    id: 'harbor-ground',
    assetId: 'ground-tile',
    area: {
      id: 'harbor-ground:area',
      minX: -GROUND_HALF_EXTENT,
      maxX: GROUND_HALF_EXTENT,
      minZ: -GROUND_HALF_EXTENT,
      maxZ: GROUND_HALF_EXTENT,
    },
    tileSize: 4,
  },
  /*
    Harbor water, floating just *above* the ground tiles rather than below
    them: the ground kit tiles the whole plot with opaque geometry at y = 0,
    so water authored underneath renders as nothing at all and the harbour
    reads as flat ground a child then walks into an invisible wall on.
  */
  ...WATER_ZONES.map((water): ScenerySpec => ({
    kind: 'FLAT_PLANE',
    id: `${water.id}:surface`,
    color: 0x2f6f9e,
    area: { ...water, id: `${water.id}:surface:area` },
    y: 0.02,
  })),
  // The dock deck, raised a little above the waterline so it reads as a pier.
  {
    kind: 'BOX',
    id: 'dock-deck',
    color: 0x8a6a45,
    area: { ...DOCK_DECK, id: 'dock-deck:area' },
    minY: 0,
    maxY: 0.18,
  },
  // Market stalls and the clock tower, from the same stone wall kit piece.
  {
    kind: 'CLUSTER',
    id: 'market-stalls',
    assetId: 'wall-stone',
    positions: MARKET_STALLS.map((stall) => ({
      x: stall.x,
      z: stall.z,
      scale: { x: stall.halfSize, y: 0.7, z: stall.halfSize },
    })),
  },
  // Crates and barrels along the dock, in one draw call.
  {
    kind: 'CLUSTER',
    id: 'dock-clutter',
    assetId: 'rock',
    positions: DOCK_CLUTTER.map((crate, index) => ({
      x: crate.x,
      z: crate.z,
      rotationY: index * 0.7,
    })),
  },
  // The gate itself, shut until the lamp turns.
  {
    kind: 'BOX',
    id: 'harbor-gate',
    color: 0x4a4e57,
    area: {
      id: 'harbor-gate:area',
      minX: HARBOR_GATE.x - HARBOR_GATE.halfWidth,
      maxX: HARBOR_GATE.x + HARBOR_GATE.halfWidth,
      minZ: HARBOR_GATE.z - 0.2,
      maxZ: HARBOR_GATE.z + 0.2,
    },
    minY: 0,
    maxY: HARBOR_GATE.height,
    requirements: [{ type: 'WORLD_CHANGE_ABSENT', changeKey: LIGHTHOUSE_FIXED }],
  },
];

/**
 * The three Golden Gears reachable in this milestone, each recording the
 * authored change key that keeps it found (section 21 hides twelve across the
 * finished region). `clockwork-machinery` draws them.
 */
const GOLDEN_GEARS: readonly CollectibleSpec[] = GOLDEN_GEAR_SPOTS.map((spot) => ({
  entityId: spot.id,
  position: { x: spot.x, z: spot.z },
  elevation: spot.y,
  label: 'a golden gear',
  pickUpMessage: 'You found a golden gear.',
  requirements: [{ type: 'WORLD_CHANGE_ABSENT', changeKey: goldenGearChangeKey(spot.id) }],
  worldChange: {
    changeType: 'COLLECTIBLE_FOUND',
    changeKey: goldenGearChangeKey(spot.id),
  },
}));

const ZONES: readonly ZoneSpec[] = DISTRICT_ZONES.map((zone) => ({
  rect: { ...zone },
  enterMessage: `You're at ${DISTRICT_LABELS[zone.id] ?? 'the harbor'}.`,
}));

export const CLOCKWORK_HARBOR_MANIFEST: ThreeLocationManifest = {
  schemaVersion: LOCATION_MANIFEST_SCHEMA_VERSION,
  regionId: CLOCKWORK_HARBOR_REGION_ID,
  locationSlug: 'clockwork-harbor',
  worldSlug: HOME_WORLD_SLUG,
  title: 'Clockwork Harbor',
  version: 1,

  bounds: {
    halfExtentX: GROUND_HALF_EXTENT,
    halfExtentZ: GROUND_HALF_EXTENT,
    wallThickness: 1,
  },

  // A muted sky while the harbour is stalled, a clear one once it runs again.
  environment: {
    backgroundColor: 0x6b7f92,
    lighting: { ambientIntensity: 0.45, sunIntensity: 0.55 },
    variants: [
      {
        requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: LIGHTHOUSE_FIXED }],
        backgroundColor: 0x8fc7e6,
        lighting: { ambientIntensity: 0.65, sunIntensity: 0.8 },
      },
    ],
  },

  checkpoints: {
    ids: CLOCKWORK_HARBOR_CHECKPOINTS.map((checkpoint) => checkpoint.id),
    triggerHalfSize: 1.5,
  },

  colliders: COLLIDERS,

  // The lighthouse: a tower with a machine room, its east side left out so
  // the doorway is a real gap in the collision geometry.
  buildings: [
    {
      id: LIGHTHOUSE.id,
      label: LIGHTHOUSE.label,
      x: LIGHTHOUSE.x,
      z: LIGHTHOUSE.z,
      halfWidth: LIGHTHOUSE.halfWidth,
      halfDepth: LIGHTHOUSE.halfDepth,
      height: LIGHTHOUSE.height,
      wallSides: LIGHTHOUSE.wallSides,
      interiorZone: { ...LIGHTHOUSE.interiorZone },
      wallAssetId: 'wall-stone',
      roofAssetId: 'roof',
      doorAssetId: 'door',
    },
  ],

  scenery: SCENERY,

  npcs: NPC_SPOTS.map((npc) => ({
    entityId: npc.id,
    npcId: npc.id,
    assetId: npc.assetId,
    position: { x: npc.x, z: npc.z },
    label: npc.label,
    idleClip: 'Idle',
    placeholderColor: npc.id === 'harbor-master' ? 0x4c9a8a : 0x8a5a3c,
    interactionId:
      npc.id === 'harbor-master'
        ? 'clockwork-harbor:talk-to-harbor-master'
        : 'clockwork-harbor:talk-to-professor-ticktock',
  })),

  // The machine, with no `assetId`: `clockwork-machinery` fills its root.
  props: [
    {
      entityId: LIGHTHOUSE_MECHANISM.id,
      position: { x: LIGHTHOUSE_MECHANISM.x, z: LIGHTHOUSE_MECHANISM.z },
      label: LIGHTHOUSE_MECHANISM.label,
      interactionId: MECHANISM_INTERACTION_ID,
    },
  ],

  collectibles: GOLDEN_GEARS,
  zones: ZONES,

  ambient: [
    {
      kind: 'SPLINE_LOOP',
      id: 'harbor-gull',
      path: AMBIENT_GULL_PATH.map((point) => ({ ...point })),
      loopsPerSecond: 0.05,
      appearance: { primitive: 'CONE', color: 0xf4f1e8 },
    },
  ],

  interactions: INTERACTIONS,
  adventureBindings: [],

  extensions: [
    {
      extensionId: 'clockwork-machinery',
      config: {
        changeKey: LIGHTHOUSE_FIXED,
        mechanismEntityId: LIGHTHOUSE_MECHANISM.id,
        gearEntityIds: GOLDEN_GEAR_SPOTS.map((spot) => spot.id),
        lamp: { x: LIGHTHOUSE.x, y: LIGHTHOUSE.height + 0.7, z: LIGHTHOUSE.z },
        clockFace: {
          x: CLOCK_TOWER.x,
          y: CLOCK_TOWER.height - 2,
          z: CLOCK_TOWER.z + CLOCK_TOWER.halfSize,
        },
      },
    },
    {
      extensionId: 'adaptive-adventure-entrance',
      config: {
        interactionId: MECHANISM_INTERACTION_ID,
        title: 'The lighthouse machine',
        locationSlug: 'clockwork-harbor',
        variantSlugs: DARK_LIGHTHOUSE_ADVENTURES.map((variant) => variant.slug),
        domain: 'math',
        completedChangeKey: LIGHTHOUSE_FIXED,
        completedMessage: 'The machine is humming along. The lamp is already turning.',
        unavailableMessage: 'The machine is quiet. Ask the Harbor Master about it.',
      },
    },
  ],

  copy: {
    loading: 'Loading Clockwork Harbor...',
    instructions:
      'Move: WASD or the arrow keys. Look: click the screen, then move your mouse (or drag with two fingers on a touch screen: left side to move, right side to look). Walk up to someone and press E, or use the buttons below, to talk.',
    statusLines: [
      {
        requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: LIGHTHOUSE_FIXED }],
        text: 'The lighthouse is turning again, and the harbor gate is open.',
      },
      { text: 'The lighthouse is dark. The Harbor Master is waiting on the dock.' },
    ],
    thingsToDoNotes: [
      {
        text: `There are ${GOLDEN_GEAR_SPOTS.length} golden gears hidden around the harbor. Look behind the lighthouse, along the dock, and up by the clock tower.`,
      },
    ],
    altNav: { label: 'Prefer not to walk in 3D? Go back to the island map', to: '' },
  },
};
