/**
 * Pixel-space walk-in zone geometry for Wonderwild Forest, keyed by
 * `WorldInteraction.zoneId` (falling back to `id` when absent). Same pattern
 * as `zones.ts`/`pirateBuilderBayZones.ts` — see `zones.ts`'s header comment
 * for why this lives apart from `worldObjects.ts`.
 */
import { BEEHIVE_TILE_RECT, HARBOR_EXIT_TILE_RECT } from './wonderwildForestTilemap';
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

export const WONDERWILD_FOREST_ZONES: Record<string, PixelRect> = {
  'wonderwild-beehive': tileRectToPixels(
    BEEHIVE_TILE_RECT.col,
    BEEHIVE_TILE_RECT.row,
    BEEHIVE_TILE_RECT.cols,
    BEEHIVE_TILE_RECT.rows,
  ),
  'wonderwild-harbor-exit': tileRectToPixels(
    HARBOR_EXIT_TILE_RECT.col,
    HARBOR_EXIT_TILE_RECT.row,
    HARBOR_EXIT_TILE_RECT.cols,
    HARBOR_EXIT_TILE_RECT.rows,
  ),
};
