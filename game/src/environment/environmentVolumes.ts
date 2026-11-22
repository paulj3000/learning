/**
 * `environment.volumes` capability: composes the authored surface, force, water and ladder
 * volumes into the runtime's `EnvironmentQuery` (provided as `EnvironmentQueryService` for
 * movement) and plays per-surface footstep cues.
 *
 * Footsteps: movement already emits `PlayerFootstep`. This capability listens to it, looks up
 * the surface under the child and emits `SurfaceFootstep { surfaceId, footstepCue }`
 * (our own presentation event, no contract change) so the host can play `snowStep`,
 * `iceStep` and so on. Nothing here changes how the child moves; movement consumes the query.
 */

import { EnvironmentQueryService } from '../contracts/physics';
import type { CapabilityDefinition } from '../core/capabilities';
import {
  emitPresentation,
  isReducedMotion,
  playerPosition,
  signalBoard,
  type GameplayRuntime,
} from '../components/common';
import { HazardRegionsService } from '../components/hazards';
import { createEnvironmentQuery } from './environmentQuery';
import { validateEnvironmentVolumesConfig, type EnvironmentVolumesConfig } from './volumes';

export const ENVIRONMENT_VOLUMES_CAPABILITY_ID = 'environment.volumes';

export const environmentVolumesCapability: CapabilityDefinition<
  EnvironmentVolumesConfig,
  GameplayRuntime
> = {
  id: ENVIRONMENT_VOLUMES_CAPABILITY_ID,
  version: '1.0.0',
  description:
    'Surface, wind/current/conveyor/updraft, water and ladder volumes composed into one EnvironmentQuery.',
  defaults: { surfaces: [], forces: [], waters: [], ladders: [], hazardRects: [] },
  validate: validateEnvironmentVolumesConfig,
  install(runtime, config) {
    const signals = signalBoard(runtime);
    const query = createEnvironmentQuery(config, {
      isSignalOn: (id) => signals.get(id),
      isReducedMotion: () => isReducedMotion(runtime),
      hazardRects: () =>
        runtime.services
          .get(HazardRegionsService)
          ?.regions()
          .map((r) => r.rect) ?? [],
    });
    const removeService = runtime.services.provide(EnvironmentQueryService, query);
    runtime.systems.add({
      id: 'environment.volumes',
      phase: 'simulation',
      order: -20,
      update(context) {
        query.tick(context.dt, playerPosition(runtime));
      },
    });
    const offFootstep = runtime.events.on(
      'PlayerFootstep' as never,
      (() => {
        const position = playerPosition(runtime);
        if (!position) {
          return;
        }
        const surface = query.surfaceAt(position.x, position.y, position.z);
        emitPresentation(runtime, 'SurfaceFootstep', {
          surfaceId: surface.id,
          footstepCue: surface.footstepCue ?? null,
        });
      }) as never,
    );
    return () => {
      offFootstep();
      runtime.systems.remove('environment.volumes');
      removeService();
    };
  },
};
