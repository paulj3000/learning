import { createWorldExtensionRegistry } from '../runtime/extensionRegistry';
import { tideTrialSceneExtension } from './tideTrial/tideTrialScene';
import { clockworkMachineryExtension } from './clockworkMachinery/clockworkMachineryScene';
import { sanctuaryArtExtension } from './sanctuaryArt/sanctuaryArtScene';
import { castleTaleExtension } from './castleTale/castleTaleScene';
import { regionPlaySceneExtension } from './regionPlay/regionPlayScene';
import { VIEW_EXTENSION_IDS } from './viewExtensionIds';

/**
 * Every bespoke world mechanic the app ships (ADR-032). A manifest names an
 * extension by id; the generic runtime finds it here and never imports a
 * mechanic directly. Registering a new one is adding it to these lists.
 *
 * - `tide-trial`: "Beat the Tide", Pirate Builder Bay's Explorer bridge
 *   repair (engine Phase 7).
 * - `clockwork-machinery`: Clockwork Harbor's placeholder machinery - the
 *   lighthouse mechanism, the lamp, the clock hand, the golden gears
 *   (engine Phase 9).
 * - `adaptive-adventure-entrance`: a spot that opens whichever authored
 *   variant a child's demonstrated skill is ready for (engine Phase 9).
 * - `sanctuary-art`: the Dragon's Sanctuary's placeholder art - the hearth,
 *   the rune sockets, the sealed gates, Ember's silhouette (engine Phase 9).
 * - `castle-tale`: Storykeeper Castle's learning, which runs in the room -
 *   the state variants, Quill's gestures, the three seating puzzles, the
 *   easel, and the in-world adventure and story hosts (engine Phase 9).
 * - `region-play`: a region published from Django (TR-7): draws its chests
 *   from the child's server state and hands its NPC and chest interactions
 *   to the play API.
 */
export const SOURCE_WORLD_EXTENSIONS = createWorldExtensionRegistry([
  tideTrialSceneExtension,
  clockworkMachineryExtension,
  sanctuaryArtExtension,
  castleTaleExtension,
  regionPlaySceneExtension,
]);

/** Every extension id with a scene half, a React half, or both. */
export const SOURCE_EXTENSION_IDS: readonly string[] = [
  ...new Set([...SOURCE_WORLD_EXTENSIONS.ids(), ...VIEW_EXTENSION_IDS]),
];
