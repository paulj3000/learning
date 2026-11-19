import type { Camera, Scene } from 'three';
import { WebGLRenderer } from 'three';
import { defineService } from '@lai/game-engine/core';
import type { RendererInfoLike } from '@lai/game-engine/debug/index';

/**
 * The renderer surface the host needs. `WebGLRenderer` satisfies it; tests pass a fake, so
 * the host runs in jsdom without WebGL.
 */
export interface HostRenderer extends RendererInfoLike {
  readonly domElement: HTMLCanvasElement;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setPixelRatio(ratio: number): void;
  render(scene: Scene, camera: Camera): void;
  dispose(): void;
}

export type RendererFactory = () => HostRenderer;

export const createWebGLRenderer: RendererFactory = () => new WebGLRenderer({ antialias: true });

/**
 * What the host hands to the engine, as a service. The engine reads it by id ('host.view');
 * `camera` is mutable so a camera capability can replace the default one.
 */
export interface HostView {
  readonly renderer: HostRenderer;
  readonly scene: Scene;
  camera: Camera;
  readonly canvas: HTMLCanvasElement;
  size(): { width: number; height: number };
}

export const HostViewService = defineService<HostView>('host.view');

/** Player and device preferences the host knows and the engine must respect. */
export interface HostPreferences {
  reducedMotion: boolean;
}

export const HostPreferencesService = defineService<HostPreferences>('host.preferences');

/**
 * Host events emitted on the runtime bus, for engine capabilities to listen to.
 * `host.inputReset`: held keys, pointers and gamepad state must be cleared (focus lost).
 * `host.resized`: the canvas size changed. `host.preferencesChanged`: reduced motion toggled.
 */
export const HOST_EVENTS = Object.freeze({
  inputReset: 'host.inputReset',
  resized: 'host.resized',
  preferencesChanged: 'host.preferencesChanged',
} as const);

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
  'gameHost.error.noGraphics': 'This device cannot show the island right now. Please ask a grown-up for help.',
  'gameHost.retry': 'Try again',
  'gameHost.paused': 'The adventure is waiting for you.',
  'gameHost.fallback': 'An interactive island scene. Use the buttons on the page to explore.',
});

export type GameHostStatus = 'loading' | 'ready' | 'error';
