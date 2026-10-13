import { HOME_WORLD_SLUG } from '../../../../worlds/slugs';
import type { RegionCheckpoint } from '../../../../discovery/checkpoints';
import { REPAIR_THE_MOONLIGHT_BRIDGE } from '../../../../adventures/content/repairTheMoonlightBridge';
import { LOCATION_MANIFEST_SCHEMA_VERSION, type ThreeLocationManifest } from '../locationManifest';

/**
 * Test Explorer Cove: engine Phase 17's extensibility proof
 * (`docs/engine/10_IMPLEMENTATION_PHASES.md`, `docs/engine/11_ACCEPTANCE_TESTS.md`
 * "Final Expansion Test"). A location nobody shipped, built only from
 * mechanics and content that already exist: an environment, a spawn, two
 * checkpoints, Pip, the tide-pool discovery (which is the first objective of
 * the existing "The Quiet Places" quest), an entrance to "Repair the
 * Moonlight Bridge", a collectible that records one durable fact, and a boat
 * to the travel deck.
 *
 * Test-only, never imported by production code, so no child can reach it.
 * The one thing it needs outside a manifest is its checkpoints, which belong
 * to the World State layer (ADR-008) rather than to the renderer; the tests
 * add them to that catalogue with `withTestExplorerCoveCheckpoints`, which is
 * what authoring a real location would do in `discovery/checkpoints.ts`.
 */

export const TEST_EXPLORER_COVE_REGION_ID = 'test-explorer-cove';

export const TEST_EXPLORER_COVE_CHECKPOINTS: readonly RegionCheckpoint[] = [
  {
    id: 'test-explorer-cove:landing',
    regionId: TEST_EXPLORER_COVE_REGION_ID,
    label: 'the landing',
    x: 0,
    z: 8,
    yaw: Math.PI,
  },
  {
    id: 'test-explorer-cove:rock-pools',
    regionId: TEST_EXPLORER_COVE_REGION_ID,
    label: 'the rock pools',
    x: -6,
    z: -6,
    yaw: 0,
  },
];

export const COVE_NPC_ENTITY_ID = 'pirate-pip';
export const COVE_DISCOVERY_ID = 'harbor-tide-pool';
export const COVE_TIDE_POOL_ZONE_ID = 'test-explorer-cove:tide-pool';
export const COVE_SIGNPOST_ENTITY_ID = 'test-explorer-cove:signpost';
export const COVE_BOAT_ENTITY_ID = 'test-explorer-cove:rowboat';
export const COVE_SHELL_ENTITY_ID = 'test-explorer-cove:shell';
export const COVE_SHELL_FOUND = 'TEST_EXPLORER_COVE_SHELL_FOUND';
/** Taken from the adventure itself, so this file names no location (`noLocationBranching.test.ts`). */
export const COVE_ADVENTURE_SLUG = REPAIR_THE_MOONLIGHT_BRIDGE.slug;
export const COVE_ADVENTURE_LOCATION = REPAIR_THE_MOONLIGHT_BRIDGE.locationSlug;

const HALF_EXTENT = 12;

export const TEST_EXPLORER_COVE_MANIFEST: ThreeLocationManifest = {
  schemaVersion: LOCATION_MANIFEST_SCHEMA_VERSION,
  regionId: TEST_EXPLORER_COVE_REGION_ID,
  worldSlug: HOME_WORLD_SLUG,
  title: 'Test Explorer Cove',
  version: 1,

  bounds: { halfExtentX: HALF_EXTENT, halfExtentZ: HALF_EXTENT, wallThickness: 1 },
  environment: {
    backgroundColor: 0x9fd3e8,
    lighting: { ambientIntensity: 0.7 },
    variants: [
      {
        requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: COVE_SHELL_FOUND }],
        backgroundColor: 0xf2c48d,
      },
    ],
  },
  checkpoints: {
    ids: TEST_EXPLORER_COVE_CHECKPOINTS.map((checkpoint) => checkpoint.id),
    triggerHalfSize: 1.5,
  },
  colliders: [
    // A sea wall along the south edge, inside the boundary.
    { rect: { id: 'test-explorer-cove:sea-wall', minX: -12, maxX: 12, minZ: 10.5, maxZ: 11 } },
  ],
  buildings: [],

  scenery: [
    {
      kind: 'TILED_GROUND',
      id: 'test-explorer-cove:sand',
      assetId: 'ground-tile',
      area: {
        id: 'test-explorer-cove:sand:area',
        minX: -HALF_EXTENT,
        maxX: HALF_EXTENT,
        minZ: -HALF_EXTENT,
        maxZ: HALF_EXTENT,
      },
      tileSize: 4,
      coverage: 'COVER',
    },
    {
      kind: 'CLUSTER',
      id: 'test-explorer-cove:rocks',
      assetId: 'rock',
      positions: [
        { x: -9, z: -9 },
        { x: -4, z: -9, rotationY: 0.6 },
      ],
    },
  ],

  npcs: [
    {
      entityId: COVE_NPC_ENTITY_ID,
      npcId: COVE_NPC_ENTITY_ID,
      assetId: 'npc-pip',
      position: { x: 4, z: 2 },
      label: 'Pip',
      idleClip: 'Idle',
      placeholderColor: 0x2f8f4e,
      interactionId: 'test-explorer-cove:say-hello-to-pip',
    },
  ],

  props: [
    {
      entityId: COVE_SIGNPOST_ENTITY_ID,
      assetId: 'signpost',
      position: { x: -4, z: 2 },
      label: 'a signpost to the bridge',
      interactionId: 'test-explorer-cove:mend-the-bridge',
    },
    {
      entityId: COVE_BOAT_ENTITY_ID,
      assetId: 'mooring-post',
      position: { x: 0, z: 10 },
      label: 'a little rowboat',
      interactionId: 'test-explorer-cove:row-away',
    },
  ],

  collectibles: [
    {
      entityId: COVE_SHELL_ENTITY_ID,
      assetId: 'collectible-gem',
      position: { x: 8, z: -8 },
      label: 'a spiral shell',
      idleClip: 'Idle',
      requirements: [{ type: 'WORLD_CHANGE_ABSENT', changeKey: COVE_SHELL_FOUND }],
      pickUpMessage: 'You found a spiral shell.',
      worldChange: {
        changeType: 'COLLECTIBLE_FOUND',
        changeKey: COVE_SHELL_FOUND,
        locationSlug: COVE_ADVENTURE_LOCATION,
      },
    },
  ],

  zones: [
    {
      rect: { id: COVE_TIDE_POOL_ZONE_ID, minX: -8, maxX: -4, minZ: -8, maxZ: -4 },
      enterMessage: 'Water glints between the rocks.',
    },
  ],

  ambient: [],

  interactions: [
    {
      id: 'test-explorer-cove:say-hello-to-pip',
      type: 'NPC',
      trigger: 'TAP',
      title: 'Say hello to Pip',
      targetId: COVE_NPC_ENTITY_ID,
      action: { kind: 'TALK_TO', npcId: COVE_NPC_ENTITY_ID },
    },
    {
      id: 'test-explorer-cove:tide-pool',
      type: 'DISCOVERY',
      trigger: 'ENTER',
      title: 'Look into the tide pool',
      targetId: COVE_TIDE_POOL_ZONE_ID,
      action: { kind: 'DISCOVER', discoveryId: COVE_DISCOVERY_ID },
    },
    {
      id: 'test-explorer-cove:mend-the-bridge',
      type: 'ADVENTURE',
      trigger: 'TAP',
      title: 'Help mend the Moonlight Bridge',
      targetId: COVE_SIGNPOST_ENTITY_ID,
      action: {
        kind: 'START_ADVENTURE',
        locationSlug: COVE_ADVENTURE_LOCATION,
        templateSlug: COVE_ADVENTURE_SLUG,
      },
    },
    {
      id: 'test-explorer-cove:row-away',
      type: 'LOCATION',
      trigger: 'TAP',
      title: 'Row to another island',
      targetId: COVE_BOAT_ENTITY_ID,
      action: { kind: 'NAVIGATE', to: 'travel' },
    },
  ],

  adventureBindings: [],
  extensions: [],

  copy: {
    loading: 'Loading Test Explorer Cove...',
    instructions: 'Explore the cove. Walk up to Pip and press E to say hello.',
    statusLines: [
      {
        requirements: [{ type: 'WORLD_CHANGE_PRESENT', changeKey: COVE_SHELL_FOUND }],
        text: 'The spiral shell is safe in your backpack.',
      },
      { text: 'Something shiny is hiding near the rocks.' },
    ],
    checkpointToasts: { found: 'You found {checkpoint}.' },
    altNav: { label: 'Go back to the harbor', to: '' },
  },
};

type CheckpointsModule = typeof import('../../../../discovery/checkpoints');

/**
 * The World State checkpoint catalogue with the cove's two added, for a
 * test's `vi.mock('.../discovery/checkpoints', ...)`. Rebuilds the four
 * catalogue-reading exports over the longer list; everything else is the
 * real module.
 */
export function withTestExplorerCoveCheckpoints(actual: CheckpointsModule): CheckpointsModule {
  const all: readonly RegionCheckpoint[] = [
    ...actual.ALL_CHECKPOINTS,
    ...TEST_EXPLORER_COVE_CHECKPOINTS,
  ];
  const findCheckpoint = (id: string | undefined) =>
    id ? all.find((checkpoint) => checkpoint.id === id) : undefined;
  return {
    ...actual,
    ALL_CHECKPOINTS: all,
    KNOWN_CHECKPOINT_IDS: all.map((checkpoint) => checkpoint.id),
    findCheckpoint,
    resolveSpawnCheckpoint: (regionId, lastCheckpointId) => {
      const stored = findCheckpoint(lastCheckpointId);
      if (stored && stored.regionId === regionId) return stored;
      const fallback = all.find((checkpoint) => checkpoint.regionId === regionId);
      if (!fallback) throw new Error(`No checkpoints authored for region "${regionId}"`);
      return fallback;
    },
  };
}
