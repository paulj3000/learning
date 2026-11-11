import type { ChildHome, HomeRegion } from '../../api/play/homeApi';

/**
 * Which adventure the child homepage features (AP-02). Pure, so the rule is tested on its own:
 *
 * 1. An adventure the child left open: pick it up exactly where they were.
 * 2. Otherwise the place they played last, if it can still be played.
 * 3. Otherwise a suggested next place the server picked (playable, chests left to open).
 * 4. Otherwise nothing: the page invites the child to choose a place instead.
 */
export type FeaturedAdventure =
  | { kind: 'RESUME'; region: HomeRegion }
  | { kind: 'RETURN'; region: HomeRegion }
  | { kind: 'START'; region: HomeRegion };

export function pickFeatured(home: ChildHome): FeaturedAdventure | null {
  const open = home.resume.find((region) => region.available);
  if (open) return { kind: 'RESUME', region: open };
  if (home.lastRegion?.available) return { kind: 'RETURN', region: home.lastRegion };
  const next = home.nextRegions.find((region) => region.available);
  return next ? { kind: 'START', region: next } : null;
}

/** Child-facing words for each kind. Readable aloud; no em dashes (CLAUDE.md section 13). */
export const FEATURED_COPY = {
  RESUME: { heading: 'Continue your adventure', action: 'Keep going' },
  RETURN: { heading: 'Go back to your last adventure', action: 'Go back' },
  START: { heading: 'Start a new adventure', action: "Let's go" },
} as const;
