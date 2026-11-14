import { getAccessToken } from '../auth';
import { createApiClient, type ApiClient } from '../client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../config';
import { ApiError } from '../errors';
import { read, type JsonObject, type Reader } from '../parse';
import type { StepAnswer } from '../../features/adventures/engine/validators';

/**
 * The Django-backed step adventure runner's routes (LAI-0816, docs/PLAY_API.md). Django grades,
 * records skill evidence, applies consequences and grants the reward; this file only sends what
 * the child did (an answer and a request id, or a hint request) and reads what came back.
 *
 * A step arrives without its answer, its hints or its transitions, by contract, so nothing
 * here can reveal or decide an outcome.
 */

export type ServedPresentation = JsonObject & { kind: string };

export interface ServedStep {
  id: string;
  type: string;
  objectiveIds: string[];
  presentation: ServedPresentation;
  /** Whether the hint button has anything behind it. */
  hasHints: boolean;
}

export interface RevisionRef {
  id: string;
  number: number;
}

export interface StepRunnerSession {
  id: string;
  adventureSlug: string;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ABANDONED' | 'SAFETY_STOPPED';
  currentStepId: string;
  hintLevel: number;
}

export interface StepRunnerView {
  session: StepRunnerSession;
  /** The current step, or the closing step of a finished session, or null. */
  step: ServedStep | null;
  stepRevision: RevisionRef | null;
  adventureRevision: RevisionRef | null;
  doneStepIds: string[];
  hintLevel: number;
  /** True only on the response that created the session. */
  created: boolean;
}

export interface CompletionRewardView {
  ruleId: string;
  message: string;
  granted: boolean;
  newItemIds: string[];
}

export interface CompletionView {
  rewards: CompletionRewardView[];
  questsCompleted: string[];
}

export interface AnswerVerdict {
  correctness: 'CORRECT' | 'INCORRECT' | 'PARTIAL' | 'NOT_APPLICABLE';
  supportLevel: number;
  action: 'RETRY' | 'ADVANCE';
  nextStepId: string | null;
  replayed: boolean;
  session: StepRunnerSession;
  worldChangeKeys: string[];
  completion: CompletionView | null;
}

export interface HintView {
  hintLevel: number;
  hintText: string | null;
}

export interface StepRunnerApi {
  /** Start the published adventure, or resume the child's open session for it. */
  start(adventureSlug: string, signal?: AbortSignal): Promise<StepRunnerView>;
  /** Reload the current step (resume after a disconnection). */
  getStep(sessionId: string, signal?: AbortSignal): Promise<StepRunnerView>;
  submitAnswer(
    sessionId: string,
    stepId: string,
    answer: StepAnswer,
    requestId: string,
    signal?: AbortSignal,
  ): Promise<AnswerVerdict>;
  requestHint(
    sessionId: string,
    stepId: string,
    fromLevel: number,
    signal?: AbortSignal,
  ): Promise<HintView>;
}

const STATUSES = ['ACTIVE', 'PAUSED', 'COMPLETED', 'ABANDONED', 'SAFETY_STOPPED'] as const;
const CORRECTNESS = ['CORRECT', 'INCORRECT', 'PARTIAL', 'NOT_APPLICABLE'] as const;

function revision(r: Reader): RevisionRef {
  return { id: r.field('id').string(), number: r.field('number').integer() };
}

function session(r: Reader): StepRunnerSession {
  return {
    id: r.field('id').string(),
    adventureSlug: r.field('adventureSlug').string(),
    status: r.field('status').oneOf(STATUSES),
    currentStepId: r.field('currentStepId').string(),
    hintLevel: r.field('hintLevel').integer(),
  };
}

function step(r: Reader): ServedStep {
  const presentation = r.field('presentation').object();
  if (typeof presentation.kind !== 'string') {
    throw new ApiError('invalid_response', { code: `expected kind at ${r.path}.presentation` });
  }
  return {
    id: r.field('id').string(),
    type: r.field('type').string(),
    objectiveIds: r.field('objectiveIds').array((o) => o.string()),
    presentation: presentation as ServedPresentation,
    hasHints: r.field('hasHints').boolean(),
  };
}

export function parseStepView(r: Reader): StepRunnerView {
  const created = r.field('created');
  return {
    session: session(r.field('session')),
    step: r.field('step').nullable(step),
    stepRevision: r.field('stepRevision').nullable(revision),
    adventureRevision: r.field('adventureRevision').nullable(revision),
    doneStepIds: r.field('doneStepIds').array((s) => s.string()),
    hintLevel: r.field('hintLevel').integer(),
    created: created.value === undefined ? false : created.boolean(),
  };
}

function completion(r: Reader): CompletionView {
  return {
    rewards: r.field('rewards').array((x) => ({
      ruleId: x.field('ruleId').string(),
      message: x.field('message').string(),
      granted: x.field('granted').boolean(),
      newItemIds: x.field('newItemIds').array((i) => i.string()),
    })),
    questsCompleted: r.field('questsCompleted').array((q) => q.string()),
  };
}

export function parseVerdict(r: Reader): AnswerVerdict {
  return {
    correctness: r.field('correctness').oneOf(CORRECTNESS),
    supportLevel: r.field('supportLevel').integer(),
    action: r.field('action').oneOf(['RETRY', 'ADVANCE'] as const),
    nextStepId: r.field('nextStepId').nullable((n) => n.string()),
    replayed: r.field('replayed').boolean(),
    session: session(r.field('session')),
    worldChangeKeys: r.field('worldChangeKeys').array((k) => k.string()),
    completion: r.field('completion').nullable(completion),
  };
}

function segment(id: string): string {
  if (!id) throw new ApiError('invalid_request', { code: 'empty_id' });
  return encodeURIComponent(id);
}

export function createStepRunnerApi(client: ApiClient, childId: string): StepRunnerApi {
  const child = `children/${segment(childId)}/`;
  return {
    async start(adventureSlug, signal) {
      const response = await client.request(
        'POST',
        `${child}content/adventures/${segment(adventureSlug)}/start/`,
        { body: {}, signal },
      );
      return read(response.data, parseStepView);
    },
    async getStep(sessionId, signal) {
      const response = await client.request('GET', `${child}sessions/${segment(sessionId)}/step/`, {
        signal,
      });
      return read(response.data, parseStepView);
    },
    async submitAnswer(sessionId, stepId, answer, requestId, signal) {
      const response = await client.request(
        'POST',
        `${child}sessions/${segment(sessionId)}/answers/`,
        { body: { stepId, answer, requestId }, signal },
      );
      return read(response.data, parseVerdict);
    },
    async requestHint(sessionId, stepId, fromLevel, signal) {
      const response = await client.request(
        'POST',
        `${child}sessions/${segment(sessionId)}/hints/`,
        { body: { stepId, fromLevel }, signal },
      );
      return read(response.data, (r) => ({
        hintLevel: r.field('hintLevel').integer(),
        hintText: r.field('hintText').nullable((t) => t.string()),
      }));
    },
  };
}

/** The runner API for a child, or a `disabled` error when this build has no Django API. */
export function stepRunnerApiFor(
  childId: string,
  config: DjangoApiConfig = DJANGO_API_CONFIG,
): StepRunnerApi {
  return createStepRunnerApi(
    createApiClient({ baseUrl: config.baseUrl, getAccessToken, provisionAccount: true }),
    childId,
  );
}
