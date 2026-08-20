import { client } from '../../lib/data-client';
import type { Correctness, AdventureDefinition } from './engine/types';
import type { Schema } from '../../../amplify/data/resource';

export type AdventureSession = Schema['AdventureSession']['type'];
export type WorldChange = Schema['WorldChange']['type'];
export type SkillProgress = Schema['SkillProgress']['type'];
export type StoryArtifact = Schema['StoryArtifact']['type'];

/** One AI-narrated (or authored-fallback) beat of a Storykeeper Castle story. */
export interface StoryScene {
  stepId: string;
  text: string;
  source: 'AI' | 'FALLBACK';
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

/** `StoryArtifact.scenes` is untyped JSON on the wire; this is our own prior write, but parse defensively rather than trusting the shape. */
export function parseStoryScenes(scenes: unknown): StoryScene[] {
  return Array.isArray(scenes) ? scenes.filter(isStoryScene) : [];
}

const CORRECTNESS_TO_SCHEMA: Record<Correctness, Schema['Correctness']['type']> = {
  correct: 'CORRECT',
  incorrect: 'INCORRECT',
  partial: 'PARTIAL',
  not_applicable: 'NOT_APPLICABLE',
};

/**
 * Owner authorization scopes `.list()` to the caller's own records, so
 * filtering client-side (same pattern as island/api.ts's CompanionProfile
 * lookup) is enough to find this child's session for this template.
 */
export async function getActiveSession(
  childProfileId: string,
  templateSlug: string,
): Promise<AdventureSession | null> {
  const { data } = await client.models.AdventureSession.list();
  return (
    data.find(
      (session: AdventureSession) =>
        session.childProfileId === childProfileId &&
        session.templateSlug === templateSlug &&
        session.status === 'ACTIVE',
    ) ?? null
  );
}

export async function startSession(
  childProfileId: string,
  templateSlug: string,
  templateVersion: number,
  entryStepId: string,
): Promise<AdventureSession> {
  const now = new Date().toISOString();
  const { data, errors } = await client.models.AdventureSession.create({
    childProfileId,
    templateSlug,
    templateVersion,
    status: 'ACTIVE',
    currentStepId: entryStepId,
    startedAt: now,
    lastActivityAt: now,
  });
  if (!data) {
    throw new Error(errors?.[0]?.message ?? 'Could not start the adventure.');
  }
  return data;
}

/**
 * Resumes this child's active session for `definition`, or starts a new
 * one. Shared by `useAdventureSession` (on mounting an adventure route) and
 * the world engine's `START_ADVENTURE` interactions (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md
 * section 8's "World checks requirements -> Adventure Engine starts"), so
 * approaching an adventure object in the world and opening the adventure
 * route directly both create at most one active session.
 */
export async function resumeOrStartSession(
  childProfileId: string,
  definition: AdventureDefinition,
): Promise<AdventureSession> {
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

export async function advanceSession(
  sessionId: string,
  nextStepId: string,
): Promise<AdventureSession> {
  const { data, errors } = await client.models.AdventureSession.update({
    id: sessionId,
    currentStepId: nextStepId,
    lastActivityAt: new Date().toISOString(),
  });
  if (!data) {
    throw new Error(errors?.[0]?.message ?? 'Could not continue the adventure.');
  }
  return data;
}

export async function completeSession(sessionId: string): Promise<AdventureSession> {
  const now = new Date().toISOString();
  const { data, errors } = await client.models.AdventureSession.update({
    id: sessionId,
    status: 'COMPLETED',
    completedAt: now,
    lastActivityAt: now,
  });
  if (!data) {
    throw new Error(errors?.[0]?.message ?? 'Could not finish the adventure.');
  }
  return data;
}

export interface RecordActionInput {
  sessionId: string;
  stepId: string;
  actionType: string;
  normalizedAnswer?: string;
  correctness: Correctness;
  hintLevel: number;
  attemptNumber: number;
  /** Phase 22 Interaction Engine "duration capture" deliverable — see `src/features/interaction/evidence.ts`. */
  durationMs?: number;
}

export async function recordAction(input: RecordActionInput): Promise<void> {
  const { errors } = await client.models.AdventureAction.create({
    sessionId: input.sessionId,
    stepId: input.stepId,
    actionType: input.actionType,
    normalizedAnswer: input.normalizedAnswer,
    correctness: CORRECTNESS_TO_SCHEMA[input.correctness],
    hintLevel: input.hintLevel,
    attemptNumber: input.attemptNumber,
    durationMs: input.durationMs,
  });
  if (errors?.length) {
    throw new Error(errors[0]?.message ?? 'Could not record that action.');
  }
}

export interface RecordSkillEvidenceInput {
  childProfileId: string;
  sessionId: string;
  learningObjectiveCode: string;
  evidenceType: string;
  result: Correctness;
  supportLevel: number;
  /** Phase 22 Interaction Engine "duration capture" deliverable — see `src/features/interaction/evidence.ts`. */
  durationMs?: number;
}

export async function recordSkillEvidence(input: RecordSkillEvidenceInput): Promise<void> {
  const { errors } = await client.models.SkillEvidence.create({
    childProfileId: input.childProfileId,
    sessionId: input.sessionId,
    learningObjectiveCode: input.learningObjectiveCode,
    evidenceType: input.evidenceType,
    result: CORRECTNESS_TO_SCHEMA[input.result],
    supportLevel: input.supportLevel,
    durationMs: input.durationMs,
    observedAt: new Date().toISOString(),
  });
  if (errors?.length) {
    throw new Error(errors[0]?.message ?? 'Could not record that skill evidence.');
  }
}

export async function listWorldChanges(
  childProfileId: string,
  locationSlug: string,
): Promise<WorldChange[]> {
  const { data } = await client.models.WorldChange.list();
  return data.filter(
    (change: WorldChange) =>
      change.childProfileId === childProfileId && change.locationSlug === locationSlug,
  );
}

/** Every world change across every location, newest first (parent dashboard). */
export async function listAllWorldChanges(childProfileId: string): Promise<WorldChange[]> {
  const { data } = await client.models.WorldChange.list();
  return data
    .filter((change: WorldChange) => change.childProfileId === childProfileId)
    .sort((a: WorldChange, b: WorldChange) => b.createdAt.localeCompare(a.createdAt));
}

export async function hasWorldChange(
  childProfileId: string,
  locationSlug: string,
  changeKey: string,
): Promise<boolean> {
  const changes = await listWorldChanges(childProfileId, locationSlug);
  return changes.some((change) => change.changeKey === changeKey);
}

/** Idempotent by `changeKey`: replaying the same adventure never duplicates a world change. */
export async function recordWorldChangeOnce(
  childProfileId: string,
  locationSlug: string,
  changeType: string,
  changeKey: string,
  sourceSessionId: string,
): Promise<void> {
  const alreadyExists = await hasWorldChange(childProfileId, locationSlug, changeKey);
  if (alreadyExists) return;

  const { errors } = await client.models.WorldChange.create({
    childProfileId,
    locationSlug,
    changeType,
    changeKey,
    sourceSessionId,
    createdAt: new Date().toISOString(),
  });
  if (errors?.length) {
    throw new Error(errors[0]?.message ?? 'Could not save that change to the island.');
  }
}

export async function listSessions(childProfileId: string): Promise<AdventureSession[]> {
  const { data } = await client.models.AdventureSession.list();
  return data
    .filter((session: AdventureSession) => session.childProfileId === childProfileId)
    .sort((a: AdventureSession, b: AdventureSession) =>
      b.lastActivityAt.localeCompare(a.lastActivityAt),
    );
}

/**
 * Saves one Storykeeper Castle play-through's assembled story
 * (docs/ROADMAP.md Phase 5). Unlike `recordWorldChangeOnce`, this is not
 * deduplicated by key: each play-through is a distinct new story the child
 * created, not a repeatable world state.
 */
export async function saveStoryArtifact(
  childProfileId: string,
  sessionId: string,
  templateSlug: string,
  title: string,
  scenes: StoryScene[],
): Promise<void> {
  const { errors } = await client.models.StoryArtifact.create({
    childProfileId,
    sessionId,
    templateSlug,
    title,
    scenes,
    createdAt: new Date().toISOString(),
  });
  if (errors?.length) {
    throw new Error(errors[0]?.message ?? 'Could not save your story.');
  }
}

export async function listStoryArtifacts(childProfileId: string): Promise<StoryArtifact[]> {
  const { data } = await client.models.StoryArtifact.list();
  return data
    .filter((artifact: StoryArtifact) => artifact.childProfileId === childProfileId)
    .sort((a: StoryArtifact, b: StoryArtifact) => b.createdAt.localeCompare(a.createdAt));
}

/** Parent-controlled retention: a parent may permanently delete a saved story. */
export async function deleteStoryArtifact(id: string): Promise<void> {
  const { errors } = await client.models.StoryArtifact.delete({ id });
  if (errors?.length) {
    throw new Error(errors[0]?.message ?? 'Could not delete that story.');
  }
}
