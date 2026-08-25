/**
 * Persistence-facing half of the Director (docs/ROADMAP.md Phase 28,
 * Phase 41 / docs/DECISIONS.md ADR-16).
 *
 * As of Phase 41, this no longer assembles a `DirectorContext` or ranks
 * anything itself — that decision now runs once, server-side, in
 * `amplify/functions/get-next-learning-activity/handler.ts`, shared by
 * every client rather than reimplemented per client. This module's only
 * job is calling that query and reconstructing its flattened wire shape
 * back into the `SelectionRecord[]` this app's UI and `explain.ts` already
 * know how to render — the same "client renders, backend decides"
 * boundary `submitAdventureAnswer` already established for the Adventure
 * Engine.
 */
import { client } from '../../lib/data-client';
import type { Schema } from '../../../amplify/data/resource';
import type { SelectionReason, SelectionRecord } from './types';
import type { SkillStatus } from '../mastery/types';

type WireSuggestion = Schema['NextAdventureSuggestion']['type'];
type WireReason = Schema['SelectionReasonType']['type'];

const SELECTION_REASON_KINDS: readonly SelectionReason['kind'][] = [
  'PRACTISES_SKILL',
  'CONTINUES_STORY',
  'ALREADY_COMPLETED',
  'PLAYED_RECENTLY',
  'NO_SKILLS_NEEDED',
];

/**
 * Reconstructs one `SelectionReason` from its flattened wire shape.
 * `kind` is external data at this boundary (CLAUDE.md section 13): an
 * unrecognized value degrades to `NO_SKILLS_NEEDED` — the one reason with
 * no further fields to get wrong — rather than throwing and losing the
 * whole suggestion list over one malformed reason.
 */
function toSelectionReason(wire: WireReason): SelectionReason {
  const kind = SELECTION_REASON_KINDS.includes(wire.kind as SelectionReason['kind'])
    ? (wire.kind as SelectionReason['kind'])
    : 'NO_SKILLS_NEEDED';
  switch (kind) {
    case 'PRACTISES_SKILL':
      return {
        kind,
        skillId: wire.skillId ?? '',
        status: (wire.status ?? 'LOCKED') as SkillStatus,
        weight: wire.weight ?? 0,
      };
    case 'CONTINUES_STORY':
      return { kind, storyId: wire.storyId ?? '' };
    case 'ALREADY_COMPLETED':
    case 'PLAYED_RECENTLY':
      return { kind, penalty: wire.penalty ?? 0 };
    case 'NO_SKILLS_NEEDED':
      return { kind };
  }
}

function toSelectionRecord(wire: WireSuggestion): SelectionRecord {
  return {
    adventureSlug: wire.adventureSlug,
    title: wire.title,
    score: wire.score,
    reasons: (wire.reasons ?? [])
      .filter((reason): reason is WireReason => reason !== null && reason !== undefined)
      .map(toSelectionReason),
  };
}

export interface NextLearningActivity {
  /** Up to 3, best first. Adult-facing reasoning travels with each record. */
  ranking: SelectionRecord[];
  /**
   * Whether `ranking` reflects this child's actual skill practice, rather
   * than an unauthored age band where every adventure ties
   * (`hasSkillBasedSignal`, computed server-side). A caller must not
   * present `ranking` as personalized when this is `false`.
   */
  hasPersonalizedSignal: boolean;
}

export const NO_SUGGESTION: NextLearningActivity = { ranking: [], hasPersonalizedSignal: false };

/**
 * What this child could do next, ranked. Never throws: a Director failure
 * must degrade to "no suggestion" rather than break a child's screen, since
 * every surface it feeds already works without it — same contract this
 * function had before Phase 41 moved the ranking itself server-side.
 */
export async function getNextLearningActivity(
  childProfileId: string,
): Promise<NextLearningActivity> {
  try {
    const { data, errors } = await client.queries.getNextLearningActivity({ childProfileId });
    if (!data) {
      throw new Error(errors?.[0]?.message ?? 'Could not load a suggestion.');
    }
    return {
      ranking: (data.suggestions ?? [])
        .filter(
          (suggestion): suggestion is WireSuggestion =>
            suggestion !== null && suggestion !== undefined,
        )
        .map(toSelectionRecord),
      hasPersonalizedSignal: data.hasPersonalizedSignal,
    };
  } catch {
    return NO_SUGGESTION;
  }
}
