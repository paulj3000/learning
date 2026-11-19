/**
 * The host contract (GE-060): what a host (the React `GameHost`, a test, the Playground) hands
 * to the engine, and the events it raises on the runtime bus. Three.js types are allowed here;
 * React is not. `react/src/features/game-engine/hostTypes.ts` re-exports these so React code
 * keeps one import path.
 */

import type { Camera, Scene } from 'three';
import { defineService } from '../core/services';
import type { RendererInfoLike } from './rendererStats';

/** The renderer surface the host needs. `WebGLRenderer` satisfies it; tests pass a fake. */
export interface HostRenderer extends RendererInfoLike {
  readonly domElement: HTMLCanvasElement;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setPixelRatio(ratio: number): void;
  render(scene: Scene, camera: Camera): void;
  dispose(): void;
}

/**
 * What the host hands to the engine, as a service. `camera` is mutable so a camera capability
 * can replace the default one.
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
 * Host events on the runtime bus. `host.inputReset`: held keys, pointers and gamepad state
 * must be cleared (focus lost, tab hidden, panel opened). `host.resized`: the canvas size
 * changed. `host.preferencesChanged`: reduced motion toggled.
 */
export const HOST_EVENTS = Object.freeze({
  inputReset: 'host.inputReset',
  resized: 'host.resized',
  preferencesChanged: 'host.preferencesChanged',
} as const);

export type HostEventMap = {
  'host.inputReset': Record<string, never>;
  'host.resized': { width: number; height: number };
  'host.preferencesChanged': HostPreferences;
};
