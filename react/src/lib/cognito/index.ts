import { createCognitoAuth, memoryStorage, type CognitoAuth, type KeyValueStorage } from './auth';
import {
  readChildCognitoConfig,
  readCognitoConfig,
  type ChildCognitoEnv,
  type CognitoConfig,
  type CognitoEnv,
} from './config';

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

/** The child pool's pool and client (`VITE_COGNITO_CHILD_*`), or null when not configured. */
export const CHILD_COGNITO_CONFIG: CognitoConfig | null = readChildCognitoConfig(
  import.meta.env as ChildCognitoEnv,
);

export const isChildCognitoConfigured = CHILD_COGNITO_CONFIG !== null;

/**
 * A fresh child Cognito session held only in memory, never in `localStorage` (the child's
 * tokens are discarded as soon as Django has opened its own session). One per sign-in attempt,
 * so nothing carries over from a previous child on a shared device.
 */
export function createChildCognitoAuth(): CognitoAuth {
  if (!CHILD_COGNITO_CONFIG) {
    throw Object.assign(new Error('Child sign-in is not configured'), {
      name: 'AuthUnconfiguredException',
    });
  }
  return createCognitoAuth({ config: CHILD_COGNITO_CONFIG, storage: memoryStorage() });
}
