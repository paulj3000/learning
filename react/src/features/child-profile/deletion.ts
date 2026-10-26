import { deleteCurrentUser } from '../../api/auth';
import { deleteDjangoChild } from '../../api/children';
import { BACKEND_SELECTION, type BackendSelection } from '../../api/config';
import { ApiError, toParentFacingError } from '../../api/errors';
import * as amplifyDeletion from '../../api/amplify/childDeletion';
import { removeChildPhoto } from './avatarPhoto';

/**
 * Full, irreversible deletion of every stored record for one child - not
 * the deactivate toggle in ChildProfileSummary, which keeps the record and
 * lets a parent reactivate it. This is the "deletes" half of
 * docs/TESTING_STRATEGY.md's e2e path 9 ("Parent deletes or deactivates a
 * child profile") and docs/AI_AND_CHILD_SAFETY.md's "data controls and
 * deletion options". Covers every model in amplify/data/resource.ts that
 * carries a `childProfileId`, plus `AdventureAction` (chained through
 * `AdventureSession.sessionId`, since it has no `childProfileId` of its
 * own), then the `ChildProfile` row itself last.
 *
 * Every model added since Phase 8 wrote this function had been missed:
 * `ChildStoryProgress` (Phase 12), `ChildNpcState` (Phase 23),
 * `ChildInventory` (Phase 24), and `ChildQuestState` (Phase 25) all survived
 * a "delete everything" until Phase 25 audited it. `ChildWorldState`
 * (Phase 26) was added here in the same change that added the model. Adding a per-child model
 * without adding it here silently breaks the deletion promise in
 * `docs/AI_AND_CHILD_SAFETY.md`, so `deletion.test.ts` now asserts the
 * Amplify cascade (`react/src/api/amplify/childDeletion.ts`) touches every
 * model in the schema that carries a `childProfileId` - a new model fails
 * that test until it is handled.
 *
 * The child's uploaded profile photo, if they have one, is deleted from
 * Amplify Storage before the row that points at it - and a failure there
 * aborts the whole deletion rather than being swallowed. "Delete my
 * child's data" has to mean the photograph too, and a parent needs to see
 * an error if it could not be removed, not a success message over a
 * picture of their child still sitting in S3.
 *
 * On a Django build (LAI-0501A) this is Django's `DELETE /children/{id}/`,
 * which is refused (`sensitive_action_unavailable`) until LAI-0602 and
 * LAI-0209 build server-side cascade deletion. Nothing is deleted
 * client-side there: the server owns the cascade.
 */
export async function deleteChildProfileData(
  childProfileId: string,
  selection: BackendSelection = BACKEND_SELECTION,
): Promise<void> {
  if (selection.backend !== 'amplify') {
    await deleteDjangoChild(selection, childProfileId);
    return;
  }
  await amplifyDeletion.deleteChildRecords(childProfileId, removeChildPhoto);
}

/**
 * Full parent account deletion: every child's data (see
 * `deleteChildProfileData`), the `ParentProfile` record, then the Cognito
 * user itself via `deleteUser()` (which also signs the caller out). Order
 * matters: everything that needs an authenticated session must happen
 * before `deleteUser()` runs.
 *
 * Unavailable on a Django build (LAI-0501A): Django has no account deletion
 * yet (LAI-0602, LAI-0209), and deleting the Cognito user first would leave
 * the family's Django records with no one able to reach or delete them. So
 * it refuses before touching anything, Cognito included.
 */
export async function deleteAccountAndAllData(
  selection: BackendSelection = BACKEND_SELECTION,
): Promise<void> {
  if (selection.backend !== 'amplify') {
    throw toParentFacingError(
      new ApiError('unsupported', { code: 'account_deletion_unavailable' }),
      'Could not delete your account.',
    );
  }
  for (const childId of await amplifyDeletion.listOwnChildIds()) {
    await deleteChildProfileData(childId, selection);
  }
  await amplifyDeletion.deleteOwnParentProfiles();

  await deleteCurrentUser();
}
