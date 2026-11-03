import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  PointsMaterial,
} from 'three';
import type { EffectSpec } from '../locationManifest';
import { RENDER_QUALITY_PRESETS, type RenderQuality } from './renderQuality';
import { seededRandom } from './surfacePatterns';

/**
 * Drifting motes: dust in lamplight, sparks of magic over a book. One
 * `Points` draw call per effect. Every mote circles its own home position
 * slowly, so the cloud never wanders off or bunches up, and a frame at time
 * `t` is a pure function of `t` (replayable, testable).
 */

const DEFAULT_SIZE = 0.05;
const DEFAULT_DRIFT = 0.08;
/** How far a mote strays from home, in metres. */
const DRIFT_RADIUS = 0.18;

/** The motes this effect gets at this tier: its own count, capped by the tier. */
export function moteCountFor(effect: Pick<EffectSpec, 'count'>, quality: RenderQuality): number {
  const count = Math.max(0, Math.floor(effect.count));
  return Math.min(count, RENDER_QUALITY_PRESETS[quality].maxMotesPerEffect);
}

export interface MoteField {
  points: Points;
  /** Moves every mote to where it is at `seconds`. A no-op is the reduced-motion choice, not this. */
  setTime(seconds: number): void;
  dispose(): void;
}

/** Home positions and phases, seeded: the same effect always scatters the same way. */
export function moteHomes(
  effect: EffectSpec,
  count: number,
): { homes: Float32Array; phases: Float32Array } {
  const random = seededRandom(effect.seed ?? 1);
  const homes = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const { minX, maxX, minZ, maxZ } = effect.area;
  for (let index = 0; index < count; index += 1) {
    homes[index * 3] = minX + random() * (maxX - minX);
    homes[index * 3 + 1] = effect.minY + random() * (effect.maxY - effect.minY);
    homes[index * 3 + 2] = minZ + random() * (maxZ - minZ);
    phases[index] = random() * Math.PI * 2;
  }
  return { homes, phases };
}

/** Returns null when the tier allows no motes, so nothing is created at all. */
export function createMoteField(effect: EffectSpec, quality: RenderQuality): MoteField | null {
  const count = moteCountFor(effect, quality);
  if (count === 0) return null;
  const { homes, phases } = moteHomes(effect, count);
  const positions = new Float32Array(homes);
  const geometry = new BufferGeometry();
  const attribute = new Float32BufferAttribute(positions, 3);
  geometry.setAttribute('position', attribute);
  const material = new PointsMaterial({
    color: effect.color,
    size: effect.size ?? DEFAULT_SIZE,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const points = new Points(geometry, material);
  points.name = `effect:${effect.id}`;
  const angularSpeed = (effect.driftSpeed ?? DEFAULT_DRIFT) / DRIFT_RADIUS;
  return {
    points,
    setTime(seconds) {
      for (let index = 0; index < count; index += 1) {
        const angle = phases[index] + seconds * angularSpeed;
        attribute.setXYZ(
          index,
          homes[index * 3] + Math.cos(angle) * DRIFT_RADIUS,
          homes[index * 3 + 1] + Math.sin(angle * 0.7) * DRIFT_RADIUS * 0.5,
          homes[index * 3 + 2] + Math.sin(angle) * DRIFT_RADIUS,
        );
      }
      attribute.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
