/**
 * Welcome Harbor's static "environmental curiosity" props
 * (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md section 17:
 * signs, trees, doors) plus ambient-only water shimmer points ("environmental
 * animations"). Phaser-free and unit-testable, same pattern as
 * `zones.ts`/`npcs.ts`/`worldObjects.ts`; `WelcomeHarborScene` only turns
 * this data into sprites/tweens.
 */
import { TILE_SIZE } from './tilemap';
import { findInteraction, WELCOME_HARBOR_INTERACTIONS } from './worldObjects';

export type DecorShape = 'SIGN' | 'TREE' | 'DOOR';

export interface DecorDefinition {
  id: string;
  /** Must resolve to a `trigger: 'TAP'` entry in `WELCOME_HARBOR_INTERACTIONS`. */
  interactionId: string;
  position: { x: number; y: number };
  shape: DecorShape;
  ambientAnimation: 'SWAY' | 'NONE';
}

// Kept clear of the avatar's spawn point (col ~3.75, row 10 in
// `WelcomeHarborScene.createAvatar`) and of Chatty's spawn (`npcs.ts`) so
// nothing renders stacked on top of anything else at load time.
export const WELCOME_HARBOR_DECOR: DecorDefinition[] = [
  {
    id: 'dock-sign',
    interactionId: 'dock-sign',
    position: { x: 2 * TILE_SIZE + TILE_SIZE / 2, y: 2 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'SIGN',
    ambientAnimation: 'SWAY',
  },
  {
    id: 'palm-tree',
    interactionId: 'palm-tree',
    position: { x: 1 * TILE_SIZE + TILE_SIZE / 2, y: 6 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'TREE',
    ambientAnimation: 'SWAY',
  },
  {
    id: 'harbor-door',
    interactionId: 'harbor-door',
    position: { x: 15 * TILE_SIZE + TILE_SIZE / 2, y: 9 * TILE_SIZE + TILE_SIZE / 2 },
    shape: 'DOOR',
    ambientAnimation: 'NONE',
  },
];

/** Purely ambient shimmer over open water. Not a `WorldInteraction` — no tap target, no zone. */
export const WELCOME_HARBOR_WATER_SHIMMER_POINTS: { x: number; y: number }[] = [
  { x: 8 * TILE_SIZE + TILE_SIZE / 2, y: 15 * TILE_SIZE + TILE_SIZE / 2 },
  { x: 16 * TILE_SIZE + TILE_SIZE / 2, y: 15 * TILE_SIZE + TILE_SIZE / 2 },
  { x: 24 * TILE_SIZE + TILE_SIZE / 2, y: 15 * TILE_SIZE + TILE_SIZE / 2 },
];

/** Resolves a decor entry's linked `WorldInteraction`, throwing if content authoring drifted apart. */
export function getDecorInteraction(decor: DecorDefinition) {
  const interaction = findInteraction(WELCOME_HARBOR_INTERACTIONS, decor.interactionId);
  if (!interaction) {
    throw new Error(`Decor "${decor.id}" references unknown interaction "${decor.interactionId}"`);
  }
  return interaction;
}
