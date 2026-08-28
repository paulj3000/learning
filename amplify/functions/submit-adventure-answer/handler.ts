import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { AppSyncIdentityCognito, AppSyncResolverEvent } from 'aws-lambda';
import type { Schema } from '../../data/resource';
import { getAdventureTemplate } from '../../../src/features/adventures/content';
import {
  getNextStepId,
  getStep,
  isGuidedCompletion,
  nextHintLevel,
  validateStepAnswer,
} from '../../../src/features/adventures/engine';
import type { AdventureStep, Correctness } from '../../../src/features/adventures/engine/types';
import type { StepAnswer } from '../../../src/features/adventures/engine/validators';
import { withRequestLog } from '../shared/requestLog';

/**
 * Custom Lambda resolver for the `submitAdventureAnswer` mutation
 * (amplify/data/resource.ts, docs/DECISIONS.md ADR-012). Imports the exact
 * same deterministic engine and content modules the web client already
 * uses (`src/features/adventures/engine`, `src/features/adventures/content`)
 * — the answer key never has to move to the database for this Lambda to be
 * authoritative about it; it just has to run somewhere the caller cannot
 * edit, which a Lambda bundle already is. Every one of those imports is
 * plain, framework-free TypeScript with no browser dependency (confirmed
 * by the docs/platform/CURRENT_PLATFORM_AUDIT.md sweep), so this is a
 * bundling choice, not a new coupling.
 *
 * Talks to DynamoDB directly (wired in amplify/backend.ts) rather than
 * through AppSync's generated resolvers, same reason and same tradeoff as
 * `amplify/functions/claim-coop-slot/handler.ts`: bypassing AppSync's own
 * per-row owner authorization here means this code has to re-derive it by
 * hand, via `ChildProfile.ownerSub` (see that field's doc comment in
 * amplify/data/resource.ts).
 *
 * Not deploy-verified against a real DynamoDB table in this session (no
 * AWS credentials available here, same recurring constraint documented
 * throughout docs/IMPLEMENTATION_STATUS.md and
 * docs/AUTHORIZATION_REVIEW.md). One assumption this code depends on and
 * could not confirm live: that a plain `UpdateExpression` touching only
 * `currentStepId`/`lastActivityAt` leaves every other attribute, including
 * the owner-authorization field AppSync manages on this table, untouched.
 * Confirm this the first time it runs against a real sandbox.
 *
 * Note on `answer`'s wire shape: unlike `a.json()` *model fields*
 * (`src/lib/awsJson.ts`'s doc comment — those travel as a JSON-encoded
 * string end to end, a mistake that shipped four times in this codebase
 * before that module existed), the generated type for this *mutation
 * argument* (`Schema['submitAdventureAnswer']['functionHandler']`) is a
 * plain JSON-value union, not `string` — confirmed by `tsc` itself
 * rejecting a `decodeAwsJson(event.arguments.answer)` call here with a
 * type error, not by a live call. AppSync's Direct Lambda Resolver
 * apparently deserializes an `AWSJSON` *argument* before invoking the
 * handler, unlike an `AWSJSON` *column* read through the generated Data
 * client. `src/features/adventures/api.ts`'s `submitAdventureAnswer`
 * wrapper passes the argument as a plain object for the same reason, with
 * no `encodeAwsJson` call.
 */

export interface AdventureSessionItem {
  id: string;
  childProfileId: string;
  templateSlug: string;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ABANDONED' | 'SAFETY_STOPPED';
  currentStepId: string;
}

export interface ChildProfileItem {
  id: string;
  ownerSub: string | null;
}

export interface SubmissionDecision {
  correctness: Correctness;
  supportLevel: number;
  action: 'RETRY' | 'ADVANCE';
  /** Set only when `action` is `'ADVANCE'`. */
  nextStepId?: string;
}

/**
 * Pure decision logic, kept separate from the AWS SDK calls below so it can
 * be unit tested without mocking DynamoDB (same split
 * `amplify/functions/claim-coop-slot/handler.ts`'s `decideClaim` already
 * established). Mirrors `useAdventureSession.submitAnswer`'s decision tree
 * exactly (`src/features/adventures/useAdventureSession.ts`): a wrong
 * answer on a step with a hint policy retries and escalates the hint
 * ladder instead of advancing, unless the ladder has already reached
 * "guided completion" (`isGuidedCompletion`), in which case the child is
 * carried forward as if correct — the same age-appropriate "never let a
 * child get stuck forever" rule the client used to apply itself.
 */
export function decideSubmission(
  step: AdventureStep,
  answer: StepAnswer,
  hintLevel: number,
): SubmissionDecision {
  const correctness = validateStepAnswer(step, answer);
  const needsRetry =
    (correctness === 'incorrect' || correctness === 'partial') && Boolean(step.hintPolicy);

  if (needsRetry) {
    const escalatedHintLevel = nextHintLevel(hintLevel);
    if (isGuidedCompletion(escalatedHintLevel)) {
      const finalCorrectness: Correctness = 'correct';
      return {
        correctness: finalCorrectness,
        supportLevel: escalatedHintLevel,
        action: 'ADVANCE',
        nextStepId: getNextStepId(step, finalCorrectness),
      };
    }
    return { correctness, supportLevel: escalatedHintLevel, action: 'RETRY' };
  }

  return {
    correctness,
    supportLevel: hintLevel,
    action: 'ADVANCE',
    nextStepId: getNextStepId(step, correctness),
  };
}

/**
 * Minimal shape guard for the decoded `answer` argument, external data at
 * this boundary (CLAUDE.md section 13). Deliberately shallow: anything
 * that gets past this but still does not match `step.presentation.kind`
 * is rejected by `validateStepAnswer` itself, which throws on a kind
 * mismatch rather than guessing.
 */
export function isStepAnswer(value: unknown): value is StepAnswer {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return false;
  const kind = (value as { kind: unknown }).kind;
  switch (kind) {
    case 'number-input':
      return typeof (value as { value?: unknown }).value === 'number';
    case 'choice':
    case 'short-response':
    case 'creative-choice':
      return typeof (value as { optionId?: unknown }).optionId === 'string';
    case 'ordering':
      return Array.isArray((value as { order?: unknown }).order);
    case 'matching':
      return Array.isArray((value as { pairs?: unknown }).pairs);
    case 'reflection':
    case 'narrative':
    case 'world-change':
      return true;
    default:
      return false;
  }
}

function getCallerSub(identity: AppSyncResolverEvent<unknown>['identity']): string {
  const cognitoIdentity = identity as AppSyncIdentityCognito | null | undefined;
  if (!cognitoIdentity?.sub) {
    throw new Error('submitAdventureAnswer requires an authenticated caller.');
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

async function getSession(id: string): Promise<AdventureSessionItem | null> {
  const { Item } = await docClient.send(
    new GetCommand({
      TableName: tableName('ADVENTURE_SESSION_TABLE_NAME'),
      Key: { id },
      ConsistentRead: true,
    }),
  );
  return (Item as AdventureSessionItem | undefined) ?? null;
}

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

async function advanceSession(id: string, nextStepId: string): Promise<void> {
  await docClient.send(
    new UpdateCommand({
      TableName: tableName('ADVENTURE_SESSION_TABLE_NAME'),
      Key: { id },
      UpdateExpression: 'SET currentStepId = :next, lastActivityAt = :now',
      ExpressionAttributeValues: { ':next': nextStepId, ':now': new Date().toISOString() },
    }),
  );
}

const CORRECTNESS_TO_SCHEMA: Record<Correctness, string> = {
  correct: 'CORRECT',
  incorrect: 'INCORRECT',
  partial: 'PARTIAL',
  not_applicable: 'NOT_APPLICABLE',
};

export const handler: Schema['submitAdventureAnswer']['functionHandler'] = async (
  event,
  context,
) => {
  const { sessionId, answer, hintLevel } = event.arguments;

  return withRequestLog(
    {
      functionName: 'submitAdventureAnswer',
      requestId: context.awsRequestId,
      headers: event.request?.headers,
      // Not known until the session lookup below resolves it — logged as
      // null rather than restructuring this already-tested control flow
      // just to capture it earlier (see requestLog.ts's doc comment).
      childProfileId: null,
    },
    async () => {
      const callerSub = getCallerSub(event.identity);

      const session = await getSession(sessionId);
      if (!session) {
        throw new Error('That adventure could not be found.');
      }
      if (session.status !== 'ACTIVE') {
        throw new Error('This adventure is no longer active.');
      }

      const child = await getChildProfile(session.childProfileId);
      if (!child?.ownerSub || child.ownerSub !== callerSub) {
        throw new Error('Not authorized for this adventure.');
      }

      const definition = getAdventureTemplate(session.templateSlug);
      if (!definition) {
        throw new Error('That adventure’s content could not be found.');
      }
      const step = getStep(definition, session.currentStepId);

      if (!isStepAnswer(answer)) {
        throw new Error('That answer could not be understood.');
      }

      const decision = decideSubmission(step, answer, hintLevel);

      if (decision.action === 'ADVANCE' && decision.nextStepId) {
        await advanceSession(sessionId, decision.nextStepId);
      }

      return {
        correctness: CORRECTNESS_TO_SCHEMA[decision.correctness],
        supportLevel: decision.supportLevel,
        action: decision.action,
        nextStepId: decision.nextStepId ?? null,
      };
    },
  );
};
