import type { ApiClient } from '../../api/client';
import { djangoClient } from '../../api/djangoClient';

/**
 * What the dashboard shows of one safety event (LAI-0706). Metadata only: never the text that
 * was replaced.
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
 * A child's AI history on Django (`ai/safety-events/`, `ai/history/`): every AI turn is audited
 * by Django (ADR-044), so its safety events are read and cleared there (AMP-03: the Amplify
 * `SafetyEvent` and `AIInteractionAudit` path is gone).
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

/** The store over this app's Django client. */
export function aiHistoryStore(api: ApiClient = djangoClient()): AiHistoryStore {
  return createDjangoAiHistoryStore(api);
}

let historyStore: AiHistoryStore | null = null;
function currentHistoryStore(): AiHistoryStore {
  historyStore ??= aiHistoryStore();
  return historyStore;
}

export const listSafetyEvents = (childProfileId: string) =>
  currentHistoryStore().listSafetyEvents(childProfileId);
export const clearAIHistory = (childProfileId: string) =>
  currentHistoryStore().clearAIHistory(childProfileId);
