import { adventuresApi } from '../../api/adventures';
import { decodeAwsJson } from '../../lib/awsJson';
import type { StoryScene } from '../../api/adventures';

/**
 * Step-adventure sessions, answers, evidence, world changes and saved
 * stories, through `react/src/api/adventures.ts` (LAI-0501B), which picks
 * Amplify or Django per build. Names and signatures are the ones the app
 * already used; `submitAdventureAnswer` gained an optional `context` that
 * Django needs and Amplify ignores.
 */

export type {
  AdventureAction,
  AdventureAnswerResult,
  AdventureSession,
  AnswerContext,
  CompletedSession,
  SessionContext,
  SessionStatus,
  RecordActionInput,
  RecordSkillEvidenceInput,
  StoryArtifact,
  StoryScene,
  WorldChange,
} from '../../api/adventures';
export type { SkillProgress } from '../../api/mastery';

function isStoryScene(value: unknown): value is StoryScene {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StoryScene).stepId === 'string' &&
    typeof (value as StoryScene).text === 'string' &&
    ((value as StoryScene).source === 'AI' || (value as StoryScene).source === 'FALLBACK')
  );
}

/** `StoryArtifact.scenes` is untyped JSON on the wire; this is our own prior write, but parse defensively rather than trusting the shape. */
export function parseStoryScenes(scenes: unknown): StoryScene[] {
  const decoded = decodeAwsJson(scenes);
  return Array.isArray(decoded) ? decoded.filter(isStoryScene) : [];
}

/**
 * `resumeOrStartSession` is the one place every route goes through to play
 * an adventure (on Amplify it also enforces the admin catalog's active
 * flags; on Django the server checks availability), so approaching an
 * adventure in the world and opening its route both create at most one
 * active session.
 */
export const {
  submitAdventureAnswer,
  getActiveSession,
  resumeOrStartSession,
  getSession,
  startSession,
  advanceSession,
  completeSession,
  recordAction,
  recordSkillEvidence,
  listWorldChanges,
  listAllWorldChanges,
  recordWorldChangeOnce,
  listSessions,
  listActionsForSessions,
  saveStoryArtifact,
  listStoryArtifacts,
  deleteStoryArtifact,
} = adventuresApi;

export async function hasWorldChange(
  childProfileId: string,
  locationSlug: string,
  changeKey: string,
): Promise<boolean> {
  const changes = await listWorldChanges(childProfileId, locationSlug);
  return changes.some((change) => change.changeKey === changeKey);
}
