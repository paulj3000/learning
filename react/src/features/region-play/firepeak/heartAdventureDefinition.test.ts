import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStandardCapabilityRegistry } from '@lai/game-engine/engine';
import { assertValidAdventure, checkContentCompatibility, validateAdventure } from '@lai/game-engine/sdk';
import { describe, expect, it } from 'vitest';
import { HEART_QUESTS } from '../../content-export/firepeakHeartContent';
import {
  FIREPEAK_HEART_ADVENTURE,
  FIREPEAK_HEART_AREA,
  FIREPEAK_HEART_CHECKPOINT_IDS,
  FIREPEAK_HEART_JUMP_ROUTES,
  FIREPEAK_HEART_PUZZLE_IDS,
} from './heartAdventureDefinition';

/** GE-073: the engine definition names the seed's real ids, and the SDK accepts it. */

interface IdRow {
  id: string;
}
interface Snapshot {
  puzzles: { puzzleId: string; ageBands: Record<string, { skill?: string } | null> }[];
  scene: {
    colliders: IdRow[];
    platforming: { platforms: IdRow[]; checkpoints: IdRow[]; zones?: { rect: IdRow }[] };
  };
}

function snapshot(): Snapshot {
  const path = resolve(process.cwd(), '../lai/apps/regions/firepeak_heart_scene.json');
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
}

describe('The Heart of Firepeak engine definition (GE-073)', () => {
  it('passes the SDK validator with the standard capability registry', () => {
    const result = validateAdventure(FIREPEAK_HEART_ADVENTURE, createStandardCapabilityRegistry(), {
      realmId: 'learning-adventure-island',
    });
    expect(result.ok ? [] : result.issues).toEqual([]);
    expect(() =>
      assertValidAdventure(FIREPEAK_HEART_ADVENTURE, createStandardCapabilityRegistry()),
    ).not.toThrow();
  });

  it('lists the seed checkpoints, in route order: one checkpoint list', () => {
    const seeded = snapshot().scene.platforming.checkpoints.map((c) => c.id);
    expect([...FIREPEAK_HEART_CHECKPOINT_IDS]).toEqual(seeded);
    expect(FIREPEAK_HEART_ADVENTURE.checkpoints.every((c) => c.areaId === FIREPEAK_HEART_AREA)).toBe(true);
  });

  it('names every seeded puzzle as a challenge, and their skills as learning objectives', () => {
    const data = snapshot();
    expect([...FIREPEAK_HEART_PUZZLE_IDS]).toEqual(data.puzzles.map((p) => p.puzzleId));
    const skills = new Set(
      data.puzzles.flatMap((p) => Object.values(p.ageBands).map((band) => band?.skill)).filter(Boolean),
    );
    expect(new Set(FIREPEAK_HEART_ADVENTURE.learningObjectiveIds)).toEqual(skills);
  });

  it('names authored jump routes, a walking route wherever one reaches the same place, all optional', () => {
    const scene = snapshot().scene;
    const authored = new Set([
      ...scene.platforming.platforms.map((p) => p.id),
      ...scene.colliders.map((c) => c.id),
      ...(scene.platforming.zones ?? []).map((z) => z.rect.id),
    ]);
    for (const route of FIREPEAK_HEART_JUMP_ROUTES) {
      expect(authored, route.jumpRouteId).toContain(route.jumpRouteId);
      if (route.accessibleRouteId !== null) {
        expect(authored, route.accessibleRouteId).toContain(route.accessibleRouteId);
      }
    }
    // Only the lava stones are jump-only, and they lead to the optional Lava Jumper shard.
    const jumpOnly = FIREPEAK_HEART_JUMP_ROUTES.filter((r) => r.accessibleRouteId === null).map((r) => r.id);
    expect(jumpOnly).toEqual(['fh-jump-lava-stones']);
    expect(FIREPEAK_HEART_ADVENTURE.jumpChallenges.every((j) => j.optional)).toBe(true);
  });

  it('passes the engine content compatibility checks, as an Area scene and as an adventure', () => {
    const registry = createStandardCapabilityRegistry();
    const scene = checkContentCompatibility(snapshot(), registry, { kind: 'AREA_SCENE' });
    expect(scene.issues).toEqual([]);
    const adventure = checkContentCompatibility(FIREPEAK_HEART_ADVENTURE, registry, { kind: 'ADVENTURE' });
    expect(adventure.issues).toEqual([]);
  });

  it('leaves the quest completion key behind as its world consequence', () => {
    const quest = HEART_QUESTS.find((q) => q.id === FIREPEAK_HEART_ADVENTURE.id);
    expect(JSON.stringify(quest)).toContain(`"${FIREPEAK_HEART_ADVENTURE.worldConsequenceId}"`);
  });
});
