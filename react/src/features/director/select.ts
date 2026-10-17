/**
 * Adventure selection (docs/ROADMAP.md Phase 28: "adventure eligibility
 * rules that favor weaker skills without presenting content to the child as
 * remediation", plus "story-continuity and variety/repetition protection").
 *
 * The scoring is deliberately small and readable rather than clever. A
 * content designer or a parent-facing surface has to be able to follow why
 * one adventure came before another, and an opaque score would make the
 * "explainable selection logs" deliverable unmeetable in practice.
 *
 * Every constant below is an authored product choice, in the same spirit as
 * the mastery thresholds this reads from.
 */
import { isAdventureForAgeBand } from '../adventures/content';
import type { AdventureDefinition } from '../adventures/engine/types';
import type { AgeBandValue } from '../child-profile/constants';
import { needWeightBySkillId } from './needs';
import type { DirectorContext, SelectionReason, SelectionRecord } from './types';

/**
 * Replaying a finished adventure is allowed and sometimes exactly what a
 * child wants, so this is a penalty rather than an exclusion - a completed
 * adventure sinks below fresh ones but stays reachable.
 */
export const COMPLETED_PENALTY = 4;

/**
 * Damps "the same thing again" without hiding it. Only the few most recent
 * sessions count, so an adventure a child played weeks ago is not still
 * being pushed down today.
 */
export const RECENT_PENALTY = 3;
export const RECENT_WINDOW = 3;

/**
 * Finishing a story already begun beats starting a fourth one. Sized to
 * outweigh a single skill of need but not a whole adventure's worth, so
 * continuity guides the order without overriding what a child needs to
 * practise.
 */
export const CONTINUITY_BONUS = 2;

/** Distinct learning objectives an adventure actually practises. */
export function adventureObjectiveIds(definition: AdventureDefinition): string[] {
  return [...new Set(definition.steps.flatMap((step) => step.objectiveIds))];
}

/**
 * Scores one adventure for one child, recording every term that moved the
 * number.
 *
 * The record is the point as much as the score: it is what makes the
 * ranking auditable by an adult, and it is why reasons are structured data
 * rather than a formatted sentence.
 */
export function scoreAdventure(
  definition: AdventureDefinition,
  context: DirectorContext,
  storyIdForAdventure?: (slug: string) => string | undefined,
): SelectionRecord {
  const needs = needWeightBySkillId(context.masterySummaries);
  const reasons: SelectionReason[] = [];
  let score = 0;

  for (const objectiveId of adventureObjectiveIds(definition)) {
    const need = needs.get(objectiveId);
    if (!need) continue;
    score += need.weight;
    reasons.push({
      kind: 'PRACTISES_SKILL',
      skillId: need.skillId,
      status: need.status,
      weight: need.weight,
    });
  }

  if (reasons.length === 0) {
    reasons.push({ kind: 'NO_SKILLS_NEEDED' });
  }

  const storyId = storyIdForAdventure?.(definition.slug);
  if (storyId && context.storiesInProgress.includes(storyId)) {
    score += CONTINUITY_BONUS;
    reasons.push({ kind: 'CONTINUES_STORY', storyId });
  }

  if (context.completedAdventureSlugs.includes(definition.slug)) {
    score -= COMPLETED_PENALTY;
    reasons.push({ kind: 'ALREADY_COMPLETED', penalty: COMPLETED_PENALTY });
  }

  if (context.recentAdventureSlugs.slice(0, RECENT_WINDOW).includes(definition.slug)) {
    score -= RECENT_PENALTY;
    reasons.push({ kind: 'PLAYED_RECENTLY', penalty: RECENT_PENALTY });
  }

  return { adventureSlug: definition.slug, title: definition.title, score, reasons };
}

/**
 * Every adventure this child may play, best first.
 *
 * Age band is the one hard filter, and it is the Adventure Engine's rule
 * rather than one invented here: an adventure authored for another band has
 * the wrong reading volume and step count for this child, whatever their
 * skills say (CLAUDE.md section 3). Everything else is ordering.
 *
 * Ties break on title so the order is stable between sessions.
 */
export function rankAdventures(
  definitions: readonly AdventureDefinition[],
  ageBand: AgeBandValue,
  context: DirectorContext,
  storyIdForAdventure?: (slug: string) => string | undefined,
): SelectionRecord[] {
  return definitions
    .filter((definition) => isAdventureForAgeBand(definition, ageBand))
    .map((definition) => scoreAdventure(definition, context, storyIdForAdventure))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

/**
 * Whether a ranking carries any skill-based signal at all.
 *
 * The seed curriculum authors skills for one age band only
 * (`mathGrade1To2`), so `listSkillsByAgeBand` returns nothing for a Sprout
 * or an Explorer and every adventure scores the same. The ranking is still
 * correct - it is just alphabetical, and personalised by nothing.
 *
 * An adult-facing surface must not present that as a recommendation, so it
 * asks here first. This is a truthfulness guard, not a feature flag: it
 * disappears on its own once the curriculum covers the other bands.
 */
export function hasSkillBasedSignal(records: readonly SelectionRecord[]): boolean {
  return records.some((record) =>
    record.reasons.some((reason) => reason.kind === 'PRACTISES_SKILL'),
  );
}

/** The single adventure to suggest next, or undefined when the band has none. */
export function nextAdventure(
  definitions: readonly AdventureDefinition[],
  ageBand: AgeBandValue,
  context: DirectorContext,
  storyIdForAdventure?: (slug: string) => string | undefined,
): SelectionRecord | undefined {
  return rankAdventures(definitions, ageBand, context, storyIdForAdventure)[0];
}
