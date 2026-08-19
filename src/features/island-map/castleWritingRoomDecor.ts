/**
 * The Writing Room's static props (docs/ROADMAP.md Phase 16, "Island
 * Progression"): the writing desk left ready for the child, plus shelves of
 * empty books. Phaser-free and unit-testable, same pattern as every other
 * location's own `*Decor.ts`; `scenes/LocationScene.ts` only turns this
 * data into sprites. `BOOKSHELF` is reused as-is from Storykeeper Castle's
 * own Great Library prop (`storykeeperCastleDecor.ts`) — no new shape
 * needed beyond `DESK`.
 */
import { findInteraction, CASTLE_WRITING_ROOM_INTERACTIONS } from './worldObjects';
import { TILE_SIZE } from './tilemap';
import type { DecorDefinition } from './decor';

// Kept clear of the avatar's spawn point (`CastleWritingRoomScene`'s
// createAvatar) and the castle-exit zone so nothing renders stacked on top
// of anything else at load time.
export const CASTLE_WRITING_ROOM_DECOR: DecorDefinition[] = [
  {
    id: 'writing-room-desk',
    interactionId: 'writing-room-desk',
    position: { x: 14 * TILE_SIZE + TILE_SIZE / 2, y: 8 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'DESK',
    ambientAnimation: 'NONE',
  },
  {
    id: 'writing-room-bookshelf',
    interactionId: 'writing-room-bookshelf',
    position: { x: 16 * TILE_SIZE + TILE_SIZE / 2, y: 10 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'BOOKSHELF',
    ambientAnimation: 'NONE',
  },
];

/** Resolves a decor entry's linked `WorldInteraction`, throwing if content authoring drifted apart. */
export function getCastleWritingRoomDecorInteraction(decor: DecorDefinition) {
  const interaction = findInteraction(CASTLE_WRITING_ROOM_INTERACTIONS, decor.interactionId);
  if (!interaction) {
    throw new Error(`Decor "${decor.id}" references unknown interaction "${decor.interactionId}"`);
  }
  return interaction;
}
