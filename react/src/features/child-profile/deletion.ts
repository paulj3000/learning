import type { ApiClient } from '../../api/client';
import { isApiError } from '../../api/errors';
import { PROFILE_MESSAGES, ProfileRequestError } from './profileErrors';

/**
 * Full, irreversible parent account deletion (AMP-03; docs/AI_AND_CHILD_SAFETY.md "data
 * controls and deletion options").
 *
 * 1. `DELETE /api/v1/me/` deletes, on the server, every child the parent owns exactly as a single
 *    child deletion does (photo objects first, then the child and everything that belongs to it),
 *    then the parent account. It needs a recent sign-in, like child deletion (LAI-0209). If photo
 *    storage could not be cleaned up the account is kept and nothing is lost; trying again
 *    finishes the job.
 * 2. Only then is the Cognito user deleted, while its token is still valid. Django holds no
 *    Cognito administrator right, so this is the client's call, and it is injected
 *    (`deleteCognitoUser`) by the auth layer rather than imported here.
 *
 * Order matters: everything that needs the signed-in session happens before the Cognito user is
 * deleted (which also signs the parent out).
 */
export type DeleteCognitoUser = () => Promise<void>;

export const ACCOUNT_DELETION_MESSAGES = {
  failed: 'Could not delete your account. Nothing was deleted. Please try again.',
  incomplete:
    'Your account could not be fully deleted yet. Nothing is lost. Please try again in a moment.',
  staff: 'This account is managed in the administration site and cannot be deleted here.',
  recentSignInRequired: 'Please confirm your sign-in to delete your account.',
  signInNotClosed:
    'Your account data was deleted, but we could not close your sign-in. Please try again.',
} as const;

function toAccountDeletionError(error: unknown): ProfileRequestError {
  if (!isApiError(error)) {
    return new ProfileRequestError(ACCOUNT_DELETION_MESSAGES.failed, { cause: error });
  }
  const code = error.code;
  const message =
    code === 'account_deletion_incomplete'
      ? ACCOUNT_DELETION_MESSAGES.incomplete
      : code === 'staff_account_not_deletable'
        ? ACCOUNT_DELETION_MESSAGES.staff
        : code === 'recent_auth_required'
          ? ACCOUNT_DELETION_MESSAGES.recentSignInRequired
          : code === 'recent_auth_unavailable'
            ? PROFILE_MESSAGES.recentSignInUnavailable
            : error.kind === 'unauthenticated'
              ? PROFILE_MESSAGES.signedOut
              : ACCOUNT_DELETION_MESSAGES.failed;
  return new ProfileRequestError(message, { code, cause: error });
}

export async function deleteAccountAndAllData(
  client: ApiClient,
  deleteCognitoUser: DeleteCognitoUser,
): Promise<void> {
  try {
    await client.request('DELETE', 'me/');
  } catch (error) {
    throw toAccountDeletionError(error);
  }
  try {
    await deleteCognitoUser();
  } catch (error) {
    // The Django account and every child's data are already gone; signing in again would only
    // create a new, empty account. Say so rather than claiming nothing happened.
    throw new ProfileRequestError(ACCOUNT_DELETION_MESSAGES.signInNotClosed, {
      code: 'cognito_user_not_deleted',
      cause: error,
    });
  }
}
