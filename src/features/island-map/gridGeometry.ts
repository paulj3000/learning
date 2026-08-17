/**
 * Location-agnostic pixel/tile geometry helpers, extracted so both Welcome
 * Harbor's and Pirate Builder Bay's data modules can validate spawn/decor
 * placement against their own grid without duplicating the same two
 * functions per location. Phaser-free and unit-tested via each location's
 * own test file.
 */

export function isWithinBounds(
  x: number,
  y: number,
  worldWidth: number,
  worldHeight: number,
): boolean {
  return x >= 0 && y >= 0 && x <= worldWidth && y <= worldHeight;
}

export function isOnWalkableTile<TileId extends number>(
  x: number,
  y: number,
  grid: readonly (readonly TileId[])[],
  collidingTiles: readonly TileId[],
  tileSize: number,
): boolean {
  const col = Math.floor(x / tileSize);
  const row = Math.floor(y / tileSize);
  const tile = grid[row]?.[col];
  return tile !== undefined && !collidingTiles.includes(tile);
}
