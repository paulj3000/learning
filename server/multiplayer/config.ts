/**
 * Room server configuration, read from the environment with the Amplify
 * sandbox's `amplify_outputs.json` as the source of Cognito and AppSync ids
 * (docs/multiplayer/MULTIPLAYER_SERVER.md has the full table).
 */

export interface RoomServerConfig {
  port: number;
  production: boolean;
  /** Exact browser origins allowed to open a WebSocket. */
  allowedOrigins: readonly string[];
  userPoolId: string;
  userPoolClientId: string;
  appSyncUrl: string;
}

export class RoomServerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoomServerConfigError';
  }
}

const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

function stringAt(value: unknown, path: readonly string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' && current.length > 0 ? current : undefined;
}

export function readRoomServerConfig(
  env: Readonly<Record<string, string | undefined>>,
  amplifyOutputs: unknown,
): RoomServerConfig {
  const production = env.NODE_ENV === 'production';

  const port = Number(env.MP_PORT ?? '2567');
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new RoomServerConfigError(`MP_PORT is not a valid port: ${env.MP_PORT}`);
  }

  const allowedOrigins = env.MP_ALLOWED_ORIGINS
    ? env.MP_ALLOWED_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0)
    : production
      ? []
      : DEV_ORIGINS;
  if (allowedOrigins.length === 0) {
    throw new RoomServerConfigError(
      'MP_ALLOWED_ORIGINS must list at least one origin in production.',
    );
  }
  if (production && allowedOrigins.some((origin) => !origin.startsWith('https://'))) {
    throw new RoomServerConfigError(
      'Every MP_ALLOWED_ORIGINS entry must be https:// in production.',
    );
  }

  const userPoolId = env.MP_USER_POOL_ID ?? stringAt(amplifyOutputs, ['auth', 'user_pool_id']);
  const userPoolClientId =
    env.MP_USER_POOL_CLIENT_ID ?? stringAt(amplifyOutputs, ['auth', 'user_pool_client_id']);
  const appSyncUrl = env.MP_APPSYNC_URL ?? stringAt(amplifyOutputs, ['data', 'url']);
  if (!userPoolId || !userPoolClientId || !appSyncUrl) {
    throw new RoomServerConfigError(
      'Cognito and AppSync ids are missing: set MP_USER_POOL_ID, MP_USER_POOL_CLIENT_ID and ' +
        'MP_APPSYNC_URL, or run from a checkout with amplify_outputs.json.',
    );
  }

  return { port, production, allowedOrigins, userPoolId, userPoolClientId, appSyncUrl };
}
