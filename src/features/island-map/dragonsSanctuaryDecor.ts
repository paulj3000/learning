/**
 * The Dragon's Sanctuary's static props (docs/ROADMAP.md Phase 16, "Island
 * Progression"): the dragon herself ("returning character" — the same
 * dragon "The Dragon of Ember Mountain" story revealed as protective, not
 * dangerous) and her egg. Phaser-free and unit-testable, same pattern as
 * every other location's own `*Decor.ts`; `scenes/LocationScene.ts` only
 * turns this data into sprites.
 */
import { findInteraction, DRAGONS_SANCTUARY_INTERACTIONS } from './worldObjects';
import { TILE_SIZE } from './tilemap';
import type { DecorDefinition } from './decor';

// Kept clear of the avatar's spawn point (`DragonsSanctuaryScene`'s
// createAvatar) and the harbor-exit zone so nothing renders stacked on top
// of anything else at load time.
export const DRAGONS_SANCTUARY_DECOR: DecorDefinition[] = [
  {
    id: 'ember-dragon',
    interactionId: 'meet-ember-dragon',
    position: { x: 14 * TILE_SIZE + TILE_SIZE / 2, y: 8 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'DRAGON',
    ambientAnimation: 'NONE',
  },
  {
    id: 'dragons-sanctuary-egg',
    interactionId: 'dragons-sanctuary-egg',
    position: { x: 16 * TILE_SIZE + TILE_SIZE / 2, y: 9 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'EGG',
    ambientAnimation: 'NONE',
  },
];

/** Resolves a decor entry's linked `WorldInteraction`, throwing if content authoring drifted apart. */
export function getDragonsSanctuaryDecorInteraction(decor: DecorDefinition) {
  const interaction = findInteraction(DRAGONS_SANCTUARY_INTERACTIONS, decor.interactionId);
  if (!interaction) {
    throw new Error(`Decor "${decor.id}" references unknown interaction "${decor.interactionId}"`);
  }
  return interaction;
}
