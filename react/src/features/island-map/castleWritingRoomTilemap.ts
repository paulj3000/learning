/**
 * The Writing Room's tile grid (docs/ROADMAP.md Phase 16, "Island
 * Progression"). Pure data, deliberately Phaser-free, same pattern as
 * `dragonsSanctuaryTilemap.ts`/`fossilRidgeCampTilemap.ts` — reusing the
 * shared `HarborTile` vocabulary, `CARPET` as the room's warm decorated
 * floor (roadmap's own description: "a small round room... left ready for
 * whoever solved the door").
 *
 * A calm arrival scene, not an adventure of its own — the learning already
 * happened inside "The Castle's Secret Door"
 * (`src/features/story/content/theCastlesSecretDoor.ts`). The real gate is
 * reaching this location at all — `worldObjects.ts`'s
 * `castle-last-bookshelf` interaction and `IslandLocationPage`/
 * `CastleWritingRoomWorldPage`'s own unlock checks.
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

/** Tile-space rectangle for the path spur leading back into Storykeeper Castle (west edge). */
export const CASTLE_EXIT_TILE_RECT = { col: 0, row: 9, cols: 2, rows: 3 };

/** Nothing to collide with here besides the world bounds. */
export const CASTLE_WRITING_ROOM_COLLIDING_TILES: readonly HarborTileId[] = [];

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
 * Builds the Writing Room's tile grid: a carpeted floor everywhere, and a
 * short path spur marking the exit back into Storykeeper Castle.
 */
export function buildCastleWritingRoomTileGrid(): HarborTileId[][] {
  const grid: HarborTileId[][] = [];
  for (let row = 0; row < GRID_ROWS; row += 1) {
    const line: HarborTileId[] = [];
    for (let col = 0; col < GRID_COLS; col += 1) {
      line.push(HarborTile.CARPET);
    }
    grid.push(line);
  }

  fillTileRect(grid, CASTLE_EXIT_TILE_RECT, HarborTile.PATH);

  return grid;
}

export const CASTLE_WRITING_ROOM_TILE_GRID: HarborTileId[][] = buildCastleWritingRoomTileGrid();
