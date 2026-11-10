/**
 * Which Cognito user pool and app client the app signs parents in with
 * (AMP-02). These replace `amplify_outputs.json`: the same pool and client
 * the Amplify backend created, now named directly at build time.
 *
 * - `VITE_COGNITO_USER_POOL_ID`, e.g. `us-west-1_AbC123`. The region is its prefix.
 * - `VITE_COGNITO_CLIENT_ID`, the public app client (no secret: a browser
 *   can never hold one).
 *
 * Neither value is a secret. With either missing or malformed the app
 * reports authentication as unconfigured instead of failing at sign-in.
 */

export interface CognitoConfig {
  region: string;
  userPoolId: string;
  clientId: string;
}

export interface CognitoEnv {
  VITE_COGNITO_USER_POOL_ID?: string;
  VITE_COGNITO_CLIENT_ID?: string;
}

const POOL_ID = /^([a-z]{2}(?:-gov)?-[a-z]+-\d)_[A-Za-z0-9]+$/;
const CLIENT_ID = /^[a-z0-9]{1,128}$/;

export function readCognitoConfig(env: CognitoEnv): CognitoConfig | null {
  const userPoolId = (env.VITE_COGNITO_USER_POOL_ID ?? '').trim();
  const clientId = (env.VITE_COGNITO_CLIENT_ID ?? '').trim();
  const match = POOL_ID.exec(userPoolId);
  if (!match?.[1] || !CLIENT_ID.test(clientId)) return null;
  return { region: match[1], userPoolId, clientId };
}

export const COGNITO_CONFIG: CognitoConfig | null = readCognitoConfig(
  import.meta.env as CognitoEnv,
);
