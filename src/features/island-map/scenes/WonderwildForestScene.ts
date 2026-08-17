import { LocationScene, type LocationSceneConfig } from './LocationScene';
import type { WorldEventBus } from '../worldEvents';
import { WONDERWILD_FOREST_INTERACTIONS, type WorldInteractionContext } from '../worldObjects';
import { WONDERWILD_FOREST_ZONES } from '../wonderwildForestZones';
import { WONDERWILD_FOREST_DECOR } from '../wonderwildForestDecor';
import {
  WONDERWILD_COLLIDING_TILES,
  WONDERWILD_FOREST_TILE_GRID,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../wonderwildForestTilemap';
import { HARBOR_TILE_COLORS, TILE_SIZE } from '../tilemap';

export { WORLD_WIDTH, WORLD_HEIGHT };
export const WONDERWILD_FOREST_SCENE_KEY = 'wonderwild-forest';

const AVATAR_START = { x: 4 * TILE_SIZE, y: 11 * TILE_SIZE };

const WONDERWILD_FOREST_CONFIG: Omit<LocationSceneConfig, 'sceneKey'> = {
  interactions: WONDERWILD_FOREST_INTERACTIONS,
  zones: WONDERWILD_FOREST_ZONES,
  npcs: [],
  decor: WONDERWILD_FOREST_DECOR,
  waterShimmerPoints: [],
  tileGrid: WONDERWILD_FOREST_TILE_GRID,
  tileColors: HARBOR_TILE_COLORS,
  collidingTiles: WONDERWILD_COLLIDING_TILES,
  tileOverrides: [],
  avatarSpawn: AVATAR_START,
  worldWidth: WORLD_WIDTH,
  worldHeight: WORLD_HEIGHT,
};

/**
 * Wonderwild Forest, Phase 13's production explorable environment
 * (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md section 32):
 * a discovery-driven environment replacing the question-selection interface
 * as the preferred way in. No NPCs. Everything else — tiles, zones, decor,
 * the pond's collision — is this forest's own data bound to the shared
 * engine; no engine changes were needed beyond the new `DecorShape`s already
 * added to `scenes/LocationScene.ts`.
 */
export class WonderwildForestScene extends LocationScene {
  constructor(bus: WorldEventBus, interactionContext: WorldInteractionContext, avatarKey: string) {
    super(
      { sceneKey: WONDERWILD_FOREST_SCENE_KEY, ...WONDERWILD_FOREST_CONFIG },
      bus,
      interactionContext,
      avatarKey,
    );
  }
}
