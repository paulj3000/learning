import type { LocationViewExtension } from '../../runtime/viewExtensionRegistry';
import { REGION_PLAY_EXTENSION_ID } from '../../../../region-play/regionManifest';
import { tryParseRegionPlayConfig } from '../../../../region-play/regionPlayConfig';
import { claimsRegionPlayInteraction } from '../../../../region-play/regionPlayInteractions';
import { RegionPlayCompanion } from './RegionPlayCompanion';

/**
 * `region-play`'s React half (TR-7). It claims exactly the interactions the
 * manifest builder bound to it (each published NPC and chest), so they reach
 * the Django play API through the companion and never the generic Amplify
 * panels.
 */
export const regionPlayViewExtension: LocationViewExtension = {
  id: REGION_PLAY_EXTENSION_ID,
  claimsInteraction(interaction, { config }) {
    return claimsRegionPlayInteraction(tryParseRegionPlayConfig(config), interaction.id);
  },
  Companion: RegionPlayCompanion,
};
