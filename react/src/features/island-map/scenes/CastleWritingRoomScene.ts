import { LocationScene, type LocationSceneConfig } from './LocationScene';
import type { WorldEventBus } from '../worldEvents';
import { CASTLE_WRITING_ROOM_INTERACTIONS, type WorldInteractionContext } from '../worldObjects';
import { CASTLE_WRITING_ROOM_ZONES } from '../castleWritingRoomZones';
import { CASTLE_WRITING_ROOM_DECOR } from '../castleWritingRoomDecor';
import {
  CASTLE_WRITING_ROOM_COLLIDING_TILES,
  CASTLE_WRITING_ROOM_TILE_GRID,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../castleWritingRoomTilemap';
import { HARBOR_TILE_COLORS, TILE_SIZE } from '../tilemap';

export { WORLD_WIDTH, WORLD_HEIGHT };
export const CASTLE_WRITING_ROOM_SCENE_KEY = 'castle-writing-room';

const AVATAR_START = { x: 3 * TILE_SIZE, y: 9 * TILE_SIZE };

const CASTLE_WRITING_ROOM_CONFIG: Omit<LocationSceneConfig, 'sceneKey'> = {
  interactions: CASTLE_WRITING_ROOM_INTERACTIONS,
  zones: CASTLE_WRITING_ROOM_ZONES,
  npcs: [],
  decor: CASTLE_WRITING_ROOM_DECOR,
  waterShimmerPoints: [],
  tileGrid: CASTLE_WRITING_ROOM_TILE_GRID,
  tileColors: HARBOR_TILE_COLORS,
  collidingTiles: CASTLE_WRITING_ROOM_COLLIDING_TILES,
  tileOverrides: [],
  avatarSpawn: AVATAR_START,
  worldWidth: WORLD_WIDTH,
  worldHeight: WORLD_HEIGHT,
};

/**
 * The Writing Room, Phase 16's third "story-dependent environmental change"
 * location (docs/ROADMAP.md Phase 16, "Island Progression"), same
 * additive-location pattern as `DragonsSanctuaryScene.ts`: no engine
 * changes, only content bound to the shared `LocationScene`.
 */
export class CastleWritingRoomScene extends LocationScene {
  constructor(bus: WorldEventBus, interactionContext: WorldInteractionContext, avatarKey: string) {
    super(
      { sceneKey: CASTLE_WRITING_ROOM_SCENE_KEY, ...CASTLE_WRITING_ROOM_CONFIG },
      bus,
      interactionContext,
      avatarKey,
    );
  }
}
