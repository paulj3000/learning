import { AuthError } from '../../api/auth';

const FRIENDLY_MESSAGES: Record<string, string> = {
  UsernameExistsException: 'An account with that email already exists. Try signing in instead.',
  NotAuthorizedException: 'That email and password do not match. Please try again.',
  UserNotConfirmedException: 'Please confirm your email before signing in.',
  UserNotFoundException: 'We could not find an account with that email.',
  CodeMismatchException: 'That confirmation code is not correct. Please try again.',
  ExpiredCodeException: 'That code has expired. Request a new one.',
  InvalidPasswordException:
    'Choose a stronger password with at least 8 characters, including a number and a symbol.',
  LimitExceededException: 'Too many attempts. Please wait a moment and try again.',
  InvalidParameterException: 'Please check the information you entered and try again.',
  AliasExistsException: 'That email address is already in use by another account.',
};

function authErrorCode(error: unknown): string {
  return error instanceof AuthError ? error.code : error instanceof Error ? error.name : '';
}

/** Cognito's answer to a password change whose current password is wrong. */
export function isIncorrectPassword(error: unknown): boolean {
  return authErrorCode(error) === 'NotAuthorizedException';
}

export function describeAuthError(error: unknown): string {
  return FRIENDLY_MESSAGES[authErrorCode(error)] ?? 'Something went wrong. Please try again.';
}
