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

/**
 * `CHARACTER`/`ROPE`/`TOOLBOX`/`CHEST` were added for Pirate Builder Bay's
 * Phase 11 spatial scene (`pirateBuilderBayDecor.ts`); `HIVE`/`FROG`/
 * `LEAVES`/`CAVE`/`MOON` were added for Wonderwild Forest's Phase 13
 * discovery points (`wonderwildForestDecor.ts`); `PORTRAIT`/`WINDOW`/
 * `WARDROBE`/`BOOKSHELF`/`EASEL` were added for Storykeeper Castle's Phase 14
 * creative-story rooms (`storykeeperCastleDecor.ts`); `DRAGON`/`EGG` were
 * added for the Dragon's Sanctuary, Phase 16's "returning character"
 * example (`dragonsSanctuaryDecor.ts`); `BUTTERFLY` was added for
 * Wonderwild Forest's Phase 16 "new NPC arrival" example
 * (`wonderwildForestDecor.ts`, gated by `requiredChangeKey` below);
 * `SKELETON` was added for Fossil Ridge Camp and `DESK` for the Writing
 * Room, Phase 16's second and third "story-dependent environmental change"
 * examples (`fossilRidgeCampDecor.ts`/`castleWritingRoomDecor.ts`); `ROBOT`
 * was added for Bolt's Workshop, Phase 16's fourth
 * (`boltsWorkshopDecor.ts`). The shared scene renderer
 * (`scenes/LocationScene.ts`) draws all twenty-three, so any location's
 * decor module can use any shape.
 */
export type DecorShape =
  | 'SIGN'
  | 'TREE'
  | 'DOOR'
  | 'CHARACTER'
  | 'ROPE'
  | 'TOOLBOX'
  | 'CHEST'
  | 'HIVE'
  | 'FROG'
  | 'LEAVES'
  | 'CAVE'
  | 'MOON'
  | 'PORTRAIT'
  | 'WINDOW'
  | 'WARDROBE'
  | 'BOOKSHELF'
  | 'EASEL'
  | 'DRAGON'
  | 'EGG'
  | 'BUTTERFLY'
  | 'SKELETON'
  | 'DESK'
  | 'ROBOT';

export interface DecorDefinition {
  id: string;
  /**
   * The interaction this sprite fires when tapped. Usually `trigger: 'TAP'`,
   * but a decor sprite may also share its position with an `APPROACH`-zoned
   * interaction (e.g. Wonderwild Forest's bee hive, `wonderwildForestDecor.ts`)
   * — tapping and walking into the zone then both resolve through the same
   * `isInteractionAvailable`/`INTERACTION_TRIGGERED` path.
   */
  interactionId: string;
  position: { x: number; y: number };
  shape: DecorShape;
  ambientAnimation: 'SWAY' | 'NONE';
  /**
   * When set, this sprite is only drawn once `changeKey` is in the child's
   * `WorldChange` history (docs/ROADMAP.md Phase 16, "new NPC arrivals") —
   * absent means always drawn, the existing behavior every prior location's
   * decor already relied on. `scenes/LocationScene.ts`'s `createDecor` is
   * the one place that reads this.
   */
  requiredChangeKey?: string;
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
