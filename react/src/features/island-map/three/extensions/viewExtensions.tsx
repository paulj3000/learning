import { createViewExtensionRegistry } from '../runtime/viewExtensionRegistry';
import { adaptiveAdventureEntranceViewExtension } from './adaptiveAdventureEntrance/adaptiveAdventureEntranceViewExtension';
import { castleTaleViewExtension } from './castleTale/castleTaleViewExtension';
import { multiplayerPresenceViewExtension } from './multiplayerPresence/multiplayerPresenceViewExtension';
import { regionPlayViewExtension } from './regionPlay/regionPlayViewExtension';
import { tideTrialViewExtension } from './tideTrial/tideTrialViewExtension';

/**
 * Every extension's React half (ADR-032), for the React host (`ThreeLocationWorldView.tsx`).
 * Split from `index.ts` in POST-MERGE-03 so the engine's world registry no longer reaches React
 * (LAI-0203). The ids are mirrored in `viewExtensionIds.ts` for the engine's manifest checks.
 */
export const SOURCE_VIEW_EXTENSIONS = createViewExtensionRegistry([
  tideTrialViewExtension,
  adaptiveAdventureEntranceViewExtension,
  castleTaleViewExtension,
  multiplayerPresenceViewExtension,
  regionPlayViewExtension,
]);
