import * as amplify from './amplify/safety';
import { selectApi } from './select';

export type { SafetyEvent } from './amplify/safety';

/**
 * Parent-facing AI safety history: the child's safety events, and clearing
 * AI audit and safety records. Django has no AI audit or safety models yet
 * (LAI-0306), so both are `safety_unavailable` there. A dashboard must show
 * that as unavailable, not as "no safety events".
 */
export interface SafetyApi {
  listSafetyEvents: typeof amplify.listSafetyEvents;
  clearAIHistory: typeof amplify.clearAIHistory;
}

export const safetyApi: SafetyApi = selectApi<SafetyApi>('safety', {
  amplify: {
    listSafetyEvents: amplify.listSafetyEvents,
    clearAIHistory: amplify.clearAIHistory,
  },
});
