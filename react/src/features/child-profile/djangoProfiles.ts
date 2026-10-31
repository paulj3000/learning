import type { ApiClient } from '../../api/client';
import { isApiError } from '../../api/errors';
import {
  AGE_BAND_LABELS,
  READING_MODE_OPTIONS,
  type AgeBandValue,
  type ReadingModeValue,
} from './constants';
import type { ChildProfile, ChildProfileInput, ParentProfile, ProfileStore } from './profileTypes';

/**
 * The Django profile store (LAI-CHILD-001, ADR-039): `/api/v1/me/` and `/api/v1/children/`.
 * Django is the authority; every route is scoped to the signed-in parent on the server, whichever
 * sign-in the build uses (a Cognito token or a local session, ADR-038). Nothing here decides
 * ownership: another family's child is a 404, which reads as "no such child" (null).
 *
 * Not available from Django yet, so this store says so instead of pretending:
 * - profile photos (Amplify Storage until LAI-1103): never sent, never shown;
 * - hard deletion of a child or the account (blocked server-side until LAI-0209): a parent can
 *   deactivate a child instead, which keeps the record and its progress.
 */

/** A safe, parent-facing message; the details stay in `cause`. */
export class ProfileRequestError extends Error {
  readonly code: string | undefined;

  constructor(message: string, options: { code?: string; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'ProfileRequestError';
    this.code = options.code;
  }
}

export const PROFILE_MESSAGES = {
  limit: 'You already have the most child profiles allowed.',
  invalid: 'Some details were not accepted. Check them and try again.',
  deletionUnavailable:
    'Deleting is not available yet. You can turn the profile off instead, which hides it from play.',
  accountDeletionUnavailable: 'Deleting your account is not available here yet.',
  signedOut: 'Please sign in again.',
} as const;

const READING_MODES = new Set<string>(READING_MODE_OPTIONS.map((option) => option.value));

export function createDjangoProfileStore(client: ApiClient): ProfileStore {
  async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    fallback: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      const { data } = await client.request(method, path, body ? { body } : {});
      return data;
    } catch (error) {
      throw toProfileError(error, fallback);
    }
  }

  async function writeChild(id: string, body: Record<string, unknown>, fallback: string) {
    return childOrThrow(await call('PATCH', childPath(id), fallback, body), fallback);
  }

  return {
    source: 'django',
    supportsPhotos: false,
    async getOrCreateParentProfile() {
      // The client provisions a first-time Cognito parent (`POST me/`) on its own.
      return parentOrThrow(await call('GET', 'me/', 'Could not load your profile.'));
    },
    async updateParentProfileDisplayName(_id, displayName) {
      const data = await call('PATCH', 'me/', 'Could not update your name.', { displayName });
      return parentOrThrow(data);
    },
    async listChildProfiles() {
      const data = await call('GET', 'children/', 'Could not load the child profiles.');
      const list = isRecord(data) && Array.isArray(data.children) ? data.children : null;
      if (!list) throw new ProfileRequestError('Could not load the child profiles.');
      return list.map(parseChild).filter((child): child is ChildProfile => child !== null);
    },
    async getChildProfile(id) {
      if (!id) return null;
      try {
        const { data } = await client.request('GET', childPath(id));
        return parseChild(data);
      } catch (error) {
        if (isApiError(error) && error.kind === 'not_found') return null;
        throw toProfileError(error, 'Could not load this child profile.');
      }
    },
    async createChildProfile(_parentProfileId, input) {
      const fallback = 'Could not create the child profile.';
      return childOrThrow(await call('POST', 'children/', fallback, toBody(input)), fallback);
    },
    updateChildProfile(id, input) {
      return writeChild(id, toBody(input), 'Could not update the child profile.');
    },
    setChildProfileActive(id, active) {
      return writeChild(id, { active }, 'Could not update the child profile.');
    },
    setChildProfileAIEnabled(id, aiEnabled) {
      return writeChild(id, { aiEnabled }, 'Could not update the child profile.');
    },
    async ensureChildProfileOwnerSub() {
      // Amplify-only backfill (ADR-012): Django ownership is the parent foreign key.
    },
    async deleteChildProfileData(id) {
      await call('DELETE', childPath(id), 'Could not delete this child profile.');
    },
    async deleteAccountAndAllData() {
      throw new ProfileRequestError(PROFILE_MESSAGES.accountDeletionUnavailable, {
        code: 'sensitive_action_unavailable',
      });
    },
  };
}

function childPath(id: string): string {
  return `children/${encodeURIComponent(id)}/`;
}

/** Only the fields Django accepts: the request bodies are closed, and photos are not sent. */
function toBody(input: ChildProfileInput): Record<string, unknown> {
  return {
    nickname: input.nickname,
    ageBand: input.ageBand,
    avatarKey: input.avatarKey,
    interests: input.interests,
    readingMode: input.readingMode,
    sessionMinutes: input.sessionMinutes,
  };
}

export function toProfileError(error: unknown, fallback: string): ProfileRequestError {
  if (!isApiError(error)) return new ProfileRequestError(fallback, { cause: error });
  const code = error.code;
  const message =
    code === 'child_profile_limit_reached'
      ? PROFILE_MESSAGES.limit
      : code === 'sensitive_action_unavailable'
        ? PROFILE_MESSAGES.deletionUnavailable
        : error.kind === 'invalid_request'
          ? PROFILE_MESSAGES.invalid
          : error.kind === 'unauthenticated'
            ? PROFILE_MESSAGES.signedOut
            : fallback;
  return new ProfileRequestError(message, { code, cause: error });
}

function childOrThrow(data: unknown, fallback: string): ChildProfile {
  const child = parseChild(data);
  if (!child) throw new ProfileRequestError(fallback, { code: 'invalid_response' });
  return child;
}

function parentOrThrow(data: unknown): ParentProfile {
  if (!isRecord(data) || typeof data.id !== 'string' || data.id === '') {
    throw new ProfileRequestError('Could not load your profile.', { code: 'invalid_response' });
  }
  return {
    id: data.id,
    displayName: typeof data.displayName === 'string' ? data.displayName : '',
    timezone: typeof data.timezone === 'string' && data.timezone !== '' ? data.timezone : null,
  };
}

/** Validates one child from the API; anything malformed is dropped rather than half-shown. */
export function parseChild(data: unknown): ChildProfile | null {
  if (!isRecord(data)) return null;
  const { id, nickname, ageBand, avatarKey, readingMode, sessionMinutes } = data;
  if (typeof id !== 'string' || id === '' || typeof nickname !== 'string') return null;
  if (typeof ageBand !== 'string' || !(ageBand in AGE_BAND_LABELS)) return null;
  if (typeof readingMode !== 'string' || !READING_MODES.has(readingMode)) return null;
  if (typeof avatarKey !== 'string' || typeof sessionMinutes !== 'number') return null;
  return {
    id,
    nickname,
    ageBand: ageBand as AgeBandValue,
    avatarKey,
    avatarPhotoKey: null,
    interests: Array.isArray(data.interests)
      ? data.interests.filter((value): value is string => typeof value === 'string')
      : [],
    readingMode: readingMode as ReadingModeValue,
    sessionMinutes,
    active: data.active !== false,
    aiEnabled: data.aiEnabled !== false,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : null,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
