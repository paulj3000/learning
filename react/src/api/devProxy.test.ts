import {
  DEFAULT_DJANGO_DEV_TARGET,
  DEV_PROXY_TIMEOUT_MS,
  djangoDevProxy,
  djangoDevTarget,
} from './devProxy';

const route = (target: string) => ({
  '/api': {
    target,
    changeOrigin: false,
    timeout: DEV_PROXY_TIMEOUT_MS,
    proxyTimeout: DEV_PROXY_TIMEOUT_MS,
  },
});

describe('djangoDevProxy (TR-D14)', () => {
  it('is off when the build does not use the Django API', () => {
    expect(djangoDevProxy({})).toBeUndefined();
    expect(djangoDevProxy({ MODE: 'production' })).toBeUndefined();
    expect(
      djangoDevProxy({
        VITE_BACKEND: 'amplify',
        MODE: 'development',
        DJANGO_DEV_PROXY_TARGET: 'http://127.0.0.1:9000',
      }),
    ).toBeUndefined();
  });

  it('is on by default in vite dev (local development defaults to Django)', () => {
    expect(djangoDevProxy({ MODE: 'development' })).toEqual(route(DEFAULT_DJANGO_DEV_TARGET));
  });

  it('forwards /api to runserver by default, with a bounded timeout', () => {
    expect(djangoDevProxy({ VITE_BACKEND: 'django' })).toEqual(route(DEFAULT_DJANGO_DEV_TARGET));
  });

  it('follows DJANGO_DEV_PORT, the same variable make runserver binds to', () => {
    expect(djangoDevProxy({ VITE_BACKEND: 'django', DJANGO_DEV_PORT: '8000' })).toEqual(
      route('http://127.0.0.1:8000'),
    );
  });

  it('prefers an explicit loopback origin over DJANGO_DEV_PORT', () => {
    expect(
      djangoDevProxy({
        VITE_BACKEND: 'django',
        DJANGO_DEV_PORT: '8000',
        DJANGO_DEV_PROXY_TARGET: 'http://localhost:8001/',
      }),
    ).toEqual(route('http://localhost:8001'));
  });

  it('refuses a malformed port instead of guessing', () => {
    for (const port of ['80a', '0', '70000', '-1', '8000.5']) {
      expect(() => djangoDevTarget({ DJANGO_DEV_PORT: port })).toThrow(/DJANGO_DEV_PORT/);
    }
  });

  it('refuses an unknown VITE_BACKEND', () => {
    expect(() => djangoDevProxy({ VITE_BACKEND: 'djnago' })).toThrow(/VITE_BACKEND/);
  });

  it('refuses anything that would send tokens off this machine', () => {
    for (const target of [
      'https://api.example.com',
      'http://10.0.0.5:8000',
      'ftp://127.0.0.1',
      'not a url',
    ]) {
      expect(() =>
        djangoDevProxy({ VITE_BACKEND: 'django', DJANGO_DEV_PROXY_TARGET: target }),
      ).toThrow();
    }
  });
});
