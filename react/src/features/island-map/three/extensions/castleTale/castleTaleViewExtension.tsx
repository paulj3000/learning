import type { LocationViewExtension } from '../../runtime/viewExtensionRegistry';
import { CastleTaleCompanion } from './CastleTaleCompanion';
import { castleTaleClaims } from './castleTaleClaims';
import { tryParseCastleTaleConfig } from './castleTaleConfig';
import { managedCastleNpcFor } from './castleNpcHandover';

/**
 * `castle-tale`'s React half. It claims the two interactions whose meaning
 * is "the learning starts here, in this room" - the story hall and the
 * secret door - because the generic panel would navigate a child away to the
 * card route, and the whole point of the castle is that the session lives
 * where the child is standing.
 *
 * It is a `Companion` rather than an `Overlay`: it has to be mounted before
 * any interaction, so a session left open yesterday resumes with the child's
 * portrait already lit, and Keeper Quill's gestures can follow the rung of
 * the hint ladder they are on.
 */
export const castleTaleViewExtension: LocationViewExtension = {
  id: 'castle-tale',
  claimsInteraction(interaction, { ageBand, config }) {
    const parsed = tryParseCastleTaleConfig(config);
    if (!parsed) return false;
    return (
      castleTaleClaims(interaction.id, parsed, ageBand) || managedCastleNpcFor(interaction) !== null
    );
  },
  Companion: CastleTaleCompanion,
};
