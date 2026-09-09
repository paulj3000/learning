import type { AdventureDefinition } from '../adventures/engine/types';
import { hasEvidence, MAX_DERIVED_LEVEL } from '../learning-profile/profile';
import type { DomainProfile, SkillLevel } from '../learning-profile/types';

/**
 * Adaptive difficulty selection (`docs/regions/clockwork.md` section 8,
 * "Phase 2 - Adaptive Challenge Engine"), and *only* selection.
 *
 * ## Why this module is small
 *
 * An earlier version of this layer carried its own challenge model, solution
 * shapes, answer grading, and hint ladder. All four of those already existed
 * in the Adventure Engine and had since Phase 3: `PresentationSpec` covers
 * number/choice/ordering/matching prompts and their correct answers,
 * `validateStepAnswer` grades them, `HintPolicy` plus `getHintText` runs the
 * hint ladder, `getNextStepId` handles what happens on a wrong answer, and
 * `FallbackPresentation` guarantees authored copy when nothing else can be
 * shown. Running a second implementation of all that would have meant two
 * places deciding whether a child was right, which is precisely the
 * duplication CLAUDE.md section 13 and the roadmap's own section 32 warn
 * against - and it would have drifted the moment either side was touched.
 *
 * So grading, hints, transitions and fallbacks belong to the Adventure
 * Engine, and this module answers the one question that engine genuinely
 * cannot: **which authored variant should this particular child be given?**
 * The Adventure Engine selects by `ageBands`. Section 2.2 of the roadmap
 * wants difficulty to follow demonstrated skill instead, and that is what
 * lives here.
 *
 * Shared island infrastructure per section 32, not Clockwork Harbor's
 * property - hence `src/features/adaptive/` rather than a folder under the
 * region.
 */

/**
 * The difficulty level a child should be served in one domain.
 *
 * Section 8's rules, in order of how load-bearing they are:
 *
 * 1. **"Failure should NOT immediately reduce skill level."** This reads only
 *    a `DomainProfile`, which is derived from cumulative evidence
 *    (`computeLearningProfile`); a single wrong answer moves the child's
 *    successes not at all and their attempts by one, so it cannot pull the
 *    level down a rung. Relief for a struggling child comes from the
 *    Adventure Engine's own hint ladder and `incorrect` transitions, which are
 *    scoped to the step in front of them and forgotten afterward, rather than
 *    from a demotion that would follow them around.
 * 2. **"Repeated success can increase difficulty."** A domain that is both
 *    settled (`confidence`) and going well gets stretched one rung.
 * 3. **An unevidenced domain is not scaled.** A domain the island has never
 *    assessed reports level 1 with zero confidence, which is an absence of
 *    data rather than a low score; treating it either way would be inventing
 *    an assessment that never happened.
 */
export function selectDifficultyLevel(profile: DomainProfile): SkillLevel {
  if (!hasEvidence(profile)) return 1;

  const successRatio = profile.successes / profile.attempts;
  const readyToStretch = profile.confidence >= 0.7 && successRatio >= 0.8;
  if (!readyToStretch) return profile.level;

  return Math.min(profile.level + 1, MAX_DERIVED_LEVEL) as SkillLevel;
}

/**
 * Picks the authored adventure variant closest to `level`, preferring the
 * easier one on a tie.
 *
 * Preferring easier is deliberate: between two equally distant variants, the
 * one that lets a child succeed and carry on is a better failure mode than the
 * one that stalls them, and section 2.1 wants the harbor to feel like an
 * adventure rather than an assessment.
 *
 * Variants with no `skillLevel` authored are ignored rather than treated as
 * level 1 - every adventure written before Clockwork Harbor is unlevelled, and
 * silently ranking those as "easiest" would have this function hand back a
 * Wonderwild Forest bee adventure as the gentlest lighthouse puzzle. Returns
 * `undefined` when nothing in `candidates` is levelled, which is the caller's
 * cue to fall back to `resolveAdventureForAgeBand`.
 */
export function resolveAdventureForSkillLevel(
  candidates: readonly AdventureDefinition[],
  level: SkillLevel,
): AdventureDefinition | undefined {
  const levelled = candidates.filter((candidate) => candidate.skillLevel !== undefined);
  if (levelled.length === 0) return undefined;

  return [...levelled].sort((a, b) => {
    const distance = Math.abs(a.skillLevel! - level) - Math.abs(b.skillLevel! - level);
    return distance !== 0 ? distance : a.skillLevel! - b.skillLevel!;
  })[0];
}
