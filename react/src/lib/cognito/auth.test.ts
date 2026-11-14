import { beforeEach, describe, expect, it } from 'vitest';
import { createCognitoAuth, decodeJwtClaims, memoryStorage, type AuthEvent } from './auth';
import { readCognitoConfig } from './config';
import {
  SRP_G,
  SRP_N,
  bytesToHex,
  derivedKey,
  modPow,
  multiplierK,
  privateKeyX,
  scramblerU,
} from './srp';

const CONFIG = { region: 'us-west-1', userPoolId: 'us-west-1_Pool123', clientId: 'client123' };
const EMAIL = 'parent@example.com';
const USER_ID = 'b6f1c2d3-0000-4000-8000-000000000001';
const PASSWORD = 'Secret-pass1';
const SALT = 0xabcdef0123456789n;
const SECRET_BLOCK = btoa('server secret block');

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${encode({ alg: 'none' })}.${encode(claims)}.sig`;
}

interface Call {
  target: string;
  body: Record<string, unknown>;
}

/**
 * A fake Cognito that runs the real SRP server side, so a sign-in passes
 * only when the client proves the right password.
 */
function fakeCognito(clock: { now: number }) {
  const calls: Call[] = [];
  const state = {
    password: PASSWORD,
    confirmed: true,
    refreshValid: true,
    b: 0x1234567890abcdef1234n,
    pending: null as { A: bigint; B: bigint } | null,
    refreshCount: 0,
  };

  function tokens(withRefresh: boolean) {
    const iat = Math.floor(clock.now / 1000);
    return {
      AccessToken: jwt({ sub: USER_ID, username: USER_ID, iat, exp: iat + 3600, auth_time: iat }),
      IdToken: jwt({ sub: USER_ID, iat, exp: iat + 3600, 'cognito:groups': ['Admins'] }),
      ...(withRefresh ? { RefreshToken: 'refresh-token-1' } : {}),
    };
  }

  function fail(name: string) {
    return new Response(JSON.stringify({ __type: `com.amazonaws#${name}`, message: name }), {
      status: 400,
    });
  }

  const fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const target = String(headers['X-Amz-Target']).split('.')[1]!;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ target, body });
    const ok = (data: object) => new Response(JSON.stringify(data), { status: 200 });

    if (target === 'InitiateAuth' && body.AuthFlow === 'USER_SRP_AUTH') {
      if (!state.confirmed) return fail('UserNotConfirmedException');
      const params = body.AuthParameters as Record<string, string>;
      const A = BigInt(`0x${params.SRP_A}`);
      const x = await privateKeyX('Pool123', USER_ID, PASSWORD, SALT);
      const v = modPow(SRP_G, x, SRP_N);
      const B = ((await multiplierK()) * v + modPow(SRP_G, state.b, SRP_N)) % SRP_N;
      state.pending = { A, B };
      return ok({
        ChallengeName: 'PASSWORD_VERIFIER',
        Session: 'srp-session',
        ChallengeParameters: {
          SRP_B: B.toString(16),
          SALT: SALT.toString(16),
          SECRET_BLOCK,
          USER_ID_FOR_SRP: USER_ID,
          USERNAME: USER_ID,
        },
      });
    }
    if (target === 'RespondToAuthChallenge') {
      const { A, B } = state.pending!;
      const responses = body.ChallengeResponses as Record<string, string>;
      const x = await privateKeyX('Pool123', USER_ID, state.password, SALT);
      const v = modPow(SRP_G, x, SRP_N);
      const u = await scramblerU(A, B);
      const key = await derivedKey(modPow(A * modPow(v, u, SRP_N), state.b, SRP_N), u);
      const encoder = new TextEncoder();
      const message = new Uint8Array([
        ...encoder.encode('Pool123'),
        ...encoder.encode(USER_ID),
        ...Uint8Array.from(atob(SECRET_BLOCK), (c) => c.charCodeAt(0)),
        ...encoder.encode(responses.TIMESTAMP!),
      ]);
      const hmacKey = await crypto.subtle.importKey(
        'raw',
        key,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const expected = btoa(
        String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, message))),
      );
      if (responses.PASSWORD_CLAIM_SIGNATURE !== expected) return fail('NotAuthorizedException');
      return ok({ AuthenticationResult: tokens(true) });
    }
    if (target === 'InitiateAuth' && body.AuthFlow === 'REFRESH_TOKEN_AUTH') {
      state.refreshCount += 1;
      if (!state.refreshValid) return fail('NotAuthorizedException');
      return ok({ AuthenticationResult: tokens(false) });
    }
    if (target === 'GetUser') {
      return ok({
        UserAttributes: [
          { Name: 'email', Value: EMAIL },
          { Name: 'name', Value: 'Pat' },
        ],
      });
    }
    if (target === 'UpdateUserAttributes') {
      return ok({ CodeDeliveryDetailsList: [{ AttributeName: 'email' }] });
    }
    return ok({});
  };
  return { fetch, calls, state };
}

let clock: { now: number };
let cognito: ReturnType<typeof fakeCognito>;
let storage: ReturnType<typeof memoryStorage>;

function makeAuth() {
  return createCognitoAuth({
    config: CONFIG,
    storage,
    fetch: cognito.fetch,
    now: () => clock.now,
  });
}

beforeEach(() => {
  clock = { now: Date.UTC(2026, 10, 10, 9, 0, 0) };
  cognito = fakeCognito(clock);
  storage = memoryStorage();
});

describe('readCognitoConfig', () => {
  it('reads the pool, client and region', () => {
    expect(
      readCognitoConfig({
        VITE_COGNITO_USER_POOL_ID: 'us-west-1_AbC123',
        VITE_COGNITO_CLIENT_ID: 'abc123def',
      }),
    ).toEqual({ region: 'us-west-1', userPoolId: 'us-west-1_AbC123', clientId: 'abc123def' });
  });

  it('is null when missing or malformed', () => {
    expect(readCognitoConfig({})).toBeNull();
    expect(
      readCognitoConfig({ VITE_COGNITO_USER_POOL_ID: 'nope', VITE_COGNITO_CLIENT_ID: 'abc' }),
    ).toBeNull();
    expect(
      readCognitoConfig({
        VITE_COGNITO_USER_POOL_ID: 'us-west-1_AbC',
        VITE_COGNITO_CLIENT_ID: 'has space',
      }),
    ).toBeNull();
  });
});

describe('signIn', () => {
  it('proves the password with SRP and stores the session where Amplify kept it', async () => {
    const auth = makeAuth();
    const events: AuthEvent[] = [];
    auth.onEvent((event) => events.push(event));

    const result = await auth.signIn({ username: ` ${EMAIL} `, password: PASSWORD });

    expect(result).toEqual({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
    expect(events).toEqual(['signedIn']);
    const first = cognito.calls[0]!;
    expect(first.body.AuthParameters).toMatchObject({ USERNAME: EMAIL });
    expect(JSON.stringify(cognito.calls)).not.toContain(PASSWORD);
    expect(storage.getItem('CognitoIdentityServiceProvider.client123.LastAuthUser')).toBe(USER_ID);
    expect(
      storage.getItem(`CognitoIdentityServiceProvider.client123.${USER_ID}.refreshToken`),
    ).toBe('refresh-token-1');
    expect(await auth.getCurrentUser()).toEqual({
      userId: USER_ID,
      username: USER_ID,
      signInDetails: { loginId: EMAIL },
    });
  });

  it('rejects a wrong password with NotAuthorizedException and stores nothing', async () => {
    cognito.state.password = 'something else';
    const auth = makeAuth();
    await expect(auth.signIn({ username: EMAIL, password: PASSWORD })).rejects.toMatchObject({
      name: 'NotAuthorizedException',
    });
    expect(await auth.getTokens()).toBeNull();
  });

  it('asks for confirmation when the account is not confirmed', async () => {
    cognito.state.confirmed = false;
    expect(await makeAuth().signIn({ username: EMAIL, password: PASSWORD })).toEqual({
      isSignedIn: false,
      nextStep: { signInStep: 'CONFIRM_SIGN_UP' },
    });
  });
});

describe('session', () => {
  it('reads tokens without a call while fresh, and exposes the group claims', async () => {
    const auth = makeAuth();
    await auth.signIn({ username: EMAIL, password: PASSWORD });
    const before = cognito.calls.length;
    const tokens = await auth.getTokens();
    expect(cognito.calls.length).toBe(before);
    expect(tokens?.idClaims?.['cognito:groups']).toEqual(['Admins']);
    expect(decodeJwtClaims(tokens!.accessToken).sub).toBe(USER_ID);
  });

  it('refreshes once near expiry, keeping the refresh token, shared by concurrent callers', async () => {
    const auth = makeAuth();
    await auth.signIn({ username: EMAIL, password: PASSWORD });
    const firstAccess = (await auth.getTokens())!.accessToken;
    clock.now += 3590 * 1000;
    const [a, b] = await Promise.all([auth.getTokens(), auth.getTokens()]);
    expect(cognito.state.refreshCount).toBe(1);
    expect(a?.accessToken).not.toBe(firstAccess);
    expect(b?.accessToken).toBe(a?.accessToken);
    const refreshCall = cognito.calls.find((c) => c.body.AuthFlow === 'REFRESH_TOKEN_AUTH')!;
    expect(refreshCall.body.AuthParameters).toEqual({ REFRESH_TOKEN: 'refresh-token-1' });
    expect(
      storage.getItem(`CognitoIdentityServiceProvider.client123.${USER_ID}.refreshToken`),
    ).toBe('refresh-token-1');
  });

  it('forceRefresh refreshes even when fresh', async () => {
    const auth = makeAuth();
    await auth.signIn({ username: EMAIL, password: PASSWORD });
    await auth.getTokens({ forceRefresh: true });
    expect(cognito.state.refreshCount).toBe(1);
  });

  it('ends the session when the refresh token is refused', async () => {
    const auth = makeAuth();
    await auth.signIn({ username: EMAIL, password: PASSWORD });
    const events: AuthEvent[] = [];
    auth.onEvent((event) => events.push(event));
    cognito.state.refreshValid = false;
    clock.now += 4000 * 1000;
    expect(await auth.getTokens()).toBeNull();
    expect(events).toEqual(['tokenRefreshFailure', 'signedOut']);
    await expect(auth.getCurrentUser()).rejects.toMatchObject({
      name: 'UserUnAuthenticatedException',
    });
  });

  it('picks up a session another instance stored (a page reload)', async () => {
    await makeAuth().signIn({ username: EMAIL, password: PASSWORD });
    expect((await makeAuth().getCurrentUser()).userId).toBe(USER_ID);
  });
});

describe('signOut', () => {
  it('revokes the refresh token and clears every key', async () => {
    const auth = makeAuth();
    await auth.signIn({ username: EMAIL, password: PASSWORD });
    const events: AuthEvent[] = [];
    auth.onEvent((event) => events.push(event));
    await auth.signOut();
    const revoke = cognito.calls.find((c) => c.target === 'RevokeToken')!;
    expect(revoke.body).toEqual({ Token: 'refresh-token-1', ClientId: 'client123' });
    expect(events).toEqual(['signedOut']);
    expect(storage.getItem('CognitoIdentityServiceProvider.client123.LastAuthUser')).toBeNull();
    expect(
      storage.getItem(`CognitoIdentityServiceProvider.client123.${USER_ID}.accessToken`),
    ).toBeNull();
  });
});

describe('account operations', () => {
  it('signs up with email and name, then auto signs in after confirmation', async () => {
    const auth = makeAuth();
    await auth.signUp({ email: EMAIL, password: PASSWORD, name: ' Pat ' });
    expect(cognito.calls[0]).toEqual({
      target: 'SignUp',
      body: {
        ClientId: 'client123',
        Username: EMAIL,
        Password: PASSWORD,
        UserAttributes: [
          { Name: 'email', Value: EMAIL },
          { Name: 'name', Value: 'Pat' },
        ],
      },
    });
    await auth.confirmSignUp({ email: EMAIL, code: ' 123456 ' });
    expect(cognito.calls[1]!.body).toMatchObject({ ConfirmationCode: '123456' });
    expect(await auth.autoSignIn(EMAIL)).toBe(true);
    expect(await auth.autoSignIn(EMAIL)).toBe(false); // the password is used once
  });

  it('does not auto sign in after the remembered password expires', async () => {
    const auth = makeAuth();
    await auth.signUp({ email: EMAIL, password: PASSWORD, name: 'Pat' });
    clock.now += 11 * 60_000;
    expect(await auth.autoSignIn(EMAIL)).toBe(false);
  });

  it('sends the access token for attribute, email, password and delete calls', async () => {
    const auth = makeAuth();
    await auth.signIn({ username: EMAIL, password: PASSWORD });
    const access = (await auth.getTokens())!.accessToken;

    expect(await auth.fetchUserAttributes()).toEqual({ email: EMAIL, name: 'Pat' });
    expect(await auth.updateEmail('new@example.com')).toBe(true);
    await auth.confirmEmail('654321');
    await auth.changePassword('old', 'new-Pass1');
    await auth.deleteUser();

    const byTarget = (target: string) => cognito.calls.find((c) => c.target === target)!.body;
    expect(byTarget('GetUser')).toEqual({ AccessToken: access });
    expect(byTarget('UpdateUserAttributes')).toEqual({
      AccessToken: access,
      UserAttributes: [{ Name: 'email', Value: 'new@example.com' }],
    });
    expect(byTarget('VerifyUserAttribute')).toEqual({
      AccessToken: access,
      AttributeName: 'email',
      Code: '654321',
    });
    expect(byTarget('ChangePassword')).toEqual({
      AccessToken: access,
      PreviousPassword: 'old',
      ProposedPassword: 'new-Pass1',
    });
    expect(byTarget('DeleteUser')).toEqual({ AccessToken: access });
    expect(await auth.getTokens()).toBeNull();
  });

  it('refuses account calls when nobody is signed in', async () => {
    await expect(makeAuth().fetchUserAttributes()).rejects.toMatchObject({
      name: 'UserUnAuthenticatedException',
    });
  });

  it('runs the forgot password flow', async () => {
    const auth = makeAuth();
    await auth.resetPassword(EMAIL);
    await auth.confirmResetPassword({ email: EMAIL, code: '111222', newPassword: 'N3w-pass!' });
    expect(cognito.calls.map((c) => c.target)).toEqual(['ForgotPassword', 'ConfirmForgotPassword']);
    expect(cognito.calls[1]!.body).toEqual({
      ClientId: 'client123',
      Username: EMAIL,
      ConfirmationCode: '111222',
      Password: 'N3w-pass!',
    });
  });

  it('reports Cognito errors by exception name and network failures as NetworkError', async () => {
    const auth = createCognitoAuth({
      config: CONFIG,
      storage,
      fetch: async () => {
        throw new TypeError('offline');
      },
    });
    await expect(auth.resetPassword(EMAIL)).rejects.toMatchObject({ name: 'NetworkError' });
  });
});

describe('helpers', () => {
  it('bytesToHex is lowercase and padded', () => {
    expect(bytesToHex(new Uint8Array([0, 15, 255]))).toBe('000fff');
  });
});
