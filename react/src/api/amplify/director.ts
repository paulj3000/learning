import { client } from '../../lib/data-client';
import type { Schema } from '../../../../amplify/data/resource';

export type WireSuggestion = Schema['NextAdventureSuggestion']['type'];
export type WireReason = Schema['SelectionReasonType']['type'];

export interface WireNextLearningActivity {
  suggestions: WireSuggestion[];
  hasPersonalizedSignal: boolean;
}

/**
 * The `getNextLearningActivity` query (Phase 41, ADR-016): the ranking is
 * decided server-side; this only returns its wire shape. Throws on failure.
 */
export async function fetchNextLearningActivity(
  childProfileId: string,
): Promise<WireNextLearningActivity> {
  const { data, errors } = await client.queries.getNextLearningActivity({ childProfileId });
  if (!data) {
    throw new Error(errors?.[0]?.message ?? 'Could not load a suggestion.');
  }
  return {
    suggestions: (data.suggestions ?? []).filter(
      (suggestion): suggestion is WireSuggestion => suggestion !== null && suggestion !== undefined,
    ),
    hasPersonalizedSignal: data.hasPersonalizedSignal,
  };
}
