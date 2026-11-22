/**
 * Thin Three.js applier for the lighting state (optional presentation). Creates one ambient and
 * one directional light, updates them from `LightingApi.values()` and removes them on dispose
 * through the caller's `ResourceScope`.
 */

import { AmbientLight, Color, DirectionalLight, MathUtils, type Scene } from 'three';
import type { ResourceScope } from '../../core/resources';
import type { LightingApi } from '../atmosphere';

export interface LightingView {
  readonly ambient: AmbientLight;
  readonly sun: DirectionalLight;
  /** Applies the current values (and the sky as the scene background). */
  update(): void;
}

export function createLightingView(
  scene: Scene,
  scope: ResourceScope,
  lighting: LightingApi,
): LightingView {
  const ambient = new AmbientLight();
  const sun = new DirectionalLight();
  sun.name = 'engine.sun';
  ambient.name = 'engine.ambient';
  scene.add(ambient, sun);
  const previousBackground = scene.background;
  scope.track(() => {
    scene.remove(ambient, sun);
    sun.dispose();
    scene.background = previousBackground;
  });
  const view: LightingView = {
    ambient,
    sun,
    update() {
      const v = lighting.values();
      ambient.color.setHex(v.ambientColor);
      ambient.intensity = v.ambientIntensity;
      sun.color.setHex(v.sunColor);
      sun.intensity = v.sunIntensity;
      const elevation = MathUtils.degToRad(v.sunElevation);
      const azimuth = MathUtils.degToRad(v.sunAzimuth);
      sun.position
        .set(
          Math.sin(azimuth) * Math.cos(elevation),
          Math.sin(elevation),
          -Math.cos(azimuth) * Math.cos(elevation),
        )
        .multiplyScalar(50);
      scene.background = new Color(v.skyColor);
    },
  };
  view.update();
  return view;
}
