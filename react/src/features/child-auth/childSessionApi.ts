import { DJANGO_API_CONFIG } from '../../api/config';
import { API_PREFIX } from '../../api/client';
import { CHILD_CSRF_HEADER } from '../../api/childPrincipal';

/**
 * The child session endpoints (`/api/v1/child-auth/session/`). Plain `fetch`, not the Django
 * client: these calls are what create and read the session, so they never use a parent token
 * and never retry through the child-mode restore path.
 */

export interface ChildSessionChild {
  id: string;
  nickname: string;
  ageBand: string;
  avatarKey: string;
}

export interface ChildSession {
  child: ChildSessionChild;
  csrfToken: string;
  expiresAt: string;
  remembered: boolean;
}

export type SessionFailure =
  /** 401 or 403 for restore: no session, or the device was forgotten. */
  | 'no_session'
  /** 403 `child_sign_in_unavailable`: paused, no consent and similar. */
  | 'unavailable'
  | 'throttled'
  | 'network';

export type SessionResult =
  { ok: true; session: ChildSession } | { ok: false; failure: SessionFailure };

type Fetch = typeof fetch;

function url(path: string, baseUrl: string): string {
  return `${baseUrl}${API_PREFIX}child-auth/session/${path}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads the session body defensively; null when it does not match the contract. */
export function parseChildSession(data: unknown): ChildSession | null {
  if (!isRecord(data) || !isRecord(data.child)) return null;
  const { id, nickname, ageBand, avatarKey } = data.child;
  if (typeof id !== 'string' || id === '') return null;
  if (typeof data.csrfToken !== 'string' || data.csrfToken === '') return null;
  return {
    child: {
      id,
      nickname: typeof nickname === 'string' ? nickname : '',
      ageBand: typeof ageBand === 'string' ? ageBand : '',
      avatarKey: typeof avatarKey === 'string' ? avatarKey : '',
    },
    csrfToken: data.csrfToken,
    expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : '',
    remembered: data.remembered === true,
  };
}

async function call(
  fetchFn: Fetch,
  method: 'GET' | 'POST',
  target: string,
  headers: Record<string, string>,
  body?: Record<string, unknown>,
): Promise<SessionResult> {
  let response: Response;
  try {
    response = await fetchFn(target, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, failure: 'network' };
  }
  if (response.ok) {
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      return { ok: false, failure: 'network' };
    }
    const session = parseChildSession(data);
    return session ? { ok: true, session } : { ok: false, failure: 'network' };
  }
  if (response.status === 429) return { ok: false, failure: 'throttled' };
  if (response.status === 403) {
    let code = '';
    try {
      const data: unknown = await response.json();
      if (isRecord(data) && isRecord(data.error) && typeof data.error.code === 'string') {
        code = data.error.code;
      }
    } catch {
      // Not JSON: treated as a plain refusal.
    }
    if (code === 'child_sign_in_unavailable') return { ok: false, failure: 'unavailable' };
  }
  if (response.status >= 500) return { ok: false, failure: 'network' };
  return { ok: false, failure: 'no_session' };
}

export interface ChildSessionApi {
  read(): Promise<SessionResult>;
  /** Right after Cognito sign-in: trades the child-pool access token for a Django session. */
  create(accessToken: string, remember: boolean): Promise<SessionResult>;
  restore(): Promise<SessionResult>;
  /** Signs out and forgets the remembered device. Never throws. */
  end(csrfToken: string): Promise<void>;
}

export function createChildSessionApi(
  baseUrl: string = DJANGO_API_CONFIG.baseUrl,
  fetchFn: Fetch = globalThis.fetch.bind(globalThis),
): ChildSessionApi {
  return {
    read: () => call(fetchFn, 'GET', url('', baseUrl), {}),
    create: (accessToken, remember) =>
      call(
        fetchFn,
        'POST',
        url('', baseUrl),
        { Authorization: `Bearer ${accessToken}` },
        {
          remember,
        },
      ),
    restore: () => call(fetchFn, 'POST', url('restore/', baseUrl), { 'X-LAI-Child-Sign-In': '1' }),
    async end(csrfToken) {
      try {
        await fetchFn(url('end/', baseUrl), {
          method: 'POST',
          credentials: 'same-origin',
          headers: { [CHILD_CSRF_HEADER]: csrfToken },
        });
      } catch {
        // The session cookie expires on its own; the browser forgets the child either way.
      }
    },
  };
}

let shared: ChildSessionApi | null = null;
export function childSessionApi(): ChildSessionApi {
  shared ??= createChildSessionApi();
  return shared;
}
