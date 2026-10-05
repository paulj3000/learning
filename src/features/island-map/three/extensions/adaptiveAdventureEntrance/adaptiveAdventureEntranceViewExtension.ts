import type { LocationViewExtension } from '../../runtime/viewExtensionRegistry';
import { AdaptiveAdventureEntranceOverlay } from './AdaptiveAdventureEntranceOverlay';
import { tryParseAdaptiveEntranceConfig } from './adaptiveAdventureEntranceConfig';

/**
 * `adaptive-adventure-entrance` has only a React half: what it changes is
 * which adventure a spot opens, not what is in the room. It claims exactly
 * the interaction its config names, for every age band - the band itself
 * still narrows the candidate variants inside the overlay.
 */
export const adaptiveAdventureEntranceViewExtension: LocationViewExtension = {
  id: 'adaptive-adventure-entrance',
  claimsInteraction(interaction, { config }) {
    return tryParseAdaptiveEntranceConfig(config)?.interactionId === interaction.id;
  },
  Overlay: AdaptiveAdventureEntranceOverlay,
};
