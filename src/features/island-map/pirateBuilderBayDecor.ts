/**
 * Pirate Builder Bay's static props (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md
 * section 30): Pirate Pip ("meet character"), a rope coil and toolbox
 * ("find materials"), and a treasure chest in the cove ("discover new
 * area"). Phaser-free and unit-testable, same pattern as Welcome Harbor's
 * `decor.ts`; `scenes/LocationScene.ts` only turns this data into sprites.
 */
import { findInteraction, PIRATE_BUILDER_BAY_INTERACTIONS } from './worldObjects';
import { TILE_SIZE } from './tilemap';
import type { DecorDefinition } from './decor';

// Kept clear of the avatar's spawn point (`PirateBuilderBayScene`'s
// createAvatar) and of the bridge zone (`pirateBuilderBayZones.ts`) so
// nothing renders stacked on top of anything else at load time.
export const PIRATE_BUILDER_BAY_DECOR: DecorDefinition[] = [
  {
    id: 'pirate-pip',
    interactionId: 'meet-pirate-pip',
    position: { x: 9 * TILE_SIZE + TILE_SIZE / 2, y: 7 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'CHARACTER',
    ambientAnimation: 'SWAY',
  },
  {
    id: 'bay-rope-coil',
    interactionId: 'bay-rope-coil',
    position: { x: 5 * TILE_SIZE + TILE_SIZE / 2, y: 4 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'ROPE',
    ambientAnimation: 'NONE',
  },
  {
    id: 'bay-toolbox',
    interactionId: 'bay-toolbox',
    position: { x: 6 * TILE_SIZE + TILE_SIZE / 2, y: 10 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'TOOLBOX',
    ambientAnimation: 'NONE',
  },
  {
    id: 'cove-treasure',
    interactionId: 'cove-treasure',
    // East of the bridge, inside the cove — unreachable until the bridge is
    // repaired (the water channel's collision gates this, not the
    // interaction's own requirements; see `worldObjects.ts`'s comment).
    position: { x: 22 * TILE_SIZE + TILE_SIZE / 2, y: 7 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'CHEST',
    ambientAnimation: 'NONE',
  },
];

/** Resolves a decor entry's linked `WorldInteraction`, throwing if content authoring drifted apart. */
export function getPirateBuilderBayDecorInteraction(decor: DecorDefinition) {
  const interaction = findInteraction(PIRATE_BUILDER_BAY_INTERACTIONS, decor.interactionId);
  if (!interaction) {
    throw new Error(`Decor "${decor.id}" references unknown interaction "${decor.interactionId}"`);
  }
  return interaction;
}
