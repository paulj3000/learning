import type { WorldInteraction } from '../../../worldObjects';
import { HOME_WORLD_SLUG } from '../../../../worlds/slugs';
import {
  DRAGONS_SANCTUARY_CHECKPOINTS,
  DRAGONS_SANCTUARY_REGION_ID,
} from '../../../../discovery/checkpoints';
import {
  SANCTUARY_CHANGE_KEYS,
  dragonScaleChangeKey,
  fireRuneChangeKey,
} from '../../../../dragons-sanctuary/types';
import {
  AMBIENT_DRAGON_PATH,
  AREA_LABELS,
  AREA_ZONES,
  BOUNDARY_WALLS,
  DRAGON_SCALE_SPOTS,
  EMBER_ID,
  FIRE_RUNE_SPOTS,
  FORGE,
  FORGE_HEARTH,
  GROUND_HALF_EXTENT,
  KEEPER_LODGE,
  NPC_SPOTS,
  ROOST_STONES,
  RUNE_SOCKET_SPOTS,
  SEALED_GATES,
  SKY_CLIFFS,
  VALLEY_BOULDERS,
  WALL_HALF_THICKNESS,
} from '../../dragonsSanctuaryRegion';
import {
  LOCATION_MANIFEST_SCHEMA_VERSION,
  type ColliderSpec,
  type CollectibleSpec,
  type PropSpec,
  type ScenerySpec,
  type ThreeLocationManifest,
} from '../locationManifest';

/**
 * The Dragon's Sanctuary as a manifest (engine roadmap Phase 9, ADR-025),
 * built from `dragonsSanctuaryRegion.ts`'s own constants.
 *
 * Like Clockwork Harbor, this region had no authored `WorldInteraction`s: its
 * view dispatched on entity-id maps (`RUNE_LABELS[entityId]`,
 * `GATE_MESSAGES[entityId]`, `SCALE_IDS.has(entityId)`). The six interactions
 * below are that behaviour in the existing vocabulary, with the same ids and
 * the same authored lines - including each sealed gate's `lockedMessage`,
 * which a locked door owes a child (CLAUDE.md pillar 7: a promise, never a
 * refusal).
 *
 * The two collectible families are where this migration pays for itself.
 * Finding a fire rune and finding a dragon scale were two near-identical
 * blocks in the view, each calling `recordWorldChangeOnce` with
 * `exploration:<propId>` provenance; both are now `worldChange` on a
 * collectible, gated on the key they record, so a rune a child has taken is
 * simply not in the valley next time. The runes carry a second gate on
 * `FORGE_LIT`, because a lit forge means all three are in their sockets.
 *
 * `sanctuary-art` draws everything distinctive: the hearth and its fire
 * bowl, the sockets, the rune stones, the gate slabs, the scales, Ember's
 * silhouette and the sky cliffs. Every interactive one of those is a manifest
 * entity with no `assetId`, so the runtime keeps focus, labels, interaction
 * and pickup while the extension only says what the child sees.
 */

const FORGE_LIT = SANCTUARY_CHANGE_KEYS.FORGE_LIT;
const TALK_TO_EMBER_ID = 'dragons-sanctuary:talk-to-ember';

const INTERACTIONS: readonly WorldInteraction[] = [
  {
    id: TALK_TO_EMBER_ID,
    type: 'NPC',
    trigger: 'TAP',
    title: 'Talk to Ember',
    targetId: EMBER_ID,
    action: { kind: 'TALK_TO', npcId: EMBER_ID },
  },
  {
    id: FORGE_HEARTH.id,
    type: 'OBJECT',
    trigger: 'TAP',
    title: FORGE_HEARTH.label,
    targetId: FORGE_HEARTH.id,
    action: {
      kind: 'SHOW_MESSAGE',
      message:
        'The hearth is cold, and its three rune sockets are empty. Ember is up at her roost.',
    },
  },
  ...SEALED_GATES.map((gate): WorldInteraction => ({
    id: gate.id,
    type: 'OBJECT',
    trigger: 'TAP',
    title: gate.label,
    targetId: gate.id,
    action: { kind: 'SHOW_MESSAGE', message: gate.lockedMessage },
  })),
  ...FIRE_RUNE_SPOTS.map((rune): WorldInteraction => ({
    id: rune.id,
    type: 'OBJECT',
    trigger: 'TAP',
    title: rune.label,
    targetId: rune.id,
    action: { kind: 'SHOW_MESSAGE', message: `${rune.label} is warm to hold.` },
  })),
];

/**
 * Roost stones, valley boulders and the sealed gates. The two buildings'
 * walls are not here: the runtime derives those from the buildings
 * themselves, so the walls a child bumps into and the walls they see are the
 * same declaration.
 */
const COLLIDERS: readonly ColliderSpec[] = [
  ...ROOST_STONES.map((stone) => ({
    rect: {
      id: `collider:${stone.id}`,
      minX: stone.x - stone.halfSize,
      maxX: stone.x + stone.halfSize,
      minZ: stone.z - stone.halfSize,
      maxZ: stone.z + stone.halfSize,
    },
    minY: 0,
    maxY: 1.6,
  })),
  ...VALLEY_BOULDERS.map((boulder) => ({
    rect: {
      id: `collider:${boulder.id}`,
      minX: boulder.x - boulder.halfSize,
      maxX: boulder.x + boulder.halfSize,
      minZ: boulder.z - boulder.halfSize,
      maxZ: boulder.z + boulder.halfSize,
    },
    minY: 0,
    maxY: 2.4,
  })),
  ...SEALED_GATES.map((gate) => ({
    rect: {
      id: `collider:${gate.id}`,
      minX: gate.x - gate.halfWidth,
      maxX: gate.x + gate.halfWidth,
      minZ: gate.z - WALL_HALF_THICKNESS,
      maxZ: gate.z + WALL_HALF_THICKNESS,
    },
    minY: 0,
    maxY: gate.height,
  })),
];

const SCENERY: readonly ScenerySpec[] = [
  {
    kind: 'TILED_GROUND',
    id: 'valley-floor',
    assetId: 'ground-tile',
    area: {
      id: 'valley-floor:area',
      minX: -GROUND_HALF_EXTENT,
      maxX: GROUND_HALF_EXTENT,
      minZ: -GROUND_HALF_EXTENT,
      maxZ: GROUND_HALF_EXTENT,
    },
    tileSize: 4,
  },
  // The valley walls: a ring of rock faces just inside the boundary colliders.
  ...BOUNDARY_WALLS.map((wall): ScenerySpec => ({
    kind: 'BOX',
    id: `${wall.id}:face`,
    color: 0x4a4048,
    area: { ...wall, id: `${wall.id}:face:area` },
    minY: 0,
    maxY: 14,
  })),
  // Roost stones and valley boulders, from the same rock kit piece.
  {
    kind: 'CLUSTER',
    id: 'sanctuary-rocks',
    assetId: 'rock',
    positions: [...ROOST_STONES, ...VALLEY_BOULDERS].map((block, index) => ({
      x: block.x,
      z: block.z,
      rotationY: index * 0.9,
    })),
  },
];

/** The hearth and the two sealed gates: interactive, and drawn by `sanctuary-art`. */
const PROPS: readonly PropSpec[] = [
  {
    entityId: FORGE_HEARTH.id,
    position: { x: FORGE_HEARTH.x, z: FORGE_HEARTH.z },
    label: FORGE_HEARTH.label,
    interactionId: FORGE_HEARTH.id,
  },
  ...SEALED_GATES.map((gate): PropSpec => ({
    entityId: gate.id,
    position: { x: gate.x, z: gate.z },
    label: gate.label,
    interactionId: gate.id,
  })),
];

/**
 * The three fire runes and the three dragon scales. A rune is gone from the
 * valley once it is found *or* once the forge is lit, because a lit forge
 * means all three are set in their sockets - drawing one in both places would
 * tell a child their progress had not been kept.
 */
const COLLECTIBLES: readonly CollectibleSpec[] = [
  ...FIRE_RUNE_SPOTS.map((rune): CollectibleSpec => ({
    entityId: rune.id,
    position: { x: rune.x, z: rune.z },
    label: rune.label,
    pickUpMessage: `You found ${rune.label}. It is warm to hold.`,
    requirements: [
      { type: 'WORLD_CHANGE_ABSENT', changeKey: fireRuneChangeKey(rune.id) },
      { type: 'WORLD_CHANGE_ABSENT', changeKey: FORGE_LIT },
    ],
    worldChange: { changeType: 'RUNE_FOUND', changeKey: fireRuneChangeKey(rune.id) },
  })),
  ...DRAGON_SCALE_SPOTS.map((scale): CollectibleSpec => ({
    entityId: scale.id,
    position: { x: scale.x, z: scale.z },
    elevation: scale.y,
    label: 'a dragon scale',
    pickUpMessage: 'You found a dragon scale.',
    requirements: [{ type: 'WORLD_CHANGE_ABSENT', changeKey: dragonScaleChangeKey(scale.id) }],
    worldChange: {
      changeType: 'COLLECTIBLE_FOUND',
      changeKey: dragonScaleChangeKey(scale.id),
    },
  })),
];

/** Where each rune is, as a hint that disappears once that rune is found. */
const RUNE_HINT_TEXT: readonly string[] = [
  'A fire rune is hidden behind the Keeper Lodge.',
  'A fire rune is hidden down among the valley boulders.',
  'A fire rune is hidden out on the sky cliff ledge.',
];

/** All three runes found: what the hearth is waiting for. */
const ALL_RUNES_FOUND = FIRE_RUNE_SPOTS.map((rune) => ({
  type: 'WORLD_CHANGE_PRESENT' as const,
  changeKey: fireRuneChangeKey(rune.id),
}));

const RUNE_HINTS = FIRE_RUNE_SPOTS.map((rune, index) => ({
  requirements: [
    { type: 'WORLD_CHANGE_ABSENT' as const, changeKey: FORGE_LIT },
    { type: 'WORLD_CHANGE_ABSENT' as const, changeKey: fireRuneChangeKey(rune.id) },
  ],
  text: RUNE_HINT_TEXT[index] ?? 'A fire rune is still out in the valley.',
}));

export const DRAGONS_SANCTUARY_MANIFEST: ThreeLocationManifest = {
  schemaVersion: LOCATION_MANIFEST_SCHEMA_VERSION,
  regionId: DRAGONS_SANCTUARY_REGION_ID,
  locationSlug: 'dragons-sanctuary',
  worldSlug: HOME_WORLD_SLUG,
  title: "The Dragon's Sanctuary",
  version: 1,

  bounds: {
    halfExtentX: GROUND_HALF_EXTENT,
    halfExtentZ: GROUND_HALF_EXTENT,
    wallThickness: 1,
  },

  // A cold, overcast valley before the forge is lit; a warm one after.
  environment: {
    backgroundColor: 0x6a6472,
    lighting: { ambientIntensity: 0.4, sunIntensity: 0.5 },
    variants: [
      {
        requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: FORGE_LIT }],
        backgroundColor: 0xe8b98a,
        lighting: { ambientIntensity: 0.75, sunIntensity: 0.9 },
      },
    ],
  },

  checkpoints: {
    ids: DRAGONS_SANCTUARY_CHECKPOINTS.map((checkpoint) => checkpoint.id),
    triggerHalfSize: 1.5,
  },

  colliders: COLLIDERS,

  buildings: [KEEPER_LODGE, FORGE].map((building) => ({
    id: building.id,
    label: building.label,
    x: building.x,
    z: building.z,
    halfWidth: building.halfWidth,
    halfDepth: building.halfDepth,
    height: building.height,
    wallSides: building.wallSides,
    interiorZone: { ...building.interiorZone },
    wallAssetId: 'wall-stone',
    roofAssetId: 'roof',
  })),

  scenery: SCENERY,

  /*
    Ember, with the character asset the island already loads for her until
    the roadmap's dragon rig exists (ADR-020). `sanctuary-art` adds the
    dragon silhouette behind her in the same root.
  */
  npcs: NPC_SPOTS.map((npc) => ({
    entityId: npc.id,
    npcId: npc.id,
    assetId: 'npc-pip',
    position: { x: npc.x, z: npc.z },
    label: npc.label,
    idleClip: 'Idle',
    placeholderColor: 0xd9622b,
    interactionId: TALK_TO_EMBER_ID,
  })),

  props: PROPS,
  collectibles: COLLECTIBLES,

  zones: AREA_ZONES.map((zone) => ({
    rect: { ...zone },
    enterMessage: `You're at ${AREA_LABELS[zone.id] ?? 'the sanctuary'}.`,
  })),

  ambient: [
    {
      kind: 'SPLINE_LOOP',
      id: 'ambient-dragon',
      path: AMBIENT_DRAGON_PATH.map((point) => ({ ...point })),
      loopsPerSecond: 0.05,
      appearance: { primitive: 'CONE', color: 0x6d5f7a },
    },
  ],

  interactions: INTERACTIONS,
  adventureBindings: [],

  extensions: [
    {
      extensionId: 'sanctuary-art',
      config: {
        forgeChangeKey: FORGE_LIT,
        hearthEntityId: FORGE_HEARTH.id,
        emberEntityId: EMBER_ID,
        sockets: RUNE_SOCKET_SPOTS.map((socket, index) => ({
          x: socket.x,
          z: socket.z,
          changeKey: fireRuneChangeKey(FIRE_RUNE_SPOTS[index]!.id),
        })),
        runeEntityIds: FIRE_RUNE_SPOTS.map((rune) => rune.id),
        scaleEntityIds: DRAGON_SCALE_SPOTS.map((scale) => scale.id),
        gates: SEALED_GATES.map((gate) => ({
          entityId: gate.id,
          halfWidth: gate.halfWidth,
          height: gate.height,
          thickness: WALL_HALF_THICKNESS,
          seam: gate.id.includes('crystal') ? 'CRYSTAL' : 'EMBER',
        })),
        skyCliffs: SKY_CLIFFS.map((cliff) => ({
          x: cliff.x,
          z: cliff.z,
          halfWidth: cliff.halfWidth,
          height: cliff.height,
        })),
      },
    },
  ],

  copy: {
    loading: "Loading the Dragon's Sanctuary...",
    instructions:
      'Move: WASD or the arrow keys. Look: click the screen, then move your mouse (or drag with two fingers on a touch screen: left side to move, right side to look). Walk up to someone and press E, or use the buttons below, to talk.',
    statusLines: [
      {
        requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: FORGE_LIT }],
        text: 'The forge is burning, and the whole valley is warm again.',
      },
      {
        requirements: ALL_RUNES_FOUND,
        text: 'You have all three fire runes. The hearth is waiting.',
      },
      { text: 'The forge is cold and dark. Ember is waiting up at her roost.' },
    ],
    /*
      Every note whose requirements hold is shown, so these are written to be
      mutually exclusive where they have to be - and the three rune hints are
      per rune rather than one counted sentence, which is a small improvement
      on the per-region view: a hint for a rune the child already has stops
      being shown instead of the count quietly going down.
    */
    thingsToDoNotes: [
      {
        requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: FORGE_LIT }],
        text: 'All three fire runes are set in the hearth.',
      },
      {
        requirements: [...ALL_RUNES_FOUND, { type: 'WORLD_CHANGE_ABSENT', changeKey: FORGE_LIT }],
        text: 'You have found all three fire runes. Take them to the hearth inside the forge.',
      },
      ...RUNE_HINTS,
      {
        text: `There are ${DRAGON_SCALE_SPOTS.length} dragon scales hidden around the sanctuary.`,
      },
    ],
    altNav: { label: 'Prefer not to walk in 3D? Go back to the island map', to: '' },
  },
};
