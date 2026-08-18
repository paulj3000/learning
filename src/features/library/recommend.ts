import type { AgeBandValue } from '../child-profile/constants';
import { listLibraryArcs, type LibraryArc } from './catalog';
import { toAdventureInterests, type AdventureInterest } from './interests';

/**
 * Which arcs a given child sees, and in what order (docs/ROADMAP.md Phase
 * 15: "gated by age band and child interest rather than gender").
 *
 * Two separate rules, deliberately not blended into one score:
 *
 * - **Age band is a gate.** An arc whose `supportedAgeBands` excludes the
 *   child is never offered to play, because its reading volume, step count,
 *   and session length were authored for a different band (CLAUDE.md
 *   section 3: "Never show content merely because it is available").
 * - **Interest is only an ordering.** A matching tag moves an arc up the
 *   page; a missing tag never removes one. This is the section-4 rule in
 *   code: a child whose profile says "Fantasy" still sees the dinosaur dig,
 *   just lower down. Nothing here reads gender, and `ChildProfile` has no
 *   gender field to read.
 *
 * Ties break on title so the library is stable between visits rather than
 * reshuffling under a child who is still learning to find things by shape
 * and position (docs/UX_AND_ACCESSIBILITY.md).
 */
export interface RecommendedArc extends LibraryArc {
  matchedInterests: AdventureInterest[];
}

export interface LibrarySelection {
  /** Age-appropriate arcs with at least one matching interest tag, best match first. */
  recommended: RecommendedArc[];
  /** Age-appropriate arcs with no matching tag. Still fully playable. */
  moreToExplore: RecommendedArc[];
  /** Arcs authored for another age band. Shown as a calm "later" note, never as a start link. */
  notYetForThisAge: LibraryArc[];
}

export interface LibraryAudience {
  ageBand: AgeBandValue;
  interests: readonly (string | null)[] | null | undefined;
}

function byMatchThenTitle(a: RecommendedArc, b: RecommendedArc): number {
  if (a.matchedInterests.length !== b.matchedInterests.length) {
    return b.matchedInterests.length - a.matchedInterests.length;
  }
  return a.story.title.localeCompare(b.story.title);
}

export function selectLibraryForChild(audience: LibraryAudience): LibrarySelection {
  const childTags = new Set(toAdventureInterests(audience.interests));
  const selection: LibrarySelection = {
    recommended: [],
    moreToExplore: [],
    notYetForThisAge: [],
  };

  for (const arc of listLibraryArcs()) {
    if (!arc.story.supportedAgeBands.includes(audience.ageBand)) {
      selection.notYetForThisAge.push(arc);
      continue;
    }
    const matchedInterests = arc.entry.interests.filter((tag) => childTags.has(tag));
    const recommended: RecommendedArc = { ...arc, matchedInterests };
    if (matchedInterests.length > 0) {
      selection.recommended.push(recommended);
    } else {
      selection.moreToExplore.push(recommended);
    }
  }

  selection.recommended.sort(byMatchThenTitle);
  selection.moreToExplore.sort(byMatchThenTitle);
  selection.notYetForThisAge.sort((a, b) => a.story.title.localeCompare(b.story.title));

  return selection;
}
