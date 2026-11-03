import { resolveAdventureForAgeBand } from '../../../../adventures/content';
import { THE_STORYKEEPERS_TALE } from '../../../../adventures/content/theStorykeepersTale';
import type { AdventureDefinition } from '../../../../adventures/engine/types';
import type { AgeBandValue } from '../../../../child-profile/constants';
import { isStoryForAgeBand } from '../../../../story/engine/eligibility';
import { THE_CASTLES_SECRET_DOOR } from '../../../../story/content/theCastlesSecretDoor';
import type { CastleTaleConfig } from './castleTaleConfig';

/** Which adventure this band tells with Quill (SC-10): the Tale, the Picture Story, or none. */
export function taleAdventureForBand(ageBand: AgeBandValue): AdventureDefinition | undefined {
  return resolveAdventureForAgeBand(
    THE_STORYKEEPERS_TALE.locationSlug,
    THE_STORYKEEPERS_TALE.slug,
    ageBand,
  );
}

/** ADR-027: the Story Engine's own gate, asked rather than restated here. */
export function isSecretDoorStoryForBand(ageBand: AgeBandValue): boolean {
  return isStoryForAgeBand(THE_CASTLES_SECRET_DOOR, ageBand);
}

/**
 * Whether `castle-tale` takes over an interaction for this band
 * (Storykeeper Castle Reboot audit, finding AUD-1). It claims the story
 * hall and the secret door only when it will actually host something there.
 * A claim it cannot honour would open nothing and never close, so an
 * interaction this band has no castle mission for stays with the generic
 * panel instead.
 */
export function castleTaleClaims(
  interactionId: string,
  config: Pick<CastleTaleConfig, 'taleInteractionId' | 'storyInteractionId'>,
  ageBand: AgeBandValue,
): boolean {
  if (interactionId === config.taleInteractionId)
    return taleAdventureForBand(ageBand) !== undefined;
  if (interactionId === config.storyInteractionId) return isSecretDoorStoryForBand(ageBand);
  return false;
}
