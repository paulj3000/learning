/**
 * Whether this build talks to a multiplayer room server at all
 * (docs/DECISIONS.md ADR-026 part H). Off unless explicitly configured, so
 * every existing build and region stays single-player.
 *
 * - `VITE_MULTIPLAYER_ENABLED=true` and `VITE_MULTIPLAYER_URL` turn it on.
 *   A production build only accepts a `wss://` URL.
 * - `VITE_MULTIPLAYER_DEV_REGIONS` (comma-separated region ids) lets a
 *   developer try presence in a region whose manifest does not opt in.
 *   It is ignored outside `vite dev`.
 */

export type MultiplayerConfig =
  { enabled: false } | { enabled: true; serverUrl: string; devRegionIds: readonly string[] };

export interface MultiplayerEnv {
  VITE_MULTIPLAYER_ENABLED?: string;
  VITE_MULTIPLAYER_URL?: string;
  VITE_MULTIPLAYER_DEV_REGIONS?: string;
  DEV?: boolean;
}

const DISABLED: MultiplayerConfig = { enabled: false };

export function readMultiplayerConfig(env: MultiplayerEnv): MultiplayerConfig {
  if (env.VITE_MULTIPLAYER_ENABLED !== 'true' || !env.VITE_MULTIPLAYER_URL) return DISABLED;

  let url: URL;
  try {
    url = new URL(env.VITE_MULTIPLAYER_URL);
  } catch {
    return DISABLED;
  }
  const secure = url.protocol === 'wss:';
  if (!secure && !(env.DEV && url.protocol === 'ws:')) return DISABLED;

  const devRegionIds = env.DEV
    ? (env.VITE_MULTIPLAYER_DEV_REGIONS ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
    : [];

  return { enabled: true, serverUrl: url.toString().replace(/\/$/, ''), devRegionIds };
}

export const MULTIPLAYER_CONFIG: MultiplayerConfig = readMultiplayerConfig(import.meta.env);
