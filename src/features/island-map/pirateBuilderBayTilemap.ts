/**
 * Pirate Builder Bay's tile grid (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md
 * section 30, "Phase 11 — Pirate Builder Bay"). Pure data, deliberately
 * Phaser-free, same pattern as Welcome Harbor's `tilemap.ts` and reusing its
 * tile vocabulary (`HarborTile`/`HARBOR_TILE_COLORS`/`TILE_SIZE`) rather than
 * duplicating a second color palette for the same seven tile types.
 *
 * Unlike Welcome Harbor's bridge (a decorative dead end — the real gating
 * happens back at the Harbor), this bay's bridge is a real gate: a water
 * channel splits the map, and `BAY_COLLIDING_TILES` marks the unrepaired
 * `BRIDGE_PLANK` tile as colliding, so the cove past it is physically
 * unreachable until the "Repair the Moonlight Bridge" adventure completes
 * and `applyTileOverride` swaps it for the walkable `BRIDGE_PLANK_REPAIRED`
 * tile. That is this phase's "discover new area" beat: no extra interaction
 * needed to gate it, since collision already does.
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

const SAND_ROWS = 13; // rows 0..12 are shoreline/cove; the rest is open water
const GRASS_COLS = 5; // cols 0..4 of the dock rows are grass

/** Tile-space rectangle for the water channel separating the dock from the cove. */
const CHANNEL_TILE_RECT = { col: 12, row: 0, cols: 4, rows: SAND_ROWS };

/** Tile-space rectangle for the bridge spanning the channel. */
export const BAY_BRIDGE_TILE_RECT = { col: 12, row: 6, cols: 4, rows: 3 };

/**
 * Tile-space rectangle for the bridge *interaction* zone — one sand column
 * west of the bridge itself, not the bridge tiles. Pre-repair, `BRIDGE_PLANK`
 * is a colliding tile (see `BAY_COLLIDING_TILES`), so the avatar's collider
 * stops its center a few pixels short of the bridge tiles' edge; a zone
 * placed directly on the bridge tiles would then be geometrically
 * unreachable and could never fire. Placing it on the walkable approach
 * instead lets the avatar's center actually enter it.
 */
export const BRIDGE_APPROACH_TILE_RECT = { col: 10, row: 5, cols: 2, rows: 5 };

/** Tile-space rectangle for the path spur leading back toward Welcome Harbor (west edge). */
export const HARBOR_EXIT_TILE_RECT = { col: 0, row: 9, cols: 2, rows: 2 };

/** Tiles the avatar cannot walk onto until the bridge is repaired. */
export const BAY_COLLIDING_TILES: readonly HarborTileId[] = [
  HarborTile.WATER,
  HarborTile.BRIDGE_PLANK,
];

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
 * Builds Pirate Builder Bay's tile grid: a dock/workshop area on the west
 * shore, open water beyond every shoreline, a water channel splitting the
 * dock from the hidden cove to the east, a bridge-plank patch spanning the
 * channel, and a short path spur marking the exit back to Welcome Harbor.
 */
export function buildPirateBuilderBayTileGrid(): HarborTileId[][] {
  const grid: HarborTileId[][] = [];
  for (let row = 0; row < GRID_ROWS; row += 1) {
    const line: HarborTileId[] = [];
    for (let col = 0; col < GRID_COLS; col += 1) {
      if (row >= SAND_ROWS) {
        line.push(HarborTile.WATER);
      } else if (col < GRASS_COLS) {
        line.push(HarborTile.GRASS);
      } else {
        // Sand covers both the west dock (right of the grass strip) and the
        // hidden cove east of the channel; the channel/bridge fills below
        // carve the water gap and crossing between them.
        line.push(HarborTile.SAND);
      }
    }
    grid.push(line);
  }

  fillTileRect(grid, CHANNEL_TILE_RECT, HarborTile.WATER);
  fillTileRect(grid, BAY_BRIDGE_TILE_RECT, HarborTile.BRIDGE_PLANK);
  fillTileRect(grid, HARBOR_EXIT_TILE_RECT, HarborTile.PATH);

  return grid;
}

export const PIRATE_BUILDER_BAY_TILE_GRID: HarborTileId[][] = buildPirateBuilderBayTileGrid();
