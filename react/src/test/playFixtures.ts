/**
 * Play API responses exactly as the Django serializers produce them
 * (docs/PLAY_API.md). Shared by the TR-6 client, parser, and hook tests.
 */

export const CHILD_A = '0b6f6b0e-8c3a-4a51-9a52-0d1f7a1e0a01';
export const CHILD_B = '0b6f6b0e-8c3a-4a51-9a52-0d1f7a1e0b02';
export const SESSION_ID = '6f1c2a3b-0000-4000-8000-000000000001';
export const ATTEMPT_ID = 'b0e9aa11-0000-4000-8000-000000000002';

export function sessionJson(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: SESSION_ID,
    kind: 'REGION',
    regionId: 'treasure-rush-cove',
    templateSlug: '',
    locationSlug: 'pirate-builder-bay',
    status: 'ACTIVE',
    startedAt: '2026-10-24T18:02:11.120000Z',
    lastActivityAt: '2026-10-24T18:02:11.120000Z',
    completedAt: null,
    ...overrides,
  };
}

const placeholder = { width: 1.2, height: 0.9, depth: 0.8 };

export function questJson(overrides: Record<string, unknown> = {}) {
  return {
    questId: 'treasure-rush-cove',
    title: 'Treasure Rush',
    summary: 'Find the treasure chest in the cove and open it with a number puzzle.',
    giverNpcId: 'pirate-pip',
    status: 'AVAILABLE',
    currentStageId: null,
    completedAt: null,
    stages: [
      {
        id: 'open-the-chest',
        title: 'Open the treasure chest',
        complete: false,
        objectives: [
          {
            id: 'treasure-cove-open-chest',
            label: 'Open the treasure chest in the cove',
            optional: false,
            complete: false,
          },
        ],
      },
    ],
    ...overrides,
  };
}

export function bootstrapJson(
  overrides: Record<string, unknown> = {},
  chest: Record<string, unknown> = {},
) {
  return {
    region: {
      regionId: 'treasure-rush-cove',
      title: 'Treasure Cove',
      locationSlug: 'pirate-builder-bay',
      version: 1,
      scene: { bounds: { halfExtentX: 18, halfExtentZ: 18, wallThickness: 1 } },
    },
    spawn: { checkpointId: 'cove-landing', label: 'the landing', x: 0, z: 10, yaw: 0 },
    npcs: [
      {
        entityId: 'cove-pip',
        label: 'Pirate Pip',
        x: 3,
        z: 6,
        elevation: 0,
        rotationY: 0,
        scale: 1,
        assetId: '',
        placeholder: { width: 1, height: 1.6, depth: 1 },
        npcId: 'pirate-pip',
        displayName: 'Pirate Pip',
        interactionId: 'meet-pirate-pip',
      },
    ],
    objects: [
      {
        entityId: 'cove-rock',
        label: '',
        x: -4,
        z: 2,
        elevation: 0,
        rotationY: 0.5,
        scale: 2,
        assetId: 'rock',
        placeholder: { width: 1, height: 1, depth: 1 },
        kind: 'SCENERY',
        interactionId: '',
      },
    ],
    chests: [
      {
        entityId: 'cove-chest',
        label: 'Treasure chest',
        x: 0,
        z: -6,
        elevation: 0,
        rotationY: 0,
        scale: 1,
        assetId: 'treasure-chest',
        placeholder,
        openClip: 'Open',
        isOpen: false,
        challengeAvailable: true,
        ...chest,
      },
    ],
    quests: [questJson()],
    session: null,
    worldChanges: [],
    ...overrides,
  };
}

export function challengeJson(overrides: Record<string, unknown> = {}) {
  return {
    attemptId: ATTEMPT_ID,
    attemptNumber: 1,
    sessionId: SESSION_ID,
    targetEntityId: 'cove-chest',
    ageBand: 'PATHFINDER',
    issuedAt: '2026-10-24T18:02:30.004000Z',
    challenge: {
      skillId: 'addition-within-ten',
      operation: 'ADD',
      operands: [2, 3],
      responseMode: 'CHOICE',
      choices: [3, 4, 5, 6],
    },
    ...overrides,
  };
}

export const doubloonJson = {
  itemId: 'golden-doubloon',
  displayName: 'Golden Doubloon',
  description: 'A shiny gold coin from the treasure chest in the cove.',
  category: 'KEEPSAKE',
  assetId: '',
};

export function outcomeJson(correct: boolean, overrides: Record<string, unknown> = {}) {
  return {
    attemptId: ATTEMPT_ID,
    correct,
    feedback: correct ? 'CORRECT' : 'TRY_AGAIN',
    canRetry: !correct,
    chestOpened: correct,
    newItems: correct ? [doubloonJson] : [],
    rewardMessage: correct ? 'You opened the chest and found a Golden Doubloon!' : null,
    questUpdates: correct
      ? [
          {
            questId: 'treasure-rush-cove',
            status: 'COMPLETED',
            currentStageId: 'open-the-chest',
            justCompleted: true,
            newlyCompletedObjectiveIds: ['treasure-cove-open-chest'],
          },
        ]
      : [],
    ...overrides,
  };
}

export function progressJson() {
  return {
    sessions: [sessionJson()],
    worldChanges: [
      {
        locationSlug: 'pirate-builder-bay',
        changeType: 'UNLOCK',
        changeKey: 'TREASURE_RUSH_COVE_CHEST_OPENED',
        payload: { regionId: 'treasure-rush-cove', entityId: 'cove-chest' },
        createdAt: '2026-10-24T18:02:41.310000Z',
      },
    ],
    openedChests: [{ regionId: 'treasure-rush-cove', entityId: 'cove-chest' }],
    inventory: [{ item: doubloonJson, grantedAt: '2026-10-24T18:02:41.310000Z' }],
    quests: [questJson({ status: 'COMPLETED', currentStageId: 'open-the-chest' })],
    practice: [{ objectiveCode: 'addition-within-ten', attempts: 2, correct: 1 }],
  };
}

export function errorJson(code: string, details?: Record<string, unknown>) {
  return {
    error: { code, message: 'Fixed message.', ...(details ? { details } : {}) },
    request_id: 'req-12345678',
  };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The Treasure Cove bridge signpost (ADR-041), an object placement with a launch point. */
export function signpostJson(overrides: Record<string, unknown> = {}) {
  return {
    entityId: 'cove-bridge-signpost',
    label: 'Bridge signpost',
    x: -3,
    z: 6,
    elevation: 0,
    rotationY: 0,
    scale: 1,
    assetId: 'signpost',
    placeholder: { width: 0.6, height: 1.6, depth: 0.2 },
    kind: 'PROP',
    interactionId: '',
    ...overrides,
  };
}

export function launchPointJson(overrides: Record<string, unknown> = {}) {
  return {
    launchId: 'signpost-repair-the-moonlight-bridge',
    entityId: 'cove-bridge-signpost',
    objectKind: 'SIGN',
    label: 'Help Pip repair the Moonlight Bridge',
    prompt: 'The sign points to the broken bridge.',
    adventure: {
      adventureId: 'repair-the-moonlight-bridge',
      title: 'Repair the Moonlight Bridge',
      placeSlug: 'pirate-builder-bay',
    },
    ...overrides,
  };
}

export function launchStartJson(overrides: Record<string, unknown> = {}) {
  return {
    launchId: 'signpost-repair-the-moonlight-bridge',
    regionId: 'treasure-rush-cove',
    adventureId: 'repair-the-moonlight-bridge',
    placeSlug: 'pirate-builder-bay',
    session: { id: '6b1d2c84-1b7e-4a52-9b0e-2f5d9c3e7a10', currentStepId: 'count' },
    returnTo: { regionId: 'treasure-rush-cove' },
    ...overrides,
  };
}

/**
 * Treasure Cove's real four-zone layout (TR-13), from the snapshot the Django
 * tests keep equal to `lai/apps/regions/treasure_cove_layout.py`, as the
 * region's `scene` serves it.
 */
export async function coveSceneJson() {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  // Vitest runs from `react/`; in jsdom `import.meta.url` is not a file URL.
  const layout: unknown = JSON.parse(
    readFileSync(resolve(process.cwd(), '../lai/apps/regions/treasure_cove_layout.json'), 'utf8'),
  );
  return {
    bounds: { halfExtentX: 36, halfExtentZ: 44, wallThickness: 1 },
    layoutVersion: 3,
    layout,
  };
}

/**
 * Pip's Missing Treasure (TR-14) as the play API serves it: the landing chest open, the hidden
 * grove chest now findable, the beach chest waiting for the key, the ruins puzzle on its
 * pedestal with three rune stones, and the key not yet picked up. `chests` overrides by id.
 */
export function pipsBootstrapJson(
  overrides: Record<string, unknown> = {},
  chests: Record<string, Record<string, unknown>> = {},
) {
  const base = bootstrapJson();
  const chest = (entityId: string, fields: Record<string, unknown>) => ({
    ...base.chests[0],
    entityId,
    presentation: 'CHEST',
    sortOrder: 0,
    locked: false,
    lockReason: null,
    requiredItemId: null,
    answerEntityIds: [],
    clue: '',
    ...fields,
    ...chests[entityId],
  });
  const placed = (entityId: string, x: number, z: number, fields: Record<string, unknown>) => ({
    entityId,
    label: entityId,
    x,
    z,
    elevation: 0,
    rotationY: 0,
    scale: 1,
    assetId: '',
    placeholder: { width: 0.6, height: 1.6, depth: 0.4 },
    kind: 'PROP',
    interactionId: '',
    pickup: false,
    collected: false,
    ...fields,
  });
  return {
    ...base,
    objects: [
      placed('cove-brass-key', 31, 0, {
        label: 'Old brass key',
        kind: 'COLLECTIBLE',
        pickup: true,
      }),
      placed('cove-rune-stone-1', -3, -23, { label: 'Rune stone 1' }),
      placed('cove-rune-stone-2', 3, -23, { label: 'Rune stone 2' }),
      placed('cove-rune-stone-3', 0, -29.4, { label: 'Rune stone 3' }),
    ],
    chests: [
      chest('cove-chest', { isOpen: true, clue: 'My first chest is at the landing.' }),
      chest('cove-grove-chest', {
        label: 'Hidden chest',
        x: -30,
        z: 20,
        presentation: 'HIDDEN',
        sortOrder: 1,
        clue: 'Follow the flowers in the grove!',
      }),
      chest('cove-beach-chest', {
        label: 'Locked chest',
        x: 21,
        z: 22,
        sortOrder: 2,
        locked: true,
        lockReason: 'PROGRESS',
        requiredItemId: 'old-brass-key',
        clue: 'Look for an X in the sand to find the key!',
      }),
      chest('cove-ruins-pedestal', {
        label: 'Glowing pedestal',
        x: 0,
        z: -26,
        assetId: '',
        openClip: '',
        presentation: 'PUZZLE',
        sortOrder: 3,
        locked: true,
        lockReason: 'PROGRESS',
        answerEntityIds: ['cove-rune-stone-1', 'cove-rune-stone-2', 'cove-rune-stone-3'],
        clue: 'Read the pedestal, then touch the right stone.',
      }),
    ],
    quests: [
      questJson({
        questId: 'pips-missing-treasure',
        title: "Pip's Missing Treasure",
        status: 'ACTIVE',
        currentStageId: 'find-the-treasure',
        stages: [
          {
            id: 'find-the-treasure',
            title: "Find Pip's treasures",
            complete: false,
            objectives: ['landing', 'grove', 'beach', 'final'].map((id, index) => ({
              id: `cove-${id}-chest`,
              label: `Treasure ${index + 1}`,
              optional: false,
              complete: index === 0,
            })),
          },
          {
            id: 'return-to-pip',
            title: 'Bring the treasure back to Pip',
            complete: false,
            objectives: [
              { id: 'cove-return-to-pip', label: 'Talk to Pip', optional: false, complete: false },
            ],
          },
        ],
      }),
    ],
    ...overrides,
  };
}
