import { describe, expect, it } from 'vitest';
import {
  CASTLE_EXIT_TILE_RECT,
  CASTLE_WRITING_ROOM_COLLIDING_TILES,
  CASTLE_WRITING_ROOM_TILE_GRID,
  GRID_COLS,
  GRID_ROWS,
  buildCastleWritingRoomTileGrid,
} from './castleWritingRoomTilemap';
import { HarborTile } from './tilemap';

describe('buildCastleWritingRoomTileGrid', () => {
  it('produces a grid matching the declared dimensions', () => {
    const grid = buildCastleWritingRoomTileGrid();
    expect(grid).toHaveLength(GRID_ROWS);
    for (const row of grid) {
      expect(row).toHaveLength(GRID_COLS);
    }
  });

  it('has no colliding tiles beyond the world bounds', () => {
    expect(CASTLE_WRITING_ROOM_COLLIDING_TILES).toEqual([]);
  });

  it('places path tiles inside the castle-exit rectangle, and carpet everywhere else', () => {
    const grid = CASTLE_WRITING_ROOM_TILE_GRID;
    const { col, row, cols, rows } = CASTLE_EXIT_TILE_RECT;
    for (let r = 0; r < GRID_ROWS; r += 1) {
      for (let c = 0; c < GRID_COLS; c += 1) {
        const insideExitRect = r >= row && r < row + rows && c >= col && c < col + cols;
        expect(grid[r][c]).toBe(insideExitRect ? HarborTile.PATH : HarborTile.CARPET);
      }
    }
  });
});
