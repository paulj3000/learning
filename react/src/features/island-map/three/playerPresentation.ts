/**
 * How the player is seen in a 3D location (LAI-JMP-01a): the camera
 * perspective and the child's avatar. Plain JSON-shaped data, like
 * `jumpConfiguration.ts`, so a source manifest (`ThreeLocationManifest.player`)
 * and a Django region (`scene.player`) author it the same way, and a location
 * overrides only what it names.
 *
 * Pure: no Three.js, no DOM.
 *
 * Scale: metres, a 1.6 m first-person eye height, a 1.35 m tall avatar
 * (`playerAvatar.ts`), 3 m walls. The default third-person camera sits 4 m
 * behind a point just above the avatar's head, which keeps the whole child
 * and a good arc of ground ahead in view outdoors; indoor locations bring it
 * closer.
 */

export const CAMERA_MODES = ['first-person', 'third-person'] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

export function isCameraMode(value: unknown): value is CameraMode {
  return (CAMERA_MODES as readonly unknown[]).includes(value);
}

export interface PlayerCameraConfiguration {
  /** The perspective a child gets here unless they chose another (and switching is allowed). */
  defaultMode: CameraMode;
  /** Whether the child may switch perspective here (V, the camera button, gamepad Y/Triangle). */
  allowModeSwitch: boolean;
  /** Third-person: how far behind the follow point the camera sits, metres. */
  distance: number;
  /** Closest the camera comes when nothing is in the way (it may come closer to avoid a wall). */
  minDistance: number;
  /** Furthest it may ever be. */
  maxDistance: number;
  /** Height of the follow point above the feet, metres; the camera looks at it. */
  heightOffset: number;
  /** How quickly the camera catches up with the player, per second. Higher is tighter. */
  followDamping: number;
  /** Multiplier on mouse, touch and gamepad look speed. */
  rotationSensitivity: number;
  /** Pull the camera in front of walls and solid props. */
  collisionEnabled: boolean;
  /**
   * Highest the camera may go, metres, for a location with ceilings. Absent
   * means no ceiling (outdoors).
   */
  maxHeight?: number;
}

export interface PlayerAvatarConfiguration {
  /** Draw the child's avatar in third-person. */
  enabled: boolean;
  /**
   * An asset library id that every child is drawn with here (a costume a
   * location needs). Absent means the child's own avatar.
   */
  assetKey?: string;
  /** Uniform scale applied to the avatar model. */
  scale: number;
  /** Radians added to the model's facing, for a model authored facing another way. */
  rotationOffset: number;
}

export const DEFAULT_PLAYER_CAMERA: Readonly<PlayerCameraConfiguration> = Object.freeze({
  defaultMode: 'third-person',
  allowModeSwitch: true,
  distance: 4,
  minDistance: 1.5,
  maxDistance: 6,
  heightOffset: 1.5,
  followDamping: 12,
  rotationSensitivity: 1,
  collisionEnabled: true,
});

export const DEFAULT_PLAYER_AVATAR: Readonly<PlayerAvatarConfiguration> = Object.freeze({
  enabled: true,
  scale: 1,
  rotationOffset: 0,
});

/** Accepted ranges; the validator reports values outside them and the resolver clamps. */
export const CAMERA_LIMITS = Object.freeze({
  distance: { min: 0.8, max: 12 },
  minDistance: { min: 0.5, max: 12 },
  maxDistance: { min: 0.8, max: 15 },
  heightOffset: { min: 0.5, max: 3 },
  followDamping: { min: 1, max: 40 },
  rotationSensitivity: { min: 0.1, max: 4 },
  maxHeight: { min: 1.5, max: 50 },
});

export const AVATAR_LIMITS = Object.freeze({
  scale: { min: 0.2, max: 5 },
  rotationOffset: { min: -2 * Math.PI, max: 2 * Math.PI },
});

/** What a manifest may say about how the player is seen. */
export interface PlayerPresentationSpec {
  camera?: Partial<PlayerCameraConfiguration>;
  avatar?: Partial<PlayerAvatarConfiguration>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The camera this location plays with: defaults overridden field by field,
 * numbers clamped, and the distances kept in order (min <= distance <= max).
 */
export function resolvePlayerCamera(
  override?: Partial<PlayerCameraConfiguration> | null,
): PlayerCameraConfiguration {
  const resolved: PlayerCameraConfiguration = { ...DEFAULT_PLAYER_CAMERA };
  if (override) {
    if (isCameraMode(override.defaultMode)) resolved.defaultMode = override.defaultMode;
    if (typeof override.allowModeSwitch === 'boolean') {
      resolved.allowModeSwitch = override.allowModeSwitch;
    }
    if (typeof override.collisionEnabled === 'boolean') {
      resolved.collisionEnabled = override.collisionEnabled;
    }
    for (const key of [
      'distance',
      'minDistance',
      'maxDistance',
      'heightOffset',
      'followDamping',
      'rotationSensitivity',
    ] as const) {
      const value = override[key];
      if (finite(value))
        resolved[key] = clamp(value, CAMERA_LIMITS[key].min, CAMERA_LIMITS[key].max);
    }
    if (finite(override.maxHeight)) {
      resolved.maxHeight = clamp(
        override.maxHeight,
        CAMERA_LIMITS.maxHeight.min,
        CAMERA_LIMITS.maxHeight.max,
      );
    }
  }
  resolved.maxDistance = Math.max(resolved.maxDistance, resolved.minDistance);
  resolved.distance = clamp(resolved.distance, resolved.minDistance, resolved.maxDistance);
  return resolved;
}

export function resolvePlayerAvatar(
  override?: Partial<PlayerAvatarConfiguration> | null,
): PlayerAvatarConfiguration {
  const resolved: PlayerAvatarConfiguration = { ...DEFAULT_PLAYER_AVATAR };
  if (!override) return resolved;
  if (typeof override.enabled === 'boolean') resolved.enabled = override.enabled;
  if (typeof override.assetKey === 'string' && override.assetKey.trim() !== '') {
    resolved.assetKey = override.assetKey;
  }
  if (finite(override.scale)) {
    resolved.scale = clamp(override.scale, AVATAR_LIMITS.scale.min, AVATAR_LIMITS.scale.max);
  }
  if (finite(override.rotationOffset)) {
    resolved.rotationOffset = clamp(
      override.rotationOffset,
      AVATAR_LIMITS.rotationOffset.min,
      AVATAR_LIMITS.rotationOffset.max,
    );
  }
  return resolved;
}

/**
 * The perspective to start in: the child's saved choice where switching is
 * allowed, otherwise the location's default.
 */
export function initialCameraMode(
  camera: Pick<PlayerCameraConfiguration, 'defaultMode' | 'allowModeSwitch'>,
  preferred: CameraMode | null | undefined,
): CameraMode {
  if (camera.allowModeSwitch && preferred && isCameraMode(preferred)) return preferred;
  return camera.defaultMode;
}

export interface PlayerPresentationIssue {
  path: string;
  message: string;
}

type Fields = Record<string, unknown>;

function isObject(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkNumbers(
  fields: Fields,
  limits: Record<string, { min: number; max: number }>,
  path: string,
  issues: PlayerPresentationIssue[],
  key: string,
): boolean {
  if (!(key in limits)) return false;
  const value = fields[key];
  const range = limits[key];
  if (!finite(value)) {
    issues.push({ path: `${path}.${key}`, message: 'must be a number' });
  } else if (value < range.min || value > range.max) {
    issues.push({
      path: `${path}.${key}`,
      message: `must be between ${range.min} and ${range.max}`,
    });
  }
  return true;
}

/**
 * Every problem with an authored `player` block, for the manifest validator
 * and a future Django publish step. Unknown keys are reported, so a typo is
 * never silently ignored.
 */
export function validatePlayerPresentation(
  player: unknown,
  path = 'player',
): PlayerPresentationIssue[] {
  const issues: PlayerPresentationIssue[] = [];
  if (player === undefined) return issues;
  if (!isObject(player)) return [{ path, message: 'must be an object' }];
  for (const key of Object.keys(player)) {
    if (key !== 'camera' && key !== 'avatar') {
      issues.push({ path: `${path}.${key}`, message: 'is not a player setting' });
    }
  }

  const camera = player.camera;
  if (camera !== undefined) {
    const at = `${path}.camera`;
    if (!isObject(camera)) {
      issues.push({ path: at, message: 'must be an object' });
    } else {
      for (const key of Object.keys(camera)) {
        if (key === 'defaultMode') {
          if (!isCameraMode(camera.defaultMode)) {
            issues.push({
              path: `${at}.defaultMode`,
              message: `must be one of ${CAMERA_MODES.join(', ')}`,
            });
          }
        } else if (key === 'allowModeSwitch' || key === 'collisionEnabled') {
          if (typeof camera[key] !== 'boolean') {
            issues.push({ path: `${at}.${key}`, message: 'must be true or false' });
          }
        } else if (!checkNumbers(camera, CAMERA_LIMITS, at, issues, key)) {
          issues.push({ path: `${at}.${key}`, message: 'is not a camera setting' });
        }
      }
      if (
        finite(camera.minDistance) &&
        finite(camera.maxDistance) &&
        camera.minDistance > camera.maxDistance
      ) {
        issues.push({ path: `${at}.minDistance`, message: 'must not be more than maxDistance' });
      }
    }
  }

  const avatar = player.avatar;
  if (avatar !== undefined) {
    const at = `${path}.avatar`;
    if (!isObject(avatar)) {
      issues.push({ path: at, message: 'must be an object' });
    } else {
      for (const key of Object.keys(avatar)) {
        if (key === 'enabled') {
          if (typeof avatar.enabled !== 'boolean') {
            issues.push({ path: `${at}.enabled`, message: 'must be true or false' });
          }
        } else if (key === 'assetKey') {
          if (typeof avatar.assetKey !== 'string' || avatar.assetKey.trim() === '') {
            issues.push({ path: `${at}.assetKey`, message: 'must be an asset id' });
          }
        } else if (!checkNumbers(avatar, AVATAR_LIMITS, at, issues, key)) {
          issues.push({ path: `${at}.${key}`, message: 'is not an avatar setting' });
        }
      }
    }
  }
  return issues;
}
