import type { LocationViewExtension } from '../../runtime/viewExtensionRegistry';
import { tryParseTideTrialConfig } from './tideTrialConfig';
import { TIDE_TRIAL_EXTENSION_ID } from './tideTrialScene';
import { TideTrialOverlay } from './TideTrialOverlay';

/** The React half of `tide-trial`: claims the configured interaction for the configured age bands. */
export const tideTrialViewExtension: LocationViewExtension = {
  id: TIDE_TRIAL_EXTENSION_ID,
  claimsInteraction(interaction, { ageBand, config }) {
    const parsed = tryParseTideTrialConfig(config);
    return (
      parsed !== null &&
      interaction.id === parsed.interactionId &&
      parsed.ageBands.includes(ageBand)
    );
  },
  Overlay: TideTrialOverlay,
};
