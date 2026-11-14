/**
 * Persistence-facing half of the Director (docs/ROADMAP.md Phase 28,
 * Phase 41 / docs/DECISIONS.md ADR-016).
 *
 * The ranking runs once, server-side. Since AMP-05 that is Django
 * (`GET /api/v1/children/<id>/next-learning-activity/`,
 * `lai/apps/education/director.py`), a port of the Amplify
 * `getNextLearningActivity` Lambda with the same rules and wire shape. This
 * module only calls it and reconstructs the flattened reasons back into the
 * `SelectionRecord[]` this app's UI and `explain.ts` already render: "client
 * renders, backend decides".
 */
import { getAccessToken } from '../../api/auth';
import { createApiClient, type ApiClient } from '../../api/client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../../api/config';
import { ApiError } from '../../api/errors';
import { read, type Reader } from '../../api/parse';
import type { SelectionReason, SelectionRecord } from './types';
import type { SkillStatus } from '../mastery/types';

const SELECTION_REASON_KINDS: readonly SelectionReason['kind'][] = [
  'PRACTISES_SKILL',
  'CONTINUES_STORY',
  'ALREADY_COMPLETED',
  'PLAYED_RECENTLY',
  'NO_SKILLS_NEEDED',
];

const SKILL_STATUSES: readonly SkillStatus[] = [
  'LOCKED',
  'INTRODUCED',
  'DEVELOPING',
  'PROFICIENT',
  'MASTERED',
];

function optionalString(reader: Reader): string | null {
  return reader.value === null || reader.value === undefined ? null : reader.string();
}

function optionalNumber(reader: Reader): number | null {
  return reader.value === null || reader.value === undefined ? null : reader.number();
}

/**
 * Reconstructs one `SelectionReason` from its flattened wire shape.
 * `kind` is external data at this boundary (CLAUDE.md section 13): an
 * unrecognized value degrades to `NO_SKILLS_NEEDED`, the one reason with
 * no further fields to get wrong, rather than losing the whole list.
 */
function toSelectionReason(reader: Reader): SelectionReason {
  const rawKind = reader.field('kind').string();
  const kind = (SELECTION_REASON_KINDS as readonly string[]).includes(rawKind)
    ? (rawKind as SelectionReason['kind'])
    : 'NO_SKILLS_NEEDED';
  switch (kind) {
    case 'PRACTISES_SKILL': {
      const status = optionalString(reader.field('status'));
      return {
        kind,
        skillId: optionalString(reader.field('skillId')) ?? '',
        status: (SKILL_STATUSES as readonly string[]).includes(status ?? '')
          ? (status as SkillStatus)
          : 'LOCKED',
        weight: optionalNumber(reader.field('weight')) ?? 0,
      };
    }
    case 'CONTINUES_STORY':
      return { kind, storyId: optionalString(reader.field('storyId')) ?? '' };
    case 'ALREADY_COMPLETED':
    case 'PLAYED_RECENTLY':
      return { kind, penalty: optionalNumber(reader.field('penalty')) ?? 0 };
    case 'NO_SKILLS_NEEDED':
      return { kind };
  }
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

/** Reads the route's response; throws `ApiError('invalid_response')` on any other shape. */
export function parseNextLearningActivity(data: unknown): NextLearningActivity {
  return read(data, (r) => ({
    ranking: r.field('suggestions').array((s) => ({
      adventureSlug: s.field('adventureSlug').string(),
      title: s.field('title').string(),
      score: s.field('score').number(),
      reasons: s.field('reasons').array(toSelectionReason),
    })),
    hasPersonalizedSignal: r.field('hasPersonalizedSignal').boolean(),
  }));
}

/** One call to the Django route. Throws `ApiError` on any failure. */
export async function fetchNextLearningActivity(
  client: ApiClient,
  childProfileId: string,
): Promise<NextLearningActivity> {
  if (!childProfileId) throw new ApiError('invalid_request', { code: 'empty_id' });
  const response = await client.request(
    'GET',
    `children/${encodeURIComponent(childProfileId)}/next-learning-activity/`,
  );
  return parseNextLearningActivity(response.data);
}

/**
 * What this child could do next, ranked. Never throws: a Director failure
 * must degrade to "no suggestion" rather than break a child's screen, since
 * every surface it feeds already works without it. A build without the
 * Django API has no Director and gets no suggestion.
 */
export async function getNextLearningActivity(
  childProfileId: string,
  config: DjangoApiConfig = DJANGO_API_CONFIG,
): Promise<NextLearningActivity> {
  try {
    const client = createApiClient({
      baseUrl: config.baseUrl,
      getAccessToken,
      provisionAccount: true,
    });
    return await fetchNextLearningActivity(client, childProfileId);
  } catch {
    return NO_SUGGESTION;
  }
}
