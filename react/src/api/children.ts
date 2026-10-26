import { client as amplifyData } from '../lib/data-client';
import { getCurrentUserId } from './auth';
import { djangoClient } from './backend';
import type { ApiClient } from './client';
import { BACKEND_SELECTION, type BackendSelection } from './config';
import { ApiError, toParentFacingError } from './errors';
import { read, type Reader } from './parse';
import type { AgeBand, ChildProfile, ChildProfileInput, ReadingMode } from './types';

/**
 * The signed-in parent's child profiles (LAI-0501A), on whichever backend
 * this build selected (`VITE_BACKEND`, see `config.ts`). Exactly one backend
 * is authoritative per build: there is no fallback and no dual write.
 *
 * - Amplify: the owner-scoped `ChildProfile` model, unchanged.
 * - Django: `/api/v1/children/` (docs/android/ANDROID_API_CONTRACT.md), the
 *   same routes and ids the Android app uses. Django takes the owner from
 *   the verified token; a child id from another family is a 404, the same
 *   as one that does not exist.
 *
 * Django has no photo route and no deletion yet (LAI-0602, LAI-0209), so
 * `photoUploadsSupported` is false there and a photo path is refused before
 * any request.
 */
export interface ChildrenApi {
  readonly photoUploadsSupported: boolean;
  list(): Promise<ChildProfile[]>;
  get(id: string): Promise<ChildProfile | null>;
  /** `parentProfileId` is Amplify's foreign key. Django ignores it and uses the session's parent. */
  create(parentProfileId: string, input: ChildProfileInput): Promise<ChildProfile>;
  update(id: string, input: ChildProfileInput): Promise<ChildProfile>;
  setActive(id: string, active: boolean): Promise<ChildProfile>;
  setAIEnabled(id: string, aiEnabled: boolean): Promise<ChildProfile>;
  /** Amplify-only backfill (ADR-012). A no-op on Django, which has no `ownerSub`. */
  ensureOwnerSub(id: string): Promise<void>;
}

const amplifyChildren: ChildrenApi = {
  photoUploadsSupported: true,

  async list() {
    const { data } = await amplifyData.models.ChildProfile.list();
    return data;
  },

  async get(id) {
    const { data } = await amplifyData.models.ChildProfile.get({ id });
    return data;
  },

  async create(parentProfileId, input) {
    const ownerSub = await getCurrentUserId();
    const { data, errors } = await amplifyData.models.ChildProfile.create({
      parentProfileId,
      active: true,
      ownerSub,
      ...input,
    });
    if (!data) {
      throw new Error(errors?.[0]?.message ?? 'Could not create the child profile.');
    }
    return data;
  },

  async update(id, input) {
    const { data, errors } = await amplifyData.models.ChildProfile.update({ id, ...input });
    if (!data) {
      throw new Error(errors?.[0]?.message ?? 'Could not update the child profile.');
    }
    return data;
  },

  async setActive(id, active) {
    const { data, errors } = await amplifyData.models.ChildProfile.update({ id, active });
    if (!data) {
      throw new Error(errors?.[0]?.message ?? 'Could not update the child profile.');
    }
    return data;
  },

  async setAIEnabled(id, aiEnabled) {
    const { data, errors } = await amplifyData.models.ChildProfile.update({ id, aiEnabled });
    if (!data) {
      throw new Error(errors?.[0]?.message ?? 'Could not update the child profile.');
    }
    return data;
  },

  /**
   * Backfills `ownerSub` for a `ChildProfile` row created before that field
   * existed (docs/DECISIONS.md ADR-012): a self-healing, idempotent no-op once
   * the row already has it.
   */
  async ensureOwnerSub(id) {
    const { data: profile } = await amplifyData.models.ChildProfile.get({ id });
    if (!profile || profile.ownerSub) return;
    const ownerSub = await getCurrentUserId();
    await amplifyData.models.ChildProfile.update({ id, ownerSub });
  },
};

// ---------------------------------------------------------------------------
// Django

const AGE_BANDS: readonly AgeBand[] = ['SPROUT', 'PATHFINDER', 'EXPLORER'];
const READING_MODES: readonly ReadingMode[] = ['VOICE_FIRST', 'READ_ALONG', 'INDEPENDENT'];

/** One profile object from the children API, validated. */
export function parseDjangoChild(r: Reader): ChildProfile {
  return {
    id: r.field('id').string(),
    nickname: r.field('nickname').string(),
    ageBand: r.field('ageBand').oneOf(AGE_BANDS),
    avatarKey: r.field('avatarKey').string(),
    avatarPhotoKey: null,
    hasPhoto: r.field('hasPhoto').boolean(),
    interests: r.field('interests').array((item) => item.string()),
    readingMode: r.field('readingMode').oneOf(READING_MODES),
    sessionMinutes: r.field('sessionMinutes').integer(),
    active: r.field('active').boolean(),
    aiEnabled: r.field('aiEnabled').boolean(),
    createdAt: r.field('createdAt').string(),
    updatedAt: r.field('updatedAt').string(),
  };
}

/** The closed request body: only the fields the contract accepts, never an id or owner. */
function djangoBody(input: ChildProfileInput): Record<string, unknown> {
  if (input.avatarPhotoKey !== null) {
    throw new ApiError('unsupported', { code: 'child_photo_unavailable' });
  }
  return {
    nickname: input.nickname,
    ageBand: input.ageBand,
    avatarKey: input.avatarKey,
    interests: input.interests,
    readingMode: input.readingMode,
    sessionMinutes: input.sessionMinutes,
  };
}

function childPath(id: string): string {
  if (!id) throw new ApiError('invalid_request', { code: 'empty_id' });
  return `children/${encodeURIComponent(id)}/`;
}

async function parentFacing<T>(fallback: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw toParentFacingError(error, fallback);
  }
}

export function createDjangoChildrenApi(client: ApiClient): ChildrenApi {
  const patch = (id: string, body: Record<string, unknown>) =>
    parentFacing('Could not update the child profile.', async () => {
      const response = await client.request('PATCH', childPath(id), { body });
      return read(response.data, parseDjangoChild);
    });

  return {
    photoUploadsSupported: false,

    list: () =>
      parentFacing('Could not load your child profiles.', async () => {
        const response = await client.request('GET', 'children/');
        return read(response.data, (r) => r.field('children').array(parseDjangoChild));
      }),

    /** Null for an unknown id or another family's child: Django does not tell them apart. */
    get: (id) =>
      parentFacing('Could not load this child profile.', async () => {
        try {
          const response = await client.request('GET', childPath(id));
          return read(response.data, parseDjangoChild);
        } catch (error) {
          if (error instanceof ApiError && error.kind === 'not_found') return null;
          throw error;
        }
      }),

    create: (_parentProfileId, input) =>
      parentFacing('Could not create the child profile.', async () => {
        const response = await client.request('POST', 'children/', { body: djangoBody(input) });
        return read(response.data, parseDjangoChild);
      }),

    update: (id, input) =>
      parentFacing('Could not update the child profile.', async () => {
        const response = await client.request('PATCH', childPath(id), { body: djangoBody(input) });
        return read(response.data, parseDjangoChild);
      }),

    setActive: (id, active) => patch(id, { active }),
    setAIEnabled: (id, aiEnabled) => patch(id, { aiEnabled }),
    ensureOwnerSub: async () => {},
  };
}

/**
 * Django's `DELETE /children/{id}/`. Today it always answers
 * `403 sensitive_action_unavailable` (LAI-0602, LAI-0209); the server is
 * asked anyway so that the day it allows deletion, only this changes.
 */
export async function deleteDjangoChild(
  selection: BackendSelection,
  id: string,
): Promise<void> {
  await parentFacing('Could not delete this child profile.', () =>
    djangoClient(selection).request('DELETE', childPath(id)),
  );
}

function failingChildrenApi(error: ApiError): ChildrenApi {
  const fail = () => Promise.reject(toParentFacingError(error, 'Could not load your profiles.'));
  return {
    photoUploadsSupported: false,
    list: fail,
    get: fail,
    create: fail,
    update: fail,
    setActive: fail,
    setAIEnabled: fail,
    ensureOwnerSub: fail,
  };
}

export function childrenApiFor(selection: BackendSelection): ChildrenApi {
  if (selection.backend === 'amplify') return amplifyChildren;
  if (selection.backend === 'misconfigured') {
    return failingChildrenApi(new ApiError('disabled', { code: selection.reason }));
  }
  return createDjangoChildrenApi(djangoClient(selection));
}

export const childrenApi: ChildrenApi = childrenApiFor(BACKEND_SELECTION);
