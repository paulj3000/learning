import type { AgeBandValue } from '../child-profile/constants';
import type { AdventureDefinition, AdventureStep, ChoiceOption } from '../adventures/engine/types';
import {
  EXPLORER_MAX_CHARACTERS,
  EXPLORER_MIN_CHARACTERS,
  PATHFINDER_MAX_TILES,
  PATHFINDER_MIN_SENTENCES,
  WRITING_ROOM_LOCATION_SLUG,
} from '../adventures/content/writingRoomStories';
import { getAdventureTemplatesForLocation, isAdventureForAgeBand } from '../adventures/content';
import type { WrittenStoryPart } from '../adventures/api';

/**
 * The write-your-story activity's pure rules (SC-final-B). No React, no network: the component
 * renders what these functions decide, and the server re-checks all of it
 * (`lai/apps/education/written_story.py`), so nothing here is a safety boundary on its own.
 *
 * Bands, from CLAUDE.md section 3: Sprouts tap a picture, a character and a word; Pathfinders
 * build two or three sentences from word tiles; Explorers pick a story starter and type a short
 * paragraph.
 */

/** A sentence a Pathfinder may leave out: finishing after two is always allowed. */
export const OPTIONAL_SENTENCE_STEP_ID = 'sentence-3';
/** The one step that takes typed text. */
export const TEXT_STEP_ID = 'write-the-story';
export const MIN_TILES_PER_SENTENCE = 2;

export { EXPLORER_MAX_CHARACTERS, EXPLORER_MIN_CHARACTERS, PATHFINDER_MAX_TILES };

/** The story template for this child's own band, or undefined (never another band's). */
export function writingStoryFor(ageBand: AgeBandValue): AdventureDefinition | undefined {
  return getAdventureTemplatesForLocation(WRITING_ROOM_LOCATION_SLUG).find((template) =>
    isAdventureForAgeBand(template, ageBand),
  );
}

export interface ChoiceStepModel {
  id: string;
  prompt: string;
  options: readonly ChoiceOption[];
  hints: readonly string[];
}

/** The steps a child answers by choosing, in the adventure's order. */
export function choiceSteps(story: AdventureDefinition): ChoiceStepModel[] {
  return story.steps.flatMap((step: AdventureStep) =>
    step.presentation.kind === 'creative-choice'
      ? [
          {
            id: step.id,
            prompt: step.presentation.prompt,
            options: step.presentation.options,
            hints: step.hintPolicy?.ladder ?? [],
          },
        ]
      : [],
  );
}

/** The typed step's prompt and hints (Explorers). */
export function textStep(story: AdventureDefinition): ChoiceStepModel | undefined {
  const step = story.steps.find((candidate) => candidate.id === TEXT_STEP_ID);
  if (!step || step.presentation.kind !== 'reflection') return undefined;
  return {
    id: step.id,
    prompt: step.presentation.prompt,
    options: [],
    hints: step.hintPolicy?.ladder ?? [],
  };
}

/** Quill's welcome line for the intro. */
export function welcomeLine(story: AdventureDefinition): string {
  const step = story.steps.find((candidate) => candidate.id === story.entryStepId);
  return step?.presentation.kind === 'narrative' ? step.presentation.text : '';
}

/** The same sentence the server will store: capitalised, with a full stop. Preview only. */
export function sentencePreview(labels: readonly string[]): string {
  const joined = labels.join(' ').replace(/\s+/g, ' ').trim();
  if (!joined) return '';
  const capital = joined.charAt(0).toUpperCase() + joined.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

export type ParagraphProblem = 'too-short' | 'too-long';

/** Whether a typed paragraph is within bounds. Says nothing about safety: the server decides that. */
export function paragraphProblem(text: string): ParagraphProblem | null {
  const length = text.replace(/\s+/g, ' ').trim().length;
  if (length < EXPLORER_MIN_CHARACTERS) return 'too-short';
  if (length > EXPLORER_MAX_CHARACTERS) return 'too-long';
  return null;
}

/** Whether the tiles chosen make a sentence a Pathfinder may keep. */
export function sentenceIsComplete(tileIds: readonly string[]): boolean {
  return tileIds.length >= MIN_TILES_PER_SENTENCE && tileIds.length <= PATHFINDER_MAX_TILES;
}

/** Whether enough sentences are built to finish. */
export function canFinishSentences(sentencesBuilt: number): boolean {
  return sentencesBuilt >= PATHFINDER_MIN_SENTENCES;
}

/** The save request for each band, from what the child chose or wrote. */
export function partsFor(
  ageBand: AgeBandValue,
  picks: Readonly<Record<string, readonly string[]>>,
  paragraph: string,
): WrittenStoryPart[] {
  const parts: WrittenStoryPart[] = Object.entries(picks)
    .filter(([, optionIds]) => optionIds.length > 0)
    .map(([stepId, optionIds]) => ({ stepId, optionIds }));
  if (ageBand === 'EXPLORER') parts.push({ stepId: TEXT_STEP_ID, text: paragraph });
  return parts;
}

/** A calm picture mark for a Sprout's option, decorative only (the label is the accessible name). */
export const OPTION_MARKS: Readonly<Record<string, string>> = {
  'picture-forest': '🌲',
  'picture-sea': '🌊',
  'picture-garden': '🌷',
  'character-fox': '🦊',
  'character-puppy': '🐶',
  'character-dragon': '🐉',
  'word-brave': '💪',
  'word-kind': '💛',
  'word-happy': '😊',
};
