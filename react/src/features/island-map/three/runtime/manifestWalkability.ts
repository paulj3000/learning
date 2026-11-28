/**
 * LAI-2104S step B1: a location manifest as the engine's walk-grid input, for realm tests and
 * for the live guided mode (`guidedWalk.ts`). Pure; no React, no Three.js objects.
 *
 * Realm tests use it with the engine's reachability helper:
 *
 * ```ts
 * import { isReachable, unreachableTargets } from '@lai/game-engine/navigation';
 * const input = manifestWalkability(manifest);
 * const start = spawnPoint(manifest);
 * expect(unreachableTargets(input, start, ['wf-sign'])).toEqual([]);
 * ```
 *
 * Targets, by id: every NPC, prop and collectible by `entityId`; every interaction by its id
 * (its bound prop or NPC when one names it, else its walk-in zone, else its `targetId` entity).
 * An entity is reachable when the child can walk within `APPROACH_RANGE_METERS` of it.
 */

import type {
  WalkabilityInput,
  WalkCollider,
  WalkHazard,
  WalkPlatform,
  WalkTarget,
} from '@lai/game-engine/navigation';
import type { WorldInteractionContext } from '../../worldObjects';
import { resolveSpawnCheckpoint } from '../../../discovery/checkpoints';
import { applyTuning, type PlatformSpec } from '../platforms/platformSpec';
import { APPROACH_RANGE_METERS } from '../sceneKit';
import type { ThreeLocationManifest } from './locationManifest';
import { NO_WORLD_STATE, solidColliders } from './sceneLayout';
import type { CollisionProfiles } from './collisionProfile';

/** Whether a platform is a fixed, always-present surface a path may use (never moving or switched). */
export function isFixedPlatform(platform: PlatformSpec): boolean {
  if (platform.motion || platform.spin || platform.bounce || platform.vanish) return false;
  const trigger = platform.activation?.trigger;
  return (
    (trigger === undefined || trigger === 'ALWAYS') &&
    platform.activation?.hiddenUntilActive !== true
  );
}

export function walkPlatformsOf(platforming: ThreeLocationManifest['platforming']): WalkPlatform[] {
  if (!platforming) return [];
  return applyTuning(platforming).map((platform) => ({
    id: platform.id,
    min: {
      x: platform.position.x - platform.size.width / 2,
      y: platform.position.y,
      z: platform.position.z - platform.size.depth / 2,
    },
    max: {
      x: platform.position.x + platform.size.width / 2,
      y: platform.position.y + platform.size.height,
      z: platform.position.z + platform.size.depth / 2,
    },
    fixed: isFixedPlatform(platform),
  }));
}

export function walkHazardsOf(platforming: ThreeLocationManifest['platforming']): WalkHazard[] {
  return (platforming?.hazards ?? []).map((hazard) => ({
    id: hazard.id,
    minX: hazard.rect.minX,
    maxX: hazard.rect.maxX,
    minZ: hazard.rect.minZ,
    maxZ: hazard.rect.maxZ,
    ...(hazard.belowY !== undefined ? { belowY: hazard.belowY } : {}),
  }));
}

/** Entities and interactions as walk targets (see the file comment). */
export function walkTargetsOf(manifest: ThreeLocationManifest): WalkTarget[] {
  const targets: WalkTarget[] = [];
  const positions = new Map<string, { x: number; z: number }>();
  const add = (id: string, position: { x: number; z: number }) => {
    positions.set(id, position);
    targets.push({ id, x: position.x, z: position.z, approachRange: APPROACH_RANGE_METERS });
  };
  for (const npc of manifest.npcs) add(npc.entityId, npc.position);
  for (const prop of manifest.props) add(prop.entityId, prop.position);
  for (const item of manifest.collectibles) add(item.entityId, item.position);

  const boundTo = new Map<string, string>();
  for (const npc of manifest.npcs)
    if (npc.interactionId) boundTo.set(npc.interactionId, npc.entityId);
  for (const prop of manifest.props)
    if (prop.interactionId) boundTo.set(prop.interactionId, prop.entityId);
  for (const interaction of manifest.interactions) {
    if (positions.has(interaction.id)) continue;
    const entity = boundTo.get(interaction.id);
    if (entity !== undefined) {
      const at = positions.get(entity);
      if (at) {
        targets.push({
          id: interaction.id,
          x: at.x,
          z: at.z,
          approachRange: APPROACH_RANGE_METERS,
        });
        continue;
      }
    }
    const zone = manifest.zones.find(
      (candidate) => candidate.rect.id === (interaction.zoneId ?? interaction.id),
    );
    if (zone) {
      targets.push({ id: interaction.id, rect: zone.rect });
      continue;
    }
    const at = positions.get(interaction.targetId);
    if (at) {
      targets.push({ id: interaction.id, x: at.x, z: at.z, approachRange: APPROACH_RANGE_METERS });
    }
  }
  return targets;
}

/** The manifest's static geometry as walk-grid input (what the child starts a visit with). */
export function manifestWalkability(
  manifest: ThreeLocationManifest,
  worldState: WorldInteractionContext = NO_WORLD_STATE,
  profiles?: CollisionProfiles,
): WalkabilityInput {
  const colliders: WalkCollider[] = solidColliders(manifest, worldState, profiles).map((solid) => ({
    ...(solid.id !== undefined ? { id: solid.id } : {}),
    min: { x: solid.box.minX, y: solid.box.minY, z: solid.box.minZ },
    max: { x: solid.box.maxX, y: solid.box.maxY, z: solid.box.maxZ },
    kind: solid.jumpable === true ? 'JUMPABLE' : 'SOLID',
  }));
  const reach = manifest.bounds.wallThickness + 1;
  return {
    colliders,
    platforms: walkPlatformsOf(manifest.platforming),
    hazards: walkHazardsOf(manifest.platforming),
    bounds: {
      minX: -(manifest.bounds.halfExtentX + reach),
      maxX: manifest.bounds.halfExtentX + reach,
      minZ: -(manifest.bounds.halfExtentZ + reach),
      maxZ: manifest.bounds.halfExtentZ + reach,
    },
    targets: walkTargetsOf(manifest),
  };
}

/** Where the child spawns (the start checkpoint, or the region's first one). */
export function manifestSpawnPoint(
  manifest: ThreeLocationManifest,
  startCheckpointId?: string,
): { x: number; z: number } {
  const spawn = resolveSpawnCheckpoint(manifest.regionId, startCheckpointId);
  return { x: spawn.x, z: spawn.z };
}
