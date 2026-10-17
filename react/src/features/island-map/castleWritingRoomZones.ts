/**
 * Pixel-space walk-in zone geometry for the Writing Room, keyed by
 * `WorldInteraction.zoneId` (falling back to `id` when absent). Same pattern
 * as `zones.ts`/`dragonsSanctuaryZones.ts` — see `zones.ts`'s header comment
 * for why this lives apart from `worldObjects.ts`.
 */
import { CASTLE_EXIT_TILE_RECT } from './castleWritingRoomTilemap';
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

export const CASTLE_WRITING_ROOM_ZONES: Record<string, PixelRect> = {
  'writing-room-castle-exit': tileRectToPixels(
    CASTLE_EXIT_TILE_RECT.col,
    CASTLE_EXIT_TILE_RECT.row,
    CASTLE_EXIT_TILE_RECT.cols,
    CASTLE_EXIT_TILE_RECT.rows,
  ),
};
