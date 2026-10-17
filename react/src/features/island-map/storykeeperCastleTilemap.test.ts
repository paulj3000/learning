import { describe, expect, it } from 'vitest';
import {
  buildStorykeeperCastleTileGrid,
  GRID_COLS,
  GRID_ROWS,
  HARBOR_EXIT_TILE_RECT,
  STORY_HALL_TILE_RECT,
  STORYKEEPER_CASTLE_COLLIDING_TILES,
  STORYKEEPER_CASTLE_TILE_GRID,
} from './storykeeperCastleTilemap';
import { HarborTile } from './tilemap';

describe('buildStorykeeperCastleTileGrid', () => {
  it('produces a grid matching the declared dimensions', () => {
    const grid = buildStorykeeperCastleTileGrid();
    expect(grid).toHaveLength(GRID_ROWS);
    for (const row of grid) {
      expect(row).toHaveLength(GRID_COLS);
    }
  });

  it('places path tiles inside the declared Harbor-exit rectangle, and nowhere else', () => {
    const grid = buildStorykeeperCastleTileGrid();
    const { col, row, cols, rows } = HARBOR_EXIT_TILE_RECT;
    for (let r = row; r < row + rows; r += 1) {
      for (let c = col; c < col + cols; c += 1) {
        expect(grid[r][c]).toBe(HarborTile.PATH);
      }
    }
  });

  it('leaves the story hall as ordinary walkable stone floor', () => {
    const grid = buildStorykeeperCastleTileGrid();
    const { col, row, cols, rows } = STORY_HALL_TILE_RECT;
    for (let r = row; r < row + rows; r += 1) {
      for (let c = col; c < col + cols; c += 1) {
        expect(grid[r][c]).toBe(HarborTile.SAND);
      }
    }
  });

  it('marks nothing as colliding', () => {
    expect(STORYKEEPER_CASTLE_COLLIDING_TILES).toEqual([]);
  });

  it('exports the same grid built by buildStorykeeperCastleTileGrid', () => {
    expect(STORYKEEPER_CASTLE_TILE_GRID).toEqual(buildStorykeeperCastleTileGrid());
  });
});
