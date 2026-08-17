import { client } from '../../lib/data-client';
import {
  listSessions,
  recordSkillEvidence,
  recordWorldChangeOnce,
  upsertSkillProgress,
} from '../adventures/api';
import type { WorldChangePayload } from '../adventures/engine/types';
import type { Schema } from '../../../amplify/data/resource';

export type ChildStoryProgress = Schema['ChildStoryProgress']['type'];

/** `storyFlags` is untyped JSON on the wire; parse defensively rather than trusting the shape, same precedent as `parseStoryScenes` in adventures/api.ts. */
export function parseStoryFlags(flags: unknown): Record<string, string> {
  if (typeof flags !== 'object' || flags === null) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(flags as Record<string, unknown>)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

function completedChapterIdsOf(progress: ChildStoryProgress): string[] {
  return (progress.completedChapterIds ?? []).filter((id): id is string => typeof id === 'string');
}

/**
 * Owner authorization scopes `.list()` to the caller's own records, same
 * pattern as `getActiveSession` in adventures/api.ts.
 */
export async function getStoryProgress(
  childProfileId: string,
  storyId: string,
): Promise<ChildStoryProgress | null> {
  const { data } = await client.models.ChildStoryProgress.list();
  return (
    data.find(
      (row: ChildStoryProgress) => row.childProfileId === childProfileId && row.storyId === storyId,
    ) ?? null
  );
}

export async function startOrResumeStoryProgress(
  childProfileId: string,
  storyId: string,
  entryChapterId: string,
): Promise<ChildStoryProgress> {
  const existing = await getStoryProgress(childProfileId, storyId);
  if (existing) return existing;

  const now = new Date().toISOString();
  const { data, errors } = await client.models.ChildStoryProgress.create({
    childProfileId,
    storyId,
    currentChapterId: entryChapterId,
    completedChapterIds: [],
    storyFlags: {},
    startedAt: now,
    lastPlayedAt: now,
  });
  if (!data) {
    throw new Error(errors?.[0]?.message ?? 'Could not start that story.');
  }
  return data;
}

/** Merges one bounded, curated choice into `storyFlags` (docs/DATA_MODEL.md: "bounded, authored flags only, never free-form child text"). */
export async function setStoryFlag(
  progress: ChildStoryProgress,
  flagKey: string,
  flagValue: string,
): Promise<ChildStoryProgress> {
  const flags = { ...parseStoryFlags(progress.storyFlags), [flagKey]: flagValue };
  const { data, errors } = await client.models.ChildStoryProgress.update({
    id: progress.id,
    storyFlags: flags,
    lastPlayedAt: new Date().toISOString(),
  });
  if (!data) {
    throw new Error(errors?.[0]?.message ?? 'Could not save your choice.');
  }
  return data;
}

export async function advanceChapter(
  progress: ChildStoryProgress,
  completedChapterId: string,
  nextChapterId: string,
): Promise<ChildStoryProgress> {
  const { data, errors } = await client.models.ChildStoryProgress.update({
    id: progress.id,
    currentChapterId: nextChapterId,
    completedChapterIds: [...completedChapterIdsOf(progress), completedChapterId],
    lastPlayedAt: new Date().toISOString(),
  });
  if (!data) {
    throw new Error(errors?.[0]?.message ?? 'Could not continue the story.');
  }
  return data;
}

/** Marks the final chapter complete and records the story's own completion world change (in addition to whatever its chapters' embedded adventures already recorded for themselves). */
export async function completeStory(
  progress: ChildStoryProgress,
  completedChapterId: string,
  completionWorldChange: WorldChangePayload,
): Promise<ChildStoryProgress> {
  const now = new Date().toISOString();
  await recordWorldChangeOnce(
    progress.childProfileId,
    completionWorldChange.locationSlug,
    completionWorldChange.changeType,
    completionWorldChange.changeKey,
    progress.id,
  );
  const { data, errors } = await client.models.ChildStoryProgress.update({
    id: progress.id,
    completedChapterIds: [...completedChapterIdsOf(progress), completedChapterId],
    completedAt: now,
    lastPlayedAt: now,
  });
  if (!data) {
    throw new Error(errors?.[0]?.message ?? 'Could not finish the story.');
  }
  return data;
}

/** Whether this child has a COMPLETED `AdventureSession` for `templateSlug` — how the Story Engine knows an embedded ADVENTURE scene is done, without polling. */
export async function isAdventureSessionComplete(
  childProfileId: string,
  templateSlug: string,
): Promise<boolean> {
  const sessions = await listSessions(childProfileId);
  return sessions.some(
    (session) => session.templateSlug === templateSlug && session.status === 'COMPLETED',
  );
}

/**
 * A story-level REFLECTION scene has no `AdventureSession` of its own, so
 * `sessionId` here is a synthetic, non-identifying label
 * (`story:<progressId>`) rather than a real session id — fine, since
 * `SkillEvidence.sessionId` is a plain string, not a foreign key.
 */
export async function recordStoryReflectionEvidence(
  childProfileId: string,
  storyProgressId: string,
  objectiveIds: string[],
): Promise<void> {
  for (const objectiveId of objectiveIds) {
    await recordSkillEvidence({
      childProfileId,
      sessionId: `story:${storyProgressId}`,
      learningObjectiveCode: objectiveId,
      evidenceType: 'REFLECTION',
      result: 'not_applicable',
      supportLevel: 0,
    });
    await upsertSkillProgress(childProfileId, objectiveId, false);
  }
}
