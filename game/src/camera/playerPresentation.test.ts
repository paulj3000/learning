import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAYER_AVATAR,
  DEFAULT_PLAYER_CAMERA,
  initialCameraMode,
  resolvePlayerAvatar,
  resolvePlayerCamera,
  validatePlayerPresentation,
} from './playerPresentation';

describe('player camera and avatar configuration (LAI-JMP-01a)', () => {
  it('defaults to a switchable third-person camera and the child’s own avatar', () => {
    expect(DEFAULT_PLAYER_CAMERA).toMatchObject({
      defaultMode: 'third-person',
      allowModeSwitch: true,
      collisionEnabled: true,
    });
    expect(DEFAULT_PLAYER_AVATAR).toEqual({ enabled: true, scale: 1, rotationOffset: 0 });
    expect(resolvePlayerCamera(undefined)).toEqual(DEFAULT_PLAYER_CAMERA);
    expect(resolvePlayerAvatar(null)).toEqual(DEFAULT_PLAYER_AVATAR);
  });

  it('overrides only what a location names (an indoor camera)', () => {
    const indoor = resolvePlayerCamera({ distance: 2.6, maxDistance: 3.5, maxHeight: 2.95 });
    expect(indoor).toEqual({
      ...DEFAULT_PLAYER_CAMERA,
      distance: 2.6,
      maxDistance: 3.5,
      maxHeight: 2.95,
    });
  });

  it('clamps numbers and keeps min <= distance <= max', () => {
    const camera = resolvePlayerCamera({ distance: 100, minDistance: 2, maxDistance: 3 });
    expect(camera.distance).toBe(3);
    const inverted = resolvePlayerCamera({ minDistance: 5, maxDistance: 2, distance: 1 });
    expect(inverted.maxDistance).toBeGreaterThanOrEqual(inverted.minDistance);
    expect(inverted.distance).toBe(inverted.minDistance);
    expect(resolvePlayerCamera({ defaultMode: 'sideways' as never }).defaultMode).toBe(
      'third-person',
    );
  });

  it('resolves an avatar costume and ignores a blank one', () => {
    expect(resolvePlayerAvatar({ assetKey: 'npc-harbor-master', scale: 0.9 })).toMatchObject({
      assetKey: 'npc-harbor-master',
      scale: 0.9,
    });
    expect(resolvePlayerAvatar({ assetKey: '  ' }).assetKey).toBeUndefined();
  });

  describe('initialCameraMode', () => {
    it('uses the child’s saved choice where switching is allowed', () => {
      expect(initialCameraMode(DEFAULT_PLAYER_CAMERA, 'first-person')).toBe('first-person');
    });

    it('uses the location’s default where switching is not allowed, or nothing was saved', () => {
      const fixed = { defaultMode: 'first-person' as const, allowModeSwitch: false };
      expect(initialCameraMode(fixed, 'third-person')).toBe('first-person');
      expect(initialCameraMode(DEFAULT_PLAYER_CAMERA, null)).toBe('third-person');
      expect(initialCameraMode(DEFAULT_PLAYER_CAMERA, 'upside-down' as never)).toBe('third-person');
    });
  });

  describe('validatePlayerPresentation', () => {
    it('accepts an absent or well-formed block', () => {
      expect(validatePlayerPresentation(undefined)).toEqual([]);
      expect(
        validatePlayerPresentation({
          camera: { defaultMode: 'first-person', distance: 3, maxHeight: 2.9 },
          avatar: { enabled: false, assetKey: 'npc-pip', scale: 1.1 },
        }),
      ).toEqual([]);
    });

    it('reports typos, bad types, out-of-range values and inverted distances by path', () => {
      expect(
        validatePlayerPresentation({
          camera: {
            defaultMode: 'top-down',
            distnce: 3,
            followDamping: 0,
            minDistance: 5,
            maxDistance: 2,
          },
          avatar: { enabled: 'yes', assetKey: '', size: 2 },
          hud: true,
        }),
      ).toEqual([
        { path: 'player.hud', message: 'is not a player setting' },
        { path: 'player.camera.defaultMode', message: 'must be one of first-person, third-person' },
        { path: 'player.camera.distnce', message: 'is not a camera setting' },
        { path: 'player.camera.followDamping', message: 'must be between 1 and 40' },
        { path: 'player.camera.minDistance', message: 'must not be more than maxDistance' },
        { path: 'player.avatar.enabled', message: 'must be true or false' },
        { path: 'player.avatar.assetKey', message: 'must be an asset id' },
        { path: 'player.avatar.size', message: 'is not an avatar setting' },
      ]);
    });
  });
});
