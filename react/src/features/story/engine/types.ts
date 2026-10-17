import type { AgeBandValue } from '../../child-profile/constants';
import type { ChoiceOption, WorldChangePayload } from '../../adventures/engine/types';

/**
 * The Story Engine (docs/ROADMAP.md Phase 12,
 * `docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md` sections
 * 10-11) sits between the World Engine and the Adventure Engine
 * (docs/ARCHITECTURE.md "World engine layering"). A `StoryDefinition` is
 * authored content checked into source control, the same "not a DB model"
 * precedent every other adventure/location content module already uses
 * (docs/DATA_MODEL.md "Content packs are not database models") — resumable
 * per-child progress through it is the separate `ChildStoryProgress` model.
 *
 * A chapter's scenes always run in authored order; there is no branching
 * *within* a chapter beyond the bounded `CHOICE` scene kind below. What the
 * roadmap calls "authored branching" is expressed through `branches` on a
 * `NARRATIVE` scene: which of a few authored lines is shown depends on a
 * `storyFlags` value set earlier in the story (docs/DATA_MODEL.md's example:
 * "dragon revealed as protective, not evil"), never on model output and
 * never on unbounded child text (docs/AI_AND_CHILD_SAFETY.md's child input
 * policy).
 */

export interface StoryFlagCondition {
  flagKey: string;
  equals: string;
}

interface StoryChapterSceneBase {
  id: string;
}

export interface NarrativeStoryScene extends StoryChapterSceneBase {
  kind: 'NARRATIVE';
  speaker: string;
  text: string;
  /** Same meaning as `PresentationSpec`'s `aiNarrated` in the Adventure Engine: Chatty may rephrase `text`, but `text` remains the authored source of truth. */
  aiNarrated?: boolean;
  /** Evaluated top to bottom; the first matching flag wins. Falls back to `text` when none match or no flags are set yet. */
  branches?: Array<{ when: StoryFlagCondition; text: string }>;
}

/** A bounded, curated choice (never free text) that records the child's pick as a story flag rather than grading it. */
export interface ChoiceStoryScene extends StoryChapterSceneBase {
  kind: 'CHOICE';
  prompt: string;
  options: Array<ChoiceOption & { flagValue: string }>;
  flagKey: string;
}

/** Embeds a real Adventure Engine session; only the Adventure Engine ever decides correctness for this scene (CLAUDE.md section 7). */
export interface AdventureStoryScene extends StoryChapterSceneBase {
  kind: 'ADVENTURE';
  templateSlug: string;
}

/** A pause for the child's own reaction, not a graded answer — same shape and intent as the Adventure Engine's REFLECTION step. */
export interface ReflectionStoryScene extends StoryChapterSceneBase {
  kind: 'REFLECTION';
  prompt: string;
  objectiveIds: string[];
}

export type StoryChapterScene =
  NarrativeStoryScene | ChoiceStoryScene | AdventureStoryScene | ReflectionStoryScene;

export interface StoryChapter {
  id: string;
  title: string;
  scenes: StoryChapterScene[];
  /** Absent on the final chapter — reaching the end of its scenes completes the story. */
  nextChapterId?: string;
}

export interface StoryDefinition {
  slug: string;
  title: string;
  description: string;
  supportedAgeBands: AgeBandValue[];
  entryChapterId: string;
  chapters: StoryChapter[];
  /** Recorded once, when the child finishes the final chapter (distinct from any world change an embedded adventure already recorded for itself). */
  completionWorldChange: WorldChangePayload;
}

export function getChapter(story: StoryDefinition, chapterId: string): StoryChapter {
  const chapter = story.chapters.find((candidate) => candidate.id === chapterId);
  if (!chapter) {
    throw new Error(`Story "${story.slug}" has no chapter "${chapterId}".`);
  }
  return chapter;
}

/** Picks the first branch whose flag condition matches `flags`, else the scene's default `text`. */
export function resolveNarrativeText(
  scene: NarrativeStoryScene,
  flags: Record<string, string>,
): string {
  const match = scene.branches?.find((branch) => flags[branch.when.flagKey] === branch.when.equals);
  return match?.text ?? scene.text;
}
