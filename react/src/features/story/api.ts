/**
 * Story progress, through `react/src/api/story.ts` (LAI-0501B). Names and
 * signatures are the ones the app already used.
 */
import { storyProgressApi } from '../../api/story';

export type { ChildStoryProgress } from '../../api/story';

export const {
  getStoryProgress,
  listStoryProgress,
  startOrResumeStoryProgress,
  setStoryFlag,
  advanceChapter,
  completeStory,
  isAdventureSessionComplete,
  recordStoryReflectionEvidence,
} = storyProgressApi;

export { parseStoryFlags } from './flags';
