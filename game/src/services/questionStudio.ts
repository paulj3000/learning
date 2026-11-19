/**
 * Question Studio port. The engine fetches **presentation data only** for a published
 * question item and forwards the child's choice; Django grades. The port has no field that
 * could carry a correct answer, and `submitAnswer` returns a server verdict the engine never
 * interprets: it hands the verdict to the host, which shows the approved response.
 *
 * Grading, support level, mastery and rewards stay server-side (scoring standard).
 */

import type { LearningRef } from '../contracts/gameplayEvents';
import { defineService } from '../core/services';
import type { AgeBand } from '../sdk/profiles';

export interface QuestionChoicePresentation {
  /** The authored option id: what is submitted, never typed text. */
  choiceId: string;
  labelRef: string;
  imageAssetId?: string;
}

export interface QuestionPresentation {
  questionId: string;
  ageBand: AgeBand;
  promptRef: string;
  audioCueId?: string;
  choices: readonly QuestionChoicePresentation[];
}

/** An opaque server verdict. The engine never reads it; it only passes it to the host. */
export interface ServerVerdict {
  readonly verdict: unknown;
}

export interface QuestionStudioPort {
  /** A published item for the band, or null when none is published. */
  fetchQuestion(questionId: string, ageBand: AgeBand): Promise<QuestionPresentation | null>;
  /** Sends the choice to Django and resolves with its verdict. */
  submitAnswer(learningRef: LearningRef, choiceId: string): Promise<ServerVerdict>;
}

export const QUESTION_STUDIO = defineService<QuestionStudioPort>('lai.questionStudio');

export interface FakeQuestionStudio extends QuestionStudioPort {
  readonly submissions: { learningRef: LearningRef; choiceId: string }[];
}

export function createFakeQuestionStudio(
  questions: readonly QuestionPresentation[] = [],
  verdict: unknown = { received: true },
): FakeQuestionStudio {
  const submissions: FakeQuestionStudio['submissions'] = [];
  return {
    submissions,
    async fetchQuestion(questionId, ageBand) {
      return questions.find((q) => q.questionId === questionId && q.ageBand === ageBand) ?? null;
    },
    async submitAnswer(learningRef, choiceId) {
      submissions.push({ learningRef, choiceId });
      return { verdict };
    },
  };
}
