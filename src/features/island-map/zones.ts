/**
 * Pixel-space interaction zone geometry for Welcome Harbor, keyed by
 * `WorldInteraction.id`. Map data, not object identity, which is why it
 * lives apart from `worldObjects.ts` (see that file's comment) — this is
 * the "real" world object registry the roadmap asks for: the scene reads
 * zone rectangles from here instead of holding its own copy, and this file
 * has no dependency on Phaser so it stays unit-testable.
 */
import { BRIDGE_TILE_RECT, TILE_SIZE } from './tilemap';

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
  'talk-to-chatty': tileRectToPixels(2, 3, 3, 3),
};
