/**
 * Registers every gameplay-component capability, and validates cross-component layout rules
 * that a single capability cannot see (a hazard names a real checkpoint, a checkpoint is not on
 * a moving platform, wind never leads into a hazard).
 */

import type { CapabilityDefinition, CapabilityRegistry } from '../core/capabilities';
import type { ValidationIssue } from '../core/errors';
import { atmosphereCapabilities } from '../environment/atmosphere';
import { environmentVolumesCapability } from '../environment/environmentVolumes';
import { forceHazardIssues, type EnvironmentVolumesConfig } from '../environment/volumes';
import { checkpointsCapability, type CheckpointsConfig } from './checkpoints';
import { chestsCapability } from './chests';
import type { GameplayRuntime } from './common';
import { collectiblesCapability } from './collectibles';
import { doorsCapability } from './doors';
import { hazardsCapability, type HazardsConfig } from './hazards';
import { jumpChallengesCapability } from './jumpChallenges';
import { platformsCapability, type PlatformsConfig } from './platforms';
import { portalsCapability } from './portals';
import { puzzlesCapability } from './puzzles';
import { triggersCapability } from './triggers';

/** Every capability this package provides, in a stable order. */
export const GAMEPLAY_CAPABILITIES: readonly CapabilityDefinition<never, GameplayRuntime>[] = [
  checkpointsCapability,
  collectiblesCapability,
  chestsCapability,
  doorsCapability,
  portalsCapability,
  triggersCapability,
  platformsCapability,
  hazardsCapability,
  puzzlesCapability,
  jumpChallengesCapability,
  environmentVolumesCapability,
  ...atmosphereCapabilities,
] as unknown as readonly CapabilityDefinition<never, GameplayRuntime>[];

export const GAMEPLAY_CAPABILITY_IDS: readonly string[] = GAMEPLAY_CAPABILITIES.map((c) => c.id);

export function registerGameplayComponents(registry: CapabilityRegistry<GameplayRuntime>): void {
  for (const capability of GAMEPLAY_CAPABILITIES) {
    registry.register(capability as unknown as CapabilityDefinition<unknown, GameplayRuntime>);
  }
}

/** Validated configs of one area, for the cross-checks below. */
export interface GameplayLayout {
  checkpoints?: CheckpointsConfig;
  hazards?: HazardsConfig;
  platforms?: PlatformsConfig;
  volumes?: EnvironmentVolumesConfig;
}

export function validateGameplayLayout(layout: GameplayLayout): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const checkpoints = layout.checkpoints?.checkpoints ?? [];
  const checkpointIds = new Set(checkpoints.map((c) => c.id));

  const hazards = [...(layout.hazards?.hazards ?? []), ...(layout.hazards?.telegraphed ?? [])];
  for (const hazard of hazards) {
    if (!checkpointIds.has(hazard.checkpointId)) {
      issues.push({ path: `hazards.${hazard.id}.checkpointId`, message: `checkpoint "${hazard.checkpointId}" does not exist (every hazard has a checkpoint)` });
    }
  }

  // Checkpoints sit at ground level, never on a moving, spinning, falling or bouncing platform.
  for (const checkpoint of checkpoints) {
    for (const platform of layout.platforms?.platforms ?? []) {
      if (platform.route === 'REQUIRED' && !platform.moving && !platform.falling && platform.bounceHeight === undefined && !platform.spinDegreesPerSecond) {
        continue;
      }
      const points = [{ x: 0, z: 0 }, ...(platform.moving?.path ?? [])];
      const top = platform.position.y + platform.size.y;
      const unstable = platform.moving || platform.falling || platform.bounceHeight !== undefined || platform.spinDegreesPerSecond;
      if (!unstable) {
        continue;
      }
      const onIt = points.some(
        (p) =>
          Math.abs(checkpoint.position.x - (platform.position.x + p.x)) <= platform.size.x / 2 &&
          Math.abs(checkpoint.position.z - (platform.position.z + p.z)) <= platform.size.z / 2 &&
          Math.abs(checkpoint.position.y - top) <= 0.5,
      );
      if (onIt) {
        issues.push({ path: `checkpoints.${checkpoint.id}`, message: `stands on unstable platform "${platform.id}"; checkpoints must be at ground level` });
      }
    }
  }

  if (layout.volumes) {
    const rects = hazards.map((h) => h.rect);
    for (const problem of forceHazardIssues(layout.volumes.forces, rects)) {
      issues.push(problem);
    }
  }
  return issues;
}
