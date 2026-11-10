import { childPath, djangoClient } from '../../api/djangoClient';
import { ApiError, isApiError } from '../../api/errors';
import { read, type Reader } from '../../api/parse';
import type { Correctness, AdventureDefinition } from './engine/types';
import type { StepAnswer } from './engine/validators';
import { AdventureUnavailableError } from '../catalog/availabilityApi';

export type { SkillProgress } from '../mastery/api';

/**
 * Classic step-based adventures on the Django API (AMP-03; docs/PLAY_API.md "Classic
 * adventures"). Every route is child-scoped: the server resolves the child through the signed-in
 * parent, so another family's child or session is a 404.
 *
 * The server is the authority for everything that decides progress (ADR-012, ADR-019): it grades
 * each answer, records the attempt and the skill evidence, escalates the hint ladder, advances
 * the session, records the world change a WORLD_CHANGE step owes, and completes the session. This
 * module only reports what the child did and reads the results.
 */

export type SessionStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ABANDONED' | 'SAFETY_STOPPED';
export type SchemaCorrectness = 'CORRECT' | 'INCORRECT' | 'PARTIAL' | 'NOT_APPLICABLE';

export interface AdventureSession {
  id: string;
  childProfileId: string;
  templateSlug: string;
  templateVersion: number;
  locationSlug: string;
  status: SessionStatus;
  currentStepId: string;
  /** The hint level the server has given on the current step. */
  hintLevel: number;
  startedAt: string;
  lastActivityAt: string;
  completedAt: string | null;
}

/** One recorded attempt at one step (the parent dashboard's independent-vs-hinted report). */
export interface AdventureAction {
  id: string;
  sessionId: string;
  stepId: string;
  actionType: string;
  correctness: SchemaCorrectness;
  /** The answer's short form (an option id, a number, an order), or null. Never free text. */
  normalizedAnswer: string | null;
  hintLevel: number;
  attemptNumber: number;
  createdAt: string;
}

export interface WorldChange {
  id: string;
  childProfileId: string;
  locationSlug: string;
  changeType: string;
  changeKey: string;
  sourceSessionId: string;
  createdAt: string;
}

/** One AI-narrated (or authored-fallback) beat of a Storykeeper Castle story. */
export interface StoryScene {
  stepId: string;
  text: string;
  source: 'AI' | 'FALLBACK';
}

export interface StoryArtifact {
  id: string;
  childProfileId: string;
  sessionId: string;
  templateSlug: string;
  title: string;
  scenes: StoryScene[];
  createdAt: string;
}

function isStoryScene(value: unknown): value is StoryScene {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StoryScene).stepId === 'string' &&
    typeof (value as StoryScene).text === 'string' &&
    ((value as StoryScene).source === 'AI' || (value as StoryScene).source === 'FALLBACK')
  );
}

/** Saved scenes are server data; parse them defensively rather than trusting the shape. */
export function parseStoryScenes(scenes: unknown): StoryScene[] {
  return Array.isArray(scenes) ? scenes.filter(isStoryScene) : [];
}

const SESSION_STATUSES = ['ACTIVE', 'PAUSED', 'COMPLETED', 'ABANDONED', 'SAFETY_STOPPED'] as const;
const CORRECTNESS_VALUES = ['CORRECT', 'INCORRECT', 'PARTIAL', 'NOT_APPLICABLE'] as const;

const SCHEMA_TO_CORRECTNESS: Record<SchemaCorrectness, Correctness> = {
  CORRECT: 'correct',
  INCORRECT: 'incorrect',
  PARTIAL: 'partial',
  NOT_APPLICABLE: 'not_applicable',
};

function nullableString(r: Reader): string | null {
  return r.nullable((v) => v.string());
}

export function readSession(r: Reader, childProfileId: string): AdventureSession {
  return {
    id: r.field('id').string(),
    childProfileId,
    templateSlug: r.field('adventureSlug').string(),
    templateVersion: r.field('templateVersion').integer(),
    locationSlug:
      r.field('locationSlug').value === undefined ? '' : r.field('locationSlug').string(),
    status: r.field('status').oneOf(SESSION_STATUSES),
    currentStepId: r.field('currentStepId').string(),
    hintLevel: r.field('hintLevel').integer(),
    startedAt: r.field('startedAt').string(),
    lastActivityAt: r.field('lastActivityAt').string(),
    completedAt: nullableString(r.field('completedAt')),
  };
}

function readWorldChange(r: Reader, childProfileId: string): WorldChange {
  return {
    id: r.field('id').string(),
    childProfileId,
    locationSlug: r.field('locationSlug').string(),
    changeType: r.field('changeType').string(),
    changeKey: r.field('changeKey').string(),
    sourceSessionId: r.field('sourceSessionId').string(),
    createdAt: r.field('createdAt').string(),
  };
}

function readArtifact(r: Reader, childProfileId: string): StoryArtifact {
  return {
    id: r.field('id').string(),
    childProfileId,
    sessionId: r.field('sessionId').string(),
    templateSlug: r.field('templateSlug').string(),
    title: r.field('title').string(),
    scenes: parseStoryScenes(r.field('scenes').value),
    createdAt: r.field('createdAt').string(),
  };
}

export interface AdventureAnswerResult {
  correctness: Correctness;
  supportLevel: number;
  action: 'RETRY' | 'ADVANCE';
  /** Set only when `action` is `'ADVANCE'`. */
  nextStepId: string | null;
  /** The session as the server left it (its step, status and completion). */
  session: AdventureSession;
}

function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Sends what the child did on the current step; the server grades it (ADR-012), records the
 * attempt and its skill evidence, and, when it advances, moves the session on itself.
 * `requestId` makes a retried request safe: the server returns the stored outcome.
 */
export async function submitAdventureAnswer(
  childProfileId: string,
  sessionId: string,
  stepId: string,
  answer: StepAnswer,
  requestId: string = newRequestId(),
): Promise<AdventureAnswerResult> {
  const response = await djangoClient().request(
    'POST',
    childPath(childProfileId, `sessions/${encodeURIComponent(sessionId)}/answers/`),
    { body: { stepId, answer: { ...answer }, requestId } },
  );
  return read(response.data, (r) => {
    const correctness = SCHEMA_TO_CORRECTNESS[r.field('correctness').oneOf(CORRECTNESS_VALUES)];
    const action = r.field('action').oneOf(['RETRY', 'ADVANCE'] as const);
    return {
      correctness,
      supportLevel: r.field('supportLevel').integer(),
      action,
      nextStepId: action === 'ADVANCE' ? nullableString(r.field('nextStepId')) : null,
      session: readSession(r.field('session'), childProfileId),
    };
  });
}

/**
 * Asks the server for the next rung of the current step's hint ladder. `fromLevel` is the level
 * the child saw, so a retried request cannot escalate twice. Returns the server's level, which is
 * also the support level the next answer is graded with.
 */
export async function requestAdventureHint(
  childProfileId: string,
  sessionId: string,
  stepId: string,
  fromLevel: number,
): Promise<number> {
  const response = await djangoClient().request(
    'POST',
    childPath(childProfileId, `sessions/${encodeURIComponent(sessionId)}/hints/`),
    { body: { stepId, fromLevel } },
  );
  return read(response.data, (r) => r.field('hintLevel').integer());
}

function adventurePath(childProfileId: string, templateSlug: string): string {
  return childPath(childProfileId, `adventures/${encodeURIComponent(templateSlug)}/session/`);
}

/** This child's ACTIVE session for one adventure, or null. */
export async function getActiveSession(
  childProfileId: string,
  templateSlug: string,
): Promise<AdventureSession | null> {
  try {
    const response = await djangoClient().request(
      'GET',
      adventurePath(childProfileId, templateSlug),
    );
    return read(response.data, (r) =>
      r.field('session').nullable((s) => readSession(s, childProfileId)),
    );
  } catch (error) {
    if (isApiError(error) && error.kind === 'not_found') return null;
    throw error;
  }
}

/**
 * Resumes this child's active session for `definition`, or starts a new one, on the server.
 * Shared by `useAdventureSession` and the world's `START_ADVENTURE` interactions, so a child has
 * at most one active session per adventure (the database enforces it too).
 *
 * Whether the adventure may be played is the server's decision (ADR-031): an adventure, or one on
 * a place or island, that was taken out of play answers `content_unavailable`, which becomes the
 * calm `AdventureUnavailableError`. An existing session is left untouched.
 */
export async function resumeOrStartSession(
  childProfileId: string,
  definition: AdventureDefinition,
): Promise<AdventureSession> {
  try {
    const response = await djangoClient().request(
      'POST',
      adventurePath(childProfileId, definition.slug),
      { body: {} },
    );
    return read(response.data, (r) => readSession(r, childProfileId));
  } catch (error) {
    if (isApiError(error) && (error.code === 'content_unavailable' || error.kind === 'not_found')) {
      throw new AdventureUnavailableError();
    }
    throw error;
  }
}

/** Every adventure session this child has, newest activity first. */
export async function listSessions(childProfileId: string): Promise<AdventureSession[]> {
  const response = await djangoClient().request('GET', childPath(childProfileId, 'sessions/'));
  return read(response.data, (r) =>
    r.field('sessions').array((s) => readSession(s, childProfileId)),
  );
}

/**
 * The recorded attempts for these sessions (the parent dashboard's independent-vs-hinted
 * report). The server returns the child's attempts; this keeps those of the named sessions.
 */
export async function listActionsForSessions(
  childProfileId: string,
  sessionIds: readonly string[],
): Promise<AdventureAction[]> {
  if (sessionIds.length === 0) return [];
  const ids = new Set(sessionIds);
  const response = await djangoClient().request(
    'GET',
    childPath(childProfileId, 'adventure-actions/'),
  );
  const actions = read(response.data, (r) =>
    r.field('actions').array((a): AdventureAction => ({
      id: a.field('id').string(),
      sessionId: a.field('sessionId').string(),
      stepId: a.field('stepId').string(),
      actionType: a.field('actionType').string(),
      correctness: a.field('correctness').oneOf(CORRECTNESS_VALUES),
      normalizedAnswer: a.field('normalizedAnswer').nullable((v) => v.string()),
      hintLevel: a.field('hintLevel').integer(),
      attemptNumber: a.field('attemptNumber').integer(),
      createdAt: a.field('createdAt').string(),
    })),
  );
  return actions.filter((action) => ids.has(action.sessionId));
}

// --- World changes -----------------------------------------------------------------------------

/** Every world change across every location, newest first (parent dashboard, world views). */
export async function listAllWorldChanges(childProfileId: string): Promise<WorldChange[]> {
  const response = await djangoClient().request('GET', childPath(childProfileId, 'world-changes/'));
  return read(response.data, (r) =>
    r.field('worldChanges').array((c) => readWorldChange(c, childProfileId)),
  );
}

export async function listWorldChanges(
  childProfileId: string,
  locationSlug: string,
): Promise<WorldChange[]> {
  const changes = await listAllWorldChanges(childProfileId);
  return changes.filter((change) => change.locationSlug === locationSlug);
}

export async function hasWorldChange(
  childProfileId: string,
  locationSlug: string,
  changeKey: string,
): Promise<boolean> {
  const changes = await listWorldChanges(childProfileId, locationSlug);
  return changes.some((change) => change.changeKey === changeKey);
}

/**
 * Records a world change the island's own runtime decided (a world action, a trial). Idempotent
 * on the server by (location, change key): replaying never duplicates a change. `sourceSessionId`
 * is the child's own session id, or a provenance label such as `quest:<id>`.
 *
 * Adventures, stories, quests and discoveries do not call this: the server records the changes
 * those owe when it accepts the step, chapter, quest state or discovery.
 */
export async function recordWorldChangeOnce(
  childProfileId: string,
  locationSlug: string,
  changeType: string,
  changeKey: string,
  sourceSessionId: string,
): Promise<void> {
  await djangoClient().request('POST', childPath(childProfileId, 'world-changes/'), {
    body: { locationSlug, changeType, changeKey, sourceSessionId },
  });
}

// --- Saved stories (Storykeeper Castle keepsakes) ------------------------------------------------

/**
 * Saves one Storykeeper Castle play-through's narrated beats. The server takes the title from the
 * catalog and keeps one story per session, so saving again returns the story already saved.
 */
export async function saveStoryArtifact(
  childProfileId: string,
  sessionId: string,
  scenes: readonly StoryScene[],
): Promise<StoryArtifact> {
  const response = await djangoClient().request(
    'POST',
    childPath(childProfileId, 'story-artifacts/'),
    {
      body: {
        sessionId,
        scenes: scenes.map((scene) => ({
          stepId: scene.stepId,
          text: scene.text,
          source: scene.source,
        })),
      },
    },
  );
  return read(response.data, (r) => readArtifact(r, childProfileId));
}

export async function listStoryArtifacts(childProfileId: string): Promise<StoryArtifact[]> {
  const response = await djangoClient().request(
    'GET',
    childPath(childProfileId, 'story-artifacts/'),
  );
  return read(response.data, (r) =>
    r.field('artifacts').array((a) => readArtifact(a, childProfileId)),
  );
}

/** Parent-controlled retention: a parent may permanently delete a saved story. */
export async function deleteStoryArtifact(childProfileId: string, id: string): Promise<void> {
  try {
    await djangoClient().request(
      'DELETE',
      childPath(childProfileId, `story-artifacts/${encodeURIComponent(id)}/`),
    );
  } catch (error) {
    if (isApiError(error) && error.kind === 'not_found') return; // already gone
    throw error instanceof ApiError ? new Error('Could not delete that story.') : error;
  }
}
