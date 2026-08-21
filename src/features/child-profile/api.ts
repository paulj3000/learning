import { fetchUserAttributes } from 'aws-amplify/auth';
import { client } from '../../lib/data-client';
import type { Schema } from '../../../amplify/data/resource';

export type ChildProfile = Schema['ChildProfile']['type'];
export type ParentProfile = Schema['ParentProfile']['type'];

export interface ChildProfileInput {
  nickname: string;
  ageBand: ChildProfile['ageBand'];
  avatarKey: string;
  /**
   * Path of the parent-uploaded profile photo in Amplify Storage, or null
   * when this child uses their authored `avatarKey` character as the icon.
   * Written by `persistPhotoSelection` (avatarPhoto.ts), which uploads the
   * image before this input reaches the API and cleans up any replaced
   * object after it succeeds.
   */
  avatarPhotoKey: string | null;
  interests: string[];
  readingMode: ChildProfile['readingMode'];
  sessionMinutes: number;
}

/**
 * Owner authorization scopes `.list()` to the caller's own records, so the
 * first (and only) match here belongs to the signed-in parent.
 */
export async function getOrCreateParentProfile(): Promise<ParentProfile> {
  const { data: existing } = await client.models.ParentProfile.list();
  const [current] = existing;
  if (current) return current;

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
  return created;
}

export async function updateParentProfileDisplayName(
  id: string,
  displayName: string,
): Promise<ParentProfile> {
  const { data, errors } = await client.models.ParentProfile.update({ id, displayName });
  if (!data) {
    throw new Error(errors?.[0]?.message ?? 'Could not update your name.');
  }
  return data;
}

export async function listChildProfiles(): Promise<ChildProfile[]> {
  const { data } = await client.models.ChildProfile.list();
  return data;
}

export async function getChildProfile(id: string): Promise<ChildProfile | null> {
  const { data } = await client.models.ChildProfile.get({ id });
  return data;
}

export async function createChildProfile(
  parentProfileId: string,
  input: ChildProfileInput,
): Promise<ChildProfile> {
  const { data, errors } = await client.models.ChildProfile.create({
    parentProfileId,
    active: true,
    ...input,
  });
  if (!data) {
    throw new Error(errors?.[0]?.message ?? 'Could not create the child profile.');
  }
  return data;
}

export async function updateChildProfile(
  id: string,
  input: ChildProfileInput,
): Promise<ChildProfile> {
  const { data, errors } = await client.models.ChildProfile.update({ id, ...input });
  if (!data) {
    throw new Error(errors?.[0]?.message ?? 'Could not update the child profile.');
  }
  return data;
}

export async function setChildProfileActive(id: string, active: boolean): Promise<ChildProfile> {
  const { data, errors } = await client.models.ChildProfile.update({ id, active });
  if (!data) {
    throw new Error(errors?.[0]?.message ?? 'Could not update the child profile.');
  }
  return data;
}

/** Parent-facing AI on/off control (docs/ROADMAP.md Phase 7). */
export async function setChildProfileAIEnabled(
  id: string,
  aiEnabled: boolean,
): Promise<ChildProfile> {
  const { data, errors } = await client.models.ChildProfile.update({ id, aiEnabled });
  if (!data) {
    throw new Error(errors?.[0]?.message ?? 'Could not update the child profile.');
  }
  return data;
}
