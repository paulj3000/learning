import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStandardCapabilityRegistry } from '@lai/game-engine/engine';
import { checkContentCompatibility, validateAdventure, validateRealm } from '@lai/game-engine/sdk';
import { describe, expect, it } from 'vitest';
import { NORTH_POLE_QUESTS } from '../../content-export/northPoleContent';
import {
  NORTH_POLE_ADVENTURE,
  NORTH_POLE_AREA,
  NORTH_POLE_CHECKPOINT_IDS,
  NORTH_POLE_JUMP_ROUTES,
  NORTH_POLE_MILESTONE_IDS,
  NORTH_POLE_PUZZLE_IDS,
  NORTH_POLE_REALM,
} from './northPoleEngineDefinition';

/** GE-074: the North Pole engine data names the seed's real ids, and the SDK accepts it. */

type Json = Record<string, unknown>;

function read<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), '../lai/apps/regions', file), 'utf8')) as T;
}

interface Snapshot {
  scene: {
    effects: { checkpoints: { id: string }[] };
    platforming: { checkpoints: { id: string }[] };
  } & Json;
}
interface PuzzleBody {
  puzzleId: string;
  ageBands: Record<string, { skill?: string } | null>;
}

/** Every authored id anywhere in the scene (platforms, colliders, stairs, zones). */
function sceneIds(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => sceneIds(v, out));
  else if (value && typeof value === 'object') {
    const record = value as Json;
    if (typeof record.id === 'string') out.add(record.id);
    Object.values(record).forEach((v) => sceneIds(v, out));
  }
  return out;
}

describe('North Pole engine definitions (GE-074)', () => {
  const registry = createStandardCapabilityRegistry();

  it('the Realm and the adventure pass the SDK validators with the standard registry', () => {
    const realm = validateRealm(NORTH_POLE_REALM);
    expect(realm.ok ? [] : realm.issues).toEqual([]);
    const adventure = validateAdventure(NORTH_POLE_ADVENTURE, registry, { realmId: NORTH_POLE_REALM.id });
    expect(adventure.ok ? [] : adventure.issues).toEqual([]);
    expect(NORTH_POLE_REALM.adventureIds).toEqual([NORTH_POLE_ADVENTURE.id]);
  });

  it('keeps both of today’s checkpoint lists, zones first', () => {
    const scene = read<Snapshot>('north_pole_scene.json').scene;
    expect([...NORTH_POLE_CHECKPOINT_IDS]).toEqual([
      ...scene.effects.checkpoints.map((c) => c.id),
      ...scene.platforming.checkpoints.map((c) => c.id),
    ]);
    expect(NORTH_POLE_ADVENTURE.checkpoints.every((c) => c.areaId === NORTH_POLE_AREA)).toBe(true);
  });

  it('names every seeded puzzle as a challenge, and their skills as learning objectives', () => {
    const bodies = read<PuzzleBody[]>('north_pole_puzzles.json');
    expect(new Set(NORTH_POLE_PUZZLE_IDS)).toEqual(new Set(bodies.map((b) => b.puzzleId)));
    const skills = new Set(
      bodies.flatMap((b) => Object.values(b.ageBands).map((band) => band?.skill)).filter(Boolean),
    );
    expect(new Set(NORTH_POLE_ADVENTURE.learningObjectiveIds)).toEqual(skills);
  });

  it('pairs every jump challenge with an authored stair or ramp, all optional', () => {
    const ids = sceneIds(read<Snapshot>('north_pole_scene.json').scene);
    for (const route of NORTH_POLE_JUMP_ROUTES) {
      expect(ids, route.jumpRouteId).toContain(route.jumpRouteId);
      expect(ids, route.accessibleRouteId).toContain(route.accessibleRouteId);
    }
    expect(NORTH_POLE_ADVENTURE.jumpChallenges.every((j) => j.optional)).toBe(true);
  });

  it('uses world-change keys the quests really record, ending with the adventure completion', () => {
    const quests = JSON.stringify(NORTH_POLE_QUESTS);
    expect(quests).toContain(`"${NORTH_POLE_ADVENTURE.worldConsequenceId}"`);
    expect(new Set(NORTH_POLE_ADVENTURE.questIds)).toEqual(new Set(NORTH_POLE_QUESTS.map((q) => q.id)));
    for (const key of NORTH_POLE_MILESTONE_IDS) expect(key).toMatch(/^NORTH_POLE_[A-Z_]+$/);
  });

  it('the scene snapshot passes the engine content compatibility checks', () => {
    const report = checkContentCompatibility(read<Snapshot>('north_pole_scene.json'), registry, {
      kind: 'AREA_SCENE',
    });
    expect(report.issues).toEqual([]);
  });
});
