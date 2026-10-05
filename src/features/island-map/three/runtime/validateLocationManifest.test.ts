import { describe, expect, it } from 'vitest';
import { LOCATION_MANIFEST_SCHEMA_VERSION, type ThreeLocationManifest } from './locationManifest';
import {
  findNonJsonValues,
  validateLocationManifest,
  type LocationManifestIssueKind,
  type LocationManifestRegistries,
} from './validateLocationManifest';

const REGISTRIES: LocationManifestRegistries = {
  assets: [
    { id: 'ground-tile', clips: [] },
    { id: 'wall', clips: [] },
    { id: 'npc-guide', clips: ['Idle', 'Talk'] },
    { id: 'gem', clips: ['Idle'] },
  ],
  npcIds: ['guide'],
  checkpoints: [
    { id: 'test-cove:beach', regionId: 'test-cove' },
    { id: 'test-cove:rocks', regionId: 'test-cove' },
    { id: 'elsewhere:spot', regionId: 'elsewhere' },
  ],
  worldSlugs: ['home'],
  locations: [
    { slug: 'test-cove', worldSlug: 'home' },
    { slug: 'far-cove', worldSlug: 'away' },
  ],
  adventures: [
    {
      slug: 'find-the-shells',
      locationSlug: 'test-cove',
      steps: [
        {
          id: 'pick-a-shell',
          presentation: {
            kind: 'choice',
            options: [{ id: 'shell-pink' }, { id: 'shell-white' }],
          },
        },
        { id: 'tell-about-it', presentation: { kind: 'narrative' } },
      ],
    },
    { slug: 'far-cove-tale', locationSlug: 'far-cove' },
  ],
  discoveryIds: ['cove-secret'],
  storySlugs: ['cove-story'],
  itemIds: ['shell-bucket'],
  extensionIds: ['tide-trial'],
};

/** A small manifest exercising every section, valid against `REGISTRIES`. */
function validManifest(): ThreeLocationManifest {
  return {
    schemaVersion: LOCATION_MANIFEST_SCHEMA_VERSION,
    regionId: 'test-cove',
    locationSlug: 'test-cove',
    worldSlug: 'home',
    title: 'Test Cove',
    version: 1,
    bounds: { halfExtentX: 10, halfExtentZ: 8, wallThickness: 1 },
    environment: { backgroundColor: 0x88ccee, lighting: { ambientIntensity: 0.5 } },
    checkpoints: { ids: ['test-cove:beach', 'test-cove:rocks'], triggerHalfSize: 1.5 },
    colliders: [{ rect: { id: 'big-rock', minX: 2, maxX: 3, minZ: 2, maxZ: 3 } }],
    buildings: [
      {
        id: 'hut',
        label: 'the hut',
        x: -4,
        z: -4,
        halfWidth: 2,
        halfDepth: 2,
        height: 3,
        wallSides: ['north', 'east', 'west'],
        interiorZone: { id: 'hut:interior', minX: -5.5, maxX: -2.5, minZ: -5.5, maxZ: -2.5 },
        enterMessage: "You're inside the hut.",
        wallAssetId: 'wall',
      },
    ],
    scenery: [
      {
        kind: 'TILED_GROUND',
        id: 'ground',
        assetId: 'ground-tile',
        area: { id: 'ground:area', minX: -10, maxX: 10, minZ: -8, maxZ: 8 },
        tileSize: 4,
      },
      {
        kind: 'FLAT_PLANE',
        id: 'sea',
        color: 0x2266aa,
        area: { id: 'sea:area', minX: -10, maxX: 10, minZ: 6, maxZ: 12 },
        y: -0.05,
      },
      {
        kind: 'RUN',
        id: 'fence',
        assetId: 'wall',
        from: { x: 0, z: 0 },
        to: { x: 2, z: 0 },
        segmentLength: 1,
      },
    ],
    npcs: [
      {
        entityId: 'guide-entity',
        npcId: 'guide',
        assetId: 'npc-guide',
        position: { x: 1, z: 1 },
        label: 'Guide',
        idleClip: 'Idle',
        placeholderColor: 0x00ff00,
        interactionId: 'talk-to-guide',
      },
    ],
    props: [
      {
        entityId: 'chest',
        assetId: 'gem',
        position: { x: 3, z: -3 },
        label: 'A chest',
        interactionId: 'cove-tale',
        interactClip: 'Idle',
      },
    ],
    collectibles: [
      {
        entityId: 'shell',
        assetId: 'gem',
        position: { x: -1, z: 2 },
        label: 'a shell',
        idleClip: 'Idle',
        requirements: [{ type: 'WORLD_CHANGE_ABSENT', changeKey: 'SHELL_FOUND' }],
        pickUpMessage: 'You picked up a shell.',
        worldChange: { changeType: 'COLLECTIBLE_FOUND', changeKey: 'SHELL_FOUND' },
      },
    ],
    zones: [{ rect: { id: 'tide-pool', minX: 4, maxX: 6, minZ: -2, maxZ: 0 } }],
    ambient: [
      {
        kind: 'SPLINE_LOOP',
        id: 'gull',
        path: [
          { x: 0, y: 3, z: 0 },
          { x: 2, y: 3, z: 2 },
          { x: -2, y: 3, z: 2 },
        ],
        loopsPerSecond: 0.05,
        appearance: { primitive: 'CONE', color: 0xffffff },
      },
    ],
    interactions: [
      {
        id: 'talk-to-guide',
        type: 'NPC',
        trigger: 'TAP',
        title: 'Talk to the guide',
        targetId: 'guide',
        action: { kind: 'TALK_TO', npcId: 'guide' },
      },
      {
        id: 'tide-pool',
        type: 'ADVENTURE',
        trigger: 'APPROACH',
        title: 'Look in the tide pool',
        targetId: 'find-the-shells',
        action: {
          kind: 'START_ADVENTURE',
          locationSlug: 'test-cove',
          templateSlug: 'find-the-shells',
        },
      },
      {
        id: 'hut-secret',
        type: 'DISCOVERY',
        trigger: 'ENTER',
        title: 'Search the hut',
        targetId: 'cove-secret',
        zoneId: 'hut:interior',
        action: { kind: 'DISCOVER', discoveryId: 'cove-secret' },
      },
      {
        id: 'cove-tale',
        type: 'OBJECT',
        trigger: 'TAP',
        title: 'Hear a cove story',
        targetId: 'cove-story',
        action: { kind: 'START_STORY', storySlug: 'cove-story' },
      },
      {
        id: 'leave',
        type: 'LOCATION',
        trigger: 'TAP',
        title: 'Sail home',
        targetId: 'home',
        action: { kind: 'NAVIGATE', to: '' },
      },
    ],
    /*
      Two things in the room standing for the two options of one step. The
      chest and the shell are what this fixture places, so they are what can
      be bound; the step's own options are unchanged by the binding.
    */
    adventureBindings: [
      {
        entityId: 'chest',
        templateSlug: 'find-the-shells',
        stepId: 'pick-a-shell',
        optionId: 'shell-pink',
      },
      {
        entityId: 'shell',
        templateSlug: 'find-the-shells',
        stepId: 'pick-a-shell',
        optionId: 'shell-white',
      },
    ],
    extensions: [{ extensionId: 'tide-trial', config: { boardSize: 3, labels: ['a', 'b'] } }],
    copy: {
      loading: 'Loading Test Cove...',
      instructions: 'Walk around and say hello.',
      altNav: { label: 'Go back to the harbor', to: '' },
    },
  };
}

function kinds(manifest: ThreeLocationManifest): LocationManifestIssueKind[] {
  return validateLocationManifest(manifest, REGISTRIES).map((issue) => issue.kind);
}

describe('validateLocationManifest', () => {
  it('accepts a manifest whose every reference resolves', () => {
    expect(validateLocationManifest(validManifest(), REGISTRIES)).toEqual([]);
  });

  it('survives a JSON round trip unchanged (acceptance A3)', () => {
    const manifest = validManifest();
    const reloaded = JSON.parse(JSON.stringify(manifest)) as ThreeLocationManifest;
    expect(reloaded).toEqual(manifest);
    expect(validateLocationManifest(reloaded, REGISTRIES)).toEqual([]);
  });

  it('rejects an unsupported schema version and a non-positive content version', () => {
    const manifest = {
      ...validManifest(),
      schemaVersion: 2,
      version: 0,
    } as unknown as ThreeLocationManifest;
    expect(kinds(manifest)).toEqual(['UNSUPPORTED_SCHEMA_VERSION', 'INVALID_VALUE']);
  });

  it('rejects executable or engine values smuggled into a manifest', () => {
    const manifest = validManifest() as unknown as Record<string, unknown>;
    manifest.copy = { ...validManifest().copy, onEnter: () => undefined };
    class Vector3Like {
      x = 0;
    }
    manifest.environment = {
      backgroundColor: Number.NaN,
      lighting: { sunPosition: new Vector3Like() },
    };
    const issues = validateLocationManifest(
      manifest as unknown as ThreeLocationManifest,
      REGISTRIES,
    );
    expect(
      issues.filter((issue) => issue.kind === 'NOT_JSON_SERIALIZABLE').map((issue) => issue.path),
    ).toEqual([
      '$.environment.backgroundColor',
      '$.environment.lighting.sunPosition',
      '$.copy.onEnter',
    ]);
  });

  it('rejects an unknown world, an unknown location, and a location owned by another world', () => {
    /*
      The fixture's pickup records against the manifest's own location, and
      its bindings name an adventure authored for it, so both cascade when the
      location changes. Left out here to keep this about identity; each has
      its own test below.
    */
    const identity = (overrides: Partial<ThreeLocationManifest>): LocationManifestIssueKind[] => {
      const base = validManifest();
      return kinds({
        ...base,
        collectibles: [{ ...base.collectibles[0]!, worldChange: undefined }],
        adventureBindings: [],
        ...overrides,
      });
    };
    expect(identity({ worldSlug: 'nowhere', locationSlug: undefined })).toEqual(['UNKNOWN_WORLD']);
    expect(identity({ locationSlug: 'missing' })).toEqual(['UNKNOWN_LOCATION']);
    expect(identity({ locationSlug: 'far-cove' })).toEqual(['LOCATION_IN_WRONG_WORLD']);
  });

  it('requires exactly the region’s authored checkpoints, in authored order', () => {
    const base = validManifest();
    expect(
      kinds({
        ...base,
        checkpoints: { ...base.checkpoints, ids: ['test-cove:rocks', 'test-cove:beach'] },
      }),
    ).toEqual(['CHECKPOINT_MISMATCH']);
    expect(
      kinds({ ...base, checkpoints: { ...base.checkpoints, ids: ['test-cove:beach'] } }),
    ).toEqual(['CHECKPOINT_MISMATCH']);
    expect(kinds({ ...base, regionId: 'no-checkpoints-here' })).toEqual(['CHECKPOINT_MISMATCH']);
  });

  it('rejects duplicate scene ids across sections and inverted rects', () => {
    const base = validManifest();
    const issues = validateLocationManifest(
      {
        ...base,
        zones: [
          { rect: { id: 'tide-pool', minX: 4, maxX: 6, minZ: -2, maxZ: 0 } },
          { rect: { id: 'shell', minX: 6, maxX: 4, minZ: 0, maxZ: 1 } },
        ],
      },
      REGISTRIES,
    );
    expect(issues.map((issue) => issue.kind)).toEqual(['DUPLICATE_ID', 'INVALID_RECT']);
    expect(issues[0]?.detail).toContain('collectibles[0].entityId');
  });

  it('rejects an NPC, collectible or building placed outside the walkable bounds', () => {
    const base = validManifest();
    const npc = { ...base.npcs[0]!, position: { x: 11, z: 0 } };
    expect(kinds({ ...base, npcs: [npc] })).toEqual(['OUT_OF_BOUNDS']);
  });

  it('rejects unknown assets and idle clips the asset does not author', () => {
    const base = validManifest();
    expect(kinds({ ...base, npcs: [{ ...base.npcs[0]!, idleClip: 'Dance' }] })).toEqual([
      'UNKNOWN_CLIP',
    ]);
    expect(
      kinds({ ...base, collectibles: [{ ...base.collectibles[0]!, assetId: 'nope' }] }),
    ).toEqual(['UNKNOWN_ASSET']);
    expect(kinds({ ...base, buildings: [{ ...base.buildings[0]!, roofAssetId: 'nope' }] })).toEqual(
      ['UNKNOWN_ASSET'],
    );
  });

  it('rejects an NPC placement naming an NPC the cast does not have', () => {
    const base = validManifest();
    expect(kinds({ ...base, npcs: [{ ...base.npcs[0]!, npcId: 'stranger' }] })).toEqual([
      'UNKNOWN_NPC',
    ]);
  });

  it('rejects an entity bound to an interaction the manifest does not declare', () => {
    const base = validManifest();
    expect(kinds({ ...base, npcs: [{ ...base.npcs[0]!, interactionId: 'missing' }] })).toEqual([
      'UNKNOWN_INTERACTION',
    ]);
  });

  it('requires walk-in interactions to have a zone, defaulting the zone id to the interaction id', () => {
    const base = validManifest();
    expect(kinds({ ...base, zones: [] })).toEqual(['UNKNOWN_ZONE']);
  });

  it('resolves every interaction action against the existing engines’ registries', () => {
    const base = validManifest();
    const withAction = (
      index: number,
      action: ThreeLocationManifest['interactions'][number]['action'],
    ) => ({
      ...base,
      interactions: base.interactions.map((interaction, i) =>
        i === index ? { ...interaction, action } : interaction,
      ),
    });
    expect(kinds(withAction(0, { kind: 'TALK_TO', npcId: 'stranger' }))).toEqual(['UNKNOWN_NPC']);
    expect(
      kinds(
        withAction(1, { kind: 'START_ADVENTURE', locationSlug: 'test-cove', templateSlug: 'nope' }),
      ),
    ).toEqual(['UNKNOWN_ADVENTURE']);
    expect(
      kinds(
        withAction(1, {
          kind: 'START_ADVENTURE',
          locationSlug: 'far-cove',
          templateSlug: 'find-the-shells',
        }),
      ),
    ).toEqual(['ADVENTURE_IN_WRONG_LOCATION']);
    expect(kinds(withAction(2, { kind: 'DISCOVER', discoveryId: 'nope' }))).toEqual([
      'UNKNOWN_DISCOVERY',
    ]);
    expect(kinds(withAction(3, { kind: 'START_STORY', storySlug: 'nope' }))).toEqual([
      'UNKNOWN_STORY',
    ]);
    expect(kinds(withAction(4, { kind: 'SHOW_MESSAGE', message: '  ' }))).toEqual(['MISSING_COPY']);
  });

  it('rejects a duplicated interaction id', () => {
    const base = validManifest();
    expect(kinds({ ...base, interactions: [...base.interactions, base.interactions[0]!] })).toEqual(
      ['DUPLICATE_ID'],
    );
  });

  it('rejects a collectible world change nothing can ever stop coming back', () => {
    // The live Clockwork Harbor bug the audit recorded: the gear is recorded
    // as found and then built again on the next visit.
    const base = validManifest();
    const ungated = { ...base.collectibles[0]!, requirements: undefined };
    expect(kinds({ ...base, collectibles: [ungated] })).toEqual(['UNGATED_WORLD_CHANGE']);
    const wrongKey = {
      ...base.collectibles[0]!,
      requirements: [{ type: 'WORLD_CHANGE_ABSENT' as const, changeKey: 'SOMETHING_ELSE' }],
    };
    expect(kinds({ ...base, collectibles: [wrongKey] })).toEqual(['UNGATED_WORLD_CHANGE']);
  });

  it('rejects a collectible world change with empty keys, an unknown location, or no location at all', () => {
    const base = validManifest();
    const collectible = base.collectibles[0]!;
    expect(
      kinds({
        ...base,
        collectibles: [
          { ...collectible, worldChange: { ...collectible.worldChange!, changeType: ' ' } },
        ],
      }),
    ).toEqual(['INVALID_VALUE']);
    expect(
      kinds({
        ...base,
        collectibles: [
          {
            ...collectible,
            worldChange: { ...collectible.worldChange!, locationSlug: 'nowhere' },
          },
        ],
      }),
    ).toEqual(['UNKNOWN_LOCATION']);
    // A region that is not a location (the harbour hub) has to name one.
    expect(kinds({ ...base, locationSlug: undefined, collectibles: [collectible] })).toEqual([
      'INVALID_VALUE',
    ]);
  });

  it('rejects an empty pick-up message', () => {
    const base = validManifest();
    expect(
      kinds({ ...base, collectibles: [{ ...base.collectibles[0]!, pickUpMessage: '  ' }] }),
    ).toEqual(['MISSING_COPY']);
  });

  it('resolves every adventure step binding against the real step and its options', () => {
    const base = validManifest();
    const [first, second] = base.adventureBindings;
    const withBindings = (...bindings: ThreeLocationManifest['adventureBindings']) => ({
      ...base,
      adventureBindings: bindings,
    });
    expect(kinds(withBindings({ ...first!, templateSlug: 'nope' }, second!))).toEqual([
      'UNKNOWN_ADVENTURE',
      'UNBOUND_STEP_OPTION',
    ]);
    expect(kinds(withBindings({ ...first!, stepId: 'tell-about-it' }, second!))).toEqual([
      'UNKNOWN_STEP_OPTION',
      'UNBOUND_STEP_OPTION',
    ]);
    expect(kinds(withBindings({ ...first!, optionId: 'shell-blue' }, second!))).toEqual([
      'UNKNOWN_STEP_OPTION',
      'UNBOUND_STEP_OPTION',
    ]);
    expect(kinds(withBindings({ ...first!, entityId: 'not-here' }, second!))).toEqual([
      'UNPLACED_ENTITY',
    ]);
  });

  it('rejects a step whose options are not all bound, and an entity bound twice in one adventure', () => {
    const base = validManifest();
    const [first, second] = base.adventureBindings;
    // One option of a bound step with no entity: the room offers one of two
    // choices and nothing else complains.
    expect(kinds({ ...base, adventureBindings: [first!] })).toEqual(['UNBOUND_STEP_OPTION']);
    expect(
      kinds({
        ...base,
        adventureBindings: [first!, second!, { ...second!, optionId: 'shell-pink' }],
      }),
      // `shell-pink` now has two entities, which is the same mistake seen
      // from the option's side.
    ).toEqual(['DUPLICATE_BINDING', 'UNBOUND_STEP_OPTION']);
  });

  it('rejects a binding into an adventure authored for another location', () => {
    const base = validManifest();
    expect(
      kinds({
        ...base,
        adventureBindings: [
          {
            entityId: 'chest',
            templateSlug: 'far-cove-tale',
            stepId: 'pick-a-shell',
            optionId: 'shell-pink',
          },
        ],
      }),
    ).toEqual(['UNKNOWN_ADVENTURE_STEP', 'ADVENTURE_IN_WRONG_LOCATION']);
  });

  it('rejects an extension the registry does not know', () => {
    const base = validManifest();
    expect(
      kinds({ ...base, extensions: [{ extensionId: 'castle-pattern-lock', config: {} }] }),
    ).toEqual(['UNKNOWN_EXTENSION']);
  });

  it('rejects empty child-facing copy', () => {
    const base = validManifest();
    expect(kinds({ ...base, copy: { ...base.copy, instructions: '' } })).toEqual(['MISSING_COPY']);
  });

  it('rejects degenerate geometry values', () => {
    const base = validManifest();
    expect(
      kinds({
        ...base,
        checkpoints: { ...base.checkpoints, triggerHalfSize: 0 },
        ambient: [{ ...base.ambient[0]!, path: base.ambient[0]!.path.slice(0, 2) }],
      }),
    ).toEqual(['INVALID_VALUE', 'INVALID_VALUE']);
  });
});

describe('findNonJsonValues', () => {
  it('allows plain data and absent optional fields', () => {
    expect(findNonJsonValues({ a: 1, b: 'x', c: [true, null], d: undefined })).toEqual([]);
  });

  it('reports functions, non-finite numbers, undefined array entries and class instances', () => {
    expect(
      findNonJsonValues({ f: () => 1, n: Infinity, list: [undefined], date: new Date(0) }),
    ).toEqual([
      { path: '$.f', reason: 'function' },
      { path: '$.n', reason: 'non-finite number' },
      { path: '$.list[0]', reason: 'undefined' },
      { path: '$.date', reason: 'non-plain object' },
    ]);
  });
});
