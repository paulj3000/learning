import { createSign, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';

/** Written by tests/e2e/django_server.py at start-up (the web server runs before any test). */
interface E2EState {
  issuer: string;
  kid: string;
  clientId: string;
  privateKeyPem: string;
  djangoOrigin: string;
  staffPassword: string;
}

let cached: E2EState | null = null;
export function e2eState(): E2EState {
  cached ??= JSON.parse(
    readFileSync(resolve(process.cwd(), 'test-results/.e2e/cognito.json'), 'utf8'),
  ) as E2EState;
  return cached;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function sign(payload: Record<string, unknown>): string {
  const state = e2eState();
  const header = base64url(JSON.stringify({ alg: 'RS256', kid: state.kid, typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${body}`);
  return `${header}.${body}.${signer.sign(state.privateKeyPem).toString('base64url')}`;
}

export interface Parent {
  sub: string;
  username: string;
  email: string;
  accessToken: string;
  idToken: string;
}

/** A synthetic Cognito parent: access and ID tokens signed by the local e2e key. */
export function mintParent(label: string, options: { groups?: string[] } = {}): Parent {
  const state = e2eState();
  const sub = `e2e-${label}-${randomUUID()}`;
  const username = sub;
  const email = `${label}@example.invalid`;
  const now = Math.floor(Date.now() / 1000);
  const common = { sub, iss: state.issuer, iat: now, auth_time: now, exp: now + 3 * 3600 };
  const groups = options.groups ? { 'cognito:groups': options.groups } : {};
  const accessToken = sign({
    ...common,
    ...groups,
    token_use: 'access',
    client_id: state.clientId,
    username,
    origin_jti: randomUUID(),
    jti: randomUUID(),
    scope: 'aws.cognito.signin.user.admin',
  });
  const idToken = sign({
    ...common,
    ...groups,
    token_use: 'id',
    aud: state.clientId,
    'cognito:username': username,
    email,
    email_verified: true,
  });
  return { sub, username, email, accessToken, idToken };
}

/** Puts the parent's tokens where Amplify v6 keeps them, before the app's first script runs. */
export async function signInAs(page: Page, parent: Parent): Promise<void> {
  const { clientId } = e2eState();
  await page.addInitScript(
    ({ prefix, user, tokens }) => {
      // Re-seeding on every navigation would undo a sign-out, so only seed a fresh context.
      if (window.sessionStorage.getItem('lai-e2e-seeded')) return;
      window.sessionStorage.setItem('lai-e2e-seeded', '1');
      window.localStorage.setItem(`${prefix}.LastAuthUser`, user);
      for (const [name, value] of Object.entries(tokens)) {
        window.localStorage.setItem(`${prefix}.${user}.${name}`, value);
      }
    },
    {
      prefix: `CognitoIdentityServiceProvider.${clientId}`,
      user: parent.username,
      tokens: {
        accessToken: parent.accessToken,
        idToken: parent.idToken,
        refreshToken: 'e2e-no-refresh',
        clockDrift: '0',
      },
    },
  );
}

/** Calls the Django API as the parent, the same way the app does (Bearer access token). */
export function api(request: APIRequestContext, parent: Parent) {
  const { djangoOrigin } = e2eState();
  const headers = { Authorization: `Bearer ${parent.accessToken}` };
  return {
    get: (path: string) => request.get(`${djangoOrigin}/api/v1/${path}`, { headers }),
    post: (path: string, data: unknown = {}) =>
      request.post(`${djangoOrigin}/api/v1/${path}`, { headers, data }),
    patch: (path: string, data: unknown) =>
      request.patch(`${djangoOrigin}/api/v1/${path}`, { headers, data }),
    delete: (path: string) => request.delete(`${djangoOrigin}/api/v1/${path}`, { headers }),
  };
}

export type AgeBand = 'SPROUT' | 'PATHFINDER' | 'EXPLORER';
// Defaults inside each band's allowed range (CLAUDE.md section 3).
const SESSION_MINUTES: Record<AgeBand, number> = { SPROUT: 6, PATHFINDER: 10, EXPLORER: 15 };
const READING_MODE: Record<AgeBand, string> = {
  SPROUT: 'VOICE_FIRST',
  PATHFINDER: 'READ_ALONG',
  EXPLORER: 'INDEPENDENT',
};

/** A parent with a provisioned Django account and one child, created through the API. */
export async function parentWithChild(
  request: APIRequestContext,
  label: string,
  child: { nickname: string; ageBand: AgeBand; sessionMinutes?: number },
): Promise<{ parent: Parent; childId: string }> {
  const parent = mintParent(label);
  const client = api(request, parent);
  expect((await client.post('me/')).status()).toBeLessThan(300);
  const created = await client.post('children/', {
    avatarKey: 'OTTER',
    readingMode: READING_MODE[child.ageBand],
    sessionMinutes: SESSION_MINUTES[child.ageBand],
    ...child,
  });
  expect(created.status(), await created.text()).toBe(201);
  const body = (await created.json()) as { id: string };
  return { parent, childId: body.id };
}

/**
 * Console and network discipline for every browser test: an uncaught exception, a failed
 * `/api` request, a 5xx, or a console error not in `allowedConsole` fails the test.
 */
export interface PageProblems {
  allowConsole(pattern: RegExp): void;
  allowStatus(pattern: RegExp, status: number): void;
  list(): string[];
}

export const test = base.extend<{ problems: PageProblems }>({
  problems: async ({ page }, provide) => {
    const problems: string[] = [];
    const allowedConsole: RegExp[] = [
      // React Router future-flag notices and Vite's HMR client are not app errors.
      /React Router Future Flag Warning/,
      /\[vite\]/,
    ];
    const allowedStatus: { pattern: RegExp; status: number }[] = [];
    page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (allowedConsole.some((pattern) => pattern.test(text))) return;
      problems.push(`console: ${text}`);
    });
    page.on('requestfailed', (request) => {
      const url = request.url();
      if (!url.includes('/api/v1/')) return;
      const reason = request.failure()?.errorText ?? '';
      // A navigation away aborts requests still in flight; that is not a failure.
      if (reason.includes('ERR_ABORTED')) return;
      problems.push(`request failed: ${request.method()} ${url} ${reason}`);
    });
    page.on('response', (response) => {
      const url = response.url();
      if (!url.includes('/api/v1/')) return;
      const status = response.status();
      if (status < 500 && status !== 404 && status !== 401 && status !== 403) return;
      if (allowedStatus.some((rule) => rule.pattern.test(url) && rule.status === status)) return;
      problems.push(`http ${status}: ${response.request().method()} ${url}`);
    });
    await provide({
      allowConsole: (pattern) => allowedConsole.push(pattern),
      allowStatus: (pattern, status) => allowedStatus.push({ pattern, status }),
      list: () => [...problems],
    });
    expect(problems, 'console errors, uncaught exceptions or failed API requests').toEqual([]);
  },
});

export { expect };
