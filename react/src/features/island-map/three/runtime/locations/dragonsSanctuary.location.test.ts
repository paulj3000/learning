import { describe, expect, it } from 'vitest';
import { resolvePlayerAvatar, resolvePlayerCamera } from '@lai/game-engine/camera';
import { createStandardCapabilityRegistry } from '@lai/game-engine/engine';
import { resolveJumpConfiguration, resolveLocomotion } from '@lai/game-engine/movement';
import { checkContentCompatibility, validateLocation } from '@lai/game-engine/sdk';
import { ASSET_MANAGER, NPC_MANAGER } from '@lai/game-engine/services';
import { DRAGONS_SANCTUARY_MANIFEST as MANIFEST } from '../manifests/dragonsSanctuary';
import { DRAGONS_SANCTUARY_ADAPTER_ISSUES, DRAGONS_SANCTUARY_LOCATION as LOCATION } from './dragonsSanctuary.location';

const registry = createStandardCapabilityRegistry();

function resolved(): Record<string, unknown> {
  const resolution = registry.resolve(LOCATION.capabilities);
  expect(resolution.issues).toEqual([]);
  return Object.fromEntries(resolution.order.map((entry) => [entry.definition.id, entry.config]));
}

describe("Dragon's Sanctuary location definition (GE-075)", () => {
  it('is validated engine data for the manifest region', () => {
    expect(DRAGONS_SANCTUARY_ADAPTER_ISSUES).toEqual([]);
    expect(LOCATION.id).toBe(MANIFEST.regionId);
    expect(LOCATION.contentSource).toBe('MANIFEST');
    expect(validateLocation(LOCATION, registry)).toMatchObject({ ok: true, issues: [] });
    expect(Object.isFrozen(LOCATION)).toBe(true);
  });

  it('requires only the ports the location uses today', () => {
    expect(LOCATION.requiredServices).toEqual([ASSET_MANAGER.id, NPC_MANAGER.id]);
  });

  it('plays with what the manifest plays with: jump, locomotion, camera and avatar', () => {
    const configs = resolved();
    expect(configs['movement.jump']).toEqual(resolveJumpConfiguration(MANIFEST.movement?.jump));
    expect(configs['movement.locomotion']).toEqual(resolveLocomotion(MANIFEST.movement?.locomotion));

    const camera = resolvePlayerCamera(MANIFEST.player?.camera);
    const { collisionEnabled, ...thirdPerson } = camera;
    expect(configs['camera.thirdPerson']).toMatchObject(thirdPerson);
    expect(configs['camera.collision']).toMatchObject({ enabled: collisionEnabled });

    const avatar = resolvePlayerAvatar(MANIFEST.player?.avatar);
    expect(configs['character.avatar']).toMatchObject({
      enabled: avatar.enabled,
      scale: avatar.scale,
      rotationOffset: avatar.rotationOffset,
    });
  });

  it('the manifest has no authored movement or player block, so these are the engine defaults', () => {
    expect(MANIFEST.movement).toBeUndefined();
    expect(MANIFEST.player).toBeUndefined();
  });

  it('the manifest and the definition report no content compatibility issues and carry no timers', () => {
    expect(checkContentCompatibility(MANIFEST, registry).issues).toEqual([]);
    expect(checkContentCompatibility(LOCATION, registry).issues).toEqual([]);
    expect(JSON.stringify(LOCATION)).not.toMatch(/timer|countdown|timeLimit|deadline/i);
  });
});
