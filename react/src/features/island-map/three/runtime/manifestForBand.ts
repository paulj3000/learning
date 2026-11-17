import type { AgeBandValue } from '../../../child-profile/constants';
import type { ThreeLocationManifest } from './locationManifest';

/**
 * The manifest a child in `ageBand` plays: the same location, with that band's own platforming
 * when the manifest authors one (SC-JMP: Sprouts get flat floor markers instead of solid pads).
 * Pure, and the identity for any location without a variant, so nothing else changes.
 */
export function manifestForBand(
  manifest: ThreeLocationManifest,
  ageBand: AgeBandValue,
): ThreeLocationManifest {
  const variant = manifest.platformingByBand?.[ageBand];
  return variant === undefined ? manifest : { ...manifest, platforming: variant };
}
