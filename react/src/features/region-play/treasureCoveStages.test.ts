import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { JsonObject } from '../../api/parse';
import type { PuzzleKind } from '../../api/play/types';
import {
  chooseAnswerCorrect,
  firstVariantIndex,
  nextVariantIndex,
  orderSequenceCorrect,
  parsePuzzleParams,
} from './areaPuzzles';
import { STAND_IN_SHAPES } from './regionPlayConfig';

/**
 * Treasure Cove's redesigned stages (#102), read from the seed's own snapshot
 * (`lai/apps/regions/treasure_cove_stages.json`, kept equal to the seed by a Django test).
 * The client must be able to draw and play every stage for every age band: nothing here is
 * trusted, so a body that does not parse would show as "not available" in the game.
 */

interface StageRow {
  puzzleId: string;
  kind: PuzzleKind;
  entityIds: string[];
  body: { ageBands: Record<string, JsonObject>; title: string };
}

const snapshot = JSON.parse(
  readFileSync(resolve(process.cwd(), '../lai/apps/regions/treasure_cove_stages.json'), 'utf8'),
) as { puzzles: StageRow[]; standIns: { entityId: string; shape: string }[] };

const BANDS = ['SPROUT', 'PATHFINDER', 'EXPLORER'];

/** What the bootstrap adds: a puzzle with no NPC intro opens with its title. */
function served(row: StageRow, band: string): JsonObject {
  return { intro: row.body.title, ...row.body.ageBands[band] };
}

describe('Treasure Cove stages on the client (#102)', () => {
  it('has the five stages in story order, with three distinct mechanics at least', () => {
    expect(snapshot.puzzles.map((row) => row.puzzleId)).toEqual([
      'cove-map-piece-1',
      'cove-map-piece-2',
      'cove-map-piece-3',
      'cove-treasure-map',
      'cove-crocodile-creek',
      'cove-supply-dock',
      'cove-cave-carving-1',
      'cove-cave-carving-2',
      'cove-cave-carving-3',
      'cove-forgotten-cave',
      'cove-lost-treasure',
    ]);
    expect(new Set(snapshot.puzzles.map((row) => row.kind)).size).toBeGreaterThanOrEqual(3);
  });

  for (const band of BANDS) {
    it(`parses every stage for ${band}, and its stored answers are right by the client's rules`, () => {
      for (const row of snapshot.puzzles) {
        const params = parsePuzzleParams(row.kind, served(row, band));
        expect(params, `${row.puzzleId} ${band}`).not.toBeNull();
        if (params?.kind === 'CHOOSE_ANSWER') {
          for (const variant of params.variants) {
            expect(chooseAnswerCorrect(variant, variant.answer)).toBe(true);
            const wrong = variant.options.find((o) => o.id !== variant.answer)!;
            expect(chooseAnswerCorrect(variant, wrong.id)).toBe(false);
          }
          for (const entity of Object.values(params.optionEntities)) {
            expect(row.entityIds).toContain(entity);
          }
        }
        if (params?.kind === 'ORDER_SEQUENCE') {
          for (const variant of params.variants) {
            expect(orderSequenceCorrect(variant, variant.answer)).toBe(true);
            expect(orderSequenceCorrect(variant, [...variant.answer].reverse())).toBe(false);
          }
          for (const entity of Object.values(params.itemEntities)) {
            expect(row.entityIds).toContain(entity);
          }
        }
      }
    });
  }

  it('gives younger children fewer stones to cross than older ones', () => {
    const creek = snapshot.puzzles.find((row) => row.puzzleId === 'cove-crocodile-creek')!;
    const stones = BANDS.map((band) => {
      const params = parsePuzzleParams(creek.kind, served(creek, band));
      return params?.kind === 'ORDER_SEQUENCE' ? Object.keys(params.itemEntities).length : 0;
    });
    expect(stones).toEqual([3, 4, 5]);
  });

  it('a replay or "Try a different one" reaches another variant of every learning stage', () => {
    for (const row of snapshot.puzzles) {
      if (row.kind !== 'CHOOSE_ANSWER' && row.kind !== 'ORDER_SEQUENCE') continue;
      for (const band of BANDS) {
        const params = parsePuzzleParams(row.kind, served(row, band));
        if (params?.kind !== 'CHOOSE_ANSWER' && params?.kind !== 'ORDER_SEQUENCE') continue;
        const first = firstVariantIndex('a-visit', row.puzzleId, params.variants.length);
        expect(nextVariantIndex(first, params.variants.length)).not.toBe(first);
      }
    }
  });

  it('draws every stage object as a known stand-in shape until its model is published', () => {
    for (const entry of snapshot.standIns) {
      expect(STAND_IN_SHAPES).toContain(entry.shape);
    }
  });
});
