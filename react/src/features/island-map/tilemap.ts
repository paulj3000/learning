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
  /**
   * Set in place of `GRASS` once a location's own "ecosystem restoration"
   * `WorldChange` exists (docs/ROADMAP.md Phase 16), e.g. Wonderwild
   * Forest's forest floor once `WAGGLE_DANCE_DISCOVERED` is recorded.
   */
  BLOOM: 6,
  /**
   * Set in place of `SAND` once a location's own "persistent construction"
   * `WorldChange` exists (docs/ROADMAP.md Phase 16), e.g. Storykeeper
   * Castle's stone floor once `FIRST_STORY_TOLD` is recorded.
   */
  CARPET: 7,
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
  0xe685c9, // BLOOM
  0xa8324c, // CARPET
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

/**
 * Tile-space rectangle for the hidden mountain-path zone leading to the
 * Dragon's Sanctuary (docs/ROADMAP.md Phase 16, "secret locations").
 * Deliberately left un-painted in `buildHarborTileGrid` (ordinary sand)
 * rather than given its own `PATH` tile like the forest/castle spurs above
 * — a visibly trodden path would give away that something is here before
 * "The Dragon of Ember Mountain" story is ever completed. Reaching this
 * zone before then does nothing (`isInteractionAvailable` is false), same
 * as walking onto any other not-yet-available interaction zone.
 */
export const MOUNTAIN_PATH_TILE_RECT = { col: 20, row: 0, cols: 3, rows: 2 };

/**
 * Tile-space rectangle for the hidden path zone leading to Fossil Ridge
 * Camp (docs/ROADMAP.md Phase 16, second "story-dependent environmental
 * change" example, alongside the Dragon's Sanctuary). Same "no visible
 * tell before the story completes" reasoning as `MOUNTAIN_PATH_TILE_RECT`.
 */
export const FOSSIL_RIDGE_PATH_TILE_RECT = { col: 8, row: 0, cols: 3, rows: 2 };

/**
 * Tile-space rectangle for the hidden path zone leading to Bolt's Workshop
 * (docs/ROADMAP.md Phase 16, fourth "story-dependent environmental change"
 * example). Same "no visible tell before the story completes" reasoning as
 * `MOUNTAIN_PATH_TILE_RECT`. Deliberately named after the robot, not
 * "Robot Repair Reef" — see `docs/IMPLEMENTATION_STATUS.md`'s Phase 16 note
 * on why that name is reserved for a possible future, larger location.
 */
export const BOLTS_WORKSHOP_PATH_TILE_RECT = { col: 4, row: 3, cols: 3, rows: 2 };

/**
 * Phase 26's tide pool: the quiet south-east end of the beach, well clear of
 * the bridge (col 24, rows 6-8), of every decor sprite, and of the water
 * that starts at row 13. Nothing is drawn here - the secret is that a child
 * walked somewhere nothing told them to go.
 */
export const TIDE_POOL_TILE_RECT = { col: 27, row: 10, cols: 3, rows: 3 };

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
