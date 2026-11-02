import { getAccessToken } from '../auth';
import { createApiClient, type ApiClient } from '../client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../config';
import { ApiError } from '../errors';

/**
 * Chatty's companion and tutor turns on the Django API (LAI-0706, ADR-044,
 * docs/AI_SERVICE.md section 2). Selected by the build's backend: with
 * `VITE_BACKEND=django` every turn goes to Django; without it this module
 * returns `null` and the feature modules keep calling the Amplify routes.
 *
 * Django builds the prompt, applies the Guardrail, validates the model
 * output, falls back to authored content and writes the audit row. The
 * browser sends only the turn's authored context (never a child's age band,
 * a length limit, a prompt, or an audit value) and never talks to Bedrock.
 *
 * The child id is the one the route selected; Django resolves it through the
 * signed-in parent, so another family's child is a 404 (`not_found`).
 */

export type AiTurnSource = 'AI' | 'FALLBACK';

/** `CLIENT_AUTHORED` until the caller's session runs on Django (LAI-0709). */
export type AiContextSource = 'CLIENT_AUTHORED' | 'DJANGO_SESSION';

export interface CompanionTurnBody {
  intent: string;
  templateId: string;
  stepSummary: string;
  authoredBaseText?: string;
  learningObjectiveCode?: string;
  hintLevel?: number;
  allowedChoiceIds?: string[];
  sessionId?: string;
  stepId?: string;
  contextSource?: AiContextSource;
}

export interface TutorTurnBody {
  skillId: string;
  templateId: string;
  hintLevel: number;
  authoredBaseText?: string;
  sessionId?: string;
  stepId?: string;
  contextSource?: AiContextSource;
}

/** The raw `turn` object (still validated by the caller) and its source. */
export interface DjangoTurnResponse {
  turn: Record<string, unknown>;
  source: AiTurnSource;
  requestId: string | null;
}

export interface DjangoAiApi {
  companionTurn(
    childId: string,
    body: CompanionTurnBody,
    signal?: AbortSignal,
  ): Promise<DjangoTurnResponse>;
  tutorTurn(
    childId: string,
    body: TutorTurnBody,
    signal?: AbortSignal,
  ): Promise<DjangoTurnResponse>;
}

// Identifiers the server accepts (`lai/apps/ai/serializers.py`); anything else would be a 400.
const IDENTIFIER = /^[a-z0-9][a-z0-9:._-]*$/;
const MAX_IDENTIFIER = 100;

/** A slug-safe template id: lower-cased, unsafe characters replaced, never empty. */
export function templateIdFor(raw: string | undefined, fallback = 'island'): string {
  const cleaned = (raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9:._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, MAX_IDENTIFIER);
  return cleaned && IDENTIFIER.test(cleaned) ? cleaned : fallback;
}

/** Drops optional fields the server would reject, so a caller's odd value never costs a turn. */
function compact(body: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null || value === '') continue;
    if (
      (key === 'sessionId' || key === 'stepId' || key === 'learningObjectiveCode') &&
      !(typeof value === 'string' && IDENTIFIER.test(value) && value.length <= MAX_IDENTIFIER)
    ) {
      continue;
    }
    if (key === 'allowedChoiceIds') {
      const ids = (value as unknown[]).filter(
        (id): id is string => typeof id === 'string' && IDENTIFIER.test(id) && id.length <= 64,
      );
      if (ids.length > 0) out[key] = ids.slice(0, 6);
      continue;
    }
    out[key] = value;
  }
  return out;
}

function readTurnResponse(data: unknown): DjangoTurnResponse {
  const body = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
  const turn = body?.turn;
  const source = body?.source;
  if (
    !body ||
    typeof turn !== 'object' ||
    turn === null ||
    Array.isArray(turn) ||
    (source !== 'AI' && source !== 'FALLBACK')
  ) {
    throw new ApiError('invalid_response', { code: 'ai_turn_shape' });
  }
  return {
    turn: turn as Record<string, unknown>,
    source,
    requestId: typeof body.requestId === 'string' ? body.requestId : null,
  };
}

function childPath(childId: string, route: string): string {
  if (!childId) throw new ApiError('invalid_request', { code: 'empty_id' });
  return `children/${encodeURIComponent(childId)}/ai/${route}/`;
}

export function createDjangoAiApi(client: ApiClient): DjangoAiApi {
  return {
    async companionTurn(childId, body, signal) {
      const response = await client.request('POST', childPath(childId, 'companion-turns'), {
        body: compact(body),
        signal,
      });
      return readTurnResponse(response.data);
    },
    async tutorTurn(childId, body, signal) {
      const response = await client.request('POST', childPath(childId, 'tutor-turns'), {
        body: compact(body),
        signal,
      });
      return readTurnResponse(response.data);
    },
  };
}

/** The build's Django AI API, or null when this build still uses the Amplify routes. */
export function djangoAiApiFor(config: DjangoApiConfig = DJANGO_API_CONFIG): DjangoAiApi | null {
  if (!config.enabled) return null;
  return createDjangoAiApi(
    createApiClient({ baseUrl: config.baseUrl, getAccessToken, provisionAccount: true }),
  );
}

let cached: DjangoAiApi | null | undefined;

/** One shared instance per page load (the config is fixed at build time). */
export function currentDjangoAiApi(): DjangoAiApi | null {
  if (cached === undefined) cached = djangoAiApiFor();
  return cached;
}
