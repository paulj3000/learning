import { LocationScene, type LocationSceneConfig } from './LocationScene';
import type { WorldEventBus } from '../worldEvents';
import { PIRATE_BUILDER_BAY_INTERACTIONS, type WorldInteractionContext } from '../worldObjects';
import { PIRATE_BUILDER_BAY_ZONES } from '../pirateBuilderBayZones';
import { PIRATE_BUILDER_BAY_DECOR } from '../pirateBuilderBayDecor';
import {
  BAY_COLLIDING_TILES,
  PIRATE_BUILDER_BAY_TILE_GRID,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../pirateBuilderBayTilemap';
import { HARBOR_TILE_COLORS, HarborTile, TILE_SIZE } from '../tilemap';

export { WORLD_WIDTH, WORLD_HEIGHT };
export const PIRATE_BUILDER_BAY_SCENE_KEY = 'pirate-builder-bay';

const AVATAR_START = { x: 3 * TILE_SIZE, y: 9 * TILE_SIZE };

const PIRATE_BUILDER_BAY_CONFIG: Omit<LocationSceneConfig, 'sceneKey'> = {
  interactions: PIRATE_BUILDER_BAY_INTERACTIONS,
  zones: PIRATE_BUILDER_BAY_ZONES,
  npcs: [],
  decor: PIRATE_BUILDER_BAY_DECOR,
  waterShimmerPoints: [],
  tileGrid: PIRATE_BUILDER_BAY_TILE_GRID,
  tileColors: HARBOR_TILE_COLORS,
  collidingTiles: BAY_COLLIDING_TILES,
  tileOverrides: [
    {
      changeKey: 'BRIDGE_REPAIRED',
      from: HarborTile.BRIDGE_PLANK,
      to: HarborTile.BRIDGE_PLANK_REPAIRED,
    },
  ],
  avatarSpawn: AVATAR_START,
  worldWidth: WORLD_WIDTH,
  worldHeight: WORLD_HEIGHT,
};

/**
 * Pirate Builder Bay, Phase 11's production explorable environment
 * (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md section 30):
 * the first fully spatial adventure location. No NPCs (`LocationScene`'s NPC
 * renderer is a Chatty-specific parrot shape — Pirate Pip is a `CHARACTER`
 * decor sprite instead, since he stands in place rather than following the
 * avatar). Everything else — tiles, zones, decor, collision, the bridge
 * repair tile-override — is this bay's own data bound to the shared engine.
 */
export class PirateBuilderBayScene extends LocationScene {
  constructor(bus: WorldEventBus, interactionContext: WorldInteractionContext, avatarKey: string) {
    super(
      { sceneKey: PIRATE_BUILDER_BAY_SCENE_KEY, ...PIRATE_BUILDER_BAY_CONFIG },
      bus,
      interactionContext,
      avatarKey,
    );
  }
}
