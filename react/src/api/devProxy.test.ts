import { DEFAULT_DJANGO_DEV_TARGET, djangoDevProxy } from './devProxy';

describe('djangoDevProxy (TR-D14)', () => {
  it('is off unless the build uses the Django API', () => {
    expect(djangoDevProxy({})).toBeUndefined();
    expect(
      djangoDevProxy({ VITE_BACKEND: 'amplify', DJANGO_DEV_PROXY_TARGET: 'http://127.0.0.1:9000' }),
    ).toBeUndefined();
  });

  it('forwards /api to runserver by default', () => {
    expect(djangoDevProxy({ VITE_BACKEND: 'django' })).toEqual({
      '/api': { target: DEFAULT_DJANGO_DEV_TARGET, changeOrigin: false },
    });
  });

  it('accepts a configured loopback origin', () => {
    expect(
      djangoDevProxy({ VITE_BACKEND: 'django', DJANGO_DEV_PROXY_TARGET: 'http://localhost:8001/' }),
    ).toEqual({
      '/api': { target: 'http://localhost:8001', changeOrigin: false },
    });
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
