import * as amplify from './amplify/director';
import { selectApi } from './select';
import type { WireNextLearningActivity } from './amplify/director';

export type { WireNextLearningActivity, WireReason, WireSuggestion } from './amplify/director';

/**
 * The Director's server-side ranking (ADR-016). Django has no
 * next-learning-activity route yet (LAI-0606), so it is
 * `director_unavailable` there; `features/director/api.ts` turns any
 * failure into "no suggestion", as it always has.
 */
export interface DirectorApi {
  fetchNextLearningActivity(childProfileId: string): Promise<WireNextLearningActivity>;
}

export const directorApi: DirectorApi = selectApi<DirectorApi>('director', {
  amplify: { fetchNextLearningActivity: amplify.fetchNextLearningActivity },
});
