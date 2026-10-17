/**
 * Pixel-space walk-in zone geometry for Storykeeper Castle, keyed by
 * `WorldInteraction.zoneId` (falling back to `id` when absent). Same pattern
 * as `zones.ts`/`pirateBuilderBayZones.ts`/`wonderwildForestZones.ts` — see
 * `zones.ts`'s header comment for why this lives apart from `worldObjects.ts`.
 */
import {
  HARBOR_EXIT_TILE_RECT,
  LAST_BOOKSHELF_TILE_RECT,
  STORY_HALL_TILE_RECT,
  TAPESTRY_STAIR_TILE_RECT,
} from './storykeeperCastleTilemap';
import { TILE_SIZE } from './tilemap';
import type { PixelRect } from './zones';

function tileRectToPixels(col: number, row: number, cols: number, rows: number): PixelRect {
  return {
    x: col * TILE_SIZE,
    y: row * TILE_SIZE,
    width: cols * TILE_SIZE,
    height: rows * TILE_SIZE,
  };
}

export const STORYKEEPER_CASTLE_ZONES: Record<string, PixelRect> = {
  'castle-story-hall': tileRectToPixels(
    STORY_HALL_TILE_RECT.col,
    STORY_HALL_TILE_RECT.row,
    STORY_HALL_TILE_RECT.cols,
    STORY_HALL_TILE_RECT.rows,
  ),
  'castle-harbor-exit': tileRectToPixels(
    HARBOR_EXIT_TILE_RECT.col,
    HARBOR_EXIT_TILE_RECT.row,
    HARBOR_EXIT_TILE_RECT.cols,
    HARBOR_EXIT_TILE_RECT.rows,
  ),
  'castle-last-bookshelf': tileRectToPixels(
    LAST_BOOKSHELF_TILE_RECT.col,
    LAST_BOOKSHELF_TILE_RECT.row,
    LAST_BOOKSHELF_TILE_RECT.cols,
    LAST_BOOKSHELF_TILE_RECT.rows,
  ),
  // Phase 26's unmarked secret. Deliberately in the opposite corner from
  // `castle-last-bookshelf` so the two never overlap or read as one thing.
  'castle-tapestry-stair': tileRectToPixels(
    TAPESTRY_STAIR_TILE_RECT.col,
    TAPESTRY_STAIR_TILE_RECT.row,
    TAPESTRY_STAIR_TILE_RECT.cols,
    TAPESTRY_STAIR_TILE_RECT.rows,
  ),
};
