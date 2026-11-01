/** Errors and messages shared by the Django profile and photo clients (LAI-CHILD-001, LAI-0905). */

/** A safe, parent-facing message; the details stay in `cause`. */
export class ProfileRequestError extends Error {
  readonly code: string | undefined;

  constructor(message: string, options: { code?: string; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'ProfileRequestError';
    this.code = options.code;
  }
}

export const PROFILE_MESSAGES = {
  limit: 'You already have the most child profiles allowed.',
  invalid: 'Some details were not accepted. Check them and try again.',
  deletionUnavailable:
    'Deleting is not available yet. You can turn the profile off instead, which hides it from play.',
  accountDeletionUnavailable: 'Deleting your account is not available here yet.',
  signedOut: 'Please sign in again.',
} as const;
