import { describe, expect, it } from 'vitest';
import {
  DRAGONS_SANCTUARY_COLLIDING_TILES,
  DRAGONS_SANCTUARY_TILE_GRID,
  GRID_COLS,
  GRID_ROWS,
  HARBOR_EXIT_TILE_RECT,
  buildDragonsSanctuaryTileGrid,
} from './dragonsSanctuaryTilemap';
import { HarborTile } from './tilemap';

describe('buildDragonsSanctuaryTileGrid', () => {
  it('produces a grid matching the declared dimensions', () => {
    const grid = buildDragonsSanctuaryTileGrid();
    expect(grid).toHaveLength(GRID_ROWS);
    for (const row of grid) {
      expect(row).toHaveLength(GRID_COLS);
    }
  });

  it('has no colliding tiles beyond the world bounds', () => {
    expect(DRAGONS_SANCTUARY_COLLIDING_TILES).toEqual([]);
  });

  it('places path tiles inside the harbor-exit rectangle, and nowhere else', () => {
    const grid = DRAGONS_SANCTUARY_TILE_GRID;
    const { col, row, cols, rows } = HARBOR_EXIT_TILE_RECT;
    for (let r = 0; r < GRID_ROWS; r += 1) {
      for (let c = 0; c < GRID_COLS; c += 1) {
        const insideExitRect = r >= row && r < row + rows && c >= col && c < col + cols;
        expect(grid[r][c]).toBe(insideExitRect ? HarborTile.PATH : HarborTile.SAND);
      }
    }
  });
});
