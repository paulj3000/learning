import { readBackendSetting, resolveBackend } from './backend';
import { readDjangoApiConfig } from './config';

describe('resolveBackend (P0: local development defaults to Django)', () => {
  it('uses Django in vite dev when VITE_BACKEND is unset', () => {
    expect(resolveBackend({ MODE: 'development' })).toBe('django');
    expect(resolveBackend({ MODE: 'development', VITE_BACKEND: '  ' })).toBe('django');
  });

  it('never switches a production build or a unit test silently', () => {
    expect(resolveBackend({ MODE: 'production' })).toBeNull();
    expect(resolveBackend({ MODE: 'test' })).toBeNull();
    expect(resolveBackend({})).toBeNull();
  });

  it('follows an explicit setting in every mode', () => {
    expect(resolveBackend({ MODE: 'production', VITE_BACKEND: 'django' })).toBe('django');
    expect(resolveBackend({ MODE: 'development', VITE_BACKEND: 'Django' })).toBe('django');
  });

  it('reports an unknown value so the dev server can refuse it', () => {
    expect(readBackendSetting({ VITE_BACKEND: 'djnago' })).toBeUndefined();
    expect(readBackendSetting({})).toBeNull();
    expect(resolveBackend({ MODE: 'development', VITE_BACKEND: 'djnago' })).toBeNull();
  });

  it('no longer accepts the retired Amplify backend (AMP-07)', () => {
    expect(readBackendSetting({ VITE_BACKEND: 'amplify' })).toBeUndefined();
    expect(resolveBackend({ MODE: 'development', VITE_BACKEND: 'amplify' })).toBeNull();
  });

  it('turns the Django API on for vite dev by default, same-origin through the proxy', () => {
    expect(readDjangoApiConfig({ MODE: 'development', DEV: true })).toEqual({
      enabled: true,
      baseUrl: '',
    });
    expect(readDjangoApiConfig({ MODE: 'production' })).toEqual({ enabled: false });
  });
});
