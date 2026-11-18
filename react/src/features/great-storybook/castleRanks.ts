/**
 * Storykeeper Castle rank titles (SC-R07-04, reboot roadmap section 4.4).
 *
 * A title is a **description of the child's own Storybook**, never a score:
 *
 * - computed from the fraction of the child's band page set restored (required pages only; the
 *   hidden bonus page never counts), so a Sprout's two pages and an Explorer's four reach the
 *   same titles at the same share;
 * - never stored, never time-based, never compared between children, never lost: the same
 *   inputs always give the same title, and pages are never un-restored;
 * - content-configured here (names and thresholds), behind `CASTLE_RANKS.enabled`, which is
 *   **off** until the owner decides to keep ranks (roadmap section 7, decision 6). With the flag
 *   off nothing shows a title, and nothing else depends on them.
 *
 * OWNER DECISION (open): the roadmap lists five titles (Story Explorer, Page Finder, Tale Keeper,
 * Story Guardian, Master Storykeeper); the SC-R07 brief and `rewards_prep.md` use the four below.
 * Either list fits this config; only the content changes.
 */

export interface RankTitle {
  id: string;
  /** Child-facing. Readable aloud, no em dash. */
  title: string;
  /** The lowest share of required pages restored (0 to 1) that earns this title. */
  min: number;
}

export interface CastleRanksConfig {
  enabled: boolean;
  ranks: readonly RankTitle[];
}

export const CASTLE_RANKS: CastleRanksConfig = {
  enabled: false,
  ranks: [
    { id: 'story-explorer', title: 'Story Explorer', min: 0 },
    { id: 'page-keeper', title: 'Page Keeper', min: 0.34 },
    { id: 'castle-pathfinder', title: 'Castle Pathfinder', min: 0.67 },
    { id: 'master-storykeeper', title: 'Master Storykeeper', min: 1 },
  ],
};

/** Problems with a rank list, empty when it is usable. Checked by the tests and by `rankFor`. */
export function rankConfigProblems(ranks: readonly RankTitle[]): string[] {
  const problems: string[] = [];
  if (ranks.length === 0) return ['there are no ranks'];
  const sorted = [...ranks].sort((a, b) => a.min - b.min);
  if (new Set(ranks.map((rank) => rank.id)).size !== ranks.length) problems.push('ids repeat');
  if (new Set(ranks.map((rank) => rank.min)).size !== ranks.length) problems.push('thresholds repeat');
  for (const rank of ranks) {
    if (!Number.isFinite(rank.min) || rank.min < 0 || rank.min > 1) {
      problems.push(`${rank.id}: threshold must be between 0 and 1`);
    }
    if (!rank.title.trim() || /[—–]/.test(rank.title)) problems.push(`${rank.id}: bad title`);
  }
  if (sorted[0].min !== 0) problems.push('the first rank must start at 0');
  if (sorted[sorted.length - 1].min !== 1) problems.push('the last rank must be at 1');
  return problems;
}

/**
 * The title for `restoredRequired` of `requiredTotal` required pages: the highest rank whose
 * `min` is at most the share restored. A band with no required pages gets the first title.
 * Input that cannot describe a book (negative, fractional, more restored than exist, not finite)
 * and an unusable rank list both give `null`, which the caller shows as no title at all.
 */
export function rankFor(
  restoredRequired: number,
  requiredTotal: number,
  ranks: readonly RankTitle[] = CASTLE_RANKS.ranks,
): RankTitle | null {
  const counts = [restoredRequired, requiredTotal];
  if (!counts.every((n) => Number.isInteger(n) && n >= 0)) return null;
  if (restoredRequired > requiredTotal) return null;
  if (rankConfigProblems(ranks).length > 0) return null;
  const sorted = [...ranks].sort((a, b) => a.min - b.min);
  if (requiredTotal === 0) return sorted[0];
  const share = restoredRequired / requiredTotal;
  let found = sorted[0];
  for (const rank of sorted) if (rank.min <= share) found = rank;
  return found;
}

/** The title to show, or `null` while ranks are switched off. */
export function shownRank(
  restoredRequired: number,
  requiredTotal: number,
  config: CastleRanksConfig = CASTLE_RANKS,
): RankTitle | null {
  return config.enabled ? rankFor(restoredRequired, requiredTotal, config.ranks) : null;
}
