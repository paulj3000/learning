import { LocationScene, type LocationSceneConfig } from './LocationScene';
import type { WorldEventBus } from '../worldEvents';
import { FOSSIL_RIDGE_CAMP_INTERACTIONS, type WorldInteractionContext } from '../worldObjects';
import { FOSSIL_RIDGE_CAMP_ZONES } from '../fossilRidgeCampZones';
import { FOSSIL_RIDGE_CAMP_DECOR } from '../fossilRidgeCampDecor';
import {
  FOSSIL_RIDGE_CAMP_COLLIDING_TILES,
  FOSSIL_RIDGE_CAMP_TILE_GRID,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../fossilRidgeCampTilemap';
import { HARBOR_TILE_COLORS, TILE_SIZE } from '../tilemap';

export { WORLD_WIDTH, WORLD_HEIGHT };
export const FOSSIL_RIDGE_CAMP_SCENE_KEY = 'fossil-ridge-camp';

const AVATAR_START = { x: 3 * TILE_SIZE, y: 9 * TILE_SIZE };

const FOSSIL_RIDGE_CAMP_CONFIG: Omit<LocationSceneConfig, 'sceneKey'> = {
  interactions: FOSSIL_RIDGE_CAMP_INTERACTIONS,
  zones: FOSSIL_RIDGE_CAMP_ZONES,
  npcs: [],
  decor: FOSSIL_RIDGE_CAMP_DECOR,
  waterShimmerPoints: [],
  tileGrid: FOSSIL_RIDGE_CAMP_TILE_GRID,
  tileColors: HARBOR_TILE_COLORS,
  collidingTiles: FOSSIL_RIDGE_CAMP_COLLIDING_TILES,
  tileOverrides: [],
  avatarSpawn: AVATAR_START,
  worldWidth: WORLD_WIDTH,
  worldHeight: WORLD_HEIGHT,
};

/**
 * Fossil Ridge Camp, Phase 16's second "story-dependent environmental
 * change" location (docs/ROADMAP.md Phase 16, "Island Progression"), same
 * additive-location pattern as `DragonsSanctuaryScene.ts`: no engine
 * changes, only content bound to the shared `LocationScene`.
 */
export class FossilRidgeCampScene extends LocationScene {
  constructor(bus: WorldEventBus, interactionContext: WorldInteractionContext, avatarKey: string) {
    super(
      { sceneKey: FOSSIL_RIDGE_CAMP_SCENE_KEY, ...FOSSIL_RIDGE_CAMP_CONFIG },
      bus,
      interactionContext,
      avatarKey,
    );
  }
}
