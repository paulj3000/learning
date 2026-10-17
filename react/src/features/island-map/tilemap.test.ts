import { describe, expect, it } from 'vitest';
import {
  applyTileOverride,
  BRIDGE_TILE_RECT,
  CASTLE_PATH_TILE_RECT,
  FOREST_PATH_TILE_RECT,
  GRID_COLS,
  GRID_ROWS,
  HARBOR_COLLIDING_TILES,
  HARBOR_TILE_COLORS,
  HARBOR_TILE_GRID,
  HarborTile,
  TILE_SIZE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  buildHarborTileGrid,
} from './tilemap';

describe('buildHarborTileGrid', () => {
  it('produces a grid matching the declared dimensions', () => {
    const grid = buildHarborTileGrid();
    expect(grid).toHaveLength(GRID_ROWS);
    for (const row of grid) {
      expect(row).toHaveLength(GRID_COLS);
    }
  });

  it('derives world pixel size from the grid dimensions and tile size', () => {
    expect(WORLD_WIDTH).toBe(GRID_COLS * TILE_SIZE);
    expect(WORLD_HEIGHT).toBe(GRID_ROWS * TILE_SIZE);
  });

  it('has a color for every tile type it can produce', () => {
    const usedTileIds = new Set(HARBOR_TILE_GRID.flat());
    for (const tileId of usedTileIds) {
      expect(HARBOR_TILE_COLORS[tileId]).toBeTypeOf('number');
    }
  });

  it('marks water, and only water, as colliding', () => {
    expect(HARBOR_COLLIDING_TILES).toEqual([HarborTile.WATER]);
  });

  it('places bridge-plank tiles inside the declared bridge rectangle', () => {
    const grid = buildHarborTileGrid();
    const { col, row, cols, rows } = BRIDGE_TILE_RECT;
    for (let r = row; r < row + rows; r += 1) {
      for (let c = col; c < col + cols; c += 1) {
        expect(grid[r][c]).toBe(HarborTile.BRIDGE_PLANK);
      }
    }
  });

  it('never places bridge-plank tiles outside the declared rectangle', () => {
    const grid = buildHarborTileGrid();
    const { col, row, cols, rows } = BRIDGE_TILE_RECT;
    for (let r = 0; r < GRID_ROWS; r += 1) {
      for (let c = 0; c < GRID_COLS; c += 1) {
        const insideBridgeRect = r >= row && r < row + rows && c >= col && c < col + cols;
        if (!insideBridgeRect) {
          expect(grid[r][c]).not.toBe(HarborTile.BRIDGE_PLANK);
        }
      }
    }
  });

  it.each([
    ['forest', FOREST_PATH_TILE_RECT],
    ['castle', CASTLE_PATH_TILE_RECT],
  ])(
    'places path tiles inside the declared %s entrance rectangle, and nowhere else',
    (_name, rect) => {
      const grid = buildHarborTileGrid();
      const { col, row, cols, rows } = rect;
      for (let r = row; r < row + rows; r += 1) {
        for (let c = col; c < col + cols; c += 1) {
          expect(grid[r][c]).toBe(HarborTile.PATH);
        }
      }
    },
  );

  it('has a color for the repaired-bridge and path tiles', () => {
    expect(HARBOR_TILE_COLORS[HarborTile.BRIDGE_PLANK_REPAIRED]).toBeTypeOf('number');
    expect(HARBOR_TILE_COLORS[HarborTile.PATH]).toBeTypeOf('number');
  });

  it('has a color for the Phase 16 ecosystem-restoration and persistent-construction tiles', () => {
    expect(HARBOR_TILE_COLORS[HarborTile.BLOOM]).toBeTypeOf('number');
    expect(HARBOR_TILE_COLORS[HarborTile.CARPET]).toBeTypeOf('number');
  });
});

describe('applyTileOverride', () => {
  it('replaces every occurrence of one tile id with another', () => {
    const grid = buildHarborTileGrid();
    const overridden = applyTileOverride(
      grid,
      HarborTile.BRIDGE_PLANK,
      HarborTile.BRIDGE_PLANK_REPAIRED,
    );

    expect(overridden.flat()).not.toContain(HarborTile.BRIDGE_PLANK);
    const { col, row, cols, rows } = BRIDGE_TILE_RECT;
    for (let r = row; r < row + rows; r += 1) {
      for (let c = col; c < col + cols; c += 1) {
        expect(overridden[r][c]).toBe(HarborTile.BRIDGE_PLANK_REPAIRED);
      }
    }
  });

  it('does not mutate the input grid', () => {
    const grid = buildHarborTileGrid();
    applyTileOverride(grid, HarborTile.BRIDGE_PLANK, HarborTile.BRIDGE_PLANK_REPAIRED);

    const { col, row } = BRIDGE_TILE_RECT;
    expect(grid[row][col]).toBe(HarborTile.BRIDGE_PLANK);
  });

  it('leaves other tile ids untouched', () => {
    const grid = buildHarborTileGrid();
    const overridden = applyTileOverride(
      grid,
      HarborTile.BRIDGE_PLANK,
      HarborTile.BRIDGE_PLANK_REPAIRED,
    );

    expect(overridden.flat().filter((tile) => tile === HarborTile.WATER).length).toBe(
      grid.flat().filter((tile) => tile === HarborTile.WATER).length,
    );
  });
});
