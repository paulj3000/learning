/**
 * Wonderwild Forest's tile grid (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md
 * section 32, "Phase 13 — Wonderwild Exploration"). Pure data, deliberately
 * Phaser-free, same pattern as Welcome Harbor's `tilemap.ts` and Pirate
 * Builder Bay's `pirateBuilderBayTilemap.ts` — reusing the shared
 * `HarborTile` vocabulary (grass forest floor, a pond as `WATER`, a `PATH`
 * spur back to Welcome Harbor) rather than a third color palette for the
 * same handful of tile types.
 *
 * Unlike the bay's bridge, nothing here is gated by collision: every
 * discovery point (the bee hive, the pond, the leaf pile, the cave mouth,
 * the night clearing) sits on ordinary walkable grass. The pond is the one
 * colliding feature, and purely for physical realism — no adventure is
 * gated behind crossing it.
 */
import {
  GRID_COLS,
  GRID_ROWS,
  HarborTile,
  type HarborTileId,
  TILE_SIZE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './tilemap';

export { GRID_COLS, GRID_ROWS, TILE_SIZE, WORLD_HEIGHT, WORLD_WIDTH };

/** Tile-space rectangle for the path spur leading back toward Welcome Harbor (west edge). */
export const HARBOR_EXIT_TILE_RECT = { col: 0, row: 9, cols: 2, rows: 3 };

/** Tile-space rectangle for the forest pond. */
export const POND_TILE_RECT = { col: 20, row: 3, cols: 6, rows: 6 };

/**
 * Tile-space rectangle for the bee hive's walk-in interaction zone. The hive
 * clearing is ordinary walkable grass (unlike the bay's bridge), so the zone
 * can sit directly on the hive's own tiles.
 */
export const BEEHIVE_TILE_RECT = { col: 14, row: 9, cols: 3, rows: 3 };

/** Tiles the avatar cannot walk onto. */
export const WONDERWILD_COLLIDING_TILES: readonly HarborTileId[] = [HarborTile.WATER];

function fillTileRect(
  grid: HarborTileId[][],
  rect: { col: number; row: number; cols: number; rows: number },
  tile: HarborTileId,
): void {
  for (let r = rect.row; r < rect.row + rect.rows; r += 1) {
    for (let c = rect.col; c < rect.col + rect.cols; c += 1) {
      if (r < grid.length && c < grid[r].length) {
        grid[r][c] = tile;
      }
    }
  }
}

/**
 * Builds Wonderwild Forest's tile grid: grass forest floor everywhere, a
 * pond in the northeast, and a short path spur marking the exit back to
 * Welcome Harbor.
 */
export function buildWonderwildForestTileGrid(): HarborTileId[][] {
  const grid: HarborTileId[][] = [];
  for (let row = 0; row < GRID_ROWS; row += 1) {
    const line: HarborTileId[] = [];
    for (let col = 0; col < GRID_COLS; col += 1) {
      line.push(HarborTile.GRASS);
    }
    grid.push(line);
  }

  fillTileRect(grid, POND_TILE_RECT, HarborTile.WATER);
  fillTileRect(grid, HARBOR_EXIT_TILE_RECT, HarborTile.PATH);

  return grid;
}

export const WONDERWILD_FOREST_TILE_GRID: HarborTileId[][] = buildWonderwildForestTileGrid();
