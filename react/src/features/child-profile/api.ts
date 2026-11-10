import { deleteUser } from 'aws-amplify/auth';
import { getAccessToken } from '../../api/auth';
import { createApiClient } from '../../api/client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../../api/config';
import { djangoBaseUrl } from '../../api/djangoClient';
import type { DeleteCognitoUser } from './deletion';
import { createDjangoProfileStore } from './djangoProfiles';
import type {
  ChildProfile,
  ChildProfileInput,
  ParentProfile,
  PhotoSelection,
  ProfileStore,
} from './profileTypes';

export type { ChildProfile, ChildProfileInput, ParentProfile, ProfileStore };

/**
 * Parent and child profiles (LAI-CHILD-001, ADR-039). Every screen calls these functions.
 *
 * Django keeps every profile (AMP-03: the Amplify Data store is gone). The parent always signs
 * in with Cognito (ADR-040); the Cognito access token identifies the parent, and Django
 * authorizes access and owns the data. A build without `VITE_BACKEND=django` calls Django on the
 * same origin, the deployed shape.
 *
 * `deleteCognitoUser` is the one auth call this module needs: account deletion removes the
 * Cognito user after Django has deleted the account. It is injected here, the single place the
 * auth layer's deleter is named (AMP-02 swaps the Amplify Auth call for its own Cognito client).
 */
const deleteCognitoUser: DeleteCognitoUser = () => deleteUser();

export function profileStoreFor(
  config: DjangoApiConfig = DJANGO_API_CONFIG,
  deleteUserFromCognito: DeleteCognitoUser = deleteCognitoUser,
): ProfileStore {
  return createDjangoProfileStore(
    createApiClient({ baseUrl: djangoBaseUrl(config), getAccessToken, provisionAccount: true }),
    undefined,
    deleteUserFromCognito,
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

/** How this build's store writes a photo around a profile save (see `ProfileStore.photoWrite`). */
export function profilePhotoWrite(): ProfileStore['photoWrite'] {
  return current().photoWrite;
}

/** A displayable URL for `ChildProfile.avatarPhotoKey`, or null. Never throws. */
export const getChildPhotoUrl = (photoKey: string) => current().getChildPhotoUrl(photoKey);
/** Upload or remove a saved child's photo (`after-save` stores only). */
export const applyChildPhotoSelection = (childId: string, selection: PhotoSelection) =>
  current().applyChildPhotoSelection(childId, selection);

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
/** Every stored record for one child (`DELETE children/<id>/`, recent sign-in required). */
export const deleteChildProfileData = (childProfileId: string) =>
  current().deleteChildProfileData(childProfileId);
/** The account, every child's data, then the Cognito user (`deletion.ts`). */
export const deleteAccountAndAllData = () => current().deleteAccountAndAllData();
