import { fetchUserAttributes } from 'aws-amplify/auth';
import { client } from '../../lib/data-client';
import type { Schema } from '../../../amplify/data/resource';

export type ChildProfile = Schema['ChildProfile']['type'];
export type ParentProfile = Schema['ParentProfile']['type'];

export interface ChildProfileInput {
  nickname: string;
  ageBand: ChildProfile['ageBand'];
  avatarKey: string;
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
