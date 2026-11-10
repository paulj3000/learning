import { createCognitoAuth, type CognitoAuth, type KeyValueStorage } from './auth';
import { COGNITO_CONFIG } from './config';

export { CognitoError } from './service';
export type {
  AuthEvent,
  CognitoAuth,
  CurrentUser,
  SessionTokens,
  SignInResult,
  SignInStep,
} from './auth';

/** In-memory storage for when `localStorage` is unavailable (private mode, tests). */
export function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

function browserStorage(): KeyValueStorage {
  try {
    const storage = globalThis.localStorage;
    if (storage) return storage;
  } catch {
    // Access can throw when site data is blocked.
  }
  return memoryStorage();
}

export const isCognitoConfigured = COGNITO_CONFIG !== null;

let instance: CognitoAuth | null = null;

/**
 * The app's one Cognito session. Throws when the build has no Cognito
 * configuration; screens check `isCognitoConfigured` first.
 */
export function cognitoAuth(): CognitoAuth {
  if (!COGNITO_CONFIG) {
    throw Object.assign(new Error('Cognito is not configured'), {
      name: 'AuthUnconfiguredException',
    });
  }
  instance ??= createCognitoAuth({ config: COGNITO_CONFIG, storage: browserStorage() });
  return instance;
}
