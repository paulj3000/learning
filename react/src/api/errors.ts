/**
 * Every failure from the Django API as one typed error (TR-6).
 *
 * `kind` is what callers branch on; `code` is the server's stable error code
 * from the LAI-0205 envelope (docs/ARCHITECTURE.md, "Django API
 * conventions"), or a client-side one for failures that never reached the
 * server. Messages here are for developers and logs only: child-facing copy
 * comes from the UI, keyed by `kind` and `code`, so it stays localizable.
 */

export type ApiErrorKind =
  /** 400: the request was malformed. A bug in the client, or an impossible answer. */
  | 'invalid_request'
  /** 401 after one forced token refresh: the parent must sign in again. */
  | 'unauthenticated'
  /** 403: signed in, but not allowed (e.g. account not provisioned). */
  | 'forbidden'
  /** 404: unknown, unpublished, retired, or another family's. Never distinguishable. */
  | 'not_found'
  /** 409: a gameplay conflict; `code` says which (see `PlayConflictCode`). */
  | 'conflict'
  /** 503: authentication or the server is temporarily unavailable. Never sign out on this. */
  | 'unavailable'
  /** Any other 5xx. */
  | 'server'
  /** The request never got a response (offline, DNS, CORS, timeout). */
  | 'network'
  /** A response arrived but did not match the documented contract. */
  | 'invalid_response'
  /** The caller cancelled it (a newer request replaced it). Not shown to anyone. */
  | 'aborted'
  /** The Django API is not configured for this build (`VITE_BACKEND`). */
  | 'disabled';

/** The 409 codes the play API documents (docs/PLAY_API.md, "Error codes specific to play"). */
export type PlayConflictCode =
  | 'content_unavailable'
  | 'session_not_open'
  | 'invalid_transition'
  | 'chest_already_open'
  | 'attempt_already_answered'
  | 'quest_unavailable';

export interface ValidationDetail {
  message: string;
  code: string;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string;
  readonly requestId: string | null;
  /** Per-field validation details, for a 400 `validation_error`. */
  readonly details: Readonly<Record<string, readonly ValidationDetail[]>>;

  constructor(
    kind: ApiErrorKind,
    options: {
      status?: number | null;
      code?: string;
      requestId?: string | null;
      details?: Record<string, readonly ValidationDetail[]>;
    } = {},
  ) {
    super(`Django API error: ${kind}${options.code ? ` (${options.code})` : ''}`);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = options.status ?? null;
    this.code = options.code ?? kind;
    this.requestId = options.requestId ?? null;
    this.details = options.details ?? {};
  }

  /** A transient failure worth offering "try again" for. */
  get retryable(): boolean {
    return this.kind === 'network' || this.kind === 'unavailable' || this.kind === 'server';
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isConflict(error: unknown, code: PlayConflictCode): boolean {
  return isApiError(error) && error.kind === 'conflict' && error.code === code;
}

export function kindForStatus(status: number): ApiErrorKind {
  if (status === 400) return 'invalid_request';
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 503) return 'unavailable';
  if (status >= 500) return 'server';
  return 'invalid_request';
}
