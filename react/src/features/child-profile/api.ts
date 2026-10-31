import { apiCredentials } from '../../api/apiAuth';
import { createApiClient } from '../../api/client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../../api/config';
import { amplifyProfileStore } from './amplifyProfiles';
import { createDjangoProfileStore } from './djangoProfiles';
import type { ChildProfile, ChildProfileInput, ParentProfile, ProfileStore } from './profileTypes';

export type { ChildProfile, ChildProfileInput, ParentProfile, ProfileStore };

/**
 * Parent and child profiles (LAI-CHILD-001, ADR-039). Every screen calls these functions.
 *
 * The store follows the build's *backend*, never its sign-in: a build with the Django API
 * (`VITE_BACKEND=django`) keeps every profile in Django, whether the parent signed in with
 * Cognito or with a local Django session (ADR-038). Authentication identifies the parent;
 * Django authorizes access and owns the data.
 *
 * A build without the Django API (today's production build) still uses Amplify Data, because
 * that is where its families' profiles are until the controlled import and cutover (Phase 11/12;
 * docs/platform/AMPLIFY_PROFILE_IMPORT.md). That branch goes with LAI-1301.
 */
export function profileStoreFor(config: DjangoApiConfig = DJANGO_API_CONFIG): ProfileStore {
  if (!config.enabled) return amplifyProfileStore;
  return createDjangoProfileStore(
    createApiClient({ baseUrl: config.baseUrl, ...apiCredentials(), provisionAccount: true }),
  );
}

let store: ProfileStore | null = null;
function current(): ProfileStore {
  store ??= profileStoreFor();
  return store;
}

/** Whether the parent can upload a profile photo with this build's store. */
export function profilePhotosSupported(): boolean {
  return current().supportsPhotos;
}

export const getOrCreateParentProfile = () => current().getOrCreateParentProfile();
export const updateParentProfileDisplayName = (id: string, displayName: string) =>
  current().updateParentProfileDisplayName(id, displayName);
export const listChildProfiles = () => current().listChildProfiles();
export const getChildProfile = (id: string) => current().getChildProfile(id);
export const createChildProfile = (parentProfileId: string, input: ChildProfileInput) =>
  current().createChildProfile(parentProfileId, input);
export const updateChildProfile = (id: string, input: ChildProfileInput) =>
  current().updateChildProfile(id, input);
export const setChildProfileActive = (id: string, active: boolean) =>
  current().setChildProfileActive(id, active);
export const setChildProfileAIEnabled = (id: string, aiEnabled: boolean) =>
  current().setChildProfileAIEnabled(id, aiEnabled);
export const ensureChildProfileOwnerSub = (childProfileId: string) =>
  current().ensureChildProfileOwnerSub(childProfileId);
/** Every stored record for one child. Unavailable from Django until LAI-0209. */
export const deleteChildProfileData = (childProfileId: string) =>
  current().deleteChildProfileData(childProfileId);
/** The account and every child's data. Unavailable from Django until LAI-0209. */
export const deleteAccountAndAllData = () => current().deleteAccountAndAllData();
