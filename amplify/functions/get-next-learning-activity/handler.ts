import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { AppSyncIdentityCognito, AppSyncResolverEvent } from 'aws-lambda';
import type { Schema } from '../../data/resource';
import { hasSkillBasedSignal, rankAdventures } from '../../../src/features/director/select';
import { reachableAdventures } from '../../../src/features/director/reachability';
import type { SelectionRecord, SelectionReason } from '../../../src/features/director/types';
import { listSkillsByAgeBand } from '../../../src/features/curriculum/queries';
import {
  buildMasterySummary,
  indexProgressBySkill,
  type SkillProgressLike,
} from '../../../src/features/mastery/summary';
import type { AgeBandValue } from '../../../src/features/child-profile/constants';
import { withRequestLog } from '../shared/requestLog';

/**
 * Custom Lambda resolver for the `getNextLearningActivity` query
 * (amplify/data/resource.ts, docs/DECISIONS.md ADR-016). Imports the exact
 * same pure Director modules the web client already used
 * (`src/features/director/select.ts`/`needs.ts`, already covered by
 * `select.test.ts`/`needs.test.ts`) — this Lambda's own job is only
 * assembling that module's `DirectorContext` input from DynamoDB and
 * flattening its `SelectionRecord[]` output for the wire, not
 * reimplementing the ranking itself.
 *
 * Talks to DynamoDB directly, same reason and tradeoff as
 * `claim-coop-slot`/`submit-adventure-answer`: a custom query bypasses
 * AppSync's per-row owner authorization, so this code re-derives it by
 * hand via `ChildProfile.ownerSub` before reading anything else.
 *
 * Reads `AdventureSession`/`WorldChange`/`SkillProgress` with a `Scan` +
 * `FilterExpression` on `childProfileId`, not a `Query` against a
 * secondary index. Amplify Data's `hasMany`/`belongsTo` relationships
 * likely generate a `childProfileId`-keyed GSI on each of these tables
 * (used internally by the generated `.adventureSessions()`-style
 * accessors), which would be more efficient — but this sandbox has no way
 * to confirm that index's actual name without a live deploy, and guessing
 * wrong would fail loudly at runtime. A full-table `Scan` needs no such
 * knowledge and is the same tradeoff `docs/platform/DEVICE_SYNC_AND_OFFLINE_SAFETY.md`
 * already accepted for a different reason; at this product's actual data
 * volume (tens of rows per child, not thousands) the cost is negligible.
 * Revisit once a real deploy can confirm the generated index name.
 *
 * `storiesInProgress` is always passed as `[]`: the one caller of the
 * client-side Director this Lambda replaces
 * (`src/routes/ChildDashboard.tsx`) never supplied `storyIdForAdventure`
 * either, so the `CONTINUES_STORY` reason was already unreachable in
 * production — this Lambda matches that existing behavior exactly rather
 * than fetching `ChildStoryProgress` for a code path nothing exercises.
 *
 * Not deploy-verified against a real DynamoDB table in this session (no
 * AWS credentials available here, the same recurring constraint documented
 * throughout `docs/IMPLEMENTATION_STATUS.md`).
 */

export interface ChildProfileItem {
  id: string;
  ownerSub: string | null;
  ageBand: AgeBandValue;
}

interface AdventureSessionItem {
  templateSlug: string;
  status: string;
  lastActivityAt: string;
}

interface WorldChangeItem {
  changeKey: string;
}

/** Flattened wire shape for one `SelectionReason` — see the schema comment on `SelectionReasonType`. */
export interface WireSelectionReason {
  kind: SelectionReason['kind'];
  skillId: string | null;
  status: string | null;
  weight: number | null;
  storyId: string | null;
  penalty: number | null;
}

/** Pure: flattens one discriminated-union `SelectionReason` into `SelectionReasonType`'s shape. */
export function flattenReason(reason: SelectionReason): WireSelectionReason {
  return {
    kind: reason.kind,
    skillId: reason.kind === 'PRACTISES_SKILL' ? reason.skillId : null,
    status: reason.kind === 'PRACTISES_SKILL' ? reason.status : null,
    weight: reason.kind === 'PRACTISES_SKILL' ? reason.weight : null,
    storyId: reason.kind === 'CONTINUES_STORY' ? reason.storyId : null,
    penalty:
      reason.kind === 'ALREADY_COMPLETED' || reason.kind === 'PLAYED_RECENTLY'
        ? reason.penalty
        : null,
  };
}

export interface WireSuggestion {
  adventureSlug: string;
  title: string;
  score: number;
  reasons: WireSelectionReason[];
}

export interface NextLearningActivityResult {
  suggestions: WireSuggestion[];
  hasPersonalizedSignal: boolean;
}

/**
 * Pure: the top 3 ranked adventures, flattened for the wire, plus the
 * Director's own truthfulness guard. Kept separate from DynamoDB
 * assembly so it can be unit tested directly against `SelectionRecord[]`
 * fixtures, the same split `claim-coop-slot`/`submit-adventure-answer`
 * already established for their own decision logic.
 */
export function toResult(ranking: readonly SelectionRecord[]): NextLearningActivityResult {
  return {
    suggestions: ranking.slice(0, 3).map((record) => ({
      adventureSlug: record.adventureSlug,
      title: record.title,
      score: record.score,
      reasons: record.reasons.map(flattenReason),
    })),
    hasPersonalizedSignal: hasSkillBasedSignal(ranking),
  };
}

function getCallerSub(identity: AppSyncResolverEvent<unknown>['identity']): string {
  const cognitoIdentity = identity as AppSyncIdentityCognito | null | undefined;
  if (!cognitoIdentity?.sub) {
    throw new Error('getNextLearningActivity requires an authenticated caller.');
  }
  return cognitoIdentity.sub;
}

function tableName(envVar: string): string {
  const name = process.env[envVar];
  if (!name) {
    throw new Error(`${envVar} is not set — check amplify/backend.ts wiring.`);
  }
  return name;
}

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

async function getChildProfile(id: string): Promise<ChildProfileItem | null> {
  const { Item } = await docClient.send(
    new GetCommand({
      TableName: tableName('CHILD_PROFILE_TABLE_NAME'),
      Key: { id },
      ConsistentRead: true,
    }),
  );
  return (Item as ChildProfileItem | undefined) ?? null;
}

/** Every item in `envVar`'s table with a matching `childProfileId`, across as many pages as it takes. */
async function scanByChildProfileId<T>(envVar: string, childProfileId: string): Promise<T[]> {
  const items: T[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await docClient.send(
      new ScanCommand({
        TableName: tableName(envVar),
        FilterExpression: 'childProfileId = :cid',
        ExpressionAttributeValues: { ':cid': childProfileId },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    items.push(...((result.Items as T[] | undefined) ?? []));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

export const handler: Schema['getNextLearningActivity']['functionHandler'] = async (
  event,
  context,
) => {
  const { childProfileId } = event.arguments;

  return withRequestLog(
    {
      functionName: 'getNextLearningActivity',
      requestId: context.awsRequestId,
      headers: event.request?.headers,
      childProfileId,
    },
    async () => {
      const callerSub = getCallerSub(event.identity);

      const child = await getChildProfile(childProfileId);
      if (!child?.ownerSub || child.ownerSub !== callerSub) {
        throw new Error('Not authorized for this child profile.');
      }

      const [sessions, worldChanges, progressRows] = await Promise.all([
        scanByChildProfileId<AdventureSessionItem>('ADVENTURE_SESSION_TABLE_NAME', childProfileId),
        scanByChildProfileId<WorldChangeItem>('WORLD_CHANGE_TABLE_NAME', childProfileId),
        scanByChildProfileId<SkillProgressLike>('SKILL_PROGRESS_TABLE_NAME', childProfileId),
      ]);

      const recentFirst = [...sessions].sort((a, b) =>
        b.lastActivityAt.localeCompare(a.lastActivityAt),
      );
      const skillIds = listSkillsByAgeBand(child.ageBand).map((skill) => skill.id);
      const masterySummaries = buildMasterySummary(skillIds, indexProgressBySkill(progressRows));
      const candidates = reachableAdventures(
        worldChanges.map((change) => change.changeKey),
        child.ageBand,
      );

      const ranking = rankAdventures(candidates, child.ageBand, {
        masterySummaries,
        completedAdventureSlugs: sessions
          .filter((session) => session.status === 'COMPLETED')
          .map((session) => session.templateSlug),
        recentAdventureSlugs: recentFirst.map((session) => session.templateSlug),
        storiesInProgress: [],
      });

      return toResult(ranking);
    },
  );
};
