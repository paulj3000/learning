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

export function bootstrapJson(overrides: Record<string, unknown> = {}, chest: Record<string, unknown> = {}) {
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
