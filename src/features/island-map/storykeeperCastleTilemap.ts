/**
 * Storykeeper Castle's tile grid (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md
 * section 33, "Phase 14 — Storykeeper Castle"). Pure data, deliberately
 * Phaser-free, same pattern as Welcome Harbor's `tilemap.ts` and reusing its
 * tile vocabulary (`HarborTile`/`HARBOR_TILE_COLORS`/`TILE_SIZE`) rather than
 * duplicating a second color palette for the same handful of tile types —
 * same reuse call Pirate Builder Bay's and Wonderwild Forest's tilemaps
 * already made. `SAND` stands in for stone floor and `PATH` for the carpet
 * runner leading in from the entrance; there is no water indoors.
 *
 * Unlike the bay's bridge, nothing here is gated by collision: every room
 * (the story hall and the five creative-story flavor rooms) sits on ordinary
 * walkable floor, same as Wonderwild Forest's discovery points. No adventure
 * is gated behind crossing anything, so `STORYKEEPER_CASTLE_COLLIDING_TILES`
 * is empty.
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

/** Tile-space rectangle for the entrance carpet runner leading back toward Welcome Harbor (west edge). */
export const HARBOR_EXIT_TILE_RECT = { col: 0, row: 9, cols: 2, rows: 3 };

/**
 * Tile-space rectangle for Keeper Quill's story hall walk-in interaction
 * zone. The hall is ordinary walkable floor (unlike the bay's bridge), so
 * the zone can sit directly on the hall's own tiles.
 */
export const STORY_HALL_TILE_RECT = { col: 14, row: 9, cols: 3, rows: 3 };

/**
 * Tile-space rectangle for the walk-in zone around the Great Library's
 * bookshelf prop (`storykeeperCastleDecor.ts`'s `castle-great-library`, at
 * col 24 row 16) — Phase 16's "behind the last bookshelf" reveal
 * (docs/ROADMAP.md Phase 16), gated by `THE_CASTLES_SECRET_DOOR_COMPLETE`.
 * Deliberately not a distinct tile/color, same "no visible tell before the
 * story completes" reasoning as `tilemap.ts`'s `MOUNTAIN_PATH_TILE_RECT`.
 */
export const LAST_BOOKSHELF_TILE_RECT = { col: 23, row: 15, cols: 3, rows: 3 };

/**
 * Phase 26's tapestry stair: the castle's south-west corner, clear of the
 * costume room sprite (col 6, row 16), the story hall, and the last
 * bookshelf's own zone at col 23. Unmarked.
 */
export const TAPESTRY_STAIR_TILE_RECT = { col: 10, row: 16, cols: 3, rows: 3 };

/** Tiles the avatar cannot walk onto. Nothing indoors collides. */
export const STORYKEEPER_CASTLE_COLLIDING_TILES: readonly HarborTileId[] = [];

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
 * Builds Storykeeper Castle's tile grid: stone floor everywhere, and a
 * carpet runner marking the entrance back to Welcome Harbor.
 */
export function buildStorykeeperCastleTileGrid(): HarborTileId[][] {
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

export const STORYKEEPER_CASTLE_TILE_GRID: HarborTileId[][] = buildStorykeeperCastleTileGrid();
