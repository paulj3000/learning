import { ADVENTURE_TEMPLATES } from '../adventures/content';
import type { AdventureDefinition } from '../adventures/engine/types';
import { STORY_DEFINITIONS } from '../story/content';
import { STORYBOOK_PAGES, type StorybookPage } from './pages';

/**
 * Which authored content produces each Great Storybook page (SC-R04-04).
 *
 * This adds no mapping table. A page already names the record it needs (`pages.ts`), and the
 * authored adventures and stories already name the records they write; this reads both and
 * *joins them*, so the connection cannot be typed twice or drift. It is used by tests and
 * tooling to prove every page has a real producer for its band, never by gameplay: completion
 * is still decided by the Adventure Engine and its server, and a page is back only when its
 * record exists.
 */
export interface PageProducer {
  kind: 'ADVENTURE' | 'STORY' | 'DISCOVERY';
  /** Adventure slug, story slug, or discovery id. */
  id: string;
  /** The step that writes the record (adventures only). */
  stepId?: string;
}

function worldChangeSteps(adventure: AdventureDefinition) {
  return adventure.steps.flatMap((step) =>
    step.presentation.kind === 'world-change'
      ? [{ stepId: step.id, payload: step.presentation.payload }]
      : [],
  );
}

/** Content that writes this page's record for at least one of the page's bands. Empty means a broken reference. */
export function producersOf(
  page: StorybookPage,
  adventures: readonly AdventureDefinition[] = ADVENTURE_TEMPLATES,
): PageProducer[] {
  if (page.source.kind === 'DISCOVERY') {
    return [{ kind: 'DISCOVERY', id: page.source.discoveryId }];
  }
  const { changeKey, locationSlug } = page.source;
  const found: PageProducer[] = [];
  for (const adventure of adventures) {
    if (!adventure.ageBands.some((band) => page.bands.includes(band))) continue;
    for (const step of worldChangeSteps(adventure)) {
      if (step.payload.changeKey === changeKey && step.payload.locationSlug === locationSlug) {
        found.push({ kind: 'ADVENTURE', id: adventure.slug, stepId: step.stepId });
      }
    }
  }
  for (const story of STORY_DEFINITIONS) {
    if (
      story.completionWorldChange.changeKey === changeKey &&
      story.completionWorldChange.locationSlug === locationSlug &&
      story.supportedAgeBands.some((band) => page.bands.includes(band))
    ) {
      found.push({ kind: 'STORY', id: story.slug });
    }
  }
  return found;
}

/** Every band of a page has a producer, or the page is a dead end for that band. */
export function bandsWithoutProducer(page: StorybookPage): string[] {
  return page.bands.filter((band) =>
    page.source.kind === 'DISCOVERY' ? false : producersOf({ ...page, bands: [band] }).length === 0,
  );
}

/**
 * Whether a step is reachable from the adventure's entry **without answering anything**: through
 * narrative, reflection, world-change steps only. A record written on such a path would be awarded
 * for merely opening the adventure, which is exactly what must never happen.
 */
export function reachableWithoutAnswering(adventure: AdventureDefinition, stepId: string): boolean {
  const byId = new Map(adventure.steps.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const queue = [adventure.entryStepId];
  while (queue.length > 0) {
    const id = queue.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    if (id === stepId) return true;
    const step = byId.get(id);
    if (!step) continue;
    const passive = ['NARRATIVE', 'REFLECTION', 'WORLD_CHANGE'].includes(step.type);
    if (!passive) continue;
    for (const t of step.transitions) queue.push(t.nextStepId);
  }
  return false;
}

export { STORYBOOK_PAGES };
