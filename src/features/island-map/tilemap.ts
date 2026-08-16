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
} as const;

export type HarborTileId = (typeof HarborTile)[keyof typeof HarborTile];

/** Draw color for each tile id, indexed to match `HarborTile`'s values. */
export const HARBOR_TILE_COLORS: readonly number[] = [
  0x1c3a52, // WATER
  0xd8c48a, // SAND
  0x2f8f4e, // GRASS
  0x8a5a34, // BRIDGE_PLANK
];

/** Tiles the avatar cannot walk onto. */
export const HARBOR_COLLIDING_TILES: readonly HarborTileId[] = [HarborTile.WATER];

const SAND_ROWS = 13; // rows 0..12 are shoreline; the rest is open water
const GRASS_COLS = 7; // cols 0..6 of the shoreline rows are grass

/** Tile-space rectangle for the broken-bridge interaction zone. */
export const BRIDGE_TILE_RECT = { col: 24, row: 6, cols: 4, rows: 3 };

/**
 * Builds Welcome Harbor's tile grid: open water beyond the shoreline, grass
 * along the western edge, sand along the rest of the shore, and a short
 * bridge-plank patch marking the broken bridge to Pirate Builder Bay.
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

  const { col, row, cols, rows } = BRIDGE_TILE_RECT;
  for (let r = row; r < row + rows; r += 1) {
    for (let c = col; c < col + cols; c += 1) {
      if (r < GRID_ROWS && c < GRID_COLS) {
        grid[r][c] = HarborTile.BRIDGE_PLANK;
      }
    }
  }

  return grid;
}

export const HARBOR_TILE_GRID: HarborTileId[][] = buildHarborTileGrid();
