import { LocationScene, type LocationSceneConfig } from './LocationScene';
import type { WorldEventBus } from '../worldEvents';
import { DRAGONS_SANCTUARY_INTERACTIONS, type WorldInteractionContext } from '../worldObjects';
import { DRAGONS_SANCTUARY_ZONES } from '../dragonsSanctuaryZones';
import { DRAGONS_SANCTUARY_DECOR } from '../dragonsSanctuaryDecor';
import {
  DRAGONS_SANCTUARY_COLLIDING_TILES,
  DRAGONS_SANCTUARY_TILE_GRID,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../dragonsSanctuaryTilemap';
import { HARBOR_TILE_COLORS, TILE_SIZE } from '../tilemap';

export { WORLD_WIDTH, WORLD_HEIGHT };
export const DRAGONS_SANCTUARY_SCENE_KEY = 'dragons-sanctuary';

const AVATAR_START = { x: 3 * TILE_SIZE, y: 9 * TILE_SIZE };

const DRAGONS_SANCTUARY_CONFIG: Omit<LocationSceneConfig, 'sceneKey'> = {
  interactions: DRAGONS_SANCTUARY_INTERACTIONS,
  zones: DRAGONS_SANCTUARY_ZONES,
  npcs: [],
  decor: DRAGONS_SANCTUARY_DECOR,
  waterShimmerPoints: [],
  tileGrid: DRAGONS_SANCTUARY_TILE_GRID,
  tileColors: HARBOR_TILE_COLORS,
  collidingTiles: DRAGONS_SANCTUARY_COLLIDING_TILES,
  tileOverrides: [],
  avatarSpawn: AVATAR_START,
  worldWidth: WORLD_WIDTH,
  worldHeight: WORLD_HEIGHT,
};

/**
 * The Dragon's Sanctuary, Phase 16's production explorable environment
 * (docs/ROADMAP.md Phase 16, "Island Progression"): the first location that
 * exists purely as a story's lasting consequence rather than an adventure of
 * its own. No NPCs (the dragon is a stationary `CHARACTER`-shaped decor
 * sprite, same reasoning as Pirate Pip in `PirateBuilderBayScene.ts`); no
 * tile overrides (nothing here changes further once discovered).
 */
export class DragonsSanctuaryScene extends LocationScene {
  constructor(bus: WorldEventBus, interactionContext: WorldInteractionContext, avatarKey: string) {
    super(
      { sceneKey: DRAGONS_SANCTUARY_SCENE_KEY, ...DRAGONS_SANCTUARY_CONFIG },
      bus,
      interactionContext,
      avatarKey,
    );
  }
}
