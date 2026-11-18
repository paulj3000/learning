import { WRITING_ROOM_STORIES } from '../adventures/content/writingRoomStories';

/**
 * The Writing Room's authored narration (SC-final-B), as `SpeechLine` ids in Django. Staff-written
 * lines only: Quill's welcome and each step's prompt. Nothing a child wrote is ever spoken or sent
 * for speech, and no AI-made utterance is spoken here.
 *
 * `manage.py seed_castle_speech_lines` creates the rows from `lai/apps/speech/writing_room_speech.json`,
 * and a Vitest test (`writingRoomSpeech.test.ts`) holds that file equal to the lines built here, so
 * the text the server speaks is exactly the caption the game already shows. A voice that fails or
 * is switched off leaves those same words on screen.
 */
export const writingRoomLineId = (storySlug: string, stepId: string): string =>
  `${storySlug}-${stepId}`;

export interface WritingRoomSpeechLine {
  id: string;
  text: string;
}

/** Every narrated line: the narrative welcome and the prompt of each choice or writing step. */
export function writingRoomSpeechLines(): WritingRoomSpeechLine[] {
  return WRITING_ROOM_STORIES.flatMap((story) =>
    story.steps.flatMap((step): WritingRoomSpeechLine[] => {
      const { presentation } = step;
      if (presentation.kind === 'narrative') {
        return [{ id: writingRoomLineId(story.slug, step.id), text: presentation.text }];
      }
      if (presentation.kind === 'creative-choice' || presentation.kind === 'reflection') {
        return [{ id: writingRoomLineId(story.slug, step.id), text: presentation.prompt }];
      }
      return [];
    }),
  );
}
