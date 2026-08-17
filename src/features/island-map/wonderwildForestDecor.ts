/**
 * Wonderwild Forest's static discovery props
 * (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md section 32):
 * the bee hive, a pond-side frog, a leaf pile, a cave mouth, and a night
 * clearing — the roadmap's own five discovery-point examples. Phaser-free
 * and unit-testable, same pattern as `decor.ts`/`pirateBuilderBayDecor.ts`;
 * `scenes/LocationScene.ts` only turns this data into sprites.
 *
 * The bee hive is the one entry whose `interactionId` is a tap-only flavor
 * line (`wonderwild-beehive-peek`) rather than the walk-in adventure
 * interaction itself: the hive's actual "start/already discovered" pair
 * (`wonderwild-beehive`/`wonderwild-beehive-discovered`, `worldObjects.ts`)
 * shares one zone rectangle and only one of the two is ever available at a
 * time, but a decor sprite can only point at a single, always-resolvable
 * interaction id. Binding the sprite to either half of that pair would go
 * silently inert once the other became available; the dedicated always-on
 * tap line sidesteps that while walking into the hive's zone still
 * correctly fires whichever of the two is currently available.
 */
import { findInteraction, WONDERWILD_FOREST_INTERACTIONS } from './worldObjects';
import { TILE_SIZE } from './tilemap';
import type { DecorDefinition } from './decor';

// Kept clear of the avatar's spawn point (`WonderwildForestScene`'s
// createAvatar), the harbor-exit zone, and the pond so nothing renders
// stacked on top of anything else at load time.
export const WONDERWILD_FOREST_DECOR: DecorDefinition[] = [
  {
    id: 'wonderwild-beehive',
    interactionId: 'wonderwild-beehive-peek',
    position: { x: 15 * TILE_SIZE + TILE_SIZE / 2, y: 10 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'HIVE',
    ambientAnimation: 'SWAY',
  },
  {
    id: 'wonderwild-pond-frog',
    interactionId: 'wonderwild-pond-frog',
    position: { x: 22 * TILE_SIZE + TILE_SIZE / 2, y: 9 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'FROG',
    ambientAnimation: 'NONE',
  },
  {
    id: 'wonderwild-leaf-pile',
    interactionId: 'wonderwild-leaf-pile',
    position: { x: 6 * TILE_SIZE + TILE_SIZE / 2, y: 4 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'LEAVES',
    ambientAnimation: 'NONE',
  },
  {
    id: 'wonderwild-cave',
    interactionId: 'wonderwild-cave',
    position: { x: 25 * TILE_SIZE + TILE_SIZE / 2, y: 15 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'CAVE',
    ambientAnimation: 'NONE',
  },
  {
    id: 'wonderwild-night-clearing',
    interactionId: 'wonderwild-night-clearing',
    position: { x: 10 * TILE_SIZE + TILE_SIZE / 2, y: 16 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'MOON',
    ambientAnimation: 'NONE',
  },
];

/** Resolves a decor entry's linked `WorldInteraction`, throwing if content authoring drifted apart. */
export function getWonderwildForestDecorInteraction(decor: DecorDefinition) {
  const interaction = findInteraction(WONDERWILD_FOREST_INTERACTIONS, decor.interactionId);
  if (!interaction) {
    throw new Error(`Decor "${decor.id}" references unknown interaction "${decor.interactionId}"`);
  }
  return interaction;
}
