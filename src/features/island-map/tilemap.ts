/**
 * Welcome Harbor's tile grid (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md
 * section 28, "tilemaps"). Pure data, deliberately Phaser-free so the layout
 * and its collision rules stay unit-testable without a rendering context.
 * `WelcomeHarborScene` turns this into a real `Phaser.Tilemaps.Tilemap` by
 * generating a small procedural tileset texture at runtime (no binary asset
 * pipeline exists yet, matching the ChattyAvatar/plank-icon precedent) and
 * feeding it `HARBOR_TILE_GRID` as embedded tilemap data.
 */

export const TILE_SIZE = 32;
export const GRID_COLS = 30;
export const GRID_ROWS = 20;

export const WORLD_WIDTH = GRID_COLS * TILE_SIZE;
export const WORLD_HEIGHT = GRID_ROWS * TILE_SIZE;

/** Tile type ids double as tileset frame indices, in this exact order. */
export const HarborTile = {
  WATER: 0,
  SAND: 1,
  GRASS: 2,
  BRIDGE_PLANK: 3,
  /** Set in place of `BRIDGE_PLANK` once the `BRIDGE_REPAIRED` world change exists. */
  BRIDGE_PLANK_REPAIRED: 4,
  /** Trodden-dirt spurs leading toward the other locations' entrances. */
  PATH: 5,
} as const;

export type HarborTileId = (typeof HarborTile)[keyof typeof HarborTile];

/** Draw color for each tile id, indexed to match `HarborTile`'s values. */
export const HARBOR_TILE_COLORS: readonly number[] = [
  0x1c3a52, // WATER
  0xd8c48a, // SAND
  0x2f8f4e, // GRASS
  0x8a5a34, // BRIDGE_PLANK
  0xd4a94e, // BRIDGE_PLANK_REPAIRED
  0xb08b62, // PATH
];

/** Tiles the avatar cannot walk onto. */
export const HARBOR_COLLIDING_TILES: readonly HarborTileId[] = [HarborTile.WATER];

const SAND_ROWS = 13; // rows 0..12 are shoreline; the rest is open water
const GRASS_COLS = 7; // cols 0..6 of the shoreline rows are grass

/** Tile-space rectangle for the broken-bridge interaction zone. */
export const BRIDGE_TILE_RECT = { col: 24, row: 6, cols: 4, rows: 3 };

/** Tile-space rectangle for the path spur toward Wonderwild Forest's entrance (west edge). */
export const FOREST_PATH_TILE_RECT = { col: 0, row: 9, cols: 3, rows: 2 };

/** Tile-space rectangle for the path spur toward Storykeeper Castle's entrance (north edge). */
export const CASTLE_PATH_TILE_RECT = { col: 12, row: 0, cols: 3, rows: 2 };

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
 * Builds Welcome Harbor's tile grid: open water beyond the shoreline, grass
 * along the western edge, sand along the rest of the shore, a short
 * bridge-plank patch marking the broken bridge to Pirate Builder Bay, and
 * two path spurs marking the entrances toward Wonderwild Forest and
 * Storykeeper Castle.
 */
export function buildHarborTileGrid(): HarborTileId[][] {
  const grid: HarborTileId[][] = [];
  for (let row = 0; row < GRID_ROWS; row += 1) {
    const line: HarborTileId[] = [];
    for (let col = 0; col < GRID_COLS; col += 1) {
      if (row >= SAND_ROWS) {
        line.push(HarborTile.WATER);
      } else if (col < GRASS_COLS) {
        line.push(HarborTile.GRASS);
      } else {
        line.push(HarborTile.SAND);
      }
    }
    grid.push(line);
  }

  fillTileRect(grid, BRIDGE_TILE_RECT, HarborTile.BRIDGE_PLANK);
  fillTileRect(grid, FOREST_PATH_TILE_RECT, HarborTile.PATH);
  fillTileRect(grid, CASTLE_PATH_TILE_RECT, HarborTile.PATH);

  return grid;
}

export const HARBOR_TILE_GRID: HarborTileId[][] = buildHarborTileGrid();

/**
 * Returns a new grid with every occurrence of one tile id replaced by
 * another (e.g. swapping `BRIDGE_PLANK` for `BRIDGE_PLANK_REPAIRED` once a
 * `WorldChange` unlocks it). Never mutates the input grid, so callers can
 * keep passing `HARBOR_TILE_GRID` in without cloning it themselves first.
 */
export function applyTileOverride(
  grid: HarborTileId[][],
  from: HarborTileId,
  to: HarborTileId,
): HarborTileId[][] {
  return grid.map((line) => line.map((tile) => (tile === from ? to : tile)));
}
