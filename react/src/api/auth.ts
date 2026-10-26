import {
  autoSignIn,
  confirmResetPassword,
  confirmSignUp as amplifyConfirmSignUp,
  confirmUserAttribute,
  deleteUser,
  fetchAuthSession,
  fetchUserAttributes,
  getCurrentUser,
  resendSignUpCode as amplifyResendSignUpCode,
  resetPassword,
  signIn as amplifySignIn,
  signOut as amplifySignOut,
  signUp as amplifySignUp,
  updatePassword,
  updateUserAttributes,
} from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { isAmplifyConfigured } from '../lib/amplify-config';

/**
 * Parent authentication (LAI-0501A). The one module in the app that calls
 * Amplify Auth.
 *
 * Cognito stays the identity provider on both backends (ADR-024, ADR-036):
 * Django has no sign-in of its own and verifies the Cognito access token on
 * every request. So `VITE_BACKEND` does not change anything here. A
 * Django-backed build additionally provisions the parent's Django account
 * once per sign-in (`DjangoAccountProvider`, `POST /api/v1/me/`).
 *
 * Tokens are never copied into app state, storage or logs (ADR-024 gate A1):
 * Amplify holds them and refreshes an expired one when asked.
 */

/** Cognito exception names the UI has parent-facing copy for (`describeAuthError`). */
export type AuthErrorCode =
  | 'UsernameExistsException'
  | 'NotAuthorizedException'
  | 'UserNotConfirmedException'
  | 'UserNotFoundException'
  | 'CodeMismatchException'
  | 'ExpiredCodeException'
  | 'InvalidPasswordException'
  | 'LimitExceededException'
  | 'InvalidParameterException'
  | 'AliasExistsException'
  | 'unknown';

const KNOWN_CODES: ReadonlySet<string> = new Set<AuthErrorCode>([
  'UsernameExistsException',
  'NotAuthorizedException',
  'UserNotConfirmedException',
  'UserNotFoundException',
  'CodeMismatchException',
  'ExpiredCodeException',
  'InvalidPasswordException',
  'LimitExceededException',
  'InvalidParameterException',
  'AliasExistsException',
]);

/**
 * Every failure from an auth operation. `code` is what callers branch on.
 * The message is Cognito's own (some screens show it, as they did before
 * LAI-0501A); Cognito never puts a token or password in it.
 */
export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message = `Authentication error: ${code}`) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

export function toAuthError(error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  const name = error instanceof Error ? error.name : '';
  const code = KNOWN_CODES.has(name) ? (name as AuthErrorCode) : 'unknown';
  return new AuthError(code, error instanceof Error && error.message ? error.message : undefined);
}

async function cognito<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw toAuthError(error);
  }
}

export const isAuthConfigured: boolean = isAmplifyConfigured;

// ---------------------------------------------------------------------------
// Session

export interface AuthSession {
  /** The Cognito `sub`. */
  userId: string;
  /** The ID token's `cognito:groups` claim, as Cognito sent it (unvalidated). */
  groups: unknown;
}

/**
 * The signed-in parent, or null when nobody is signed in (or the session
 * cannot be read). Never throws.
 */
export async function getCurrentAuthSession(): Promise<AuthSession | null> {
  try {
    const user = await getCurrentUser();
    const session = await fetchAuthSession();
    return { userId: user.userId, groups: session.tokens?.idToken?.payload['cognito:groups'] };
  } catch {
    return null;
  }
}

/** The signed-in parent's Cognito `sub`. Throws `AuthError` when nobody is signed in. */
export async function getCurrentUserId(): Promise<string> {
  const user = await cognito(() => getCurrentUser());
  return user.userId;
}

/**
 * The signed-in parent's Cognito **access** token, which is what Django
 * verifies (ADR-024; the multiplayer room server takes the ID token instead).
 *
 * Asked for on every request rather than held: Amplify refreshes an expired
 * token here, and ADR-024 gate A1 says not to copy tokens into app state or
 * any storage of our own. `forceRefresh` is used once after a 401.
 * Returns null when nobody is signed in.
 */
export async function getAccessToken(
  options: { forceRefresh?: boolean } = {},
): Promise<string | null> {
  const session = await fetchAuthSession({ forceRefresh: options.forceRefresh ?? false });
  return session.tokens?.accessToken?.toString() ?? null;
}

/**
 * The signed-in parent's Cognito **ID** token and its `sub`, for the
 * multiplayer room server (ADR-026), which verifies the ID token itself.
 * The same on both data backends. Null when there is no usable session.
 */
export async function getIdTokenIdentity(): Promise<{ idToken: string; sub: string } | null> {
  const session = await fetchAuthSession();
  const idToken = session.tokens?.idToken;
  const sub = idToken?.payload.sub;
  if (!idToken || typeof sub !== 'string') return null;
  return { idToken: idToken.toString(), sub };
}

export type AuthChange = 'signedIn' | 'signedOut';

/** Calls `listener` when a parent signs in or out. Returns the unsubscribe function. */
export function onAuthChange(listener: (change: AuthChange) => void): () => void {
  if (!isAuthConfigured) return () => {};
  return Hub.listen('auth', ({ payload }) => {
    if (payload.event === 'signedIn' || payload.event === 'signedOut') listener(payload.event);
  });
}

export async function signOut(): Promise<void> {
  await cognito(() => amplifySignOut());
}

// ---------------------------------------------------------------------------
// Sign-in, sign-up, confirmation, password recovery

export interface SignInResult {
  /** The account exists but its email is unconfirmed: go to the confirmation step. */
  needsConfirmation: boolean;
}

export async function signIn(email: string, password: string): Promise<SignInResult> {
  const { nextStep } = await cognito(() => amplifySignIn({ username: email, password }));
  return { needsConfirmation: nextStep.signInStep === 'CONFIRM_SIGN_UP' };
}

export async function signUp(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<void> {
  await cognito(() =>
    amplifySignUp({
      username: input.email,
      password: input.password,
      options: {
        userAttributes: { name: input.displayName, email: input.email },
        autoSignIn: true,
      },
    }),
  );
}

/** Confirms the sign-up code, then completes the sign-in that `signUp` asked for. */
export async function confirmSignUp(email: string, code: string): Promise<void> {
  const { nextStep } = await cognito(() =>
    amplifyConfirmSignUp({ username: email, confirmationCode: code }),
  );
  if (nextStep.signUpStep === 'COMPLETE_AUTO_SIGN_IN') {
    await cognito(() => autoSignIn());
  }
}

export async function resendSignUpCode(email: string): Promise<void> {
  await cognito(() => amplifyResendSignUpCode({ username: email }));
}

export async function requestPasswordReset(email: string): Promise<void> {
  await cognito(() => resetPassword({ username: email }));
}

export async function confirmPasswordReset(
  email: string,
  code: string,
  newPassword: string,
): Promise<void> {
  await cognito(() =>
    confirmResetPassword({ username: email, confirmationCode: code, newPassword }),
  );
}

// ---------------------------------------------------------------------------
// The signed-in parent's sign-in details

export interface AccountAttributes {
  email: string | null;
  name: string | null;
}

export async function getAccountAttributes(): Promise<AccountAttributes> {
  const attributes = await cognito(() => fetchUserAttributes());
  return { email: attributes.email ?? null, name: attributes.name ?? null };
}

export interface EmailChangeResult {
  needsConfirmation: boolean;
}

/**
 * Cognito sends a confirmation code to the new address before the change
 * takes effect; call `confirmEmailChange` with that code to complete it.
 */
export async function changeEmail(newEmail: string): Promise<EmailChangeResult> {
  const output = await cognito(() => updateUserAttributes({ userAttributes: { email: newEmail } }));
  const step = output.email?.nextStep.updateAttributeStep;
  return { needsConfirmation: step === 'CONFIRM_ATTRIBUTE_WITH_CODE' };
}

export async function confirmEmailChange(confirmationCode: string): Promise<void> {
  await cognito(() => confirmUserAttribute({ userAttributeKey: 'email', confirmationCode }));
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  await cognito(() => updatePassword({ oldPassword, newPassword }));
}

/** Deletes the Cognito user and signs out. Callers delete the parent's data first. */
export async function deleteCurrentUser(): Promise<void> {
  await cognito(() => deleteUser());
}
