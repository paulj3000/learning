/**
 * The Firepeak Volcano region bootstrap as the Django serializer produces it for a Pathfinder
 * (mirrors `lai/apps/regions/firepeak_seed.py`, trimmed to what the client tests need). Shared by
 * the manifest, scene and companion tests for the area puzzles (ADR-047, Firepeak FP-12).
 */

export const FIREPEAK = 'firepeak-volcano';
export const FIREPEAK_SESSION = '7a2b3c4d-0000-4000-8000-0000000000f1';

const KEYS = {
  observed: 'FIREPEAK_FEATURES_OBSERVED',
  crossing: 'FIREPEAK_CROSSING_REPAIRED',
  steam: 'FIREPEAK_STEAM_REDIRECTED',
  crystal: 'FIREPEAK_HEART_CRYSTAL_FOUND',
};
export const FIREPEAK_KEYS = KEYS;

function placed(entityId: string, x: number, z: number, extra: Record<string, unknown> = {}) {
  return {
    entityId,
    label: entityId,
    x,
    z,
    elevation: 0,
    rotationY: 0,
    scale: 1,
    assetId: '',
    placeholder: { width: 1, height: 1, depth: 1 },
    kind: 'PROP',
    interactionId: '',
    ...extra,
  };
}

const OBSERVE = {
  intro: 'Look through my telescope.',
  features: [
    { id: 'crater', label: 'Crater', explanation: 'The big bowl at the top.' },
    { id: 'lava-flow', label: 'Lava flow', explanation: 'Rock so hot it melted.' },
    { id: 'steam-vent', label: 'Steam vent', explanation: 'A crack that puffs steam.' },
  ],
  hints: ['Look at the top first.'],
  completeMessage: 'You found all three!',
};

const PLATFORMS = {
  intro: 'Fill each gap with the stone that fits.',
  stones: [
    { id: 'firepeak-stone-small', label: 'Small stone', size: 1 },
    { id: 'firepeak-stone-middle', label: 'Middle stone', size: 2 },
    { id: 'firepeak-stone-big', label: 'Long stone', size: 3 },
  ],
  slots: [
    { id: 'firepeak-gap-near', label: 'Near gap', gap: 1 },
    { id: 'firepeak-gap-middle', label: 'Middle gap', gap: 2 },
    { id: 'firepeak-gap-far', label: 'Far gap', gap: 3 },
  ],
  showOutlines: true,
  hintAfterAttempts: 2,
  hints: ['Match the outline to the stone with the same size.'],
  completeMessage: 'The crossing is safe now.',
};

const VALVES = {
  intro: 'Turn the valves to send the steam up into the sky.',
  channels: [
    { id: 'passage', label: 'Passage' },
    { id: 'copper-pipe', label: 'Copper pipe' },
    { id: 'cooling-tank', label: 'Cooling tank' },
    { id: 'sky-vent', label: 'Sky vent' },
  ],
  start: 'passage',
  goal: 'sky-vent',
  valves: [
    { id: 'firepeak-valve-red', label: 'Red valve', from: 'passage', to: 'copper-pipe' },
    { id: 'firepeak-valve-blue', label: 'Blue valve', from: 'copper-pipe', to: 'cooling-tank' },
    { id: 'firepeak-valve-green', label: 'Green valve', from: 'cooling-tank', to: 'sky-vent' },
  ],
  showSteamPath: true,
  hintAfterAttempts: 2,
  hints: ['Turn the valve next to the steam first.'],
  completeMessage: 'Whoosh!',
};

export function firepeakPuzzles(solved: readonly string[] = []) {
  const keyFor: Record<string, string> = {
    'firepeak-telescope': KEYS.observed,
    'firepeak-crossing': KEYS.crossing,
    'firepeak-steam': KEYS.steam,
    'firepeak-heart-crystal': KEYS.crystal,
    'firepeak-return': 'FIREPEAK_REPORTED_TO_EMBER',
  };
  const order = Object.keys(keyFor);
  const puzzle = (
    puzzleId: string,
    kind: string,
    title: string,
    entityIds: string[],
    parameters: Record<string, unknown>,
  ) => {
    const index = order.indexOf(puzzleId);
    const isSolved = solved.includes(puzzleId);
    const previousSolved = index === 0 || solved.includes(order[index - 1]);
    return {
      puzzleId,
      kind,
      title,
      entityIds,
      solved: isSolved,
      locked: !isSolved && !previousSolved,
      failedAttempts: 0,
      parameters,
    };
  };
  return [
    puzzle(
      'firepeak-telescope',
      'OBSERVE_FEATURES',
      'Look through the telescope',
      ['firepeak-telescope'],
      OBSERVE,
    ),
    puzzle(
      'firepeak-crossing',
      'PLACE_PLATFORMS',
      'Repair the lava crossing',
      [
        'firepeak-stone-small',
        'firepeak-stone-middle',
        'firepeak-stone-big',
        'firepeak-gap-near',
        'firepeak-gap-middle',
        'firepeak-gap-far',
      ],
      PLATFORMS,
    ),
    puzzle(
      'firepeak-steam',
      'VALVE_SEQUENCE',
      'Redirect the steam',
      ['firepeak-valve-red', 'firepeak-valve-blue', 'firepeak-valve-green'],
      VALVES,
    ),
    puzzle(
      'firepeak-heart-crystal',
      'COLLECT_OBJECT',
      'Discover the Heart Crystal',
      ['firepeak-crystal'],
      {
        intro: 'Something is glowing on the old pedestal.',
        discoveryMessage: 'You found the first Heart Crystal fragment!',
        scienceNote: 'Crystals grow slowly as hot rock cools.',
      },
    ),
    puzzle('firepeak-return', 'RETURN_TO_NPC', 'Return to Professor Ember', ['firepeak-ember'], {
      intro: 'Show Professor Ember the crystal fragment.',
      npcEntityId: 'firepeak-ember',
      completeMessage: 'Thank you, explorer!',
    }),
  ];
}

export function firepeakBootstrapJson(
  options: { solved?: readonly string[]; session?: boolean; deliverable?: readonly string[] } = {},
) {
  const solved = options.solved ?? [];
  const keyOf: Record<string, string> = {
    'firepeak-telescope': KEYS.observed,
    'firepeak-crossing': KEYS.crossing,
    'firepeak-steam': KEYS.steam,
    'firepeak-heart-crystal': KEYS.crystal,
  };
  const deliverable = new Set(options.deliverable ?? ['rock', 'ground-tile-stone']);
  const asset = (assetId: string, kind: string) => ({
    assetId,
    kind,
    clips: [],
    deliverable: deliverable.has(assetId),
  });
  return {
    region: {
      regionId: FIREPEAK,
      title: 'Firepeak Volcano',
      locationSlug: FIREPEAK,
      version: 1,
      scene: {
        bounds: { halfExtentX: 14, halfExtentZ: 34, wallThickness: 1 },
        environment: { backgroundColor: 0x3b2a33 },
        groundAssetId: 'ground-tile-stone',
        copy: { loading: 'Hiking up.', instructions: 'Talk to Professor Ember.' },
        colliders: [
          { id: 'firepeak-sealed-passage', minX: -4.5, maxX: 4.5, minZ: -14, maxZ: -12.5 },
        ],
        effects: {
          lava: [
            {
              id: 'firepeak-lava-river',
              minX: -14,
              maxX: 14,
              minZ: 1.5,
              maxZ: 11.5,
              safe: [
                { minX: -1.4, maxX: 1.4, minZ: 1.5, maxZ: 11.5, whenChangeKey: KEYS.crossing },
              ],
            },
          ],
          steam: [
            {
              id: 'firepeak-passage-steam',
              x: 0,
              z: -13,
              height: 4,
              hiddenWhenChangeKey: KEYS.steam,
            },
          ],
          lights: [{ id: 'glow', x: 0, y: 1.5, z: 6, color: 0xff6a1a, intensity: 2, distance: 18 }],
          backdrop: { assetId: 'firepeak-volcano-main', x: 0, z: -70, radius: 30, height: 34 },
          checkpoints: [
            { id: 'base-camp', label: 'Base Camp', x: 0, z: 28, yaw: 3.14 },
            { id: 'near-bank', label: 'the lava river', x: 0, z: 13, yaw: 3.14 },
            {
              id: 'far-bank',
              label: 'the far bank',
              x: 0,
              z: 0,
              yaw: 3.14,
              whenChangeKey: KEYS.crossing,
            },
          ],
          openings: [{ colliderId: 'firepeak-sealed-passage', whenChangeKey: KEYS.steam }],
          returns: [
            {
              entityId: 'firepeak-return-lift',
              toCheckpoint: 'base-camp',
              whenChangeKey: KEYS.crystal,
              label: 'Ride the rope lift back',
            },
          ],
          standIns: [
            { entityId: 'firepeak-telescope', shape: 'TELESCOPE', color: 0x8c6a3f },
            { entityId: 'firepeak-crystal', shape: 'CRYSTAL', color: 0x7fe7ff },
            { entityId: 'firepeak-return-lift', shape: 'PORTAL', color: 0xffd36b },
            { entityId: 'firepeak-tent', shape: 'TENT', color: 0xc9853a },
          ],
        },
      },
    },
    spawn: { checkpointId: 'base-camp', label: 'Base Camp', x: 0, z: 28, yaw: 3.14 },
    npcs: [
      {
        ...placed('firepeak-ember', -3, 22, { assetId: 'firepeak-professor-ember' }),
        label: 'Professor Ember',
        npcId: 'professor-ember',
        displayName: 'Professor Ember',
        interactionId: 'meet-professor-ember',
        dialogue: [
          {
            nodeId: 'ember-greeting',
            text: 'Hello, explorer! I am Professor Ember.',
            followUpOnly: false,
            choices: [
              { choiceId: 'ask', label: 'Why is it rumbling?', nextNodeId: 'ember-why-rumble' },
              { choiceId: 'bye', label: 'Let us find out!', nextNodeId: null },
            ],
          },
          {
            nodeId: 'ember-why-rumble',
            text: 'Deep below us there is hot melted rock called magma.',
            followUpOnly: true,
            choices: [],
          },
        ],
      },
    ],
    objects: [
      placed('firepeak-tent', -7.5, 26, { assetId: 'firepeak-base-camp', label: 'Research tent' }),
      placed('firepeak-telescope', 4, 20, { assetId: 'firepeak-telescope', label: 'Telescope' }),
      placed('firepeak-rock-1', -10, 30, { assetId: 'rock', kind: 'SCENERY', label: '' }),
      placed('firepeak-stone-small', -3, 13.5, {
        assetId: 'firepeak-stone-platform',
        label: 'Stone',
      }),
      placed('firepeak-stone-middle', 0, 13.5, {
        assetId: 'firepeak-stone-platform',
        label: 'Stone',
      }),
      placed('firepeak-stone-big', 3, 13.5, { assetId: 'firepeak-stone-platform', label: 'Stone' }),
      placed('firepeak-gap-near', 0, 9.5, { label: 'Gap in the crossing' }),
      placed('firepeak-gap-middle', 0, 6.5, { label: 'Gap in the crossing' }),
      placed('firepeak-gap-far', 0, 3.5, { label: 'Gap in the crossing' }),
      placed('firepeak-valve-red', -3.2, -5, {
        assetId: 'firepeak-steam-valve',
        label: 'Red valve',
      }),
      placed('firepeak-valve-blue', 3.2, -7, {
        assetId: 'firepeak-steam-valve',
        label: 'Blue valve',
      }),
      placed('firepeak-valve-green', -3.2, -9, {
        assetId: 'firepeak-steam-valve',
        label: 'Green valve',
      }),
      placed('firepeak-crystal', 0, -25.4, {
        assetId: 'firepeak-heart-crystal-fragment',
        kind: 'COLLECTIBLE',
        label: 'Glowing crystal',
      }),
      placed('firepeak-return-lift', 5, -19, { label: 'Rope lift' }),
    ],
    chests: [],
    quests: [
      {
        questId: 'the-volcano-awakens',
        title: 'The Volcano Awakens',
        summary: 'Help Professor Ember find out why Firepeak is waking up.',
        giverNpcId: 'professor-ember',
        status: 'ACTIVE',
        currentStageId: 'meet-professor-ember',
        completedAt: null,
        stages: [],
      },
    ],
    session: options.session
      ? {
          sessionId: FIREPEAK_SESSION,
          kind: 'REGION',
          regionId: FIREPEAK,
          templateSlug: '',
          locationSlug: FIREPEAK,
          status: 'ACTIVE',
          startedAt: '2026-11-01T10:00:00Z',
          lastActivityAt: '2026-11-01T10:00:00Z',
          completedAt: null,
        }
      : null,
    worldChanges: solved
      .filter((id) => keyOf[id])
      .map((id) => ({
        locationSlug: FIREPEAK,
        changeType: 'PUZZLE_SOLVED',
        changeKey: keyOf[id],
        payload: {},
        createdAt: '2026-11-01T10:05:00Z',
      })),
    launchPoints: [],
    puzzles: firepeakPuzzles(solved),
    catalog: {
      worldSlug: 'learning-adventure-island',
      assets: [
        asset('firepeak-professor-ember', 'character'),
        asset('firepeak-base-camp', 'prop'),
        asset('firepeak-telescope', 'prop'),
        asset('firepeak-stone-platform', 'prop'),
        asset('firepeak-steam-valve', 'prop'),
        asset('firepeak-heart-crystal-fragment', 'collectible'),
        asset('firepeak-volcano-main', 'kit-piece'),
        asset('rock', 'kit-piece'),
        asset('ground-tile-stone', 'kit-piece'),
      ],
    },
  };
}

export function puzzleOutcomeJson(overrides: Record<string, unknown> = {}) {
  return {
    attemptId: 'c0ffee00-0000-4000-8000-0000000000a1',
    correct: true,
    feedback: 'CORRECT',
    solvedNow: true,
    alreadySolved: false,
    failedAttempts: 0,
    newItems: [],
    rewardMessage: null,
    questUpdates: [],
    ...overrides,
  };
}
