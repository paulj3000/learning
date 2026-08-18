/**
 * Storykeeper Castle's static room props
 * (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md section 33):
 * Keeper Quill in the story hall ("meet character"), plus the roadmap's own
 * five other "potential areas" — the Character Gallery, Setting Tower,
 * Costume Room, Great Library, and Illustration Studio. Phaser-free and
 * unit-testable, same pattern as `pirateBuilderBayDecor.ts`/
 * `wonderwildForestDecor.ts`; `scenes/LocationScene.ts` only turns this data
 * into sprites.
 *
 * Keeper Quill is a `CHARACTER` decor sprite, not an NPC entry — same call
 * `pirateBuilderBayDecor.ts` made for Pirate Pip, since `LocationScene`'s NPC
 * renderer is a Chatty-specific parrot shape and Keeper Quill stands in
 * place rather than following the avatar.
 */
import { findInteraction, STORYKEEPER_CASTLE_INTERACTIONS } from './worldObjects';
import { TILE_SIZE } from './tilemap';
import type { DecorDefinition } from './decor';

// Kept clear of the avatar's spawn point (`StorykeeperCastleScene`'s
// createAvatar), the entrance zone, and the story hall zone
// (`storykeeperCastleZones.ts`) so nothing renders stacked on top of
// anything else at load time.
export const STORYKEEPER_CASTLE_DECOR: DecorDefinition[] = [
  {
    id: 'keeper-quill',
    interactionId: 'talk-to-keeper-quill',
    position: { x: 15 * TILE_SIZE + TILE_SIZE / 2, y: 10 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'CHARACTER',
    ambientAnimation: 'SWAY',
  },
  {
    id: 'castle-character-gallery',
    interactionId: 'castle-character-gallery',
    position: { x: 6 * TILE_SIZE + TILE_SIZE / 2, y: 3 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'PORTRAIT',
    ambientAnimation: 'NONE',
  },
  {
    id: 'castle-setting-tower',
    interactionId: 'castle-setting-tower',
    position: { x: 24 * TILE_SIZE + TILE_SIZE / 2, y: 3 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'WINDOW',
    ambientAnimation: 'NONE',
  },
  {
    id: 'castle-costume-room',
    interactionId: 'castle-costume-room',
    position: { x: 6 * TILE_SIZE + TILE_SIZE / 2, y: 16 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'WARDROBE',
    ambientAnimation: 'NONE',
  },
  {
    id: 'castle-great-library',
    interactionId: 'castle-great-library',
    position: { x: 24 * TILE_SIZE + TILE_SIZE / 2, y: 16 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'BOOKSHELF',
    ambientAnimation: 'NONE',
  },
  {
    id: 'castle-illustration-studio',
    interactionId: 'castle-illustration-studio',
    position: { x: 15 * TILE_SIZE + TILE_SIZE / 2, y: 3 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'EASEL',
    ambientAnimation: 'NONE',
  },
];

/** Resolves a decor entry's linked `WorldInteraction`, throwing if content authoring drifted apart. */
export function getStorykeeperCastleDecorInteraction(decor: DecorDefinition) {
  const interaction = findInteraction(STORYKEEPER_CASTLE_INTERACTIONS, decor.interactionId);
  if (!interaction) {
    throw new Error(`Decor "${decor.id}" references unknown interaction "${decor.interactionId}"`);
  }
  return interaction;
}
