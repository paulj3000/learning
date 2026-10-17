/**
 * Bolt's Workshop's static props (docs/ROADMAP.md Phase 16, "Island
 * Progression"): Bolt, repaired and back to work, plus a shelf of spare
 * parts. Phaser-free and unit-testable, same pattern as every other
 * location's own `*Decor.ts`; `scenes/LocationScene.ts` only turns this
 * data into sprites.
 */
import { findInteraction, BOLTS_WORKSHOP_INTERACTIONS } from './worldObjects';
import { TILE_SIZE } from './tilemap';
import type { DecorDefinition } from './decor';

// Kept clear of the avatar's spawn point (`BoltsWorkshopScene`'s
// createAvatar) and the harbor-exit zone so nothing renders stacked on top
// of anything else at load time.
export const BOLTS_WORKSHOP_DECOR: DecorDefinition[] = [
  {
    id: 'bolt',
    interactionId: 'meet-bolt',
    position: { x: 14 * TILE_SIZE + TILE_SIZE / 2, y: 8 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'ROBOT',
    ambientAnimation: 'NONE',
  },
  {
    id: 'bolts-workshop-toolbox',
    interactionId: 'bolts-workshop-toolbox',
    position: { x: 16 * TILE_SIZE + TILE_SIZE / 2, y: 10 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'TOOLBOX',
    ambientAnimation: 'NONE',
  },
];

/** Resolves a decor entry's linked `WorldInteraction`, throwing if content authoring drifted apart. */
export function getBoltsWorkshopDecorInteraction(decor: DecorDefinition) {
  const interaction = findInteraction(BOLTS_WORKSHOP_INTERACTIONS, decor.interactionId);
  if (!interaction) {
    throw new Error(`Decor "${decor.id}" references unknown interaction "${decor.interactionId}"`);
  }
  return interaction;
}
