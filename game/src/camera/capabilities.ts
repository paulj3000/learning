/**
 * Camera capabilities (GE-030): `camera.thirdPerson` (default on), `camera.firstPerson`
 * (compatibility), `camera.collision`. Limits are `CAMERA_LIMITS`, the same ranges the island
 * map's `validatePlayerPresentation` enforces, so a manifest and a Django Area validate alike.
 *
 * Each `validate` never throws, reports unknown keys as issues and clamps nothing. The
 * capabilities install no systems themselves: the host builds a `CameraRig` from the resolved
 * configs with `cameraRigOptionsFromCapabilities` (it owns the renderer camera, the storage
 * port and the physics service).
 */

import type { CapabilityDefinition, CapabilityRegistry } from '../core/capabilities';
import { DEFAULT_SAFETY_RADIUS, type CameraRigOptions } from './cameraRig';
import { CAMERA_LIMITS, CAMERA_MODES, DEFAULT_PLAYER_CAMERA, type PlayerCameraConfiguration } from './playerPresentation';
import { num, validateConfig, type Schema } from './validation';

export const CAMERA_THIRD_PERSON = 'camera.thirdPerson';
export const CAMERA_FIRST_PERSON = 'camera.firstPerson';
export const CAMERA_COLLISION = 'camera.collision';

/** Capabilities every adventure gets unless it opts out: third-person is the default view. */
export const DEFAULT_CAMERA_CAPABILITIES: readonly string[] = Object.freeze([CAMERA_THIRD_PERSON, CAMERA_COLLISION]);

export interface ThirdPersonCameraConfig {
  defaultMode: 'first-person' | 'third-person';
  allowModeSwitch: boolean;
  distance: number;
  minDistance: number;
  maxDistance: number;
  heightOffset: number;
  followDamping: number;
  rotationSensitivity: number;
  sprintFovBoost: number;
  /** Highest the camera may go, for a location with ceilings. Absent: outdoors. */
  maxHeight?: number;
}

export interface FirstPersonCameraConfig {
  /** Eye height above the feet, metres. */
  eyeHeight: number;
  rotationSensitivity: number;
}

export interface CameraCollisionConfig {
  enabled: boolean;
  /** Half-size of the keep-out box around the camera, metres. */
  safetyRadius: number;
}

export const EYE_HEIGHT_LIMITS = Object.freeze({ min: 0.8, max: 2.2 });
export const SAFETY_RADIUS_LIMITS = Object.freeze({ min: 0.02, max: 0.5 });

const THIRD_PERSON_SCHEMA: Schema = {
  defaultMode: { kind: 'enum', values: CAMERA_MODES },
  allowModeSwitch: { kind: 'boolean' },
  distance: num(CAMERA_LIMITS.distance),
  minDistance: num(CAMERA_LIMITS.minDistance),
  maxDistance: num(CAMERA_LIMITS.maxDistance),
  heightOffset: num(CAMERA_LIMITS.heightOffset),
  followDamping: num(CAMERA_LIMITS.followDamping),
  rotationSensitivity: num(CAMERA_LIMITS.rotationSensitivity),
  sprintFovBoost: num(CAMERA_LIMITS.sprintFovBoost),
  maxHeight: num(CAMERA_LIMITS.maxHeight),
};

export const cameraThirdPersonCapability: CapabilityDefinition<ThirdPersonCameraConfig> = {
  id: CAMERA_THIRD_PERSON,
  version: '1.0.0',
  description: 'Third-person boom camera behind and above the child, with wall pull-in and tall-wall lift. On by default.',
  defaults: Object.freeze({
    defaultMode: DEFAULT_PLAYER_CAMERA.defaultMode,
    allowModeSwitch: DEFAULT_PLAYER_CAMERA.allowModeSwitch,
    distance: DEFAULT_PLAYER_CAMERA.distance,
    minDistance: DEFAULT_PLAYER_CAMERA.minDistance,
    maxDistance: DEFAULT_PLAYER_CAMERA.maxDistance,
    heightOffset: DEFAULT_PLAYER_CAMERA.heightOffset,
    followDamping: DEFAULT_PLAYER_CAMERA.followDamping,
    rotationSensitivity: DEFAULT_PLAYER_CAMERA.rotationSensitivity,
    sprintFovBoost: DEFAULT_PLAYER_CAMERA.sprintFovBoost,
  }),
  validate: (input) =>
    validateConfig<ThirdPersonCameraConfig>(input, cameraThirdPersonCapability.defaults, THIRD_PERSON_SCHEMA, (config, issues) => {
      if (config.minDistance > config.maxDistance) {
        issues.push({ path: 'minDistance', message: 'must not be more than maxDistance' });
      }
    }),
};

export const cameraFirstPersonCapability: CapabilityDefinition<FirstPersonCameraConfig> = {
  id: CAMERA_FIRST_PERSON,
  version: '1.0.0',
  description: 'First-person eye camera, the compatibility view, switchable from third-person.',
  defaults: Object.freeze({ eyeHeight: 1.6, rotationSensitivity: DEFAULT_PLAYER_CAMERA.rotationSensitivity }),
  validate: (input) =>
    validateConfig<FirstPersonCameraConfig>(input, cameraFirstPersonCapability.defaults, {
      eyeHeight: num(EYE_HEIGHT_LIMITS),
      rotationSensitivity: num(CAMERA_LIMITS.rotationSensitivity),
    }),
};

export const cameraCollisionCapability: CapabilityDefinition<CameraCollisionConfig> = {
  id: CAMERA_COLLISION,
  version: '1.0.0',
  description: 'Boom shortening through the physics provider (skipping cameraIgnores colliders) so the camera never ends inside a wall.',
  requires: [CAMERA_THIRD_PERSON],
  defaults: Object.freeze({ enabled: DEFAULT_PLAYER_CAMERA.collisionEnabled, safetyRadius: DEFAULT_SAFETY_RADIUS }),
  validate: (input) =>
    validateConfig<CameraCollisionConfig>(input, cameraCollisionCapability.defaults, {
      enabled: { kind: 'boolean' },
      safetyRadius: num(SAFETY_RADIUS_LIMITS),
    }),
};

/** Registers the camera capabilities (the host calls this once when it builds its registry). */
export function registerCameraCapabilities(registry: CapabilityRegistry): void {
  registry.register(cameraThirdPersonCapability);
  registry.register(cameraFirstPersonCapability);
  registry.register(cameraCollisionCapability);
}

/** Every camera capability, for validators that only need `validate`. */
export const CAMERA_CAPABILITY_IDS: readonly string[] = Object.freeze([CAMERA_THIRD_PERSON, CAMERA_FIRST_PERSON, CAMERA_COLLISION]);

export interface ResolvedCameraConfigs {
  thirdPerson?: ThirdPersonCameraConfig;
  firstPerson?: FirstPersonCameraConfig;
  collision?: CameraCollisionConfig;
}

/**
 * Rig options from resolved capability configs. A location with no `camera.collision` has no
 * boom collision; with only `camera.firstPerson` the child starts and stays in first-person.
 */
export function cameraRigOptionsFromCapabilities(
  configs: ResolvedCameraConfigs,
  rest: Omit<CameraRigOptions, 'config' | 'eyeHeight' | 'safetyRadius'> = {},
): CameraRigOptions {
  const third = configs.thirdPerson;
  const config: Partial<PlayerCameraConfiguration> = third
    ? { ...third, collisionEnabled: configs.collision?.enabled ?? false }
    : { defaultMode: 'first-person', allowModeSwitch: false, rotationSensitivity: configs.firstPerson?.rotationSensitivity, collisionEnabled: false };
  return {
    ...rest,
    config,
    eyeHeight: configs.firstPerson?.eyeHeight,
    safetyRadius: configs.collision?.safetyRadius,
  };
}
