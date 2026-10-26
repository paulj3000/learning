import { client } from '../../lib/data-client';
import type { Schema } from '../../../../amplify/data/resource';

/**
 * The admin section stays on Amplify until LAI-0802, whatever `VITE_BACKEND`
 * says, so it uses Amplify's own record types (with `parentProfileId`)
 * rather than the backend-neutral ones in `react/src/api/types.ts`.
 */
export type ChildProfile = Schema['ChildProfile']['type'];
export type ParentProfile = Schema['ParentProfile']['type'];

/**
 * The `Admins` Cognito-group read rule on `ParentProfile`/`ChildProfile`
 * (amplify/data/resource.ts) makes `.list()` return every parent's/child's
 * rows for a caller in that group, not just the caller's own — unlike every
 * other `.list()` call in this codebase, which owner authorization already
 * scopes to the signed-in parent. Only reachable through
 * `src/features/auth/RequireAdmin.tsx`.
 */
export async function listAllParentProfiles(): Promise<ParentProfile[]> {
  const { data } = await client.models.ParentProfile.list();
  return data;
}

/** Any family's child, for an admin (the `Admins` read rule above). Null when it does not exist. */
export async function getAnyChildProfile(id: string): Promise<ChildProfile | null> {
  const { data } = await client.models.ChildProfile.get({ id });
  return data;
}

export async function listAllChildProfiles(): Promise<ChildProfile[]> {
  const { data } = await client.models.ChildProfile.list();
  return data;
}

export interface ParentWithChildren {
  parent: ParentProfile;
  children: ChildProfile[];
}

/**
 * Pure grouping, kept independent of the fetch calls above so it is
 * testable without a backend (same "domain logic independent from React
 * components" precedent as `src/features/parent-dashboard/weeklySummary.ts`).
 * A child whose parent row no longer exists is dropped rather than guessed
 * into another parent's group.
 */
export function groupChildrenByParent(
  parents: ParentProfile[],
  children: ChildProfile[],
): ParentWithChildren[] {
  return parents
    .map((parent) => ({
      parent,
      children: children.filter((child) => child.parentProfileId === parent.id),
    }))
    .sort((a, b) => a.parent.displayName.localeCompare(b.parent.displayName));
}
