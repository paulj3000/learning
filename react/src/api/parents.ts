import { client as amplifyData } from '../lib/data-client';
import { getAccountAttributes } from './auth';
import { djangoClient } from './backend';
import type { ApiClient } from './client';
import { BACKEND_SELECTION, type BackendSelection } from './config';
import { ApiError, toParentFacingError } from './errors';
import { read } from './parse';
import type { ParentProfile } from './types';

/**
 * The signed-in parent's account record (LAI-0501A), on whichever backend
 * this build selected (`VITE_BACKEND`, see `config.ts`).
 *
 * - Amplify: the owner-scoped `ParentProfile` model, created on first use.
 * - Django: `POST /api/v1/me/`, which provisions the `ParentAccount` from
 *   the verified token and is idempotent. Django returns only the account
 *   id; it has no display-name or timezone contract yet, so the name shown
 *   is the one Cognito holds (the same fallback Amplify uses when it first
 *   creates the record), and changing it is `unsupported`. Gap recorded in
 *   docs/IMPLEMENTATION_STATUS.md (LAI-0501A).
 *
 * Neither implementation takes an owner from the caller.
 */
export interface ParentsApi {
  getOrCreateCurrentParent(): Promise<ParentProfile>;
  updateDisplayName(id: string, displayName: string): Promise<ParentProfile>;
}

const amplifyParents: ParentsApi = {
  /**
   * Owner authorization scopes `.list()` to the caller's own records, so the
   * first (and only) match here belongs to the signed-in parent.
   */
  async getOrCreateCurrentParent() {
    const { data: existing } = await amplifyData.models.ParentProfile.list();
    const [current] = existing;
    if (current) return current;

    const displayName = await cognitoDisplayName();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const { data: created, errors } = await amplifyData.models.ParentProfile.create({
      displayName,
      timezone,
    });
    if (!created) {
      throw new Error(errors?.[0]?.message ?? 'Could not create a parent profile.');
    }
    return created;
  },

  async updateDisplayName(id, displayName) {
    const { data, errors } = await amplifyData.models.ParentProfile.update({ id, displayName });
    if (!data) {
      throw new Error(errors?.[0]?.message ?? 'Could not update your name.');
    }
    return data;
  },
};

async function cognitoDisplayName(): Promise<string> {
  const attributes = await getAccountAttributes();
  return attributes.name ?? attributes.email ?? 'Parent';
}

export function createDjangoParentsApi(
  client: ApiClient,
  displayName: () => Promise<string> = cognitoDisplayName,
): ParentsApi {
  return {
    async getOrCreateCurrentParent() {
      try {
        const [response, name] = await Promise.all([client.request('POST', 'me/'), displayName()]);
        const id = read(response.data, (r) => r.field('id').string());
        return { id, displayName: name, timezone: null };
      } catch (error) {
        throw toParentFacingError(error, 'Could not load your account.');
      }
    },

    async updateDisplayName() {
      throw toParentFacingError(
        new ApiError('unsupported', { code: 'display_name_unavailable' }),
        'Could not update your name.',
      );
    },
  };
}

function failingParentsApi(error: ApiError): ParentsApi {
  const fail = () => Promise.reject(toParentFacingError(error, 'Could not load your account.'));
  return { getOrCreateCurrentParent: fail, updateDisplayName: fail };
}

export function parentsApiFor(selection: BackendSelection): ParentsApi {
  if (selection.backend === 'amplify') return amplifyParents;
  if (selection.backend === 'misconfigured') {
    return failingParentsApi(new ApiError('disabled', { code: selection.reason }));
  }
  return createDjangoParentsApi(djangoClient(selection));
}

export const parentsApi: ParentsApi = parentsApiFor(BACKEND_SELECTION);
