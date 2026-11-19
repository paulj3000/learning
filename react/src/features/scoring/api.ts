/**
 * A child's scoring, read from Django (`children/<id>/scoring/`, docs/scoring/SCORING_CONTRACTS.md
 * section 6). Read only: there is no write function. The client never sends an amount, a currency
 * or a total, because awards are derived on the server from records Django wrote itself.
 */
import { childPath, djangoClient } from '../../api/djangoClient';
import {
  parseAwardFeed,
  parseScoringSummary,
  type AwardFeed,
  type ParseResult,
  type ScoringSummary,
} from './types';

function unwrap<T>(result: ParseResult<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

/** The child's progression summary, or `{ enabled: false }` when scoring is off. */
export async function getScoringSummary(childId: string): Promise<ScoringSummary> {
  const response = await djangoClient().request('GET', childPath(childId, 'scoring/'));
  return unwrap(parseScoringSummary(response.data));
}

/** Ledger entries recorded after `after` (an entry id), oldest first. */
export async function getScoringAwards(childId: string, after?: string): Promise<AwardFeed> {
  const suffix = after ? `?after=${encodeURIComponent(after)}` : '';
  const response = await djangoClient().request(
    'GET',
    childPath(childId, `scoring/awards/${suffix}`),
  );
  return unwrap(parseAwardFeed(response.data));
}
