import * as amplify from './amplify/adventures';
import type { ApiClient } from './client';
import { ApiError } from './errors';
import { read, type Reader } from './parse';
import { createPlayApi } from './play/playApi';
import { optionalQuestUpdates, type QuestUpdateView } from './questUpdates';
import { parseRewardOutcome, type RewardOutcome } from './rewards';
import { selectApi } from './select';
import {
  AdventureUnavailableError,
  assertAdventureAvailable,
} from '../features/catalog/availabilityApi';
import type { AdventureDefinition, Correctness } from '../features/adventures/engine/types';
import type { StepAnswer } from '../features/adventures/engine/validators';

/**
 * Step adventures: sessions, answers, recorded evidence, world changes and
 * saved stories (LAI-0501B).
 *
 * On Django:
 * - **Sessions** use the LAI-0608 lifecycle routes under
 *   `/children/{id}/adventures/{adventureId}/`: `POST sessions/` starts or
 *   resumes (the server checks availability), `GET sessions/{sessionId}/`
 *   reads, `POST sessions/{sessionId}/complete/` finalises, and
 *   `GET availability/` finds the session to resume. A refusal (not visible,
 *   unavailable, child turned off, content changed) is the same calm
 *   `AdventureUnavailableError` the Amplify catalog gate throws.
 * - **Answers** go to `POST /children/{id}/sessions/{sessionId}/answers/`
 *   (LAI-0601). The Python engine decides correctness, support level and the
 *   next step; the client sends only what the child did, plus a fresh
 *   `requestId` so a resent request replays instead of counting twice.
 * - **World-change reads** come from `GET /children/{id}/progress/`, which
 *   returns every world change the child has (not a page).
 * - Everything else is `adventures_unavailable`: the client-side writes
 *   Amplify needs (`startSession` alone, `advanceSession`, `recordAction`,
 *   evidence, world changes, saved stories) have no Django route, because
 *   the server records the attempt itself inside the answer and owns the
 *   rest (LAI-0603, LAI-0605, LAI-0607). `useAdventureSession` asks
 *   `supports(...)` before making them.
 */

export type { AdventureAction, StoryArtifact } from './amplify/adventures';

export type SessionStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ABANDONED' | 'SAFETY_STOPPED';

/** A step-adventure session as every backend reports it. Amplify's records already fit. */
export interface AdventureSession {
  id: string;
  childProfileId: string;
  templateSlug: string;
  templateVersion: number;
  status: SessionStatus;
  currentStepId: string;
  startedAt: string;
  lastActivityAt: string;
  completedAt?: string | null;
}

/** Which adventure a session belongs to. Django's session routes are nested under it. */
export interface SessionContext {
  childProfileId: string;
  adventureSlug: string;
}
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
  /**
   * What this answer earned, decided by the server (Django, LAI-0604). Undefined on Amplify,
   * where rewards are granted by the client's own engines, not by the answer.
   */
  rewards?: RewardOutcome;
  /** The quests this answer moved, decided by the server (Django, LAI-0605). */
  questUpdates?: QuestUpdateView[];
}

/** A completed session, with the rewards completing it earned (Django, LAI-0604). */
export type CompletedSession = AdventureSession & { rewards?: RewardOutcome };

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
  getActiveSession(childProfileId: string, templateSlug: string): Promise<AdventureSession | null>;
  /** The single start path: availability, then the active session or a new one. */
  resumeOrStartSession(
    childProfileId: string,
    definition: AdventureDefinition,
  ): Promise<AdventureSession>;
  getSession(sessionId: string, context: SessionContext): Promise<AdventureSession | null>;
  startSession: typeof amplify.startSession;
  advanceSession: typeof amplify.advanceSession;
  /** Django needs `context`; Amplify ignores it. Django refuses it before the engine's end. */
  completeSession(sessionId: string, context?: SessionContext): Promise<CompletedSession>;
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

/**
 * Resumes this child's active session for `definition`, or starts a new
 * one, on Amplify. Also where the admin catalog's active flags are enforced
 * for children (docs/ISLAND_ADVENTURE_MANAGEMENT.md section 17): a
 * deactivated adventure throws `AdventureUnavailableError` instead of
 * starting or resuming, and an existing session is left untouched.
 */
async function amplifyResumeOrStartSession(
  childProfileId: string,
  definition: AdventureDefinition,
): Promise<AdventureSession> {
  await assertAdventureAvailable(definition);
  const existing = await amplify.getActiveSession(childProfileId, definition.slug);
  return (
    existing ??
    (await amplify.startSession(
      childProfileId,
      definition.slug,
      definition.version,
      definition.entryStepId,
    ))
  );
}

const amplifyAdventures: AdventuresApi = {
  submitAdventureAnswer: amplify.submitAdventureAnswer,
  getActiveSession: amplify.getActiveSession,
  resumeOrStartSession: amplifyResumeOrStartSession,
  getSession: amplify.getSession,
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

/** An optional additive `rewards` field: parsed when the server sends it. */
function optionalRewards(r: Reader): RewardOutcome | undefined {
  const field = r.field('rewards');
  return field.value === undefined ? undefined : parseRewardOutcome(field);
}

/** The LAI-0601 answer response; `session` is read by nothing here yet. */
export function parseAnswerResult(r: Reader): AdventureAnswerResult {
  const action = r.field('action').oneOf(['RETRY', 'ADVANCE'] as const);
  const rewards = optionalRewards(r);
  const questUpdates = optionalQuestUpdates(r);
  return {
    correctness: r.field('correctness').oneOf(CORRECTNESS),
    supportLevel: r.field('supportLevel').integer(),
    action,
    nextStepId: action === 'ADVANCE' ? r.field('nextStepId').nullable((x) => x.string()) : null,
    ...(rewards ? { rewards } : {}),
    ...(questUpdates ? { questUpdates } : {}),
  };
}

const SESSION_STATUSES: readonly SessionStatus[] = [
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'ABANDONED',
  'SAFETY_STOPPED',
];

/** The `session` object every LAI-0601/LAI-0608 route returns. */
export function parseSessionState(r: Reader): AdventureSession {
  return {
    id: r.field('id').string(),
    childProfileId: r.field('childId').string(),
    templateSlug: r.field('adventureSlug').string(),
    templateVersion: r.field('templateVersion').integer(),
    status: r.field('status').oneOf(SESSION_STATUSES),
    currentStepId: r.field('currentStepId').string(),
    startedAt: r.field('startedAt').string(),
    lastActivityAt: r.field('lastActivityAt').string(),
    completedAt: r.field('completedAt').nullable((x) => x.string()),
  };
}

/** The LAI-0608 lifecycle body: its `session`. The step view is for clients without content. */
function parseSessionView(r: Reader): AdventureSession {
  return parseSessionState(r.field('session'));
}

/** Codes that mean "this adventure cannot be played now", shown with the calm catalog message. */
const UNAVAILABLE_CODES = new Set([
  'adventure_unavailable',
  'child_inactive',
  'content_version_changed',
  'not_found',
]);

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

  const adventurePath = (childProfileId: string, slug: string) =>
    `children/${segment(childProfileId)}/adventures/${segment(slug)}/`;

  async function readSession(sessionId: string, context: SessionContext) {
    try {
      const response = await client.request(
        'GET',
        `${adventurePath(context.childProfileId, context.adventureSlug)}sessions/${segment(sessionId)}/`,
      );
      return read(response.data, parseSessionView);
    } catch (error) {
      if (error instanceof ApiError && error.kind === 'not_found') return null;
      throw error;
    }
  }

  return {
    async resumeOrStartSession(childProfileId, definition) {
      try {
        const response = await client.request(
          'POST',
          `${adventurePath(childProfileId, definition.slug)}sessions/`,
        );
        return read(response.data, parseSessionView);
      } catch (error) {
        if (error instanceof ApiError && UNAVAILABLE_CODES.has(error.code)) {
          throw new AdventureUnavailableError();
        }
        throw error;
      }
    },

    async getActiveSession(childProfileId, templateSlug) {
      let resumeSessionId: string | null;
      try {
        const response = await client.request(
          'GET',
          `${adventurePath(childProfileId, templateSlug)}availability/`,
        );
        resumeSessionId = read(response.data, (r) =>
          r.field('resumeSessionId').nullable((x) => x.string()),
        );
      } catch (error) {
        // Not visible to this child: they have no session they could resume.
        if (error instanceof ApiError && error.kind === 'not_found') return null;
        throw error;
      }
      if (!resumeSessionId) return null;
      return readSession(resumeSessionId, { childProfileId, adventureSlug: templateSlug });
    },

    getSession: (sessionId, context) => readSession(sessionId, context),

    async completeSession(sessionId, context) {
      if (!context) throw new ApiError('invalid_request', { code: 'session_context_missing' });
      const response = await client.request(
        'POST',
        `${adventurePath(context.childProfileId, context.adventureSlug)}sessions/${segment(sessionId)}/complete/`,
      );
      return read(response.data, (r) => {
        const rewards = optionalRewards(r);
        return { ...parseSessionView(r), ...(rewards ? { rewards } : {}) };
      });
    },

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
