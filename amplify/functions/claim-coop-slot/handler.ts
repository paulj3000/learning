import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { AppSyncIdentityCognito, AppSyncResolverEvent } from 'aws-lambda';
import type { Schema } from '../../data/resource';

/**
 * Custom Lambda resolver for the `claimCoopSlot` mutation
 * (amplify/data/resource.ts). This function has its own IAM role and talks
 * to DynamoDB directly (wired in amplify/backend.ts) rather than going
 * through AppSync's generated resolvers, which is exactly why it has to
 * redo the host/participant/status checks AppSync would otherwise have
 * handled — nothing upstream of this code has verified the caller yet.
 *
 * Not deploy-verified against a real DynamoDB table in this session (no
 * AWS credentials available here, per docs/PILOT_READINESS.md's recurring
 * note). One assumption this code depends on and could not confirm live:
 * that Amplify's default DynamoDB resolver mapping stores an `a.json()`
 * object field (`CoopSession.sharedState`) as a native DynamoDB Map (`M`)
 * attribute rather than a JSON-encoded string — required for the nested
 * `sharedState.slots.<slotKey>` attribute-path `ConditionExpression`
 * below to work at all. Confirm this the first time `claimCoopSlot` runs
 * against a real sandbox.
 */

export interface CoopSessionItem {
  id: string;
  hostParentProfileId: string;
  templateSlug: string;
  templateVersion: number;
  participantChildProfileIds: string[];
  status: 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
  sharedState: { slots?: Record<string, string>; presence?: string[] } | null;
  startedAt: string;
  completedAt: string | null;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
}

export type ClaimDecision =
  | { outcome: 'claim' }
  | { outcome: 'already-claimed-by-caller' }
  | { outcome: 'rejected' }
  | { outcome: 'not-host' }
  | { outcome: 'not-participant' }
  | { outcome: 'inactive' };

/**
 * Pure decision logic, kept separate from the AWS SDK calls below so it can
 * be unit tested without mocking DynamoDB (same split
 * amplify/functions/operational-metrics/handler.ts already established
 * with `summarizeRecords`). Does not itself guarantee atomicity — the
 * `ConditionExpression` in `claimSlot` is what actually prevents a race
 * between two children's near-simultaneous claims; this function only
 * decides what *should* happen for a single, already-fetched snapshot.
 */
export function decideClaim(
  session: CoopSessionItem,
  callerSub: string,
  childProfileId: string,
  slotKey: string,
): ClaimDecision {
  if (session.hostParentProfileId !== callerSub) return { outcome: 'not-host' };
  if (!session.participantChildProfileIds.includes(childProfileId))
    return { outcome: 'not-participant' };
  if (session.status !== 'ACTIVE') return { outcome: 'inactive' };

  const existingClaim = session.sharedState?.slots?.[slotKey];
  if (existingClaim === childProfileId) return { outcome: 'already-claimed-by-caller' };
  if (existingClaim) return { outcome: 'rejected' };
  return { outcome: 'claim' };
}

function getCallerSub(identity: AppSyncResolverEvent<unknown>['identity']): string {
  const cognitoIdentity = identity as AppSyncIdentityCognito | null | undefined;
  if (!cognitoIdentity?.sub) {
    throw new Error('claimCoopSlot requires an authenticated caller.');
  }
  return cognitoIdentity.sub;
}

function isConditionalCheckFailed(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}

function tableName(): string {
  const name = process.env.COOP_SESSION_TABLE_NAME;
  if (!name) {
    throw new Error('COOP_SESSION_TABLE_NAME is not set — check amplify/backend.ts wiring.');
  }
  return name;
}

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

async function getSession(id: string): Promise<CoopSessionItem | null> {
  const { Item } = await docClient.send(
    new GetCommand({ TableName: tableName(), Key: { id }, ConsistentRead: true }),
  );
  return (Item as CoopSessionItem | undefined) ?? null;
}

async function claimSlot(
  id: string,
  slotKey: string,
  childProfileId: string,
): Promise<CoopSessionItem | null> {
  try {
    const { Attributes } = await docClient.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { id },
        UpdateExpression: 'SET sharedState.slots.#slotKey = :childId, lastActivityAt = :now',
        ConditionExpression: 'attribute_not_exists(sharedState.slots.#slotKey)',
        ExpressionAttributeNames: { '#slotKey': slotKey },
        ExpressionAttributeValues: { ':childId': childProfileId, ':now': new Date().toISOString() },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return (Attributes as CoopSessionItem | undefined) ?? null;
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      // Another child's claim landed first between our read and this write —
      // not an error the child should see; return the now-current state.
      return getSession(id);
    }
    throw error;
  }
}

type ClaimCoopSlotEvent = AppSyncResolverEvent<{
  coopSessionId: string;
  slotKey: string;
  childProfileId: string;
}>;

export const handler: Schema['claimCoopSlot']['functionHandler'] = async (
  event: ClaimCoopSlotEvent,
) => {
  const { coopSessionId, slotKey, childProfileId } = event.arguments;
  const callerSub = getCallerSub(event.identity);

  const session = await getSession(coopSessionId);
  if (!session) {
    throw new Error('That shared adventure could not be found.');
  }

  const decision = decideClaim(session, callerSub, childProfileId, slotKey);
  switch (decision.outcome) {
    case 'not-host':
      // A real authorization violation, unlike a slot conflict — this is
      // not the benign "someone else got there first" case below, so it
      // does surface as an error.
      throw new Error('Not authorized to claim a slot in this shared adventure.');
    case 'not-participant':
      throw new Error('That child is not part of this shared adventure.');
    case 'inactive':
      throw new Error('This shared adventure is no longer active.');
    case 'already-claimed-by-caller':
      // Idempotent: this child already holds this slot, nothing to write.
      return session;
    case 'rejected':
      // Rejected server-side, not surfaced as an error
      // (docs/ADVENTURE_ENGINE.md "Co-op sessions"): the caller re-renders
      // this already-current, already-claimed-by-someone-else state.
      return session;
    case 'claim':
      return (await claimSlot(coopSessionId, slotKey, childProfileId)) ?? session;
  }
};
