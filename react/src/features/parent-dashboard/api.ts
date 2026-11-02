import { client } from '../../lib/data-client';
import type { Schema } from '../../../../amplify/data/resource';
import { getAccessToken } from '../../api/auth';
import { createApiClient, type ApiClient } from '../../api/client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../../api/config';

type AIInteractionAudit = Schema['AIInteractionAudit']['type'];
type AmplifySafetyEvent = Schema['SafetyEvent']['type'];

/**
 * What the dashboard shows of one safety event, owned here rather than taken
 * from the Amplify schema, so a Django build (LAI-0706) and an Amplify build
 * render the same shape. Metadata only: never the text that was replaced.
 */
export interface SafetyEvent {
  id: string;
  category: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  actionTaken: string;
  reviewStatus: 'OPEN' | 'REVIEWED' | 'DISMISSED';
  createdAt: string;
}

const SEVERITIES = new Set(['LOW', 'MEDIUM', 'HIGH']);
const REVIEW_STATUSES = new Set(['OPEN', 'REVIEWED', 'DISMISSED']);

/** Reads one Django safety event, or undefined if it does not match the contract. */
export function readSafetyEvent(raw: unknown): SafetyEvent | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const { id, category, severity, actionTaken, reviewStatus, createdAt } = r;
  if (
    typeof id !== 'string' ||
    typeof category !== 'string' ||
    typeof severity !== 'string' ||
    !SEVERITIES.has(severity) ||
    typeof actionTaken !== 'string' ||
    typeof reviewStatus !== 'string' ||
    !REVIEW_STATUSES.has(reviewStatus) ||
    typeof createdAt !== 'string'
  ) {
    return undefined;
  }
  return {
    id,
    category,
    severity: severity as SafetyEvent['severity'],
    actionTaken,
    reviewStatus: reviewStatus as SafetyEvent['reviewStatus'],
    createdAt,
  };
}

/**
 * The AI history store follows the build's backend, like the profile store
 * (ADR-039): with the Django API every AI turn is audited by Django
 * (ADR-044), so its safety events are read and cleared there.
 */
export interface AiHistoryStore {
  listSafetyEvents(childProfileId: string): Promise<SafetyEvent[]>;
  clearAIHistory(childProfileId: string): Promise<void>;
}

export function createDjangoAiHistoryStore(api: ApiClient): AiHistoryStore {
  const path = (childId: string, rest: string) =>
    `children/${encodeURIComponent(childId)}/ai/${rest}/`;
  return {
    async listSafetyEvents(childProfileId) {
      const response = await api.request('GET', path(childProfileId, 'safety-events'));
      const results = (response.data as { results?: unknown } | null)?.results;
      if (!Array.isArray(results)) return [];
      return results
        .map(readSafetyEvent)
        .filter((event): event is SafetyEvent => event !== undefined);
    },
    async clearAIHistory(childProfileId) {
      await api.request('DELETE', path(childProfileId, 'history'));
    },
  };
}

export function aiHistoryStoreFor(config: DjangoApiConfig = DJANGO_API_CONFIG): AiHistoryStore {
  if (!config.enabled)
    return { listSafetyEvents: listAmplifySafetyEvents, clearAIHistory: clearAmplifyAIHistory };
  return createDjangoAiHistoryStore(
    createApiClient({ baseUrl: config.baseUrl, getAccessToken, provisionAccount: true }),
  );
}

let historyStore: AiHistoryStore | null = null;
function currentHistoryStore(): AiHistoryStore {
  historyStore ??= aiHistoryStoreFor();
  return historyStore;
}

export const listSafetyEvents = (childProfileId: string) =>
  currentHistoryStore().listSafetyEvents(childProfileId);
export const clearAIHistory = (childProfileId: string) =>
  currentHistoryStore().clearAIHistory(childProfileId);

/**
 * Parent-facing safety visibility (docs/AI_AND_CHILD_SAFETY.md "Parent
 * transparency": "safety events requiring attention, using carefully
 * reviewed language"). Read-only - review/dismissal of a `SafetyEvent`
 * remains an admin/reviewer workflow that does not exist yet
 * (docs/AUTHORIZATION_REVIEW.md section 4.3); this only lets a parent see
 * that Chatty replaced an AI response with authored content for their own
 * child, newest first.
 */
async function listAmplifySafetyEvents(childProfileId: string): Promise<SafetyEvent[]> {
  const { data } = await client.models.SafetyEvent.list();
  return data
    .filter((event: AmplifySafetyEvent) => event.childProfileId === childProfileId)
    .sort((a: AmplifySafetyEvent, b: AmplifySafetyEvent) => b.createdAt.localeCompare(a.createdAt))
    .map((event: AmplifySafetyEvent) => ({
      id: event.id,
      category: event.category,
      severity: event.severity,
      actionTaken: event.actionTaken,
      reviewStatus: event.reviewStatus,
      createdAt: event.createdAt,
    }));
}

/**
 * Parent-controlled retention (docs/ROADMAP.md Phase 7: "controls for AI,
 * voice, session time, and retention"). Permanently deletes every stored
 * `AIInteractionAudit` and `SafetyEvent` row for one child — the metadata
 * `docs/DATA_MODEL.md` says these models keep "by default" — without
 * touching gameplay records (`AdventureSession`/`SkillProgress`/
 * `WorldChange`) or saved stories, which have their own dedicated,
 * per-item retention control (`src/routes/StoryKeepsakes.tsx`).
 */
async function clearAmplifyAIHistory(childProfileId: string): Promise<void> {
  const [{ data: audits }, { data: safetyEvents }] = await Promise.all([
    client.models.AIInteractionAudit.list(),
    client.models.SafetyEvent.list(),
  ]);

  const ownAudits = audits.filter(
    (audit: AIInteractionAudit) => audit.childProfileId === childProfileId,
  );
  const ownSafetyEvents = safetyEvents.filter(
    (event: AmplifySafetyEvent) => event.childProfileId === childProfileId,
  );

  await Promise.all([
    ...ownAudits.map((audit: AIInteractionAudit) =>
      client.models.AIInteractionAudit.delete({ id: audit.id }),
    ),
    ...ownSafetyEvents.map((event: AmplifySafetyEvent) =>
      client.models.SafetyEvent.delete({ id: event.id }),
    ),
  ]);
}
