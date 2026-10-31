import { readAuthMode } from './authMode';

describe('readAuthMode', () => {
  it('is cognito by default and when named, in any build', () => {
    expect(readAuthMode({})).toBe('cognito');
    expect(readAuthMode({ VITE_AUTH_PROVIDER: ' Cognito ', DEV: false })).toBe('cognito');
  });

  it('allows django sign-in only under vite dev with the Django API on', () => {
    expect(readAuthMode({ VITE_AUTH_PROVIDER: 'django', VITE_BACKEND: 'django', DEV: true })).toBe(
      'django',
    );
  });

  it('refuses django sign-in in a production build', () => {
    expect(() =>
      readAuthMode({ VITE_AUTH_PROVIDER: 'django', VITE_BACKEND: 'django', DEV: false }),
    ).toThrow(/local development/);
    expect(() => readAuthMode({ VITE_AUTH_PROVIDER: 'django', VITE_BACKEND: 'django' })).toThrow();
  });

  it('refuses django sign-in without the Django API', () => {
    expect(() => readAuthMode({ VITE_AUTH_PROVIDER: 'django', DEV: true })).toThrow(
      /VITE_BACKEND=django/,
    );
  });

  it.each(['amplify', 'session', 'django,cognito'])('refuses the unknown value %s', (value) => {
    expect(() => readAuthMode({ VITE_AUTH_PROVIDER: value, DEV: true })).toThrow(
      /cognito or django/,
    );
  });
});
