import { getChapter } from './engine/types';
import type { StoryDefinition } from './engine/types';
import type { ChildStoryProgress } from './api';

/**
 * Deterministic, non-AI recap (docs/ROADMAP.md Phase 12 "story recap"),
 * same "no model call, cannot claim anything the records don't already
 * show" precedent as `buildWeeklySummary` in
 * src/features/parent-dashboard/weeklySummary.ts. Built entirely from
 * `ChildStoryProgress`'s own stored chapter ids — matches
 * docs/DATA_MODEL.md's note that Chatty may summarize prior chapters "only
 * from these stored, authored flags and IDs, never from a persisted
 * free-form transcript."
 */
export function buildStoryRecap(story: StoryDefinition, progress: ChildStoryProgress): string[] {
  const completedChapterIds = (progress.completedChapterIds ?? []).filter(
    (id): id is string => typeof id === 'string',
  );

  if (completedChapterIds.length === 0) {
    return [`You are just beginning "${story.title}".`];
  }

  const completedTitles = completedChapterIds.map((id) => getChapter(story, id).title);
  const lines = [
    `So far in "${story.title}", you have finished: ${completedTitles.join(', then ')}.`,
  ];

  if (progress.completedAt) {
    lines.push('You finished the whole story!');
  } else {
    const currentChapter = getChapter(story, progress.currentChapterId);
    lines.push(`Next up: ${currentChapter.title}.`);
  }

  return lines;
}
