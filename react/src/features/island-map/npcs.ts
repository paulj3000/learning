/**
 * Welcome Harbor's NPC framework (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md
 * section 29): data describing each NPC's spawn point, palette, and follow
 * behavior, so adding a future NPC is a content addition here rather than
 * new code in `WelcomeHarborScene.ts`. Phaser-free and unit-testable, same
 * pattern as `zones.ts`/`worldObjects.ts`.
 */
import {
  HARBOR_COLLIDING_TILES,
  HARBOR_TILE_GRID,
  TILE_SIZE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './tilemap';
import { findInteraction, WELCOME_HARBOR_INTERACTIONS } from './worldObjects';
import { isOnWalkableTile as isOnWalkableGridTile, isWithinBounds } from './gridGeometry';

export interface NpcPalette {
  body: number;
  belly: number;
  beak: number;
  eye: number;
}

export interface NpcDefinition {
  id: string;
  /** Must resolve to a `type: 'NPC'`, `trigger: 'TAP'` entry in `WELCOME_HARBOR_INTERACTIONS`. */
  interactionId: string;
  name: string;
  /** Pixel-space starting position before it begins following the avatar. */
  spawn: { x: number; y: number };
  palette: NpcPalette;
  /** How far behind the avatar this NPC trails once following (pixels). */
  followDistancePx: number;
  /** Amplitude of the idle up/down bob while not reduced-motion (pixels). */
  idleBobPx: number;
}

/** Chatty's Phase 9 palette, kept as-is; only the spawn point moved to make room for the new decor layout. */
export const WELCOME_HARBOR_NPCS: NpcDefinition[] = [
  {
    id: 'chatty',
    interactionId: 'talk-to-chatty',
    name: 'Chatty the Parrot',
    spawn: { x: 4 * TILE_SIZE, y: 4 * TILE_SIZE },
    palette: { body: 0x2f8f4e, belly: 0xf4d35e, beak: 0xf2a541, eye: 0x1b2733 },
    followDistancePx: 56,
    idleBobPx: 4,
  },
];

export function isWithinWorldBounds(x: number, y: number): boolean {
  return isWithinBounds(x, y, WORLD_WIDTH, WORLD_HEIGHT);
}

export function isOnWalkableTile(x: number, y: number): boolean {
  return isOnWalkableGridTile(x, y, HARBOR_TILE_GRID, HARBOR_COLLIDING_TILES, TILE_SIZE);
}

/** Resolves an NPC's linked `WorldInteraction`, throwing if content authoring drifted apart. */
export function getNpcInteraction(npc: NpcDefinition) {
  const interaction = findInteraction(WELCOME_HARBOR_INTERACTIONS, npc.interactionId);
  if (!interaction) {
    throw new Error(`NPC "${npc.id}" references unknown interaction "${npc.interactionId}"`);
  }
  return interaction;
}
