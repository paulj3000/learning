import { WebGLRenderer } from 'three';
import type { HostRenderer } from '@lai/game-engine/engine';

/**
 * The host contract lives in the engine (`game/src/engine/host.ts`, GE-060) so engine
 * capabilities can read it without React. Re-exported here so React code keeps one path.
 */
export {
  HOST_EVENTS,
  HostPreferencesService,
  HostViewService,
  type HostEventMap,
  type HostPreferences,
  type HostRenderer,
  type HostView,
} from '@lai/game-engine/engine';

export type RendererFactory = () => HostRenderer;

export const createWebGLRenderer: RendererFactory = () => new WebGLRenderer({ antialias: true });

/** Child-facing message keys. Defaults are English; callers may supply a translated catalog. */
export type GameHostMessageKey =
  | 'gameHost.loading'
  | 'gameHost.error.generic'
  | 'gameHost.error.noGraphics'
  | 'gameHost.retry'
  | 'gameHost.paused'
  | 'gameHost.fallback';

export type GameHostMessages = Readonly<Record<GameHostMessageKey, string>>;

export const DEFAULT_GAME_HOST_MESSAGES: GameHostMessages = Object.freeze({
  'gameHost.loading': 'Getting the island ready...',
  'gameHost.error.generic': 'Oops, the island needs a moment. Let us try again.',
  'gameHost.error.noGraphics':
    'This device cannot show the island right now. Please ask a grown-up for help.',
  'gameHost.retry': 'Try again',
  'gameHost.paused': 'The adventure is waiting for you.',
  'gameHost.fallback': 'An interactive island scene. Use the buttons on the page to explore.',
});

export type GameHostStatus = 'loading' | 'ready' | 'error';
