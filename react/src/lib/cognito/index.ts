import { createCognitoAuth, memoryStorage, type CognitoAuth, type KeyValueStorage } from './auth';
import { readCognitoConfig, type CognitoConfig, type CognitoEnv } from './config';

export { CognitoError } from './service';
export type {
  AuthEvent,
  CognitoAuth,
  CurrentUser,
  SessionTokens,
  SignInResult,
  SignInStep,
} from './auth';

export { memoryStorage };

/** This build's pool and client (`VITE_COGNITO_*`, see config.ts). */
export const COGNITO_CONFIG: CognitoConfig | null = readCognitoConfig(
  import.meta.env as CognitoEnv,
);

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
