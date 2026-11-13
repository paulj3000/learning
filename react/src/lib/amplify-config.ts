import { Amplify } from 'aws-amplify';
import { resolveBackend } from '../api/backend';
import { readCognitoConfig, type CognitoConfig } from './cognito/config';

/**
 * Configures the Amplify Auth SDK, which is kept only as a Cognito client until PR #15 (AMP-02)
 * replaces it. Cognito is the identity provider; Amplify's backend is not needed.
 *
 * Where the user pool and app client come from, in order:
 *
 * 1. `VITE_COGNITO_USER_POOL_ID` and `VITE_COGNITO_CLIENT_ID` (react/src/lib/cognito/config.ts,
 *    the same variables AMP-02 uses). Only the Auth category is configured, so no Amplify
 *    sandbox and no `amplify_outputs.json` are needed. This is the only source a Django build
 *    (`VITE_BACKEND=django`, the local default) uses.
 * 2. A legacy Amplify build only (`VITE_BACKEND=amplify`, or unset in production): the
 *    gitignored repository-root `amplify_outputs.json`, which the hosted Amplify pipeline
 *    writes. `import.meta.glob` tolerates the file being absent.
 *
 * With neither, sign-in is reported as unconfigured (a friendly page, never a crash).
 * Configured as a side effect of importing this module: `generateClient()` (data-client.ts)
 * needs `Amplify.configure()` to have run first, so every module that calls it imports this
 * file directly. Token storage is unchanged (Amplify v6's localStorage keys, scoped by client
 * id), so a parent who is signed in stays signed in (ADR-024 gate A1).
 */

type AmplifyOutputs = Record<string, unknown>;

export type AuthConfigSource = 'env' | 'amplify_outputs' | 'none';

export interface AuthSetup {
  source: AuthConfigSource;
  /** The Cognito region, for diagnostics; never a token or a credential. */
  region: string | null;
  /** What to pass to `Amplify.configure`, or null when sign-in is unconfigured. */
  amplifyConfig: Parameters<typeof Amplify.configure>[0] | null;
}

export interface AuthSetupEnv {
  VITE_BACKEND?: string;
  MODE?: string;
  VITE_COGNITO_USER_POOL_ID?: string;
  VITE_COGNITO_CLIENT_ID?: string;
}

/** The Auth-only Amplify configuration for an explicitly named pool and client. */
export function cognitoAmplifyConfig(
  config: CognitoConfig,
): Parameters<typeof Amplify.configure>[0] {
  return {
    Auth: {
      Cognito: {
        userPoolId: config.userPoolId,
        userPoolClientId: config.clientId,
        loginWith: { email: true },
        signUpVerificationMethod: 'code',
        userAttributes: { email: { required: true } },
      },
    },
  };
}

/** Pure: decides where Cognito settings come from. Exported for tests. */
export function resolveAuthSetup(
  env: AuthSetupEnv,
  outputs: AmplifyOutputs | undefined,
): AuthSetup {
  const cognito = readCognitoConfig(env);
  if (cognito) {
    return { source: 'env', region: cognito.region, amplifyConfig: cognitoAmplifyConfig(cognito) };
  }
  if (outputs && resolveBackend(env) === 'amplify') {
    const auth = (outputs as { auth?: { aws_region?: unknown } }).auth;
    return {
      source: 'amplify_outputs',
      region: typeof auth?.aws_region === 'string' ? auth.aws_region : null,
      amplifyConfig: outputs as Parameters<typeof Amplify.configure>[0],
    };
  }
  return { source: 'none', region: null, amplifyConfig: null };
}

const outputModules = import.meta.glob<{ default: AmplifyOutputs }>(
  '../../../amplify_outputs.json',
  { eager: true },
);

export const AUTH_SETUP: AuthSetup = resolveAuthSetup(
  import.meta.env,
  outputModules['../../../amplify_outputs.json']?.default,
);

/** Whether parent sign-in (Cognito) is configured for this build. */
export const isAuthConfigured = AUTH_SETUP.amplifyConfig !== null;

if (AUTH_SETUP.amplifyConfig) {
  Amplify.configure(AUTH_SETUP.amplifyConfig);
}
