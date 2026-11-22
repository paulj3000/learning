/**
 * The camera system (GE-030): a presentation-phase system that reads the player entity's
 * canonical `PlayerTransformComponent`, updates the `CameraRig` with the frame alpha and hands
 * the frame to the host (to move the renderer camera and hide the avatar when the boom is
 * pressed against it). It runs after the avatar follow system (order 20).
 */

import { PLAYER_ENTITY_ID, PlayerTransformComponent } from '../contracts/player';
import type { EntityWorld } from '../core/entities';
import type { EngineSystem } from '../core/systems';
import type { CameraRig } from './cameraRig';
import type { PlayerCameraFrame } from './playerCamera';

export const CAMERA_SYSTEM_ID = 'camera.rig';

export interface CameraSystemOptions {
  world: EntityWorld;
  rig: CameraRig;
  onFrame(frame: PlayerCameraFrame): void;
  order?: number;
}

export function createCameraSystem(options: CameraSystemOptions): EngineSystem {
  return {
    id: CAMERA_SYSTEM_ID,
    phase: 'presentation',
    order: options.order ?? 20,
    update(context) {
      const entity = options.world.bySemanticId(PLAYER_ENTITY_ID);
      const transform =
        entity === undefined ? undefined : options.world.get(entity, PlayerTransformComponent);
      if (!transform) {
        return;
      }
      options.onFrame(options.rig.update(context.frameSeconds, transform, context.alpha));
    },
  };
}
