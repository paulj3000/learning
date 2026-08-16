/**
 * Pixel-space walk-in zone geometry for Welcome Harbor, keyed by
 * `WorldInteraction.zoneId` (falling back to `id` when absent). Covers only
 * APPROACH/ENTER-triggered interactions: TAP/USE interactions (NPCs,
 * decor/objects) get their position from `npcs.ts`/`decor.ts` instead, since
 * those need a real sprite to hit-test against, not an invisible rectangle.
 * Map data, not object identity, which is why it lives apart from
 * `worldObjects.ts` (see that file's comment) — this is the "real" world
 * object registry the roadmap asks for: the scene reads zone rectangles
 * from here instead of holding its own copy, and this file has no
 * dependency on Phaser so it stays unit-testable.
 */
import {
  BRIDGE_TILE_RECT,
  CASTLE_PATH_TILE_RECT,
  FOREST_PATH_TILE_RECT,
  TILE_SIZE,
} from './tilemap';

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function tileRectToPixels(col: number, row: number, cols: number, rows: number): PixelRect {
  return {
    x: col * TILE_SIZE,
    y: row * TILE_SIZE,
    width: cols * TILE_SIZE,
    height: rows * TILE_SIZE,
  };
}

export const WELCOME_HARBOR_ZONES: Record<string, PixelRect> = {
  'broken-bridge': tileRectToPixels(
    BRIDGE_TILE_RECT.col,
    BRIDGE_TILE_RECT.row,
    BRIDGE_TILE_RECT.cols,
    BRIDGE_TILE_RECT.rows,
  ),
  'forest-entrance': tileRectToPixels(
    FOREST_PATH_TILE_RECT.col,
    FOREST_PATH_TILE_RECT.row,
    FOREST_PATH_TILE_RECT.cols,
    FOREST_PATH_TILE_RECT.rows,
  ),
  'castle-entrance': tileRectToPixels(
    CASTLE_PATH_TILE_RECT.col,
    CASTLE_PATH_TILE_RECT.row,
    CASTLE_PATH_TILE_RECT.cols,
    CASTLE_PATH_TILE_RECT.rows,
  ),
};
