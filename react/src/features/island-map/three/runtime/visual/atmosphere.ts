import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Mesh,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  type Scene,
  type Vector3,
} from 'three';
import type {
  AtmosphereSpec,
  FogSpec,
  PrecipitationSpec,
  SkyRibbonSpec,
} from '../locationManifest';
import { RENDER_QUALITY_PRESETS, type RenderQuality } from './renderQuality';
import { seededRandom } from './surfacePatterns';

/**
 * Area atmosphere (`docs/engine/AREA_ATMOSPHERE.md`): linear fog, falling precipitation that
 * follows the camera, and a few far-off waving sky ribbons. All decorative and data-driven. A tier
 * changes how much is drawn, reduced motion stills it, neither changes anything a child can do.
 */

export const MAX_SKY_RIBBONS = 4;
export const MAX_FOG_FAR = 1000;
/** The box of falling particles around the camera, in metres. */
export const PRECIPITATION_BOX = { width: 40, height: 24, depth: 40 } as const;
const FALL_SPEED = 1.6;
const REDUCED_FALL_SPEED = 0.7;
const SWAY_METRES = 0.4;
/** Ribbons sit far away, so a region with any needs a deeper camera. */
export const RIBBON_CAMERA_FAR = 400;

const PRECIPITATION_KINDS = ['SNOW'] as const;

function isColor(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffff;
}
function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A fog is drawn only when 0 < near < far <= 1000 and the colour is a 24-bit integer. */
export function readFog(value: unknown): FogSpec | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { color, near, far } = value as Record<string, unknown>;
  if (!isColor(color) || !finite(near) || !finite(far)) return undefined;
  if (!(near > 0 && near < far && far <= MAX_FOG_FAR)) return undefined;
  return { color, near, far };
}

/** Unknown kinds are ignored; density is clamped to 0..1. */
export function readPrecipitation(value: unknown): PrecipitationSpec | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { kind, density } = value as Record<string, unknown>;
  if (!PRECIPITATION_KINDS.some((known) => known === kind) || !finite(density)) return undefined;
  return { kind: 'SNOW', density: Math.min(1, Math.max(0, density)) };
}

export function readSkyRibbons(value: unknown): SkyRibbonSpec[] {
  if (!Array.isArray(value)) return [];
  const out: SkyRibbonSpec[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const { id, colors, x, y, z, width, height } = raw as Record<string, unknown>;
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    if (!Array.isArray(colors) || colors.length !== 2 || !colors.every(isColor)) continue;
    if (![x, y, z, width, height].every(finite)) continue;
    if ((width as number) <= 0 || (height as number) <= 0) continue;
    seen.add(id);
    out.push({
      id,
      colors: [colors[0], colors[1]],
      x: x as number,
      y: y as number,
      z: z as number,
      width: width as number,
      height: height as number,
    });
    if (out.length === MAX_SKY_RIBBONS) break;
  }
  return out;
}

/** The lenient parser the Django-backed manifest uses: a bad entry is dropped, never the region. */
export function readAtmosphere(value: unknown): AtmosphereSpec | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const source = value as Record<string, unknown>;
  const fog = readFog(source.fog);
  const precipitation = readPrecipitation(source.precipitation);
  const skyRibbons = readSkyRibbons(source.skyRibbons);
  if (!fog && !precipitation && skyRibbons.length === 0) return undefined;
  return {
    ...(fog ? { fog } : {}),
    ...(precipitation ? { precipitation } : {}),
    ...(skyRibbons.length > 0 ? { skyRibbons } : {}),
  };
}

/** Linear fog on the scene. The authored background is left alone; authors match the two. */
export function applyFog(scene: Scene, fog: FogSpec | undefined): void {
  if (!fog) return;
  scene.fog = new Fog(fog.color, fog.near, fog.far);
}

/** Particles drawn: density times the tier's budget; half of that under reduced motion. */
export function precipitationCountFor(
  spec: Pick<PrecipitationSpec, 'density'>,
  quality: RenderQuality,
  reducedMotion: boolean,
): number {
  const budget = RENDER_QUALITY_PRESETS[quality].maxPrecipitation;
  const density = Math.min(1, Math.max(0, spec.density));
  const count = Math.floor(density * budget);
  return reducedMotion ? Math.floor(count / 2) : count;
}

export interface Precipitation {
  points: Points;
  count: number;
  /** Falls and wraps the particles, and recentres the box on `center` (the camera). */
  update(deltaSeconds: number, center: Vector3): void;
  dispose(): void;
}

/** One `Points` draw call. Null when the tier or density leaves nothing to draw. */
export function createPrecipitation(
  spec: PrecipitationSpec,
  quality: RenderQuality,
  reducedMotion: boolean,
  seed = 7,
): Precipitation | null {
  const count = precipitationCountFor(spec, quality, reducedMotion);
  if (count === 0) return null;
  const random = seededRandom(seed);
  const { width, height, depth } = PRECIPITATION_BOX;
  const baseX = new Float32Array(count);
  const phase = new Float32Array(count);
  const speedScale = new Float32Array(count);
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    baseX[index] = (random() - 0.5) * width;
    positions[index * 3] = baseX[index];
    positions[index * 3 + 1] = (random() - 0.5) * height;
    positions[index * 3 + 2] = (random() - 0.5) * depth;
    phase[index] = random() * Math.PI * 2;
    speedScale[index] = 0.7 + random() * 0.6;
  }
  const geometry = new BufferGeometry();
  const attribute = new Float32BufferAttribute(positions, 3);
  geometry.setAttribute('position', attribute);
  const material = new PointsMaterial({
    color: 0xffffff,
    size: 0.14,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const points = new Points(geometry, material);
  points.name = 'atmosphere:precipitation';
  // The box moves with the camera, so the bounding sphere computed at build time is meaningless.
  points.frustumCulled = false;
  const fall = reducedMotion ? REDUCED_FALL_SPEED : FALL_SPEED;
  let clock = 0;
  return {
    points,
    count,
    update(deltaSeconds, center) {
      clock += deltaSeconds;
      points.position.set(center.x, center.y, center.z);
      const half = height / 2;
      for (let index = 0; index < count; index += 1) {
        let y = attribute.getY(index) - fall * speedScale[index] * deltaSeconds;
        if (y < -half) y += height;
        const sway = reducedMotion ? 0 : Math.sin(clock * 0.7 + phase[index]) * SWAY_METRES;
        attribute.setXYZ(index, baseX[index] + sway, y, attribute.getZ(index));
      }
      attribute.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

const RIBBON_VERTEX = `
uniform float uTime;
uniform float uWave;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  p.z += sin(p.x * 0.05 + uTime * 0.3) * uWave;
  p.y += sin(p.x * 0.03 - uTime * 0.2) * uWave * 0.5;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const RIBBON_FRAGMENT = `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uTime;
varying vec2 vUv;
void main() {
  float edge = sin(vUv.x * 3.14159265);
  float vertical = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
  float shimmer = 0.85 + 0.15 * sin(vUv.x * 24.0 + uTime * 0.6);
  vec3 color = mix(uColorA, uColorB, vUv.y);
  gl_FragColor = vec4(color * shimmer, edge * vertical * 0.6);
}`;

export interface SkyRibbon {
  mesh: Mesh;
  /** Moves the wave to `seconds`. Never called under reduced motion, so the ribbon holds still. */
  setTime(seconds: number): void;
  dispose(): void;
}

/** A translucent additive band in the sky. Null at LOW, which draws no ribbons. */
export function createSkyRibbon(spec: SkyRibbonSpec, quality: RenderQuality): SkyRibbon | null {
  if (quality === 'LOW') return null;
  const geometry = new PlaneGeometry(spec.width, spec.height, 24, 1);
  const material = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWave: { value: spec.height * 0.15 },
      uColorA: { value: new Color(spec.colors[0]) },
      uColorB: { value: new Color(spec.colors[1]) },
    },
    vertexShader: RIBBON_VERTEX,
    fragmentShader: RIBBON_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = `atmosphere:ribbon:${spec.id}`;
  mesh.position.set(spec.x, spec.y, spec.z);
  mesh.frustumCulled = false;
  return {
    mesh,
    setTime(seconds) {
      material.uniforms.uTime.value = seconds;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
