/**
 * Parent dashboard safety reads and AI-history retention, through
 * `react/src/api/safety.ts` (LAI-0501B). Names and signatures are the ones
 * the app already used.
 */
import { safetyApi } from '../../api/safety';

export type { SafetyEvent } from '../../api/safety';

export const {
  listSafetyEvents,
  clearAIHistory,
} = safetyApi;
