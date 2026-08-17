import { describe, expect, it } from 'vitest';
import {
  BAY_BRIDGE_TILE_RECT,
  BAY_COLLIDING_TILES,
  buildPirateBuilderBayTileGrid,
  GRID_COLS,
  GRID_ROWS,
  HARBOR_EXIT_TILE_RECT,
  PIRATE_BUILDER_BAY_TILE_GRID,
} from './pirateBuilderBayTilemap';
import { applyTileOverride, HarborTile } from './tilemap';

describe('buildPirateBuilderBayTileGrid', () => {
  it('produces a grid matching the declared dimensions', () => {
    const grid = buildPirateBuilderBayTileGrid();
    expect(grid).toHaveLength(GRID_ROWS);
    for (const row of grid) {
      expect(row).toHaveLength(GRID_COLS);
    }
  });

  it('places bridge-plank tiles inside the declared bridge rectangle', () => {
    const grid = buildPirateBuilderBayTileGrid();
    const { col, row, cols, rows } = BAY_BRIDGE_TILE_RECT;
    for (let r = row; r < row + rows; r += 1) {
      for (let c = col; c < col + cols; c += 1) {
        expect(grid[r][c]).toBe(HarborTile.BRIDGE_PLANK);
      }
    }
  });

  it('surrounds the bridge with water along its whole channel column range', () => {
    const grid = buildPirateBuilderBayTileGrid();
    const { col, cols } = BAY_BRIDGE_TILE_RECT;
    for (let r = 0; r < BAY_BRIDGE_TILE_RECT.row; r += 1) {
      for (let c = col; c < col + cols; c += 1) {
        expect(grid[r][c]).toBe(HarborTile.WATER);
      }
    }
  });

  it('places path tiles inside the declared Harbor-exit rectangle, and nowhere else', () => {
    const grid = buildPirateBuilderBayTileGrid();
    const { col, row, cols, rows } = HARBOR_EXIT_TILE_RECT;
    for (let r = row; r < row + rows; r += 1) {
      for (let c = col; c < col + cols; c += 1) {
        expect(grid[r][c]).toBe(HarborTile.PATH);
      }
    }
  });

  it('marks water and the unrepaired bridge plank as colliding', () => {
    expect(BAY_COLLIDING_TILES).toEqual([HarborTile.WATER, HarborTile.BRIDGE_PLANK]);
  });
});

describe('bridge repair opens the cove', () => {
  it('the repaired bridge tile is not in the colliding set, unlike the unrepaired one', () => {
    expect(BAY_COLLIDING_TILES).toContain(HarborTile.BRIDGE_PLANK);
    expect(BAY_COLLIDING_TILES).not.toContain(HarborTile.BRIDGE_PLANK_REPAIRED);
  });

  it('applyTileOverride swaps every bridge-plank tile for its repaired, walkable counterpart', () => {
    const repaired = applyTileOverride(
      PIRATE_BUILDER_BAY_TILE_GRID,
      HarborTile.BRIDGE_PLANK,
      HarborTile.BRIDGE_PLANK_REPAIRED,
    );
    expect(repaired.flat()).not.toContain(HarborTile.BRIDGE_PLANK);
    const { col, row, cols, rows } = BAY_BRIDGE_TILE_RECT;
    for (let r = row; r < row + rows; r += 1) {
      for (let c = col; c < col + cols; c += 1) {
        expect(repaired[r][c]).toBe(HarborTile.BRIDGE_PLANK_REPAIRED);
      }
    }
  });
});
