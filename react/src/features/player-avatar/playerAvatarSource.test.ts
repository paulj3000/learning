import { describe, expect, it, vi } from 'vitest';
import type { AssetResolver } from '../island-map/three/assets/assetResolver';
import { playerAvatarSourceFor } from './playerAvatarSource';

const ENABLED = { enabled: true, baseUrl: 'https://api.example' } as never;
const MODEL = {
  ref: 'player-fox@2',
  assetId: 'player-fox',
  version: 2,
  clips: ['Idle'],
  scale: 1,
  rotationOffset: 0,
  animationMap: { idle: 'Idle' },
  customization: { colorMaterials: {}, attachPoints: {} },
};

describe('playerAvatarSourceFor (LAI-JMP-01c)', () => {
  it('serves the published model and loads it through the Django asset resolver by reference', async () => {
    const resolve = vi.fn(async () => {
      throw new Error('stop here: the loader asked the resolver');
    });
    const source = playerAvatarSourceFor(
      'c1',
      ENABLED,
      async () => ({ avatarKey: 'FOX', displayName: 'Fox', model: MODEL, reason: null }),
      () => ({ resolve }) as AssetResolver,
    );
    expect(await source.published).toEqual(MODEL);
    await expect(source.loadModel?.('player-fox@2')).rejects.toThrow();
    expect(resolve).toHaveBeenCalledWith('player-fox@2');
  });

  it('is the placeholder (null) when the answer has no model or fails', async () => {
    const none = playerAvatarSourceFor('c1', ENABLED, async () => ({
      avatarKey: 'FOX',
      displayName: 'Fox',
      model: null,
      reason: 'not_available',
    }));
    expect(await none.published).toBeNull();
    const failed = playerAvatarSourceFor('c1', ENABLED, () => Promise.reject(new Error('down')));
    expect(await failed.published).toBeNull();
  });

  it('has no loader without a child, so the location own loader is used', async () => {
    const source = playerAvatarSourceFor('', ENABLED, async () => null);
    expect(source.loadModel).toBeUndefined();
    expect(await source.published).toBeNull();
  });
});
