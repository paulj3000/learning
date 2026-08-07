import { client } from '../../lib/data-client';
import type { Schema } from '../../../amplify/data/resource';

export type CompanionProfile = Schema['CompanionProfile']['type'];

/**
 * Owner authorization scopes `.list()` to the caller's own records, so
 * filtering by childProfileId client-side (rather than relying on a second
 * query) is enough to find this child's companion, if any.
 */
export async function getCompanionProfile(
  childProfileId: string,
): Promise<CompanionProfile | null> {
  const { data } = await client.models.CompanionProfile.list();
  return (
    data.find((companion: CompanionProfile) => companion.childProfileId === childProfileId) ?? null
  );
}

export async function getOrCreateCompanionProfile(
  childProfileId: string,
): Promise<CompanionProfile> {
  const existing = await getCompanionProfile(childProfileId);
  if (existing) return existing;

  const { data: created, errors } = await client.models.CompanionProfile.create({
    childProfileId,
    companionType: 'CHATTY_PARROT',
    displayName: 'Chatty',
  });
  if (!created) {
    throw new Error(errors?.[0]?.message ?? 'Could not create a companion profile.');
  }
  return created;
}
