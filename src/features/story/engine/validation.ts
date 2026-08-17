import type { StoryDefinition } from './types';

/**
 * Pure structural validation for authored `StoryDefinition` content
 * (docs/ROADMAP.md Phase 12 "content validation"), same spirit as every
 * Adventure Engine content module's own structural-guard test — but shared
 * here as one reusable function rather than duplicated per story, since a
 * story is a graph of chapters (not just a graph of steps) with its own
 * failure modes: an unreachable chapter, an entry point pointing nowhere, a
 * chapter chain that never terminates, or a `CHOICE`/`ADVENTURE` scene
 * missing what it needs to run. Returns a list of human-readable problems;
 * an empty list means the story is structurally sound. `resolveAdventure`
 * is injected (rather than importing `getAdventureTemplate` directly) so
 * this module stays Phaser/Adventure-Engine-registry-free and independently
 * testable, matching the project's existing "Phaser-free, unit-tested"
 * precedent for engine-layer modules.
 */
export function validateStoryDefinition(
  story: StoryDefinition,
  resolveAdventureTemplateSlug: (templateSlug: string) => boolean,
): string[] {
  const errors: string[] = [];
  const chapterIds = new Set(story.chapters.map((chapter) => chapter.id));

  if (chapterIds.size !== story.chapters.length) {
    errors.push('Chapter ids are not unique.');
  }

  if (!chapterIds.has(story.entryChapterId)) {
    errors.push(`entryChapterId "${story.entryChapterId}" does not match any chapter.`);
  }

  for (const chapter of story.chapters) {
    if (chapter.scenes.length === 0) {
      errors.push(`Chapter "${chapter.id}" has no scenes.`);
    }

    const sceneIds = new Set(chapter.scenes.map((scene) => scene.id));
    if (sceneIds.size !== chapter.scenes.length) {
      errors.push(`Chapter "${chapter.id}" has duplicate scene ids.`);
    }

    if (chapter.nextChapterId && !chapterIds.has(chapter.nextChapterId)) {
      errors.push(
        `Chapter "${chapter.id}" has nextChapterId "${chapter.nextChapterId}", which does not match any chapter.`,
      );
    }

    for (const scene of chapter.scenes) {
      if (scene.kind === 'ADVENTURE' && !resolveAdventureTemplateSlug(scene.templateSlug)) {
        errors.push(
          `Chapter "${chapter.id}" scene "${scene.id}" embeds unknown adventure "${scene.templateSlug}".`,
        );
      }
      if (scene.kind === 'CHOICE') {
        if (scene.options.length < 2) {
          errors.push(`Chapter "${chapter.id}" scene "${scene.id}" needs at least two options.`);
        }
        const optionIds = new Set(scene.options.map((option) => option.id));
        if (optionIds.size !== scene.options.length) {
          errors.push(`Chapter "${chapter.id}" scene "${scene.id}" has duplicate option ids.`);
        }
        if (!scene.flagKey) {
          errors.push(`Chapter "${chapter.id}" scene "${scene.id}" is missing a flagKey.`);
        }
      }
    }
  }

  // Every chapter must be reachable from the entry chapter, and following
  // nextChapterId from the entry must terminate (a chapter with no
  // nextChapterId) without looping.
  const reachable = new Set<string>();
  let currentId: string | undefined = story.entryChapterId;
  const visitedForTermination = new Set<string>();
  let terminates = false;
  while (currentId && chapterIds.has(currentId)) {
    if (visitedForTermination.has(currentId)) break;
    visitedForTermination.add(currentId);
    reachable.add(currentId);
    const chapter = story.chapters.find((candidate) => candidate.id === currentId);
    if (!chapter?.nextChapterId) {
      terminates = true;
      break;
    }
    currentId = chapter.nextChapterId;
  }
  if (!terminates) {
    errors.push('Following nextChapterId from the entry chapter never reaches an ending chapter.');
  }
  for (const chapter of story.chapters) {
    if (!reachable.has(chapter.id)) {
      errors.push(`Chapter "${chapter.id}" is not reachable from entryChapterId.`);
    }
  }

  return errors;
}
