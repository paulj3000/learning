import { describe, expect, it } from 'vitest';
import {
  BEEHIVE_TILE_RECT,
  buildWonderwildForestTileGrid,
  GRID_COLS,
  GRID_ROWS,
  HARBOR_EXIT_TILE_RECT,
  POND_TILE_RECT,
  WONDERWILD_COLLIDING_TILES,
  WONDERWILD_FOREST_TILE_GRID,
} from './wonderwildForestTilemap';
import { HarborTile } from './tilemap';

describe('buildWonderwildForestTileGrid', () => {
  it('produces a grid matching the declared dimensions', () => {
    const grid = buildWonderwildForestTileGrid();
    expect(grid).toHaveLength(GRID_ROWS);
    for (const row of grid) {
      expect(row).toHaveLength(GRID_COLS);
    }
  });

  it('places water tiles inside the declared pond rectangle', () => {
    const grid = buildWonderwildForestTileGrid();
    const { col, row, cols, rows } = POND_TILE_RECT;
    for (let r = row; r < row + rows; r += 1) {
      for (let c = col; c < col + cols; c += 1) {
        expect(grid[r][c]).toBe(HarborTile.WATER);
      }
    }
  });

  it('places path tiles inside the declared Harbor-exit rectangle, and nowhere else', () => {
    const grid = buildWonderwildForestTileGrid();
    const { col, row, cols, rows } = HARBOR_EXIT_TILE_RECT;
    for (let r = row; r < row + rows; r += 1) {
      for (let c = col; c < col + cols; c += 1) {
        expect(grid[r][c]).toBe(HarborTile.PATH);
      }
    }
  });

  it('leaves the bee hive clearing as ordinary walkable grass', () => {
    const grid = buildWonderwildForestTileGrid();
    const { col, row, cols, rows } = BEEHIVE_TILE_RECT;
    for (let r = row; r < row + rows; r += 1) {
      for (let c = col; c < col + cols; c += 1) {
        expect(grid[r][c]).toBe(HarborTile.GRASS);
      }
    }
  });

  it('marks only water as colliding', () => {
    expect(WONDERWILD_COLLIDING_TILES).toEqual([HarborTile.WATER]);
  });

  it('exports the same grid built by buildWonderwildForestTileGrid', () => {
    expect(WONDERWILD_FOREST_TILE_GRID).toEqual(buildWonderwildForestTileGrid());
  });
});
