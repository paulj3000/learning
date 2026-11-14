/**
 * Household co-op sessions (ADR-006) on the Django API (AMP-05,
 * `lai/apps/game_sessions/coop_views.py`). Every route is child-scoped: the
 * child in the path is the one acting, and Django checks that the signed-in
 * parent hosts the session and owns that child.
 *
 * Live updates are polling of the GET route (`subscribeToCoopSession`), which
 * replaced the AppSync `onUpdate` subscription. ADR-026 keeps continuous
 * real-time play on the separate room server; co-op is a handful of discrete
 * claims and join/leave flags, so a short poll is enough.
 */
import { getAccessToken } from '../../api/auth';
import { createApiClient, type ApiClient } from '../../api/client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../../api/config';
import { ApiError } from '../../api/errors';
import { read } from '../../api/parse';
import { parseCoopSharedState, type CoopSharedState } from './types';

export type CoopSessionStatus = 'ACTIVE' | 'COMPLETED' | 'ABANDONED';

export interface CoopSession {
  id: string;
  templateSlug: string;
  templateVersion: number;
  participantChildProfileIds: string[];
  status: CoopSessionStatus;
  sharedState: CoopSharedState;
  startedAt: string;
  lastActivityAt: string;
  completedAt: string | null;
}

export type ClaimOutcome = 'claimed' | 'already_held' | 'held_by_partner';

/** How often a joined client re-reads the shared state. */
export const COOP_POLL_INTERVAL_MS = 2000;

function parseSession(data: unknown): CoopSession {
  return read(data, (r) => ({
    id: r.field('id').string(),
    templateSlug: r.field('templateSlug').string(),
    templateVersion: r.field('templateVersion').integer(),
    participantChildProfileIds: r.field('participantChildProfileIds').array((id) => id.string()),
    status: r.field('status').oneOf<CoopSessionStatus>(['ACTIVE', 'COMPLETED', 'ABANDONED']),
    sharedState: parseCoopSharedState(r.field('sharedState').value),
    startedAt: r.field('startedAt').string(),
    lastActivityAt: r.field('lastActivityAt').string(),
    completedAt: r.field('completedAt').nullable((at) => at.string()),
  }));
}

function requireId(value: string, name: string): void {
  if (!value) throw new ApiError('invalid_request', { code: `empty_${name}` });
}

const base = (childId: string) => `children/${encodeURIComponent(childId)}/coop-sessions/`;
const sessionPath = (childId: string, coopId: string) =>
  `${base(childId)}${encodeURIComponent(coopId)}/`;

function defaultClient(config: DjangoApiConfig = DJANGO_API_CONFIG): ApiClient {
  return createApiClient({ baseUrl: config.baseUrl, getAccessToken, provisionAccount: true });
}

/**
 * Starts a session for exactly two of the signed-in parent's own children
 * (docs/DATA_MODEL.md CoopSession: "2 for v1"). Django pins the adventure's
 * current version and refuses another family's child or an unsuited band.
 */
export async function startCoopSession(
  templateSlug: string,
  [hostChildId, partnerChildId]: [string, string],
  client: ApiClient = defaultClient(),
): Promise<CoopSession> {
  requireId(hostChildId, 'child');
  requireId(partnerChildId, 'partner');
  const response = await client.request('POST', base(hostChildId), {
    body: { adventureSlug: templateSlug, partnerChildId },
  });
  return parseSession(response.data);
}

export async function getCoopSession(
  childProfileId: string,
  coopSessionId: string,
  client: ApiClient = defaultClient(),
): Promise<CoopSession> {
  requireId(childProfileId, 'child');
  requireId(coopSessionId, 'session');
  const response = await client.request('GET', sessionPath(childProfileId, coopSessionId));
  return parseSession(response.data);
}

/**
 * Claims a co-op-eligible step's shared slot (docs/ADVENTURE_ENGINE.md
 * "Co-op sessions"). Django serialises claims with a row lock: the first
 * wins, a repeat by the same child changes nothing, and a slot the other
 * child holds is not an error. The returned session already shows whichever
 * outcome happened.
 */
export async function claimCoopSlot(
  coopSessionId: string,
  slotKey: string,
  childProfileId: string,
  client: ApiClient = defaultClient(),
): Promise<CoopSession> {
  requireId(childProfileId, 'child');
  requireId(coopSessionId, 'session');
  requireId(slotKey, 'slot');
  const response = await client.request(
    'POST',
    `${sessionPath(childProfileId, coopSessionId)}slots/`,
    { body: { slotKey } },
  );
  return read(response.data, (r) => {
    r.field('outcome').oneOf<ClaimOutcome>(['claimed', 'already_held', 'held_by_partner']);
    return parseSession(r.field('session').value);
  });
}

export function slotClaimedBy(session: CoopSession, slotKey: string): string | null {
  return session.sharedState.slots[slotKey] ?? null;
}

/**
 * Best-effort join/leave presence: not conflict-resolved like a claim, since
 * ADR-006 excludes continuous presence from v1 and a lost toggle has no
 * gameplay consequence.
 */
export async function setCoopPresence(
  coopSessionId: string,
  childProfileId: string,
  present: boolean,
  client: ApiClient = defaultClient(),
): Promise<CoopSession> {
  requireId(childProfileId, 'child');
  requireId(coopSessionId, 'session');
  const response = await client.request(
    'POST',
    `${sessionPath(childProfileId, coopSessionId)}presence/`,
    { body: { present } },
  );
  return parseSession(response.data);
}

/** Idempotent: both children's clients may call it as each reaches the end. */
export async function completeCoopSession(
  coopSessionId: string,
  childProfileId: string,
  client: ApiClient = defaultClient(),
): Promise<CoopSession> {
  requireId(childProfileId, 'child');
  requireId(coopSessionId, 'session');
  const response = await client.request(
    'POST',
    `${sessionPath(childProfileId, coopSessionId)}complete/`,
  );
  return parseSession(response.data);
}

export interface PollOptions {
  intervalMs?: number;
  client?: ApiClient;
}

/**
 * Live shared state by polling the GET route: once straight away, then every
 * `intervalMs`, one request at a time. The returned function stops it; no
 * request is started and no callback runs after that. A failed poll is
 * skipped quietly and the next one tries again.
 */
export function subscribeToCoopSession(
  coopSessionId: string,
  childProfileId: string,
  onChange: (session: CoopSession) => void,
  { intervalMs = COOP_POLL_INTERVAL_MS, client }: PollOptions = {},
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let api: ApiClient | undefined = client;

  async function poll(): Promise<void> {
    try {
      api ??= defaultClient();
      const session = await getCoopSession(childProfileId, coopSessionId, api);
      if (!stopped) onChange(session);
    } catch {
      // The next poll tries again; a co-op hiccup never interrupts play.
    }
    if (!stopped) timer = setTimeout(() => void poll(), intervalMs);
  }

  void poll();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}

export { parseCoopSharedState, type CoopSharedState };
