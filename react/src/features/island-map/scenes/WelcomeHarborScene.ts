import { LocationScene, type LocationSceneConfig } from './LocationScene';
import type { WorldEventBus } from '../worldEvents';
import { WELCOME_HARBOR_INTERACTIONS, type WorldInteractionContext } from '../worldObjects';
import { WELCOME_HARBOR_ZONES } from '../zones';
import { WELCOME_HARBOR_NPCS } from '../npcs';
import { WELCOME_HARBOR_DECOR, WELCOME_HARBOR_WATER_SHIMMER_POINTS } from '../decor';
import {
  HARBOR_COLLIDING_TILES,
  HARBOR_TILE_COLORS,
  HARBOR_TILE_GRID,
  HarborTile,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../tilemap';

export { WORLD_WIDTH, WORLD_HEIGHT };
export const WELCOME_HARBOR_SCENE_KEY = 'welcome-harbor';

const bridgeZone = WELCOME_HARBOR_ZONES['broken-bridge'];
const AVATAR_START = { x: Math.min(120, bridgeZone ? bridgeZone.x - 80 : 120), y: 320 };

const WELCOME_HARBOR_CONFIG: Omit<LocationSceneConfig, 'sceneKey'> = {
  interactions: WELCOME_HARBOR_INTERACTIONS,
  zones: WELCOME_HARBOR_ZONES,
  npcs: WELCOME_HARBOR_NPCS,
  decor: WELCOME_HARBOR_DECOR,
  waterShimmerPoints: WELCOME_HARBOR_WATER_SHIMMER_POINTS,
  tileGrid: HARBOR_TILE_GRID,
  tileColors: HARBOR_TILE_COLORS,
  collidingTiles: HARBOR_COLLIDING_TILES,
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
 * Welcome Harbor, Phase 10's production explorable environment
 * (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md section 29).
 * Phase 11 extracted the actual rendering engine into `LocationScene`; this
 * class is now just Welcome Harbor's own data bound to that shared engine,
 * the same pattern `PirateBuilderBayScene` uses for the bay.
 */
export class WelcomeHarborScene extends LocationScene {
  constructor(bus: WorldEventBus, interactionContext: WorldInteractionContext, avatarKey: string) {
    super(
      { sceneKey: WELCOME_HARBOR_SCENE_KEY, ...WELCOME_HARBOR_CONFIG },
      bus,
      interactionContext,
      avatarKey,
    );
  }
}
