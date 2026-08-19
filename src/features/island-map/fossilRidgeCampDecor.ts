/**
 * Fossil Ridge Camp's static props (docs/ROADMAP.md Phase 16, "Island
 * Progression"): the fully assembled dinosaur skeleton — the excavation's
 * payoff — plus the dig tools left behind at camp. Phaser-free and
 * unit-testable, same pattern as every other location's own `*Decor.ts`;
 * `scenes/LocationScene.ts` only turns this data into sprites.
 */
import { findInteraction, FOSSIL_RIDGE_CAMP_INTERACTIONS } from './worldObjects';
import { TILE_SIZE } from './tilemap';
import type { DecorDefinition } from './decor';

// Kept clear of the avatar's spawn point (`FossilRidgeCampScene`'s
// createAvatar) and the harbor-exit zone so nothing renders stacked on top
// of anything else at load time.
export const FOSSIL_RIDGE_CAMP_DECOR: DecorDefinition[] = [
  {
    id: 'fossil-ridge-skeleton',
    interactionId: 'meet-the-fossil',
    position: { x: 14 * TILE_SIZE + TILE_SIZE / 2, y: 8 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'SKELETON',
    ambientAnimation: 'NONE',
  },
  {
    id: 'fossil-ridge-dig-tools',
    interactionId: 'fossil-ridge-dig-tools',
    position: { x: 16 * TILE_SIZE + TILE_SIZE / 2, y: 10 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'TOOLBOX',
    ambientAnimation: 'NONE',
  },
];

/** Resolves a decor entry's linked `WorldInteraction`, throwing if content authoring drifted apart. */
export function getFossilRidgeCampDecorInteraction(decor: DecorDefinition) {
  const interaction = findInteraction(FOSSIL_RIDGE_CAMP_INTERACTIONS, decor.interactionId);
  if (!interaction) {
    throw new Error(`Decor "${decor.id}" references unknown interaction "${decor.interactionId}"`);
  }
  return interaction;
}
