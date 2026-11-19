import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { read } from '../../api/parse';
import * as parse from '../../api/play/parse';
import { firepeakBootstrapJson } from '../../test/firepeakFixtures';
import { publishRegionCheckpoints, unpublishRegionCheckpoints } from '../discovery/checkpoints';
import { PLATFORM_LIMITS, validatePlatforming } from '../island-map/three/platforms/platformSpec';
import { SOURCE_MANIFEST_REGISTRIES } from '../island-map/three/runtime/sourceManifestRegistries';
import { validateLocationManifest } from '../island-map/three/runtime/validateLocationManifest';
import { buildRegionManifest } from './regionManifest';
import { withServerCatalog } from './regionManifestRepository';
import { tryParseRegionPlayConfig } from './regionPlayConfig';
import { toRegionSceneModel } from './sceneModel';

/**
 * The Heart of Firepeak on the client (design sections 4 and 6): the scene the Django seed writes
 * (`lai/apps/regions/firepeak_heart_scene.json`, kept equal to `firepeak_heart_seed.py` by Django
 * tests) goes through the real region manifest builder and the manifest and platforming
 * validators. No hand-mirrored fixture.
 */

const REGION = 'firepeak-heart';

interface Placement {
  entity_id: string;
  kind: string;
  asset: string;
  label: string;
  x: number;
  z: number;
  elevation: number;
  rotation_y: number;
  size: [number, number, number];
  npc?: string;
}

interface Snapshot {
  scene: Record<string, unknown> & {
    platforming: { platforms: { id: string }[]; zones: { enterMessage: string }[] };
    effects: { checkpoints: { id: string }[]; standIns: { entityId: string; shape: string }[] };
    colliders: { id: string; jumpable?: boolean; minY?: number; maxY?: number }[];
  };
  spawn: { checkpointId: string; label: string; x: number; z: number; yaw: number };
  placements: Placement[];
  puzzles: { puzzleId: string; kind: string; title: string; entityIds: string[] }[];
  assets: { assetId: string; kind: string }[];
}

function snapshot(): Snapshot {
  const path = resolve(process.cwd(), '../lai/apps/regions/firepeak_heart_scene.json');
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
}

function placed(p: Placement) {
  return {
    entityId: p.entity_id,
    label: p.label,
    x: p.x,
    z: p.z,
    elevation: p.elevation,
    rotationY: p.rotation_y,
    scale: 1,
    assetId: p.asset,
    placeholder: { width: p.size[0], height: p.size[1], depth: p.size[2] },
    kind: p.kind,
    interactionId: '',
    ...(p.kind === 'COLLECTIBLE' ? { pickup: true, collected: false } : {}),
  };
}

function bootstrapFromSnapshot() {
  const data = snapshot();
  const base = firepeakBootstrapJson();
  const npcs = data.placements
    .filter((p) => p.kind === 'NPC')
    .map((p) => ({
      ...placed(p),
      npcId: p.npc,
      displayName: p.label,
      interactionId: `meet-${p.entity_id}`,
      dialogue: [],
    }));
  const objects = data.placements.filter((p) => p.kind !== 'NPC').map(placed);
  const puzzles = data.puzzles.map((puzzle, index) => ({
    puzzleId: puzzle.puzzleId,
    // The two new kinds arrive with the puzzle-kinds workstream; the manifest never reads kinds.
    kind: puzzle.kind,
    title: puzzle.title,
    entityIds: puzzle.entityIds,
    solved: false,
    locked: index > 0,
    failedAttempts: 0,
    parameters: {},
  }));
  const json = {
    ...base,
    region: {
      regionId: REGION,
      title: 'Heart of Firepeak',
      locationSlug: REGION,
      version: 1,
      scene: data.scene,
    },
    spawn: data.spawn,
    npcs,
    objects,
    chests: [],
    quests: [],
    worldChanges: [],
    puzzles,
    catalog: {
      worldSlug: 'learning-adventure-island',
      assets: [
        ...data.assets.map((a) => ({ assetId: a.assetId, kind: a.kind, clips: [], deliverable: false })),
        { assetId: 'ground-tile-stone', kind: 'kit-piece', clips: [], deliverable: true },
      ],
    },
  };
  return { data, json };
}

/**
 * Reads the bootstrap with the real puzzle kinds. Until the puzzle UI workstream teaches the
 * client's parser the two new kinds (CHOOSE_ANSWER, ORDER_SEQUENCE), the same puzzles are read as
 * COLLECT_OBJECT: the manifest builder never looks at a puzzle's kind, only at its entity ids.
 */
function readBootstrap(json: ReturnType<typeof bootstrapFromSnapshot>['json']) {
  try {
    return read(json, parse.regionBootstrap);
  } catch {
    const known = new Set([
      'OBSERVE_FEATURES',
      'PLACE_PLATFORMS',
      'VALVE_SEQUENCE',
      'COLLECT_OBJECT',
      'RETURN_TO_NPC',
    ]);
    const puzzles = json.puzzles.map((puzzle) =>
      known.has(puzzle.kind) ? puzzle : { ...puzzle, kind: 'COLLECT_OBJECT' },
    );
    return read({ ...json, puzzles }, parse.regionBootstrap);
  }
}

function built() {
  const { data, json } = bootstrapFromSnapshot();
  const bootstrap = readBootstrap(json);
  return {
    data,
    bootstrap,
    ...buildRegionManifest(toRegionSceneModel(bootstrap), { worldSlug: 'learning-adventure-island' }),
  };
}

afterEach(() => unpublishRegionCheckpoints(REGION));

describe('the Heart of Firepeak manifest', () => {
  it('validates against the bundled registries plus what Django declares', () => {
    const { bootstrap, manifest, checkpoints } = built();
    publishRegionCheckpoints(REGION, checkpoints);
    expect(
      validateLocationManifest(manifest, withServerCatalog(SOURCE_MANIFEST_REGISTRIES, bootstrap)),
    ).toEqual([]);
  });

  it('has a platforming block that validates with no errors', () => {
    const { manifest } = built();
    expect(manifest.platforming).toBeDefined();
    const issues = validatePlatforming(manifest.platforming, {
      propIds: new Set(manifest.props.map((prop) => prop.entityId)),
      zoneIds: new Set(manifest.zones.map((zone) => zone.rect.id)),
      bounds: manifest.bounds,
      solids: manifest.colliders.filter((c) => !c.jumpable).map((c) => c.rect),
    });
    expect(issues).toEqual([]);
    expect(manifest.platforming!.platforms.length).toBeLessThanOrEqual(PLATFORM_LIMITS.maxPlatforms);
  });

  it('is the seven-zone area: bounds, zone messages, checkpoints and a default spawn', () => {
    const { manifest, data } = built();
    expect(manifest.bounds).toEqual({ halfExtentX: 32, halfExtentZ: 96, wallThickness: 1 });
    expect(manifest.zones.filter((z) => z.rect.id.startsWith('fh-zone-'))).toHaveLength(8);
    expect(manifest.zones.every((z) => !!z.enterMessage)).toBe(true);
    expect(manifest.platforming!.checkpoints!.length).toBe(data.scene.effects.checkpoints.length);
    expect(data.spawn.checkpointId).toBe('fh-cp-landing');
  });

  it('draws every modelled placement as a stand-in until a model is published', () => {
    const { manifest, data } = built();
    const config = tryParseRegionPlayConfig(manifest.extensions[0].config)!;
    const drawn = new Set(config.drawn.map((d) => d.entityId));
    const puzzleEntities = data.puzzles.flatMap((p) => p.entityIds);
    for (const entity of puzzleEntities) expect(drawn.has(entity) || config.figures.some((f) => f.entityId === entity), entity).toBe(true);
    expect(config.drawn.every((d) => d.assetId === null)).toBe(true);
    expect(config.effects.lava).toHaveLength(1);
    expect(config.effects.openings.map((o) => o.colliderId)).toContain('fh-gate-heart');
    expect(config.effects.returns.map((r) => r.entityId)).toEqual(['fh-return-portal']);
  });

  it('binds the five NPC characters and the puzzle objects to the extension', () => {
    const { manifest } = built();
    const config = tryParseRegionPlayConfig(manifest.extensions[0].config)!;
    const npcs = config.interactions.filter((i) => i.kind === 'npc').map((i) => i.npcId);
    expect(new Set(npcs)).toEqual(new Set(['flint', 'kindle', 'professor-basalt', 'cinder', 'ignis']));
    const puzzleObjects = config.interactions.filter((i) => i.kind === 'puzzle');
    expect(puzzleObjects.length).toBeGreaterThan(25);
  });

  it('carries the gate colliders as solids and the logs as jumpable, ready for the engine', () => {
    const { data } = built();
    const gates = data.scene.colliders.filter((c) => c.id.startsWith('fh-gate-'));
    expect(gates).toHaveLength(18);
    expect(gates.every((c) => c.jumpable === undefined)).toBe(true);
    const logs = data.scene.colliders.filter((c) => c.jumpable);
    expect(logs.length).toBe(4);
    expect(logs.every((c) => c.minY === 0 && (c.maxY ?? 0) <= 0.45)).toBe(true);
  });
});
