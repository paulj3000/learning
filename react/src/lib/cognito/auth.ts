import type { CognitoConfig } from './config';
import { CognitoError, createCognitoService, type CognitoFetch } from './service';
import { answerPasswordVerifier, startSrp, type PasswordVerifierChallenge } from './srp';

/**
 * Parent sign-in against the Cognito user pool, with no Amplify (AMP-02).
 *
 * - Sign-in is `USER_SRP_AUTH`, the only password flow the existing app
 *   client allows: the password never leaves the browser.
 * - The session lives where Amplify v6 kept it (`localStorage`, the same
 *   `CognitoIdentityServiceProvider.<clientId>.<user>.*` keys), so a parent
 *   signed in before the switch stays signed in, and ADR-024 gate A1
 *   ("no token storage of our own") is unchanged.
 * - Tokens are read on demand and refreshed with the refresh token shortly
 *   before they expire; concurrent callers share one refresh.
 * - Sign-out revokes the refresh token, then clears the session.
 *
 * Shapes follow the Amplify calls they replace (`signIn` results,
 * `getCurrentUser`, `fetchAuthSession`) so screens and tests changed little.
 */

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** In-memory storage for when `localStorage` is unavailable (private mode, tests, scripts). */
export function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

export type JwtClaims = Record<string, unknown>;

export interface SessionTokens {
  accessToken: string;
  idToken: string | null;
  accessClaims: JwtClaims;
  idClaims: JwtClaims | null;
}

export interface CurrentUser {
  /** The parent's `sub`. */
  userId: string;
  /** Cognito's internal user name (a UUID when signing in with email). */
  username: string;
  signInDetails?: { loginId?: string };
}

export type SignInStep =
  | 'DONE'
  | 'CONFIRM_SIGN_UP'
  | 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED'
  | 'UNSUPPORTED_CHALLENGE';

export interface SignInResult {
  isSignedIn: boolean;
  nextStep: { signInStep: SignInStep };
}

export type AuthEvent = 'signedIn' | 'signedOut' | 'tokenRefreshFailure';

export interface CognitoAuth {
  signIn(input: { username: string; password: string }): Promise<SignInResult>;
  signOut(): Promise<void>;
  /** The current tokens, refreshed when about to expire; null when nobody is signed in. */
  getTokens(options?: { forceRefresh?: boolean }): Promise<SessionTokens | null>;
  /** Throws `UserUnAuthenticatedException` when nobody is signed in (as Amplify did). */
  getCurrentUser(): Promise<CurrentUser>;
  signUp(input: { email: string; password: string; name: string }): Promise<void>;
  confirmSignUp(input: { email: string; code: string }): Promise<void>;
  /** Signs in after `confirmSignUp` with the password given to `signUp` in this page, if any. */
  autoSignIn(email: string): Promise<boolean>;
  resendSignUpCode(email: string): Promise<void>;
  resetPassword(email: string): Promise<void>;
  confirmResetPassword(input: { email: string; code: string; newPassword: string }): Promise<void>;
  fetchUserAttributes(): Promise<Record<string, string>>;
  /** Starts an email change; true when Cognito sent a code to confirm it. */
  updateEmail(email: string): Promise<boolean>;
  confirmEmail(code: string): Promise<void>;
  changePassword(oldPassword: string, newPassword: string): Promise<void>;
  /** Deletes the signed-in Cognito user, then clears the session. */
  deleteUser(): Promise<void>;
  onEvent(listener: (event: AuthEvent) => void): () => void;
}

export interface CognitoAuthOptions {
  config: CognitoConfig;
  storage: KeyValueStorage;
  fetch?: CognitoFetch;
  now?: () => number;
}

/** Refresh this long before the access token expires. */
const REFRESH_MARGIN_MS = 60_000;
/** How long a sign-up password is kept in memory for `autoSignIn`. */
const AUTO_SIGN_IN_TTL_MS = 10 * 60_000;
const KEY_PREFIX = 'CognitoIdentityServiceProvider';

interface AuthenticationResult {
  AccessToken?: string;
  IdToken?: string;
  RefreshToken?: string;
}

interface InitiateAuthResponse {
  ChallengeName?: string;
  ChallengeParameters?: Record<string, string>;
  Session?: string;
  AuthenticationResult?: AuthenticationResult;
}

interface StoredSession {
  username: string;
  accessToken: string;
  idToken: string | null;
  refreshToken: string | null;
  clockDrift: number;
  loginId: string | null;
}

export function decodeJwtClaims(token: string): JwtClaims {
  const part = token.split('.')[1];
  if (!part) throw new CognitoError('InvalidTokenException', 'Malformed token');
  const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const json = new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
  const claims: unknown = JSON.parse(json);
  if (typeof claims !== 'object' || claims === null) {
    throw new CognitoError('InvalidTokenException', 'Malformed token');
  }
  return claims as JwtClaims;
}

function notSignedIn(): CognitoError {
  return new CognitoError('UserUnAuthenticatedException', 'No parent is signed in');
}

export function createCognitoAuth(options: CognitoAuthOptions): CognitoAuth {
  const { config, storage } = options;
  const service = createCognitoService(config, options.fetch);
  const now = options.now ?? (() => Date.now());
  const listeners = new Set<(event: AuthEvent) => void>();
  let refreshing: Promise<StoredSession | null> | null = null;
  let pendingSignUp: { email: string; password: string; expires: number } | null = null;

  const lastUserKey = `${KEY_PREFIX}.${config.clientId}.LastAuthUser`;
  const keysFor = (username: string) => {
    const base = `${KEY_PREFIX}.${config.clientId}.${username}`;
    return {
      accessToken: `${base}.accessToken`,
      idToken: `${base}.idToken`,
      refreshToken: `${base}.refreshToken`,
      clockDrift: `${base}.clockDrift`,
      signInDetails: `${base}.signInDetails`,
      oauthMetadata: `${base}.oauthMetadata`,
    };
  };

  function emit(event: AuthEvent): void {
    for (const listener of [...listeners]) listener(event);
  }

  function safeGet(key: string): string | null {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  }

  function load(): StoredSession | null {
    const username = safeGet(lastUserKey);
    if (!username) return null;
    const keys = keysFor(username);
    const accessToken = safeGet(keys.accessToken);
    if (!accessToken) return null;
    let loginId: string | null = null;
    const details = safeGet(keys.signInDetails);
    if (details) {
      try {
        const parsed: unknown = JSON.parse(details);
        const value = (parsed as { loginId?: unknown } | null)?.loginId;
        loginId = typeof value === 'string' ? value : null;
      } catch {
        loginId = null;
      }
    }
    const drift = Number.parseInt(safeGet(keys.clockDrift) ?? '0', 10);
    return {
      username,
      accessToken,
      idToken: safeGet(keys.idToken),
      refreshToken: safeGet(keys.refreshToken),
      clockDrift: Number.isFinite(drift) ? drift : 0,
      loginId,
    };
  }

  function save(session: StoredSession): void {
    const keys = keysFor(session.username);
    storage.setItem(lastUserKey, session.username);
    storage.setItem(keys.accessToken, session.accessToken);
    if (session.idToken) storage.setItem(keys.idToken, session.idToken);
    else storage.removeItem(keys.idToken);
    if (session.refreshToken) storage.setItem(keys.refreshToken, session.refreshToken);
    else storage.removeItem(keys.refreshToken);
    storage.setItem(keys.clockDrift, String(session.clockDrift));
    if (session.loginId) {
      storage.setItem(
        keys.signInDetails,
        JSON.stringify({ loginId: session.loginId, authFlowType: 'USER_SRP_AUTH' }),
      );
    } else {
      storage.removeItem(keys.signInDetails);
    }
  }

  function clear(): void {
    const username = safeGet(lastUserKey);
    try {
      if (username) {
        for (const key of Object.values(keysFor(username))) storage.removeItem(key);
      }
      storage.removeItem(lastUserKey);
    } catch {
      // Storage unavailable: nothing persisted to clear.
    }
  }

  function sessionFrom(
    result: AuthenticationResult,
    username: string,
    loginId: string | null,
    previous: StoredSession | null,
  ): StoredSession {
    if (!result.AccessToken) throw new CognitoError('InvalidTokens', 'Cognito returned no tokens');
    const claims = decodeJwtClaims(result.AccessToken);
    const issuedAt = typeof claims.iat === 'number' ? claims.iat * 1000 : 0;
    return {
      username,
      accessToken: result.AccessToken,
      idToken: result.IdToken ?? previous?.idToken ?? null,
      refreshToken: result.RefreshToken ?? previous?.refreshToken ?? null,
      clockDrift: issuedAt > 0 ? issuedAt - now() : 0,
      loginId,
    };
  }

  function isFresh(session: StoredSession): boolean {
    let exp: unknown;
    try {
      exp = decodeJwtClaims(session.accessToken).exp;
    } catch {
      return false;
    }
    if (typeof exp !== 'number') return false;
    return exp * 1000 - (now() + session.clockDrift) > REFRESH_MARGIN_MS;
  }

  async function refresh(session: StoredSession): Promise<StoredSession | null> {
    if (!session.refreshToken) return null;
    try {
      const response = await service.call<InitiateAuthResponse>('InitiateAuth', {
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: config.clientId,
        AuthParameters: { REFRESH_TOKEN: session.refreshToken },
      });
      if (!response.AuthenticationResult) return null;
      const next = sessionFrom(
        response.AuthenticationResult,
        session.username,
        session.loginId,
        session,
      );
      save(next);
      return next;
    } catch (error) {
      // A network failure keeps the session for a later try; a refused refresh token ends it.
      if (error instanceof CognitoError && error.name === 'NetworkError') throw error;
      clear();
      emit('tokenRefreshFailure');
      emit('signedOut');
      return null;
    }
  }

  async function currentSession(forceRefresh: boolean): Promise<StoredSession | null> {
    const session = load();
    if (!session) return null;
    if (!forceRefresh && isFresh(session)) return session;
    if (!refreshing) {
      refreshing = refresh(session).finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  async function signIn(input: { username: string; password: string }): Promise<SignInResult> {
    const loginId = input.username.trim();
    const srp = startSrp();
    let first: InitiateAuthResponse;
    try {
      first = await service.call<InitiateAuthResponse>('InitiateAuth', {
        AuthFlow: 'USER_SRP_AUTH',
        ClientId: config.clientId,
        AuthParameters: { USERNAME: loginId, SRP_A: srp.A.toString(16) },
      });
    } catch (error) {
      if (error instanceof CognitoError && error.name === 'UserNotConfirmedException') {
        return { isSignedIn: false, nextStep: { signInStep: 'CONFIRM_SIGN_UP' } };
      }
      throw error;
    }
    if (first.ChallengeName !== 'PASSWORD_VERIFIER' || !first.ChallengeParameters) {
      return { isSignedIn: false, nextStep: { signInStep: 'UNSUPPORTED_CHALLENGE' } };
    }
    const challenge = first.ChallengeParameters as unknown as PasswordVerifierChallenge;
    const answer = await answerPasswordVerifier({
      session: srp,
      userPoolId: config.userPoolId,
      password: input.password,
      challenge,
      now: new Date(now()),
    });
    let second: InitiateAuthResponse;
    try {
      second = await service.call<InitiateAuthResponse>('RespondToAuthChallenge', {
        ChallengeName: 'PASSWORD_VERIFIER',
        ClientId: config.clientId,
        ChallengeResponses: answer,
        ...(first.Session ? { Session: first.Session } : {}),
      });
    } catch (error) {
      if (error instanceof CognitoError && error.name === 'UserNotConfirmedException') {
        return { isSignedIn: false, nextStep: { signInStep: 'CONFIRM_SIGN_UP' } };
      }
      throw error;
    }
    if (second.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
      return {
        isSignedIn: false,
        nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED' },
      };
    }
    if (!second.AuthenticationResult) {
      return { isSignedIn: false, nextStep: { signInStep: 'UNSUPPORTED_CHALLENGE' } };
    }
    const previous = load();
    if (previous) clear();
    save(sessionFrom(second.AuthenticationResult, challenge.USER_ID_FOR_SRP, loginId, null));
    emit('signedIn');
    return { isSignedIn: true, nextStep: { signInStep: 'DONE' } };
  }

  async function signOut(): Promise<void> {
    const session = load();
    if (session?.refreshToken) {
      try {
        await service.call('RevokeToken', {
          Token: session.refreshToken,
          ClientId: config.clientId,
        });
      } catch {
        // Revocation is best effort; the local session is cleared regardless.
      }
    }
    clear();
    if (session) emit('signedOut');
  }

  async function requireAccessToken(): Promise<string> {
    const session = await currentSession(false);
    if (!session) throw notSignedIn();
    return session.accessToken;
  }

  return {
    signIn,
    signOut,

    async getTokens(opts = {}) {
      const session = await currentSession(opts.forceRefresh ?? false);
      if (!session) return null;
      return {
        accessToken: session.accessToken,
        idToken: session.idToken,
        accessClaims: decodeJwtClaims(session.accessToken),
        idClaims: session.idToken ? decodeJwtClaims(session.idToken) : null,
      };
    },

    async getCurrentUser() {
      const session = await currentSession(false);
      if (!session) throw notSignedIn();
      const claims = decodeJwtClaims(session.accessToken);
      const sub = typeof claims.sub === 'string' ? claims.sub : session.username;
      const username = typeof claims.username === 'string' ? claims.username : session.username;
      return {
        userId: sub,
        username,
        ...(session.loginId ? { signInDetails: { loginId: session.loginId } } : {}),
      };
    },

    async signUp(input) {
      const email = input.email.trim();
      await service.call('SignUp', {
        ClientId: config.clientId,
        Username: email,
        Password: input.password,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'name', Value: input.name.trim() },
        ],
      });
      pendingSignUp = { email, password: input.password, expires: now() + AUTO_SIGN_IN_TTL_MS };
    },

    async confirmSignUp(input) {
      await service.call('ConfirmSignUp', {
        ClientId: config.clientId,
        Username: input.email.trim(),
        ConfirmationCode: input.code.trim(),
      });
    },

    async autoSignIn(email) {
      const pending = pendingSignUp;
      pendingSignUp = null;
      if (!pending || pending.expires < now() || pending.email !== email.trim()) return false;
      const result = await signIn({ username: pending.email, password: pending.password });
      return result.isSignedIn;
    },

    async resendSignUpCode(email) {
      await service.call('ResendConfirmationCode', {
        ClientId: config.clientId,
        Username: email.trim(),
      });
    },

    async resetPassword(email) {
      await service.call('ForgotPassword', { ClientId: config.clientId, Username: email.trim() });
    },

    async confirmResetPassword(input) {
      await service.call('ConfirmForgotPassword', {
        ClientId: config.clientId,
        Username: input.email.trim(),
        ConfirmationCode: input.code.trim(),
        Password: input.newPassword,
      });
    },

    async fetchUserAttributes() {
      const response = await service.call<{
        UserAttributes?: { Name?: string; Value?: string }[];
      }>('GetUser', { AccessToken: await requireAccessToken() });
      const attributes: Record<string, string> = {};
      for (const attribute of response.UserAttributes ?? []) {
        if (attribute.Name && typeof attribute.Value === 'string') {
          attributes[attribute.Name] = attribute.Value;
        }
      }
      return attributes;
    },

    async updateEmail(email) {
      const response = await service.call<{ CodeDeliveryDetailsList?: unknown[] }>(
        'UpdateUserAttributes',
        {
          AccessToken: await requireAccessToken(),
          UserAttributes: [{ Name: 'email', Value: email.trim() }],
        },
      );
      return (response.CodeDeliveryDetailsList ?? []).length > 0;
    },

    async confirmEmail(code) {
      await service.call('VerifyUserAttribute', {
        AccessToken: await requireAccessToken(),
        AttributeName: 'email',
        Code: code.trim(),
      });
    },

    async changePassword(oldPassword, newPassword) {
      await service.call('ChangePassword', {
        AccessToken: await requireAccessToken(),
        PreviousPassword: oldPassword,
        ProposedPassword: newPassword,
      });
    },

    async deleteUser() {
      await service.call('DeleteUser', { AccessToken: await requireAccessToken() });
      clear();
      emit('signedOut');
    },

    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
