/**
 * The North Pole Village region bootstrap as the Django serializer produces it, built from the
 * real seed snapshots (`north_pole_scene.json`: scene, placements, chests, spawn; and
 * `north_pole_puzzles.json`: every puzzle body for the three age bands) and the catalogue content
 * export. TypeScript cannot import Python, so the snapshots are the contract (NP-037, NP-044).
 */
import puzzleSnapshot from '../../../lai/apps/regions/north_pole_puzzles.json';
import sceneSnapshot from '../../../lai/apps/regions/north_pole_scene.json';
import { NORTH_POLE_QUESTS } from '../features/content-export/northPoleContent';

export const NORTH_POLE = 'north-pole-village';
export const NORTH_POLE_SESSION = '7a2b3c4d-0000-4000-8000-0000000000e1';
export type NorthPoleBand = 'SPROUT' | 'PATHFINDER' | 'EXPLORER';

interface SnapshotPlacement {
  asset_id: string;
  elevation: number;
  entity_id: string;
  kind: 'NPC' | 'PROP' | 'COLLECTIBLE' | 'SCENERY';
  label: string;
  npc_id: string;
  pickup_change_key: string;
  placeholder_depth: number;
  placeholder_height: number;
  placeholder_width: number;
  rotation_y: number;
  x: number;
  z: number;
}

interface SnapshotPuzzle {
  puzzleId: string;
  kind: string;
  title: string;
  requiresChangeKeys: string[];
  worldChangeKey: string;
  ageBands: Record<NorthPoleBand, Record<string, unknown>>;
}

interface SnapshotChestSpot {
  elevation: number;
  label: string;
  rotation_y: number;
  x: number;
  z: number;
}

const SCENE = sceneSnapshot as unknown as {
  scene: Record<string, unknown>;
  placements: SnapshotPlacement[];
  chests: Record<string, SnapshotChestSpot>;
  puzzleEntities: Record<string, string[]>;
  puzzleEntityMaps: Record<string, Record<string, string>>;
  spawn: { checkpoint_id: string; label: string; x: number; z: number; yaw: number };
};
export const NORTH_POLE_PUZZLE_SNAPSHOT = puzzleSnapshot as unknown as SnapshotPuzzle[];
export const NORTH_POLE_SCENE_SNAPSHOT = SCENE;

function placed(p: {
  entity_id: string;
  label: string;
  x: number;
  z: number;
  elevation: number;
  rotation_y: number;
  asset_id?: string;
  placeholder_width?: number;
  placeholder_height?: number;
  placeholder_depth?: number;
}) {
  return {
    entityId: p.entity_id,
    label: p.label,
    x: p.x,
    z: p.z,
    elevation: p.elevation,
    rotationY: p.rotation_y,
    scale: 1,
    assetId: p.asset_id ?? '',
    placeholder: {
      width: p.placeholder_width ?? 1,
      height: p.placeholder_height ?? 1,
      depth: p.placeholder_depth ?? 1,
    },
  };
}

/** Puzzle states in contract order, with the same lock rule Django applies. */
export function northPolePuzzles(keys: ReadonlySet<string>, band: NorthPoleBand) {
  return NORTH_POLE_PUZZLE_SNAPSHOT.map((puzzle) => {
    const solved = keys.has(puzzle.worldChangeKey);
    const locked = !solved && !puzzle.requiresChangeKeys.every((key) => keys.has(key));
    return {
      puzzleId: puzzle.puzzleId,
      kind: puzzle.kind,
      title: puzzle.title,
      entityIds: SCENE.puzzleEntities[puzzle.puzzleId] ?? [],
      solved,
      locked,
      failedAttempts: 0,
      // Django adds the characters' puzzle lines (dialogue, LAI-0817) to the served parameters.
      parameters: {
        intro: 'Take a careful look.',
        completeMessage: 'Well done!',
        ...puzzle.ageBands[band],
      },
    };
  });
}

function questEntries(keys: ReadonlySet<string>) {
  return NORTH_POLE_QUESTS.map((quest) => {
    const objectives = quest.stages[0].objectives.map((o) => ({
      id: o.id,
      label: o.label,
      optional: false,
      complete: 'changeKey' in o && keys.has(o.changeKey),
    }));
    const prerequisite = quest.prerequisites[0];
    const open =
      prerequisite.type === 'ALWAYS' ||
      ('changeKey' in prerequisite && keys.has(prerequisite.changeKey));
    const done = objectives.every((o) => o.complete);
    return {
      questId: quest.id,
      title: quest.title,
      summary: quest.summary,
      giverNpcId: quest.giverNpcId,
      status: done ? 'COMPLETED' : open ? 'ACTIVE' : 'AVAILABLE',
      currentStageId: quest.stages[0].id,
      completedAt: done ? '2026-11-01T11:00:00Z' : null,
      stages: [
        { id: quest.stages[0].id, title: quest.stages[0].title, complete: done, objectives },
      ],
    };
  });
}

export function northPoleBootstrapJson(
  options: {
    /** World change keys the child holds (puzzle keys, fragment keys, gate keys). */
    keys?: readonly string[];
    band?: NorthPoleBand;
    session?: boolean;
    deliverable?: readonly string[];
  } = {},
) {
  const keys = new Set(options.keys ?? []);
  const band = options.band ?? 'PATHFINDER';
  const deliverable = new Set(options.deliverable ?? []);
  const kindOf = (kind: string) => (kind === 'COLLECTIBLE' ? 'collectible' : 'prop');
  const layoutScenery = (SCENE.scene.layout as { scenery: { assetId?: string }[] }).scenery;
  const assetIds = [
    ...new Set([
      ...SCENE.placements.map((p) => p.asset_id),
      ...layoutScenery.map((item) => item.assetId ?? ''),
    ]),
  ]
    .filter(Boolean)
    .sort();
  const dialogue = (name: string) => [
    {
      nodeId: `${name}-greeting`,
      text: 'Hello, explorer!',
      followUpOnly: false,
      choices: [{ choiceId: 'bye', label: 'See you soon', nextNodeId: null }],
    },
  ];
  return {
    region: {
      regionId: NORTH_POLE,
      title: 'North Pole Village',
      locationSlug: NORTH_POLE,
      version: 1,
      scene: SCENE.scene,
    },
    spawn: {
      checkpointId: SCENE.spawn.checkpoint_id,
      label: SCENE.spawn.label,
      x: SCENE.spawn.x,
      z: SCENE.spawn.z,
      yaw: SCENE.spawn.yaw,
    },
    npcs: SCENE.placements
      .filter((p) => p.kind === 'NPC')
      .map((p) => ({
        ...placed(p),
        npcId: p.npc_id,
        displayName: p.label,
        interactionId: `meet-${p.npc_id}`,
        dialogue: dialogue(p.npc_id),
      })),
    objects: SCENE.placements
      .filter((p) => p.kind !== 'NPC')
      .map((p) => ({
        ...placed(p),
        kind: p.kind,
        interactionId: '',
        pickup: p.kind === 'COLLECTIBLE' && p.pickup_change_key !== '',
        collected: p.pickup_change_key !== '' && keys.has(p.pickup_change_key),
      })),
    chests: Object.entries(SCENE.chests).map(([entityId, spot], order) => ({
      ...placed({ entity_id: entityId, ...spot }),
      openClip: '',
      isOpen: false,
      challengeAvailable: true,
      presentation: entityId.startsWith('np-replay-') ? 'REPLAY' : 'CHEST',
      sortOrder: order,
      locked: false,
      lockReason: null,
      requiredItemId: null,
      answerEntityIds: [],
      clue: '',
    })),
    quests: questEntries(keys),
    session: options.session
      ? {
          sessionId: NORTH_POLE_SESSION,
          kind: 'REGION',
          regionId: NORTH_POLE,
          templateSlug: '',
          locationSlug: NORTH_POLE,
          status: 'ACTIVE',
          startedAt: '2026-11-01T10:00:00Z',
          lastActivityAt: '2026-11-01T10:00:00Z',
          completedAt: null,
        }
      : null,
    worldChanges: [...keys].map((changeKey) => ({
      locationSlug: NORTH_POLE,
      changeType: 'PUZZLE_SOLVED',
      changeKey,
      payload: {},
      createdAt: '2026-11-01T10:05:00Z',
    })),
    launchPoints: [],
    puzzles: northPolePuzzles(keys, band),
    catalog: {
      worldSlug: 'learning-adventure-island',
      assets: assetIds.map((assetId) => ({
        assetId,
        kind: kindOf(SCENE.placements.find((p) => p.asset_id === assetId)?.kind ?? 'PROP'),
        clips: [],
        deliverable: deliverable.has(assetId),
      })),
    },
  };
}
