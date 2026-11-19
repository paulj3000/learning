/**
 * GE-070: Treasure Cove as a Game Engine Core adventure (Realm SDK `AdventureDefinition`).
 *
 * The definition is data (`treasureCoveAdventure.json`), so the same file is checked three ways:
 * here with `validateAdventure` against the standard capability registry, by
 * `npm run engine:validate` like any content, and by Django
 * (`lai/apps/regions/tests/test_treasure_cove_adventure.py`), which proves every chest, pickup,
 * quest, checkpoint and world-change id in it is one the Treasure Cove seed really publishes.
 *
 * It declares what the adventure needs, not a second implementation of it. Today the live
 * location runtime and region play provide every capability (movement, jumping, camera, avatar,
 * chests, pickups, the spawn checkpoint); Django owns the challenges, grading and rewards. The
 * cove authors no movement or camera overrides, so every capability takes its engine defaults,
 * exactly as the live runtime does. Pirate's Leap's course, checkpoints and jump challenges are
 * GE-071 and are added there.
 */

import { defineAdventure, type AdventureDefinition } from '@lai/game-engine/sdk';
import definition from './treasureCoveAdventure.json';

/** The engine component types the cove places (`game/src/components`). */
export const TREASURE_COVE_COMPONENT_TYPES: ReadonlySet<string> = new Set([
  'gameplay.chest',
  'gameplay.collectible',
]);

export const TREASURE_COVE_ADVENTURE: Readonly<AdventureDefinition> = defineAdventure(
  definition as Parameters<typeof defineAdventure>[0],
);
