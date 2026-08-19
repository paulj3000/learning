import { LocationScene, type LocationSceneConfig } from './LocationScene';
import type { WorldEventBus } from '../worldEvents';
import { STORYKEEPER_CASTLE_INTERACTIONS, type WorldInteractionContext } from '../worldObjects';
import { STORYKEEPER_CASTLE_ZONES } from '../storykeeperCastleZones';
import { STORYKEEPER_CASTLE_DECOR } from '../storykeeperCastleDecor';
import {
  STORYKEEPER_CASTLE_COLLIDING_TILES,
  STORYKEEPER_CASTLE_TILE_GRID,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../storykeeperCastleTilemap';
import { HARBOR_TILE_COLORS, HarborTile, TILE_SIZE } from '../tilemap';

export { WORLD_WIDTH, WORLD_HEIGHT };
export const STORYKEEPER_CASTLE_SCENE_KEY = 'storykeeper-castle';

const AVATAR_START = { x: 3 * TILE_SIZE, y: 10 * TILE_SIZE };

const STORYKEEPER_CASTLE_CONFIG: Omit<LocationSceneConfig, 'sceneKey'> = {
  interactions: STORYKEEPER_CASTLE_INTERACTIONS,
  zones: STORYKEEPER_CASTLE_ZONES,
  npcs: [],
  decor: STORYKEEPER_CASTLE_DECOR,
  waterShimmerPoints: [],
  tileGrid: STORYKEEPER_CASTLE_TILE_GRID,
  tileColors: HARBOR_TILE_COLORS,
  collidingTiles: STORYKEEPER_CASTLE_COLLIDING_TILES,
  tileOverrides: [
    {
      changeKey: 'FIRST_STORY_TOLD',
      from: HarborTile.SAND,
      to: HarborTile.CARPET,
    },
  ],
  avatarSpawn: AVATAR_START,
  worldWidth: WORLD_WIDTH,
  worldHeight: WORLD_HEIGHT,
};

/**
 * Storykeeper Castle, Phase 14's production explorable environment
 * (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md section 33):
 * a physical creative-story environment. No NPCs (Keeper Quill is a
 * stationary `CHARACTER` decor sprite, same call Pirate Builder Bay made for
 * Pirate Pip). Everything else — tiles, zones, decor — is this castle's own
 * data bound to the shared engine; no engine changes were needed beyond the
 * new `DecorShape`s already added to `scenes/LocationScene.ts`.
 *
 * The `tileOverrides` entry is Phase 16's "persistent construction"
 * (docs/ROADMAP.md Phase 16): once `FIRST_STORY_TOLD` is recorded
 * (completing "The Storykeeper's Tale"), the whole stone floor becomes a
 * carpeted `CARPET` floor, same whole-grid-swap reasoning as
 * `WonderwildForestScene.ts`'s bloom.
 */
export class StorykeeperCastleScene extends LocationScene {
  constructor(bus: WorldEventBus, interactionContext: WorldInteractionContext, avatarKey: string) {
    super(
      { sceneKey: STORYKEEPER_CASTLE_SCENE_KEY, ...STORYKEEPER_CASTLE_CONFIG },
      bus,
      interactionContext,
      avatarKey,
    );
  }
}
