import { childPath, djangoClient } from '../../api/djangoClient';
import { read, type Reader } from '../../api/parse';
import { listSessions } from '../adventures/api';

/**
 * Story progress on Django (`children/<id>/stories/...`, AMP-03).
 *
 * The client says what the child did; the server decides what it changes, from the content
 * export's own story definitions (`apps/progression/stories.py`): the entry chapter, which flag
 * values a choice offers, which chapter is next, whether a chapter's embedded adventures are
 * done, the completion world change, and the reflection evidence. Each write is idempotent.
 */
export interface ChildStoryProgress {
  id: string;
  childProfileId: string;
  storyId: string;
  currentChapterId: string;
  completedChapterIds: string[];
  /** Bounded, authored flags only (never free-form child text). */
  storyFlags: Record<string, string>;
  startedAt: string;
  lastPlayedAt: string;
  completedAt: string | null;
}

/** `storyFlags` from the server; parse defensively rather than trusting the shape. */
export function parseStoryFlags(flags: unknown): Record<string, string> {
  if (typeof flags !== 'object' || flags === null || Array.isArray(flags)) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(flags as Record<string, unknown>)) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

function readProgress(r: Reader, childProfileId: string): ChildStoryProgress {
  return {
    id: r.field('id').string(),
    childProfileId,
    storyId: r.field('storyId').string(),
    currentChapterId: r.field('currentChapterId').string(),
    completedChapterIds: r.field('completedChapterIds').array((id) => id.string()),
    storyFlags: parseStoryFlags(r.field('storyFlags').value),
    startedAt: r.field('startedAt').string(),
    lastPlayedAt: r.field('lastPlayedAt').string(),
    completedAt: r.field('completedAt').nullable((v) => v.string()),
  };
}

function storyPath(childProfileId: string, storyId: string, rest: string): string {
  return childPath(childProfileId, `stories/${encodeURIComponent(storyId)}/${rest}`);
}

async function write(
  childProfileId: string,
  path: string,
  body: Record<string, unknown> = {},
): Promise<ChildStoryProgress> {
  const response = await djangoClient().request('POST', path, { body });
  return read(response.data, (r) => readProgress(r, childProfileId));
}

/** Every story this child has started (the Adventure Library's "keep going" or "finished"). */
export async function listStoryProgress(childProfileId: string): Promise<ChildStoryProgress[]> {
  const response = await djangoClient().request('GET', childPath(childProfileId, 'stories/'));
  return read(response.data, (r) =>
    r.field('stories').array((row) => readProgress(row, childProfileId)),
  );
}

export async function getStoryProgress(
  childProfileId: string,
  storyId: string,
): Promise<ChildStoryProgress | null> {
  const rows = await listStoryProgress(childProfileId);
  return rows.find((row) => row.storyId === storyId) ?? null;
}

/** Starts this story at its authored entry chapter, or resumes it. */
export function startOrResumeStoryProgress(
  childProfileId: string,
  storyId: string,
): Promise<ChildStoryProgress> {
  return write(childProfileId, storyPath(childProfileId, storyId, 'start/'));
}

/** Records one authored choice (`flagKey` set to an offered `flagValue`). */
export function setStoryFlag(
  progress: ChildStoryProgress,
  flagKey: string,
  flagValue: string,
): Promise<ChildStoryProgress> {
  return write(
    progress.childProfileId,
    storyPath(progress.childProfileId, progress.storyId, 'flags/'),
    {
      flagKey,
      flagValue,
    },
  );
}

/**
 * Finishes the current chapter. The server moves to the authored next chapter, or completes the
 * story and records its completion world change when this was the last one. A chapter whose
 * embedded adventures are not all completed is refused.
 */
export function completeChapter(
  progress: ChildStoryProgress,
  chapterId: string,
): Promise<ChildStoryProgress> {
  return write(
    progress.childProfileId,
    storyPath(
      progress.childProfileId,
      progress.storyId,
      `chapters/${encodeURIComponent(chapterId)}/complete/`,
    ),
  );
}

/** Whether this child has a COMPLETED session for `templateSlug` (an embedded ADVENTURE scene). */
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
 * A story-level REFLECTION scene. The server records not-applicable evidence for the scene's own
 * authored objectives, once per story play and objective.
 */
export async function recordStoryReflectionEvidence(
  childProfileId: string,
  storyId: string,
  sceneId: string,
): Promise<void> {
  await djangoClient().request('POST', storyPath(childProfileId, storyId, 'reflections/'), {
    body: { sceneId },
  });
}
