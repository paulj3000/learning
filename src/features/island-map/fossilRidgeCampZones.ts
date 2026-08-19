/**
 * Pixel-space walk-in zone geometry for Fossil Ridge Camp, keyed by
 * `WorldInteraction.zoneId` (falling back to `id` when absent). Same pattern
 * as `zones.ts`/`dragonsSanctuaryZones.ts` — see `zones.ts`'s header comment
 * for why this lives apart from `worldObjects.ts`.
 */
import { HARBOR_EXIT_TILE_RECT } from './fossilRidgeCampTilemap';
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

export const FOSSIL_RIDGE_CAMP_ZONES: Record<string, PixelRect> = {
  'fossil-ridge-camp-harbor-exit': tileRectToPixels(
    HARBOR_EXIT_TILE_RECT.col,
    HARBOR_EXIT_TILE_RECT.row,
    HARBOR_EXIT_TILE_RECT.cols,
    HARBOR_EXIT_TILE_RECT.rows,
  ),
};
