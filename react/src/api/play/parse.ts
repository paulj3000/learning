import type { Reader } from '../parse';
import type {
  AnswerOutcome,
  ChestState,
  InventoryEntry,
  IssuedChallenge,
  ItemView,
  NpcPlacement,
  ObjectPlacement,
  PlacedEntity,
  PlayerProgress,
  PlaySession,
  QuestEntry,
  RegionBootstrap,
  SpawnPoint,
  WorldChange,
} from './types';

/** Response readers for docs/PLAY_API.md. Each mirrors one serializer. */

const SESSION_STATUSES = ['ACTIVE', 'PAUSED', 'COMPLETED', 'ABANDONED', 'SAFETY_STOPPED'] as const;
const QUEST_STATUSES = ['AVAILABLE', 'ACTIVE', 'COMPLETED'] as const;
const ITEM_CATEGORIES = ['COLLECTIBLE', 'COSMETIC', 'QUEST_ITEM', 'KEEPSAKE'] as const;

function placed(r: Reader): PlacedEntity {
  const placeholder = r.field('placeholder');
  return {
    entityId: r.field('entityId').string(),
    label: r.field('label').string(),
    x: r.field('x').number(),
    z: r.field('z').number(),
    elevation: r.field('elevation').number(),
    rotationY: r.field('rotationY').number(),
    scale: r.field('scale').number(),
    assetId: r.field('assetId').string(),
    placeholder: {
      width: placeholder.field('width').number(),
      height: placeholder.field('height').number(),
      depth: placeholder.field('depth').number(),
    },
  };
}

function npc(r: Reader): NpcPlacement {
  return {
    ...placed(r),
    npcId: r.field('npcId').string(),
    displayName: r.field('displayName').string(),
    interactionId: r.field('interactionId').string(),
  };
}

function object(r: Reader): ObjectPlacement {
  return {
    ...placed(r),
    kind: r.field('kind').oneOf(['PROP', 'COLLECTIBLE', 'SCENERY'] as const),
    interactionId: r.field('interactionId').string(),
  };
}

function chest(r: Reader): ChestState {
  return {
    ...placed(r),
    openClip: r.field('openClip').string(),
    isOpen: r.field('isOpen').boolean(),
    challengeAvailable: r.field('challengeAvailable').boolean(),
  };
}

function spawn(r: Reader): SpawnPoint {
  return {
    checkpointId: r.field('checkpointId').string(),
    label: r.field('label').string(),
    x: r.field('x').number(),
    z: r.field('z').number(),
    yaw: r.field('yaw').number(),
  };
}

export function session(r: Reader): PlaySession {
  return {
    sessionId: r.field('sessionId').string(),
    kind: r.field('kind').oneOf(['ADVENTURE', 'REGION'] as const),
    regionId: r.field('regionId').string(),
    templateSlug: r.field('templateSlug').string(),
    locationSlug: r.field('locationSlug').string(),
    status: r.field('status').oneOf(SESSION_STATUSES),
    startedAt: r.field('startedAt').string(),
    lastActivityAt: r.field('lastActivityAt').string(),
    completedAt: r.field('completedAt').nullable((v) => v.string()),
  };
}

function worldChange(r: Reader): WorldChange {
  return {
    locationSlug: r.field('locationSlug').string(),
    changeType: r.field('changeType').string(),
    changeKey: r.field('changeKey').string(),
    payload: r.field('payload').object(),
    createdAt: r.field('createdAt').string(),
  };
}

function item(r: Reader): ItemView {
  return {
    itemId: r.field('itemId').string(),
    displayName: r.field('displayName').string(),
    description: r.field('description').string(),
    category: r.field('category').oneOf(ITEM_CATEGORIES),
    assetId: r.field('assetId').string(),
  };
}

function inventoryEntry(r: Reader): InventoryEntry {
  return { item: item(r.field('item')), grantedAt: r.field('grantedAt').string() };
}

export function quest(r: Reader): QuestEntry {
  return {
    questId: r.field('questId').string(),
    title: r.field('title').string(),
    summary: r.field('summary').string(),
    giverNpcId: r.field('giverNpcId').nullable((v) => v.string()),
    status: r.field('status').oneOf(QUEST_STATUSES),
    currentStageId: r.field('currentStageId').nullable((v) => v.string()),
    completedAt: r.field('completedAt').nullable((v) => v.string()),
    stages: r.field('stages').array((stage) => ({
      id: stage.field('id').string(),
      title: stage.field('title').string(),
      complete: stage.field('complete').boolean(),
      objectives: stage.field('objectives').array((objective) => ({
        id: objective.field('id').string(),
        label: objective.field('label').string(),
        optional: objective.field('optional').boolean(),
        complete: objective.field('complete').boolean(),
      })),
    })),
  };
}

export function regionBootstrap(r: Reader): RegionBootstrap {
  const region = r.field('region');
  return {
    region: {
      regionId: region.field('regionId').string(),
      title: region.field('title').string(),
      locationSlug: region.field('locationSlug').string(),
      version: region.field('version').integer(),
      scene: region.field('scene').object(),
    },
    spawn: r.field('spawn').nullable(spawn),
    npcs: r.field('npcs').array(npc),
    objects: r.field('objects').array(object),
    chests: r.field('chests').array(chest),
    quests: r.field('quests').array(quest),
    session: r.field('session').nullable(session),
    worldChanges: r.field('worldChanges').array(worldChange),
  };
}

export function issuedChallenge(r: Reader): IssuedChallenge {
  const challenge = r.field('challenge');
  return {
    attemptId: r.field('attemptId').string(),
    attemptNumber: r.field('attemptNumber').integer(),
    sessionId: r.field('sessionId').string(),
    targetEntityId: r.field('targetEntityId').string(),
    ageBand: r.field('ageBand').oneOf(['SPROUT', 'PATHFINDER', 'EXPLORER'] as const),
    issuedAt: r.field('issuedAt').string(),
    challenge: {
      skillId: challenge.field('skillId').string(),
      operation: challenge.field('operation').oneOf(['COUNT', 'ADD', 'SUBTRACT'] as const),
      operands: challenge.field('operands').array((v) => v.integer()),
      responseMode: challenge.field('responseMode').oneOf(['CHOICE', 'NUMBER_INPUT'] as const),
      choices: challenge.field('choices').array((v) => v.integer()),
    },
  };
}

export function answerOutcome(r: Reader): AnswerOutcome {
  return {
    attemptId: r.field('attemptId').string(),
    correct: r.field('correct').boolean(),
    feedback: r.field('feedback').oneOf(['CORRECT', 'TRY_AGAIN'] as const),
    canRetry: r.field('canRetry').boolean(),
    chestOpened: r.field('chestOpened').boolean(),
    newItems: r.field('newItems').array(item),
    rewardMessage: r.field('rewardMessage').nullable((v) => v.string()),
    questUpdates: r.field('questUpdates').array((update) => ({
      questId: update.field('questId').string(),
      status: update.field('status').oneOf(QUEST_STATUSES),
      currentStageId: update.field('currentStageId').string(),
      justCompleted: update.field('justCompleted').boolean(),
      newlyCompletedObjectiveIds: update
        .field('newlyCompletedObjectiveIds')
        .array((v) => v.string()),
    })),
  };
}

export function playerProgress(r: Reader): PlayerProgress {
  return {
    sessions: r.field('sessions').array(session),
    worldChanges: r.field('worldChanges').array(worldChange),
    openedChests: r.field('openedChests').array((c) => ({
      regionId: c.field('regionId').string(),
      entityId: c.field('entityId').string(),
    })),
    inventory: r.field('inventory').array(inventoryEntry),
    quests: r.field('quests').array(quest),
    practice: r.field('practice').array((p) => ({
      objectiveCode: p.field('objectiveCode').string(),
      attempts: p.field('attempts').integer(),
      correct: p.field('correct').integer(),
    })),
  };
}
