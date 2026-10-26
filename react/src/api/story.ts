import * as amplify from './amplify/story';
import { selectApi } from './select';

export type { ChildStoryProgress } from './amplify/story';

/**
 * Story Engine progress (chapters, flags, reflection evidence). Django has a
 * `StoryProgress` model but no story route (LAI-0607), so every operation is
 * `story_unavailable` there. Story progress is never written by the client on
 * Django.
 */
export interface StoryProgressApi {
  getStoryProgress: typeof amplify.getStoryProgress;
  listStoryProgress: typeof amplify.listStoryProgress;
  startOrResumeStoryProgress: typeof amplify.startOrResumeStoryProgress;
  setStoryFlag: typeof amplify.setStoryFlag;
  advanceChapter: typeof amplify.advanceChapter;
  completeStory: typeof amplify.completeStory;
  isAdventureSessionComplete: typeof amplify.isAdventureSessionComplete;
  recordStoryReflectionEvidence: typeof amplify.recordStoryReflectionEvidence;
}

export const storyProgressApi: StoryProgressApi = selectApi<StoryProgressApi>('story', {
  amplify: {
    getStoryProgress: amplify.getStoryProgress,
    listStoryProgress: amplify.listStoryProgress,
    startOrResumeStoryProgress: amplify.startOrResumeStoryProgress,
    setStoryFlag: amplify.setStoryFlag,
    advanceChapter: amplify.advanceChapter,
    completeStory: amplify.completeStory,
    isAdventureSessionComplete: amplify.isAdventureSessionComplete,
    recordStoryReflectionEvidence: amplify.recordStoryReflectionEvidence,
  },
});
