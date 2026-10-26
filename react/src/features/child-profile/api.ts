import { childrenApi } from '../../api/children';
import { parentsApi } from '../../api/parents';
import type { ChildProfile, ChildProfileInput, ParentProfile } from '../../api/types';

/**
 * Child profiles and the parent account, for the app's screens. Since
 * LAI-0501A this is a thin facade over `react/src/api/children.ts` and
 * `parents.ts`, which pick Amplify or Django per build (`VITE_BACKEND`).
 * The names and signatures are the ones the app already used.
 */

export type { ChildProfile, ChildProfileInput, ParentProfile };

/** Whether this build's backend can store a child's profile photo (Django cannot yet). */
export const childPhotoUploadsSupported: boolean = childrenApi.photoUploadsSupported;

export async function getOrCreateParentProfile(): Promise<ParentProfile> {
  return parentsApi.getOrCreateCurrentParent();
}

export async function updateParentProfileDisplayName(
  id: string,
  displayName: string,
): Promise<ParentProfile> {
  return parentsApi.updateDisplayName(id, displayName);
}

export async function listChildProfiles(): Promise<ChildProfile[]> {
  return childrenApi.list();
}

export async function getChildProfile(id: string): Promise<ChildProfile | null> {
  return childrenApi.get(id);
}

export async function createChildProfile(
  parentProfileId: string,
  input: ChildProfileInput,
): Promise<ChildProfile> {
  return childrenApi.create(parentProfileId, input);
}

/**
 * Backfills `ownerSub` for an Amplify `ChildProfile` row created before that
 * field existed (docs/DECISIONS.md ADR-012). Called from
 * `useAdventureSession`'s load effect, since `submitAdventureAnswer` is the
 * first caller that needs `ownerSub` to be present. A no-op on Django.
 */
export async function ensureChildProfileOwnerSub(childProfileId: string): Promise<void> {
  return childrenApi.ensureOwnerSub(childProfileId);
}

export async function updateChildProfile(
  id: string,
  input: ChildProfileInput,
): Promise<ChildProfile> {
  return childrenApi.update(id, input);
}

export async function setChildProfileActive(id: string, active: boolean): Promise<ChildProfile> {
  return childrenApi.setActive(id, active);
}

/** Parent-facing AI on/off control (docs/ROADMAP.md Phase 7). */
export async function setChildProfileAIEnabled(
  id: string,
  aiEnabled: boolean,
): Promise<ChildProfile> {
  return childrenApi.setAIEnabled(id, aiEnabled);
}
