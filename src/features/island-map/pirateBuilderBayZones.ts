/**
 * Pixel-space walk-in zone geometry for Pirate Builder Bay, keyed by
 * `WorldInteraction.zoneId` (falling back to `id` when absent). Same pattern
 * as `zones.ts` — see that file's header comment for why this lives apart
 * from `worldObjects.ts`.
 */
import { BRIDGE_APPROACH_TILE_RECT, HARBOR_EXIT_TILE_RECT } from './pirateBuilderBayTilemap';
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

export const PIRATE_BUILDER_BAY_ZONES: Record<string, PixelRect> = {
  'bay-broken-bridge': tileRectToPixels(
    BRIDGE_APPROACH_TILE_RECT.col,
    BRIDGE_APPROACH_TILE_RECT.row,
    BRIDGE_APPROACH_TILE_RECT.cols,
    BRIDGE_APPROACH_TILE_RECT.rows,
  ),
  'bay-harbor-exit': tileRectToPixels(
    HARBOR_EXIT_TILE_RECT.col,
    HARBOR_EXIT_TILE_RECT.row,
    HARBOR_EXIT_TILE_RECT.cols,
    HARBOR_EXIT_TILE_RECT.rows,
  ),
};
