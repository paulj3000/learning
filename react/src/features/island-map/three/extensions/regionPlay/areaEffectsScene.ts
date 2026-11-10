import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  Group,
  Mesh,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  type Object3D,
} from 'three';
import { prefersReducedMotion } from '../../../../../lib/motionPreference';
import { cloneAssetScene } from '../../assets/cloneAsset';
import type {
  CheckpointConfig,
  LavaConfig,
  Rect,
  RegionPlayEffects,
} from '../../../../region-play/regionPlayConfig';
import type { WorldExtensionContext } from '../../runtime/extensionRegistry';
import { ownedMesh, type Owned } from './areaStandIns';

/**
 * A 3D Area's environment effects (Firepeak FP-3, FP-6, FP-10): animated lava that returns the
 * child to safety, steam plumes, a distant volcano, safe checkpoints, passages that open, and the
 * safe way back. All seed-authored data (`scene.effects`), drawn here; nothing is recorded.
 *
 * State comes only from the server: the world change keys in the config at build time, then
 * `setChangeKeys` after the play API reports a new one. Interacting never opens a passage.
 *
 * Performance: one shader plane per lava band (no fluid simulation), at most 48 particles per
 * steam plume, one cone for the backdrop. With reduced motion the lava stops flowing and steam is
 * a still, soft column.
 */

export interface AreaEffectsEvents {
  /** The child stepped into lava and was returned to a safe checkpoint (no progress lost). */
  respawned(checkpoint: CheckpointConfig): void;
}

export interface AreaEffectsApi {
  setChangeKeys(keys: readonly string[]): void;
  /** Sends the child back along an open return (the rope lift). False if it is not open yet. */
  useReturn(entityId: string): boolean;
  /**
   * Shows the steam as it will be once cleared (plumes a change would hide are hidden, plumes it
   * would show are shown), for the valve puzzle's live feedback; `false` returns to the keys.
   */
  previewSteamCleared(cleared: boolean): void;
  /** The checkpoint the child would return to now. */
  safeCheckpoint(): CheckpointConfig | null;
  subscribe(listener: Partial<AreaEffectsEvents>): () => void;
}

const STEAM_PARTICLES = 48;
const CHECKPOINT_REACH = 3;
const RESPAWN_COOLDOWN_MS = 1200;

const LAVA_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Two travelling sine bands and a crust pattern: cheap, and it reads as flowing lava.
const LAVA_FRAGMENT = `
uniform float uTime;
uniform vec2 uScale;
varying vec2 vUv;
void main() {
  vec2 p = vUv * uScale;
  float flow = sin(p.x * 0.9 + uTime * 0.6) * 0.5 + sin(p.y * 1.7 - uTime * 0.9) * 0.5;
  float crust = smoothstep(0.55, 0.95, sin(p.x * 2.3 + sin(p.y * 1.9 + uTime * 0.3) * 2.0));
  vec3 hot = vec3(1.0, 0.55, 0.08);
  vec3 warm = vec3(0.95, 0.22, 0.04);
  vec3 dark = vec3(0.25, 0.06, 0.03);
  vec3 color = mix(warm, hot, flow * 0.5 + 0.5);
  color = mix(color, dark, crust * 0.6);
  gl_FragColor = vec4(color, 1.0);
}`;

export function inRect(rect: Rect, x: number, z: number): boolean {
  return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

/** Whether standing at (x, z) is in lava that is not made safe by a key the child has. */
export function isInDangerousLava(
  lava: readonly LavaConfig[],
  keys: ReadonlySet<string>,
  x: number,
  z: number,
): boolean {
  return lava.some(
    (band) =>
      inRect(band, x, z) &&
      !band.safe.some((part) => keys.has(part.whenChangeKey) && inRect(part, x, z)),
  );
}

/** The checkpoints that are open: those with no key, or whose key the child has. */
export function openCheckpoints(
  checkpoints: readonly CheckpointConfig[],
  keys: ReadonlySet<string>,
): CheckpointConfig[] {
  return checkpoints.filter((c) => c.whenChangeKey === null || keys.has(c.whenChangeKey));
}

/**
 * Where a returning child resumes: the last checkpoint their progress has opened (one with a
 * change key they have), or `null` to stay at the spawn. A checkpoint that is always open is a
 * place to be returned to from the lava, not progress, so it never moves a new explorer.
 */
export function resumeCheckpoint(
  checkpoints: readonly CheckpointConfig[],
  keys: ReadonlySet<string>,
): CheckpointConfig | null {
  const earned = checkpoints.filter((c) => c.whenChangeKey !== null && keys.has(c.whenChangeKey));
  return earned.length > 0 ? earned[earned.length - 1] : null;
}

export function mountAreaEffects(
  context: WorldExtensionContext,
  effects: RegionPlayEffects,
  initialKeys: readonly string[],
  owned: Owned,
  isDisposed: () => boolean,
): { api: AreaEffectsApi; dispose(): void } {
  const reducedMotion = prefersReducedMotion();
  let keys = new Set(initialKeys);
  const listeners = new Set<Partial<AreaEffectsEvents>>();
  const group = new Group();
  group.name = 'region-play:effects';
  context.scene.add(group);

  // Lava: one animated plane per band, slightly above the ground.
  const lavaMaterials: ShaderMaterial[] = [];
  for (const band of effects.lava) {
    const width = band.maxX - band.minX;
    const depth = band.maxZ - band.minZ;
    const geometry = new PlaneGeometry(width, depth);
    const material = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: [width / 2, depth / 2] } },
      vertexShader: LAVA_VERTEX,
      fragmentShader: LAVA_FRAGMENT,
    });
    owned.geometries.push(geometry);
    owned.materials.push(material);
    lavaMaterials.push(material);
    const plane = new Mesh(geometry, material);
    plane.name = `lava:${band.id}`;
    plane.rotation.x = -Math.PI / 2;
    plane.position.set((band.minX + band.maxX) / 2, 0.03, (band.minZ + band.maxZ) / 2);
    group.add(plane);
  }

  // Steam plumes: a few rising particles, or a still column with reduced motion.
  const plumes = new Map<string, { object: Object3D; spec: RegionPlayEffects['steam'][number] }>();
  const overrides = new Map<string, boolean>();
  const moving: { points: Points; speeds: Float32Array; height: number }[] = [];
  for (const spec of effects.steam) {
    let object: Object3D;
    if (reducedMotion) {
      object = ownedMesh(owned, new ConeGeometry(0.8, spec.height, 12, 1, true), 0xf2f2f2, {
        opacity: 0.35,
      });
      object.position.set(spec.x, spec.height / 2, spec.z);
    } else {
      const positions = new Float32Array(STEAM_PARTICLES * 3);
      const speeds = new Float32Array(STEAM_PARTICLES);
      for (let index = 0; index < STEAM_PARTICLES; index += 1) {
        positions[index * 3] = (Math.random() - 0.5) * 0.8;
        positions[index * 3 + 1] = Math.random() * spec.height;
        positions[index * 3 + 2] = (Math.random() - 0.5) * 0.8;
        speeds[index] = 0.6 + Math.random() * 0.8;
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      const material = new PointsMaterial({
        color: new Color(0xf5f5f5),
        size: 0.45,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      owned.geometries.push(geometry);
      owned.materials.push(material);
      const points = new Points(geometry, material);
      points.position.set(spec.x, 0, spec.z);
      moving.push({ points, speeds, height: spec.height });
      object = points;
    }
    object.name = `steam:${spec.id}`;
    group.add(object);
    plumes.set(spec.id, { object, spec });
  }

  // The distant volcano: a cone stand-in, replaced by its model when one is published.
  if (effects.backdrop) {
    const { x, z, radius, height, assetId } = effects.backdrop;
    const holder = new Group();
    holder.name = 'backdrop';
    holder.position.set(x, 0, z);
    const cone = ownedMesh(owned, new ConeGeometry(radius, height, 24, 1, true), 0x4a3a3a);
    cone.position.y = height / 2;
    const crater = ownedMesh(owned, new ConeGeometry(radius * 0.18, height * 0.08, 16), 0xff6a1a, {
      emissive: 0xff4a0a,
      emissiveIntensity: 1,
    });
    crater.position.y = height;
    crater.rotation.x = Math.PI;
    holder.add(cone, crater);
    group.add(holder);
    if (assetId) {
      context
        .loadModel(assetId)
        .then((asset) => {
          if (isDisposed()) return;
          holder.clear();
          holder.add(cloneAssetScene(asset.scene));
        })
        .catch((error: unknown) =>
          console.warn(`[region-play] backdrop: could not load "${assetId}"`, error),
        );
    }
  }

  const removed = new Set<string>();
  function applyKeys(): void {
    for (const opening of effects.openings) {
      if (keys.has(opening.whenChangeKey) && !removed.has(opening.colliderId)) {
        if (context.removeCollider(opening.colliderId)) removed.add(opening.colliderId);
      }
    }
    for (const [id, plume] of plumes) {
      const override = overrides.get(id);
      const hidden =
        plume.spec.hiddenWhenChangeKey !== null && keys.has(plume.spec.hiddenWhenChangeKey);
      const waiting =
        plume.spec.shownWhenChangeKey !== null && !keys.has(plume.spec.shownWhenChangeKey);
      plume.object.visible = override ?? !(hidden || waiting);
    }
  }
  applyKeys();

  // Resume: a returning child starts at the furthest section they have reached (FP scenario 10).
  const resumed = resumeCheckpoint(effects.checkpoints, keys);
  if (resumed) context.teleportPlayer(resumed.x, resumed.z, resumed.yaw);
  let safe: CheckpointConfig | null =
    resumed ?? openCheckpoints(effects.checkpoints, keys)[0] ?? null;

  let lastRespawnAt = -Infinity;
  let elapsed = 0;
  const stopFrames = context.onFrame((delta) => {
    if (!reducedMotion) {
      elapsed += delta;
      for (const material of lavaMaterials) material.uniforms.uTime.value = elapsed;
      for (const plume of moving) {
        if (!plume.points.visible) continue;
        const attribute = plume.points.geometry.getAttribute('position') as BufferAttribute;
        for (let index = 0; index < plume.speeds.length; index += 1) {
          let y = attribute.getY(index) + plume.speeds[index] * delta;
          if (y > plume.height) y = 0;
          attribute.setY(index, y);
        }
        attribute.needsUpdate = true;
      }
    }
    const { x, z } = context.playerPosition();
    for (const checkpoint of openCheckpoints(effects.checkpoints, keys)) {
      if (Math.hypot(checkpoint.x - x, checkpoint.z - z) <= CHECKPOINT_REACH) safe = checkpoint;
    }
    const now = context.now();
    if (
      safe &&
      now - lastRespawnAt > RESPAWN_COOLDOWN_MS &&
      isInDangerousLava(effects.lava, keys, x, z)
    ) {
      lastRespawnAt = now;
      context.teleportPlayer(safe.x, safe.z, safe.yaw);
      const landed = safe;
      for (const listener of listeners) listener.respawned?.(landed);
    }
  });

  const api: AreaEffectsApi = {
    setChangeKeys(next) {
      keys = new Set(next);
      applyKeys();
    },
    useReturn(entityId) {
      const route = effects.returns.find((entry) => entry.entityId === entityId);
      if (!route || !keys.has(route.whenChangeKey)) return false;
      const target = effects.checkpoints.find((c) => c.id === route.toCheckpoint);
      if (!target) return false;
      context.teleportPlayer(target.x, target.z, target.yaw);
      safe = target;
      return true;
    },
    previewSteamCleared(cleared) {
      overrides.clear();
      if (cleared) {
        for (const [id, plume] of plumes) {
          if (plume.spec.hiddenWhenChangeKey !== null) overrides.set(id, false);
          if (plume.spec.shownWhenChangeKey !== null) overrides.set(id, true);
        }
      }
      applyKeys();
    },
    safeCheckpoint: () => safe,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return {
    api,
    dispose() {
      stopFrames();
      listeners.clear();
      context.scene.remove(group);
    },
  };
}
