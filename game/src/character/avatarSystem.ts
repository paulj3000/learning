/**
 * The avatar follow system (GE-030): a presentation-phase system that reads the player entity's
 * canonical `PlayerTransformComponent` and nothing else, places the avatar root at the
 * interpolated position and yaw, and drives its animation from the achieved velocity. It owns
 * no position of its own and writes nothing back.
 */

import { PLAYER_ENTITY_ID, PlayerTransformComponent } from '../contracts/player';
import type { EntityWorld } from '../core/entities';
import type { EngineSystem } from '../core/systems';
import type { AvatarAnimationSpeeds, AvatarController } from './avatar';

export const AVATAR_SYSTEM_ID = 'character.avatarFollow';

export interface AvatarFollowSystemOptions {
  world: EntityWorld;
  avatar: AvatarController;
  /** The movement speeds that match the walk and run cycles. Read each frame (they can change). */
  speeds: () => AvatarAnimationSpeeds;
  /** Runs after movement and before the camera system. Default 10. */
  order?: number;
}

export function createAvatarFollowSystem(options: AvatarFollowSystemOptions): EngineSystem {
  return {
    id: AVATAR_SYSTEM_ID,
    phase: 'presentation',
    order: options.order ?? 10,
    update(context) {
      const entity = options.world.bySemanticId(PLAYER_ENTITY_ID);
      const transform = entity === undefined ? undefined : options.world.get(entity, PlayerTransformComponent);
      if (!transform) {
        return;
      }
      options.avatar.follow(transform, context.alpha, context.frameSeconds);
      options.avatar.animate(context.frameSeconds, transform, options.speeds());
    },
    dispose() {
      options.avatar.dispose();
    },
  };
}
