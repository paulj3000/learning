import * as amplify from './amplify/adventures';
import type { ApiClient } from './client';
import { ApiError } from './errors';
import { read, type Reader } from './parse';
import { createPlayApi } from './play/playApi';
import { selectApi } from './select';
import type { Correctness } from '../features/adventures/engine/types';
import type { StepAnswer } from '../features/adventures/engine/validators';

/**
 * Step adventures: sessions, answers, recorded evidence, world changes and
 * saved stories (LAI-0501B).
 *
 * On Django:
 * - **Answers** go to `POST /children/{id}/sessions/{sessionId}/answers/`
 *   (LAI-0601). The Python engine decides correctness, support level and the
 *   next step; the client sends only what the child did, plus a fresh
 *   `requestId` so a resent request replays instead of counting twice.
 * - **World-change reads** come from `GET /children/{id}/progress/`, which
 *   returns every world change the child has (not a page).
 * - Everything else is `adventures_unavailable`. In particular no Django
 *   route starts or resumes a step-adventure session yet (LAI-0605,
 *   docs/android/ANDROID_API_CONTRACT.md), so the answer route cannot be
 *   reached from a fresh session. Evidence, mastery and world changes are
 *   written by the server as part of an answer, never by the client.
 */

export type { AdventureAction, AdventureSession, StoryArtifact } from './amplify/adventures';
export type { RecordActionInput, RecordSkillEvidenceInput } from './amplify/adventures';

/** One AI-narrated (or authored-fallback) beat of a Storykeeper Castle story. */
export interface StoryScene {
  stepId: string;
  text: string;
  source: 'AI' | 'FALLBACK';
}

export interface AdventureAnswerResult {
  correctness: Correctness;
  supportLevel: number;
  action: 'RETRY' | 'ADVANCE';
  /** Set only when `action` is `'ADVANCE'`. */
  nextStepId: string | null;
}

/** What Django needs besides the answer. Amplify's Lambda reads these from the session. */
export interface AnswerContext {
  childProfileId: string;
  stepId: string;
}

/**
 * A persistent consequence on the island. On Django `id` is
 * `<locationSlug>:<changeKey>`, which Django keeps unique per child
 * (`world_change_once`); it is a stable display key, not a database id.
 */
export interface WorldChange {
  id: string;
  locationSlug: string;
  changeType: string;
  changeKey: string;
  payload?: unknown;
  sourceSessionId?: string | null;
  createdAt: string;
}

export interface AdventuresApi {
  submitAdventureAnswer(
    sessionId: string,
    answer: StepAnswer,
    hintLevel: number,
    context?: AnswerContext,
  ): Promise<AdventureAnswerResult>;
  getActiveSession: typeof amplify.getActiveSession;
  startSession: typeof amplify.startSession;
  advanceSession: typeof amplify.advanceSession;
  completeSession: typeof amplify.completeSession;
  recordAction: typeof amplify.recordAction;
  recordSkillEvidence: typeof amplify.recordSkillEvidence;
  listWorldChanges(childProfileId: string, locationSlug: string): Promise<WorldChange[]>;
  /** Newest first. */
  listAllWorldChanges(childProfileId: string): Promise<WorldChange[]>;
  recordWorldChangeOnce: typeof amplify.recordWorldChangeOnce;
  listSessions: typeof amplify.listSessions;
  listActionsForSessions: typeof amplify.listActionsForSessions;
  saveStoryArtifact: typeof amplify.saveStoryArtifact;
  listStoryArtifacts: typeof amplify.listStoryArtifacts;
  deleteStoryArtifact: typeof amplify.deleteStoryArtifact;
}

const amplifyAdventures: AdventuresApi = {
  submitAdventureAnswer: amplify.submitAdventureAnswer,
  getActiveSession: amplify.getActiveSession,
  startSession: amplify.startSession,
  advanceSession: amplify.advanceSession,
  completeSession: amplify.completeSession,
  recordAction: amplify.recordAction,
  recordSkillEvidence: amplify.recordSkillEvidence,
  listWorldChanges: amplify.listWorldChanges,
  listAllWorldChanges: amplify.listAllWorldChanges,
  recordWorldChangeOnce: amplify.recordWorldChangeOnce,
  listSessions: amplify.listSessions,
  listActionsForSessions: amplify.listActionsForSessions,
  saveStoryArtifact: amplify.saveStoryArtifact,
  listStoryArtifacts: amplify.listStoryArtifacts,
  deleteStoryArtifact: amplify.deleteStoryArtifact,
};

// ---------------------------------------------------------------------------
// Django

const CORRECTNESS: readonly Correctness[] = ['correct', 'incorrect', 'partial', 'not_applicable'];

/** The LAI-0601 answer response; `session` is read by nothing here yet. */
export function parseAnswerResult(r: Reader): AdventureAnswerResult {
  const action = r.field('action').oneOf(['RETRY', 'ADVANCE'] as const);
  return {
    correctness: r.field('correctness').oneOf(CORRECTNESS),
    supportLevel: r.field('supportLevel').integer(),
    action,
    nextStepId: action === 'ADVANCE' ? r.field('nextStepId').nullable((x) => x.string()) : null,
  };
}

function segment(id: string): string {
  if (!id) throw new ApiError('invalid_request', { code: 'empty_id' });
  return encodeURIComponent(id);
}

export function createDjangoAdventures(
  client: ApiClient,
  newRequestId: () => string = () => crypto.randomUUID(),
): Partial<AdventuresApi> {
  async function allWorldChanges(childProfileId: string): Promise<WorldChange[]> {
    const progress = await createPlayApi(client, childProfileId).getProgress();
    return progress.worldChanges.map((change) => ({
      id: `${change.locationSlug}:${change.changeKey}`,
      locationSlug: change.locationSlug,
      changeType: change.changeType,
      changeKey: change.changeKey,
      payload: change.payload,
      createdAt: change.createdAt,
    }));
  }

  return {
    async submitAdventureAnswer(sessionId, answer, _hintLevel, context) {
      // The hint level is the server's (session state), so it is not sent.
      if (!context) throw new ApiError('invalid_request', { code: 'answer_context_missing' });
      const response = await client.request(
        'POST',
        `children/${segment(context.childProfileId)}/sessions/${segment(sessionId)}/answers/`,
        { body: { stepId: context.stepId, answer, requestId: newRequestId() } },
      );
      return read(response.data, parseAnswerResult);
    },

    async listWorldChanges(childProfileId, locationSlug) {
      const changes = await allWorldChanges(childProfileId);
      return changes.filter((change) => change.locationSlug === locationSlug);
    },

    async listAllWorldChanges(childProfileId) {
      const changes = await allWorldChanges(childProfileId);
      return changes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  };
}

export const adventuresApi: AdventuresApi = selectApi<AdventuresApi>('adventures', {
  amplify: amplifyAdventures,
  django: (client) => createDjangoAdventures(client),
});
