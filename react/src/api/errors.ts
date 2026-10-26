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
  | 'disabled'
  /**
   * The selected backend has no contract for this operation yet (LAI-0501A),
   * for example a parent display name or a child photo on Django. Raised
   * before any request, so nothing is half-done.
   */
  | 'unsupported';

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

/**
 * An `ApiError` carrying copy that is safe to show a parent.
 *
 * The account and child-profile screens render `error.message` as written,
 * so the profile API (`parents.ts`, `children.ts`) throws this instead of a
 * bare `ApiError`, whose message is developer text. `apiError` keeps the
 * typed kind and server code for anything that branches on them.
 */
export class ParentFacingError extends Error {
  readonly apiError: ApiError;

  constructor(apiError: ApiError, message: string) {
    super(message);
    this.name = 'ParentFacingError';
    this.apiError = apiError;
  }

  get kind(): ApiErrorKind {
    return this.apiError.kind;
  }

  get code(): string {
    return this.apiError.code;
  }
}

const PARENT_MESSAGES: Partial<Record<string, string>> = {
  child_profile_limit_reached: 'You already have the most child profiles allowed.',
  sensitive_action_unavailable: 'Deleting profiles is not available yet.',
  account_deletion_unavailable: 'Deleting your account is not available yet.',
  display_name_unavailable: 'Changing your name is not available yet.',
  child_photo_unavailable: 'Profile photos are not available yet.',
};

const PARENT_MESSAGES_BY_KIND: Partial<Record<ApiErrorKind, string>> = {
  invalid_request: 'Please check the information you entered and try again.',
  unauthenticated: 'Please sign in again.',
  not_found: 'We could not find that profile.',
  network: 'We could not reach the island. Check your connection and try again.',
  unavailable: 'The island is busy right now. Please try again in a moment.',
  disabled: 'This part of the app is not set up yet.',
};

/** Wraps any failure from the Django API in a `ParentFacingError`; other errors pass through. */
export function toParentFacingError(error: unknown, fallback: string): unknown {
  if (!isApiError(error)) return error;
  const message =
    PARENT_MESSAGES[error.code] ?? PARENT_MESSAGES_BY_KIND[error.kind] ?? fallback;
  return new ParentFacingError(error, message);
}
