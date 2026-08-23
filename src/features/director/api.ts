/**
 * Persistence-facing half of the Director (docs/ROADMAP.md Phase 28).
 *
 * The only impure module here. It assembles a `DirectorContext` from engines
 * that already own their data, through their own public APIs - the same
 * discipline `src/features/quests/api.ts` follows - and makes no decision of
 * its own, so every ranking rule stays unit-testable without a backend.
 *
 * It reads the Mastery Engine through `buildMasterySummary`, never
 * `buildMasteryDetail`: the Director is one of the two consumers Phase 20
 * wrote that split for.
 */
import { listSessions } from '../adventures/api';
import { ADVENTURE_TEMPLATES } from '../adventures/content';
import type { AgeBandValue } from '../child-profile/constants';
import { listSkillsByAgeBand } from '../curriculum/queries';
import { listSkillProgress } from '../mastery/api';
import { buildMasterySummary, indexProgressBySkill } from '../mastery/summary';
import { listStoryProgress } from '../story/api';
import { nextAdventure, rankAdventures } from './select';
import type { DirectorContext, SelectionRecord } from './types';

/**
 * Assembles what the Director may see about one child.
 *
 * Scoped to the skills authored for this child's own age band rather than
 * the whole curriculum: a Sprout has no need for an Explorer skill, and
 * summarizing every skill in the graph would put statuses in the context
 * that nothing could act on.
 */
export async function buildDirectorContext(
  childProfileId: string,
  ageBand: AgeBandValue,
): Promise<DirectorContext> {
  const [sessions, progressRows, storyProgress] = await Promise.all([
    listSessions(childProfileId),
    listSkillProgress(childProfileId),
    listStoryProgress(childProfileId).catch(() => []),
  ]);

  const skillIds = listSkillsByAgeBand(ageBand).map((skill) => skill.id);
  const masterySummaries = buildMasterySummary(skillIds, indexProgressBySkill(progressRows));

  return {
    masterySummaries,
    completedAdventureSlugs: sessions
      .filter((session) => session.status === 'COMPLETED')
      .map((session) => session.templateSlug),
    // `listSessions` already sorts newest first.
    recentAdventureSlugs: sessions.map((session) => session.templateSlug),
    storiesInProgress: storyProgress
      .filter((progress) => !progress.completedAt)
      .map((progress) => progress.storyId),
  };
}

export interface DirectorSuggestion {
  /** Best first. Adult-facing reasoning travels with each record. */
  ranking: SelectionRecord[];
  /** The one to lead with, or undefined when this band has no adventure at all. */
  next: SelectionRecord | undefined;
}

/**
 * What this child could do next, ranked. Never throws: a Director failure
 * must degrade to "no suggestion" rather than break a child's screen, since
 * every surface it feeds already works without it.
 */
export async function suggestNextAdventure(
  childProfileId: string,
  ageBand: AgeBandValue,
  storyIdForAdventure?: (slug: string) => string | undefined,
): Promise<DirectorSuggestion> {
  try {
    const context = await buildDirectorContext(childProfileId, ageBand);
    return {
      ranking: rankAdventures(ADVENTURE_TEMPLATES, ageBand, context, storyIdForAdventure),
      next: nextAdventure(ADVENTURE_TEMPLATES, ageBand, context, storyIdForAdventure),
    };
  } catch {
    return { ranking: [], next: undefined };
  }
}
