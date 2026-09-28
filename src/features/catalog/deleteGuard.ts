/**
 * Why an adventure catalog record may not be deleted, or `null` if it may
 * (docs/ISLAND_ADVENTURE_MANAGEMENT.md section 18, ADR-024).
 *
 * Deleting a catalog row never deletes child history: `AdventureSession`
 * and everything hanging off it are keyed by `templateSlug`, not by the
 * row's id. Deletion is still refused in two cases:
 *
 * - The slug has authored game content. With no row, that adventure would
 *   fall back to "available", so deleting a deactivated adventure would
 *   quietly put it back in front of children.
 * - A child has played it. Their history stays, but the catalog entry is
 *   what explains that history to an admin, so the adventure should be
 *   deactivated instead.
 */
export function deleteBlockReason(input: {
  hasGameContent: boolean;
  sessionCount: number;
}): string | null {
  if (input.hasGameContent) {
    return 'This adventure has playable game content. Deactivate it instead; deleting the record would make it available to children again.';
  }
  if (input.sessionCount > 0) {
    return `Children have played this adventure (${input.sessionCount} ${
      input.sessionCount === 1 ? 'session' : 'sessions'
    }). Deactivate it instead so their history keeps its catalog entry.`;
  }
  return null;
}
