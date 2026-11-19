/**
 * Thin Three.js view of a particle pool (optional presentation, ADR-020: the pure state in
 * `../particles.ts` is the source of truth). Everything it creates is tracked in the caller's
 * `ResourceScope` and removed from the scene on dispose.
 */

import { BufferAttribute, BufferGeometry, Points, PointsMaterial, type Scene } from 'three';
import type { ResourceScope } from '../../core/resources';
import type { ParticlePool } from '../particles';

export interface ParticleViewOptions {
  name: string;
  color: number;
  size: number;
}

export interface ParticleView {
  readonly points: Points;
  /** Copies the pool into the geometry. Call once per rendered frame. */
  update(pool: ParticlePool): void;
  setAppearance(color: number, size: number): void;
}

export function createParticleView(scene: Scene, scope: ResourceScope, capacity: number, options: ParticleViewOptions): ParticleView {
  const geometry = scope.track(new BufferGeometry());
  const positions = new Float32Array(Math.max(1, capacity) * 3);
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setDrawRange(0, 0);
  const material = scope.track(new PointsMaterial({ color: options.color, size: options.size, transparent: true, opacity: 0.85, depthWrite: false }));
  const points = new Points(geometry, material);
  points.name = options.name;
  points.frustumCulled = false;
  scene.add(points);
  scope.track(() => {
    scene.remove(points);
  });
  return {
    points,
    update(pool) {
      const count = Math.min(pool.alive, capacity);
      positions.set(pool.positions.subarray(0, count * 3));
      (geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
      geometry.setDrawRange(0, count);
    },
    setAppearance(color, size) {
      material.color.setHex(color);
      material.size = size;
    },
  };
}
