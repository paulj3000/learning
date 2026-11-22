/**
 * Character capabilities (GE-030): `character.avatar` and `character.animation`. Avatar limits
 * are `AVATAR_LIMITS` from the presentation module (the island map's own ranges). `validate`
 * never throws, reports unknown keys as issues and clamps nothing.
 */

import {
  DEFAULT_ANIMATION_DEFINITION,
  type AnimationMachineDefinition,
} from '../animation/animationStateMachine';
import { AVATAR_LIMITS, DEFAULT_PLAYER_AVATAR } from '../camera/playerPresentation';
import { num, validateConfig } from '../camera/validation';
import type { CapabilityDefinition, CapabilityRegistry } from '../core/capabilities';

export const CHARACTER_AVATAR = 'character.avatar';
export const CHARACTER_ANIMATION = 'character.animation';

export interface AvatarCapabilityConfig {
  enabled: boolean;
  /** An asset id every child is drawn with here (a costume a location needs). Absent: the child's own. */
  assetKey?: string;
  scale: number;
  rotationOffset: number;
  /** `transform` faces the canonical yaw; `velocity` turns toward the achieved velocity. */
  facing: 'transform' | 'velocity';
}

export interface AnimationCapabilityConfig {
  /** Crossfade seconds used where a transition names none. */
  defaultFade: number;
}

export const ANIMATION_LIMITS = Object.freeze({ defaultFade: { min: 0, max: 1 } });

export const characterAvatarCapability: CapabilityDefinition<AvatarCapabilityConfig> = {
  id: CHARACTER_AVATAR,
  version: '1.0.0',
  description:
    'The child avatar, placed exactly at the canonical player transform. Never carries root motion.',
  defaults: Object.freeze({
    enabled: DEFAULT_PLAYER_AVATAR.enabled,
    scale: DEFAULT_PLAYER_AVATAR.scale,
    rotationOffset: DEFAULT_PLAYER_AVATAR.rotationOffset,
    facing: 'transform' as const,
  }),
  validate: (input) =>
    validateConfig<AvatarCapabilityConfig>(input, characterAvatarCapability.defaults, {
      enabled: { kind: 'boolean' },
      assetKey: { kind: 'string' },
      scale: num(AVATAR_LIMITS.scale),
      rotationOffset: num(AVATAR_LIMITS.rotationOffset),
      facing: { kind: 'enum', values: ['transform', 'velocity'] },
    }),
};

export const characterAnimationCapability: CapabilityDefinition<AnimationCapabilityConfig> = {
  id: CHARACTER_ANIMATION,
  version: '1.0.0',
  description:
    'Data-driven avatar animation: movement states to clips through the avatar animationMap, with crossfades and fallbacks.',
  requires: [CHARACTER_AVATAR],
  defaults: Object.freeze({ defaultFade: DEFAULT_ANIMATION_DEFINITION.defaultFade }),
  validate: (input) =>
    validateConfig<AnimationCapabilityConfig>(input, characterAnimationCapability.defaults, {
      defaultFade: num(ANIMATION_LIMITS.defaultFade),
    }),
};

export function registerCharacterCapabilities(registry: CapabilityRegistry): void {
  registry.register(characterAvatarCapability);
  registry.register(characterAnimationCapability);
}

/** The state machine definition for a resolved animation config. */
export function animationDefinitionFromConfig(
  config: AnimationCapabilityConfig,
): AnimationMachineDefinition {
  return { ...DEFAULT_ANIMATION_DEFINITION, defaultFade: config.defaultFade };
}
