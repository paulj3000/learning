import { createWorldExtensionRegistry } from '../runtime/extensionRegistry';
import { createViewExtensionRegistry } from '../runtime/viewExtensionRegistry';
import { tideTrialSceneExtension } from './tideTrial/tideTrialScene';
import { tideTrialViewExtension } from './tideTrial/tideTrialViewExtension';

/**
 * Every bespoke world mechanic the app ships (ADR-025). A manifest names an
 * extension by id; the generic runtime finds it here and never imports a
 * mechanic directly. Registering a new one is adding it to these lists.
 *
 * - `tide-trial`: "Beat the Tide", Pirate Builder Bay's Explorer bridge
 *   repair (engine Phase 7).
 */
export const SOURCE_WORLD_EXTENSIONS = createWorldExtensionRegistry([tideTrialSceneExtension]);

export const SOURCE_VIEW_EXTENSIONS = createViewExtensionRegistry([tideTrialViewExtension]);

/** Every extension id with a scene half, a React half, or both. */
export const SOURCE_EXTENSION_IDS: readonly string[] = [
  ...new Set([...SOURCE_WORLD_EXTENSIONS.ids(), ...SOURCE_VIEW_EXTENSIONS.ids()]),
];
