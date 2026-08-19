/**
 * The Dragon's Sanctuary's tile grid (docs/ROADMAP.md Phase 16, "Island
 * Progression"). Pure data, deliberately Phaser-free, same pattern as every
 * other location's own `*Tilemap.ts` — reusing the shared `HarborTile`
 * vocabulary (sand as rocky mountain floor, a `PATH` spur back to Welcome
 * Harbor) rather than a new color palette for a location this small.
 *
 * Nothing here is gated by collision: this is a calm arrival scene, not an
 * adventure of its own (the learning already happened inside "The Dragon of
 * Ember Mountain" story). The real gate is reaching this location at all —
 * `worldObjects.ts`'s `mountain-path` interaction and `IslandLocationPage`/
 * `DragonsSanctuaryWorldPage`'s own unlock checks.
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

/** Nothing to collide with here besides the world bounds. */
export const DRAGONS_SANCTUARY_COLLIDING_TILES: readonly HarborTileId[] = [];

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
 * Builds the Dragon's Sanctuary's tile grid: rocky sand ground everywhere,
 * and a short path spur marking the exit back to Welcome Harbor.
 */
export function buildDragonsSanctuaryTileGrid(): HarborTileId[][] {
  const grid: HarborTileId[][] = [];
  for (let row = 0; row < GRID_ROWS; row += 1) {
    const line: HarborTileId[] = [];
    for (let col = 0; col < GRID_COLS; col += 1) {
      line.push(HarborTile.SAND);
    }
    grid.push(line);
  }

  fillTileRect(grid, HARBOR_EXIT_TILE_RECT, HarborTile.PATH);

  return grid;
}

export const DRAGONS_SANCTUARY_TILE_GRID: HarborTileId[][] = buildDragonsSanctuaryTileGrid();
