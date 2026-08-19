import { LocationScene, type LocationSceneConfig } from './LocationScene';
import type { WorldEventBus } from '../worldEvents';
import { BOLTS_WORKSHOP_INTERACTIONS, type WorldInteractionContext } from '../worldObjects';
import { BOLTS_WORKSHOP_ZONES } from '../boltsWorkshopZones';
import { BOLTS_WORKSHOP_DECOR } from '../boltsWorkshopDecor';
import {
  BOLTS_WORKSHOP_COLLIDING_TILES,
  BOLTS_WORKSHOP_TILE_GRID,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../boltsWorkshopTilemap';
import { HARBOR_TILE_COLORS, TILE_SIZE } from '../tilemap';

export { WORLD_WIDTH, WORLD_HEIGHT };
export const BOLTS_WORKSHOP_SCENE_KEY = 'bolts-workshop';

const AVATAR_START = { x: 3 * TILE_SIZE, y: 9 * TILE_SIZE };

const BOLTS_WORKSHOP_CONFIG: Omit<LocationSceneConfig, 'sceneKey'> = {
  interactions: BOLTS_WORKSHOP_INTERACTIONS,
  zones: BOLTS_WORKSHOP_ZONES,
  npcs: [],
  decor: BOLTS_WORKSHOP_DECOR,
  waterShimmerPoints: [],
  tileGrid: BOLTS_WORKSHOP_TILE_GRID,
  tileColors: HARBOR_TILE_COLORS,
  collidingTiles: BOLTS_WORKSHOP_COLLIDING_TILES,
  tileOverrides: [],
  avatarSpawn: AVATAR_START,
  worldWidth: WORLD_WIDTH,
  worldHeight: WORLD_HEIGHT,
};

/**
 * Bolt's Workshop, Phase 16's fourth "story-dependent environmental change"
 * location (docs/ROADMAP.md Phase 16, "Island Progression"), same
 * additive-location pattern as `DragonsSanctuaryScene.ts`: no engine
 * changes, only content bound to the shared `LocationScene`.
 */
export class BoltsWorkshopScene extends LocationScene {
  constructor(bus: WorldEventBus, interactionContext: WorldInteractionContext, avatarKey: string) {
    super(
      { sceneKey: BOLTS_WORKSHOP_SCENE_KEY, ...BOLTS_WORKSHOP_CONFIG },
      bus,
      interactionContext,
      avatarKey,
    );
  }
}
