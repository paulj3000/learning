import { createWorldExtensionRegistry } from '../runtime/extensionRegistry';
import { createViewExtensionRegistry } from '../runtime/viewExtensionRegistry';
import { tideTrialSceneExtension } from './tideTrial/tideTrialScene';
import { tideTrialViewExtension } from './tideTrial/tideTrialViewExtension';
import { clockworkMachineryExtension } from './clockworkMachinery/clockworkMachineryScene';
import { adaptiveAdventureEntranceViewExtension } from './adaptiveAdventureEntrance/adaptiveAdventureEntranceViewExtension';
import { sanctuaryArtExtension } from './sanctuaryArt/sanctuaryArtScene';

/**
 * Every bespoke world mechanic the app ships (ADR-025). A manifest names an
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
 */
export const SOURCE_WORLD_EXTENSIONS = createWorldExtensionRegistry([
  tideTrialSceneExtension,
  clockworkMachineryExtension,
  sanctuaryArtExtension,
]);

export const SOURCE_VIEW_EXTENSIONS = createViewExtensionRegistry([
  tideTrialViewExtension,
  adaptiveAdventureEntranceViewExtension,
]);

/** Every extension id with a scene half, a React half, or both. */
export const SOURCE_EXTENSION_IDS: readonly string[] = [
  ...new Set([...SOURCE_WORLD_EXTENSIONS.ids(), ...SOURCE_VIEW_EXTENSIONS.ids()]),
];
