import { getAdventureTemplate, resolveAdventureForAgeBand } from '../../../../adventures/content';
import {
  PAINTED_WORDS_AGAIN_SLUG,
  PAINTED_WORDS_SLUG,
} from '../../../../adventures/content/thePaintedWords';
import type { WorldInteraction } from '../../../worldObjects';
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

/**
 * SC-JMP: the Painted Words, hosted in the Illustration Studio so its three painted pads can
 * answer. `castle-tale` takes over the wall's two interactions (first play and replay) only for a
 * band the mission is authored for (Pathfinders); any other band leaves the wall to the generic
 * panel, and a claim is never made that would open nothing (C-2).
 */
export function paintedWordsAdventureFor(
  interaction: Pick<WorldInteraction, 'action'>,
  ageBand: AgeBandValue,
): AdventureDefinition | undefined {
  if (interaction.action.kind !== 'START_ADVENTURE') return undefined;
  const { templateSlug } = interaction.action;
  if (templateSlug !== PAINTED_WORDS_SLUG && templateSlug !== PAINTED_WORDS_AGAIN_SLUG) {
    return undefined;
  }
  const template = getAdventureTemplate(templateSlug);
  return template && template.ageBands.includes(ageBand) ? template : undefined;
}
