import { fetchUserAttributes, getCurrentUser } from 'aws-amplify/auth';
import { client } from '../../lib/data-client';
import type { Schema } from '../../../../amplify/data/resource';
import type { AgeBandValue, ReadingModeValue } from './constants';
import { deleteAccountAndAllData, deleteChildProfileData } from './deletion';
import type { ChildProfile, ChildProfileInput, ParentProfile, ProfileStore } from './profileTypes';

type AmplifyChildProfile = Schema['ChildProfile']['type'];
type AmplifyParentProfile = Schema['ParentProfile']['type'];

/**
 * The Amplify Data profile store (ADR-010). Used only by builds without the Django API
 * (`VITE_BACKEND` unset: today's production build) until the profile cutover (Phase 11/12,
 * LAI-1203) and its removal (LAI-1301). Django builds never use it for profiles.
 */
export function fromAmplifyChild(row: AmplifyChildProfile): ChildProfile {
  return {
    id: row.id,
    nickname: row.nickname,
    ageBand: row.ageBand as AgeBandValue,
    avatarKey: row.avatarKey,
    avatarPhotoKey: row.avatarPhotoKey ?? null,
    interests: (row.interests ?? []).filter((value): value is string => typeof value === 'string'),
    readingMode: row.readingMode as ReadingModeValue,
    sessionMinutes: row.sessionMinutes,
    active: row.active !== false,
    aiEnabled: row.aiEnabled ?? true,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

function fromAmplifyParent(row: AmplifyParentProfile): ParentProfile {
  return { id: row.id, displayName: row.displayName, timezone: row.timezone ?? null };
}

/**
 * Owner authorization scopes `.list()` to the caller's own records, so the
 * first (and only) match here belongs to the signed-in parent.
 */
async function getOrCreateParentProfile(): Promise<ParentProfile> {
  const { data: existing } = await client.models.ParentProfile.list();
  const [current] = existing;
  if (current) return fromAmplifyParent(current);

  const attributes = await fetchUserAttributes();
  const displayName = attributes.name ?? attributes.email ?? 'Parent';
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const { data: created, errors } = await client.models.ParentProfile.create({
    displayName,
    timezone,
  });
  if (!created) {
    throw new Error(errors?.[0]?.message ?? 'Could not create a parent profile.');
  }
  return fromAmplifyParent(created);
}

async function updateParentProfileDisplayName(
  id: string,
  displayName: string,
): Promise<ParentProfile> {
  const { data, errors } = await client.models.ParentProfile.update({ id, displayName });
  if (!data) {
    throw new Error(errors?.[0]?.message ?? 'Could not update your name.');
  }
  return fromAmplifyParent(data);
}

async function listChildProfiles(): Promise<ChildProfile[]> {
  const { data } = await client.models.ChildProfile.list();
  return data.map(fromAmplifyChild);
}

async function getChildProfile(id: string): Promise<ChildProfile | null> {
  const { data } = await client.models.ChildProfile.get({ id });
  return data ? fromAmplifyChild(data) : null;
}

async function createChildProfile(
  parentProfileId: string,
  input: ChildProfileInput,
): Promise<ChildProfile> {
  const { userId: ownerSub } = await getCurrentUser();
  const { data, errors } = await client.models.ChildProfile.create({
    parentProfileId,
    active: true,
    ownerSub,
    ...input,
  });
  if (!data) {
    throw new Error(errors?.[0]?.message ?? 'Could not create the child profile.');
  }
  return fromAmplifyChild(data);
}

/**
 * Backfills `ownerSub` for a `ChildProfile` row created before that field
 * existed (docs/DECISIONS.md ADR-012): a self-healing, idempotent no-op once
 * the row already has it, so a fresh profile pays this once and every later
 * call is a single cheap read. Called from `useAdventureSession`'s load
 * effect, since `submitAdventureAnswer` is the first caller that needs
 * `ownerSub` to be present.
 */
async function ensureChildProfileOwnerSub(childProfileId: string): Promise<void> {
  const { data: profile } = await client.models.ChildProfile.get({ id: childProfileId });
  if (!profile || profile.ownerSub) return;
  const { userId: ownerSub } = await getCurrentUser();
  await client.models.ChildProfile.update({ id: childProfileId, ownerSub });
}

async function updateChildProfile(id: string, input: ChildProfileInput): Promise<ChildProfile> {
  const { data, errors } = await client.models.ChildProfile.update({ id, ...input });
  if (!data) {
    throw new Error(errors?.[0]?.message ?? 'Could not update the child profile.');
  }
  return fromAmplifyChild(data);
}

async function setChildProfileActive(id: string, active: boolean): Promise<ChildProfile> {
  const { data, errors } = await client.models.ChildProfile.update({ id, active });
  if (!data) {
    throw new Error(errors?.[0]?.message ?? 'Could not update the child profile.');
  }
  return fromAmplifyChild(data);
}

/** Parent-facing AI on/off control (docs/ROADMAP.md Phase 7). */
async function setChildProfileAIEnabled(id: string, aiEnabled: boolean): Promise<ChildProfile> {
  const { data, errors } = await client.models.ChildProfile.update({ id, aiEnabled });
  if (!data) {
    throw new Error(errors?.[0]?.message ?? 'Could not update the child profile.');
  }
  return fromAmplifyChild(data);
}

export const amplifyProfileStore: ProfileStore = {
  source: 'amplify',
  supportsPhotos: true,
  getOrCreateParentProfile,
  updateParentProfileDisplayName,
  listChildProfiles,
  getChildProfile,
  createChildProfile,
  updateChildProfile,
  setChildProfileActive,
  setChildProfileAIEnabled,
  ensureChildProfileOwnerSub,
  deleteChildProfileData,
  deleteAccountAndAllData,
};
