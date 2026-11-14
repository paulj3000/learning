import { cognitoEnvFallback, diagnosticsLines, probeDjango } from './devDiagnostics';

const POOL_ID = 'us-west-2_SecretLooking1';
const CLIENT_ID = 'clientidshouldnotprint';

describe('dev start-up diagnostics (P0)', () => {
  it('reports the default backend, the proxy target, Django and Cognito', () => {
    const lines = diagnosticsLines({
      env: {
        MODE: 'development',
        DJANGO_DEV_PORT: '8000',
        VITE_COGNITO_USER_POOL_ID: POOL_ID,
        VITE_COGNITO_CLIENT_ID: CLIENT_ID,
      },
      cognitoSource: 'react env',
      health: { ok: true },
    });
    expect(lines).toEqual([
      '[lai] dev backend: django (default for vite dev)',
      '[lai] dev API proxy: /api -> http://127.0.0.1:8000 (DJANGO_DEV_PORT)',
      '[lai] dev Django: reachable (GET /api/v1/health/ answered)',
      '[lai] dev Cognito: configured (region us-west-2, from react env)',
    ]);
  });

  it('never prints the pool id or the client id', () => {
    const text = diagnosticsLines({
      env: { VITE_COGNITO_USER_POOL_ID: POOL_ID, VITE_COGNITO_CLIENT_ID: CLIENT_ID },
      cognitoSource: 'react env',
      health: null,
    }).join('\n');
    expect(text).not.toContain(POOL_ID);
    expect(text).not.toContain(CLIENT_ID);
  });

  it('says how to fix an unreachable Django and a missing Cognito pool', () => {
    const text = diagnosticsLines({
      env: { VITE_BACKEND: 'django' },
      cognitoSource: null,
      health: { ok: false, reason: 'refused' },
    }).join('\n');
    expect(text).toContain('NOT reachable at http://127.0.0.1:8010 (refused)');
    expect(text).toContain('make runserver DJANGO_DEV_PORT=8010');
    expect(text).toContain('Cognito: NOT configured');
  });

  it('notes that the proxy is off for a VITE_BACKEND that is not django', () => {
    expect(
      diagnosticsLines({ env: { VITE_BACKEND: 'amplify' }, cognitoSource: null, health: null })[1],
    ).toContain('proxy: off');
  });
});

describe('cognitoEnvFallback', () => {
  it('keeps explicit VITE_COGNITO_* settings', () => {
    const reactEnv = { VITE_COGNITO_USER_POOL_ID: POOL_ID, VITE_COGNITO_CLIENT_ID: 'abc' };
    expect(cognitoEnvFallback(reactEnv, { COGNITO_USER_POOL_ID: 'us-east-1_Other' })).toEqual({
      env: reactEnv,
      source: 'react env',
    });
  });

  it("uses Django's root .env pool and the first allowed client otherwise", () => {
    expect(
      cognitoEnvFallback(
        {},
        { COGNITO_USER_POOL_ID: POOL_ID, COGNITO_ALLOWED_CLIENT_IDS: 'webclient1, android2' },
      ),
    ).toEqual({
      env: { VITE_COGNITO_USER_POOL_ID: POOL_ID, VITE_COGNITO_CLIENT_ID: 'webclient1' },
      source: 'root .env (COGNITO_*)',
    });
  });

  it('reports nothing configured when neither is usable', () => {
    expect(cognitoEnvFallback({}, { COGNITO_USER_POOL_ID: '' }).source).toBeNull();
  });
});

describe('probeDjango', () => {
  it('reports a healthy server, an error status and a refused connection', async () => {
    const ok = vi.fn(async () => new Response('{}', { status: 200 }));
    expect(await probeDjango('http://127.0.0.1:8000', ok)).toEqual({ ok: true });
    expect(ok).toHaveBeenCalledWith('http://127.0.0.1:8000/api/v1/health/', expect.anything());
    const bad = vi.fn(async () => new Response('', { status: 502 }));
    expect(await probeDjango('http://127.0.0.1:8000', bad)).toEqual({
      ok: false,
      reason: 'HTTP 502',
    });
    const refused = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await probeDjango('http://127.0.0.1:8000', refused)).toEqual({
      ok: false,
      reason: 'refused',
    });
  });
});
