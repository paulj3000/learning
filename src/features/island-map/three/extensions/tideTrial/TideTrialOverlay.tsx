import { recordWorldChangeOnce } from '../../../../adventures/api';
import { TideTrialPanel } from '../../TideTrialPanel';
import type { LocationViewExtensionOverlayProps } from '../../runtime/viewExtensionRegistry';
import { tryParseTideTrialConfig } from './tideTrialConfig';
import { isTideTrialScene } from './tideTrialScene';

/**
 * The React half of "Beat the Tide" (engine Phase 7, ADR-025). Explorers
 * mend the bridge in the scene instead of through the card adventure: the
 * card route resolves an Explorer to "The Tide Gate Calculation", which
 * records `TIDE_GATE_SET`, not `BRIDGE_REPAIRED`, so an Explorer could
 * never cross to the cove (moved here from `PirateBuilderBayWorldView.tsx`).
 *
 * Winning records the configured world change through the Adventure
 * Engine's existing `recordWorldChangeOnce`, with an `exploration:` source
 * because no adventure session is involved.
 */
export function TideTrialOverlay({
  childId,
  config,
  sceneApi,
  onClose,
  refreshWorld,
}: LocationViewExtensionOverlayProps) {
  const parsed = tryParseTideTrialConfig(config);
  if (!parsed) return null;
  const { worldChange } = parsed;
  return (
    <TideTrialPanel
      scene={isTideTrialScene(sceneApi) ? sceneApi : null}
      onWon={async () => {
        await recordWorldChangeOnce(
          childId,
          worldChange.locationSlug,
          worldChange.changeType,
          worldChange.changeKey,
          worldChange.source,
        );
        await refreshWorld();
      }}
      onClose={onClose}
    />
  );
}
