/**
 * Room server configuration, read only from the environment
 * (docs/multiplayer/MULTIPLAYER_SERVER.md has the full table).
 */

export interface RoomServerConfig {
  port: number;
  production: boolean;
  /** Exact browser origins allowed to open a WebSocket. */
  allowedOrigins: readonly string[];
  userPoolId: string;
  userPoolClientId: string;
  /** Origin of the Django API, e.g. `https://api.example.org`, without `/api/v1`. */
  djangoApiBase: string;
}

export class RoomServerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoomServerConfigError';
  }
}

const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

const REQUIRED = ['MP_USER_POOL_ID', 'MP_USER_POOL_CLIENT_ID', 'MP_DJANGO_API_BASE'] as const;

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readDjangoApiBase(raw: string, production: boolean): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RoomServerConfigError(`MP_DJANGO_API_BASE is not a URL: ${raw}`);
  }
  const allowed = production ? ['https:'] : ['https:', 'http:'];
  if (!allowed.includes(url.protocol)) {
    throw new RoomServerConfigError(
      production
        ? 'MP_DJANGO_API_BASE must be https:// in production.'
        : 'MP_DJANGO_API_BASE must be http:// or https://.',
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new RoomServerConfigError(
      'MP_DJANGO_API_BASE must be a plain origin (and optional path), without credentials, query or fragment.',
    );
  }
  return url.toString().replace(/\/+$/, '');
}

export function readRoomServerConfig(
  env: Readonly<Record<string, string | undefined>>,
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

  const userPoolId = nonEmpty(env.MP_USER_POOL_ID);
  const userPoolClientId = nonEmpty(env.MP_USER_POOL_CLIENT_ID);
  const apiBase = nonEmpty(env.MP_DJANGO_API_BASE);
  if (!userPoolId || !userPoolClientId || !apiBase) {
    const missing = REQUIRED.filter((name) => !nonEmpty(env[name]));
    throw new RoomServerConfigError(
      `Missing required environment variables: ${missing.join(', ')}.`,
    );
  }
  const djangoApiBase = readDjangoApiBase(apiBase, production);

  return { port, production, allowedOrigins, userPoolId, userPoolClientId, djangoApiBase };
}
