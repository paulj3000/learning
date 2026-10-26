import { adventuresApi } from '../../api/adventures';
import { decodeAwsJson } from '../../lib/awsJson';
import type { AdventureDefinition } from './engine/types';
import type { AdventureSession, StoryScene } from '../../api/adventures';
import { assertAdventureAvailable } from '../catalog/availabilityApi';

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

export const {
  submitAdventureAnswer,
  getActiveSession,
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

/**
 * Resumes this child's active session for `definition`, or starts a new
 * one. Shared by `useAdventureSession` (on mounting an adventure route) and
 * the world engine's `START_ADVENTURE` interactions (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md
 * section 8's "World checks requirements -> Adventure Engine starts"), so
 * approaching an adventure object in the world and opening the adventure
 * route directly both create at most one active session.
 *
 * Also the one place every route goes through to play an adventure, so it
 * is where the admin catalog's active flags are enforced for children
 * (docs/ISLAND_ADVENTURE_MANAGEMENT.md section 17): an adventure, or one on
 * an island, that an admin deactivated throws `AdventureUnavailableError`
 * instead of starting or resuming. An existing session is left untouched,
 * so the child's progress is still there if the adventure is reactivated.
 */
export async function resumeOrStartSession(
  childProfileId: string,
  definition: AdventureDefinition,
): Promise<AdventureSession> {
  await assertAdventureAvailable(definition);
  const existing = await getActiveSession(childProfileId, definition.slug);
  return (
    existing ??
    (await startSession(
      childProfileId,
      definition.slug,
      definition.version,
      definition.entryStepId,
    ))
  );
}

