import { describe, expect, it } from 'vitest';
import { resolvePlayerAvatar, resolvePlayerCamera } from '@lai/game-engine/camera';
import { createStandardCapabilityRegistry } from '@lai/game-engine/engine';
import { resolveJumpConfiguration, resolveLocomotion } from '@lai/game-engine/movement';
import {
  capabilityRequestsFromManifest,
  checkContentCompatibility,
  defineLocation,
  validateLocation,
} from '@lai/game-engine/sdk';
import { ASSET_MANAGER, NPC_MANAGER } from '@lai/game-engine/services';
import { TEST_EXPLORER_COVE_MANIFEST } from '../testing/testExplorerCove';

/**
 * Explorer Cove as a validated engine location (GE-075). The cove is engine Phase 17's test-only
 * location (never imported by production code), so its definition lives here, in a test, rather
 * than beside the shipped locations: a production module must not import a test fixture.
 */
const registry = createStandardCapabilityRegistry();
const adapted = capabilityRequestsFromManifest({
  movement: TEST_EXPLORER_COVE_MANIFEST.movement,
  player: TEST_EXPLORER_COVE_MANIFEST.player,
});
const EXPLORER_COVE_LOCATION = defineLocation(
  {
    id: TEST_EXPLORER_COVE_MANIFEST.regionId,
    version: '1.0.0',
    engineApi: '>=0.1.0 <1.0.0',
    contentSource: 'MANIFEST',
    capabilities: adapted.requests,
    // Pip is placed in the cove; every model is an asset id.
    requiredServices: [ASSET_MANAGER.id, NPC_MANAGER.id],
  },
  registry,
);
const resolution = registry.resolve(EXPLORER_COVE_LOCATION.capabilities);
const resolved = (id: string) =>
  resolution.order.find((item) => item.definition.id === id)!.config as Record<string, unknown>;

describe('Explorer Cove location (GE-075)', () => {
  it('loses nothing from the manifest and validates against the standard registry', () => {
    expect(adapted.issues).toEqual([]);
    expect(validateLocation(EXPLORER_COVE_LOCATION, registry)).toMatchObject({
      ok: true,
      issues: [],
    });
    expect(EXPLORER_COVE_LOCATION.id).toBe('test-explorer-cove');
  });

  it('plays with exactly what its manifest resolves to', () => {
    const manifest = TEST_EXPLORER_COVE_MANIFEST;
    expect(resolved('movement.jump')).toEqual(resolveJumpConfiguration(manifest.movement?.jump));
    expect(resolved('movement.locomotion')).toEqual(
      resolveLocomotion(manifest.movement?.locomotion),
    );
    const camera = resolvePlayerCamera(manifest.player?.camera);
    for (const field of [
      'defaultMode',
      'allowModeSwitch',
      'distance',
      'minDistance',
      'maxDistance',
      'heightOffset',
      'followDamping',
      'rotationSensitivity',
      'sprintFovBoost',
      'maxHeight',
    ] as const) {
      expect(resolved('camera.thirdPerson')[field], field).toEqual(camera[field]);
    }
    expect(resolved('camera.collision').enabled).toBe(camera.collisionEnabled);
    const avatar = resolvePlayerAvatar(manifest.player?.avatar);
    for (const field of ['enabled', 'assetKey', 'scale', 'rotationOffset'] as const) {
      expect(resolved('character.avatar')[field], field).toEqual(avatar[field]);
    }
  });

  it('passes the content compatibility check and has no timers', () => {
    const untrusted: unknown = JSON.parse(JSON.stringify(TEST_EXPLORER_COVE_MANIFEST));
    expect(checkContentCompatibility(untrusted, registry)).toEqual({ ok: true, issues: [] });
    expect(JSON.stringify(TEST_EXPLORER_COVE_MANIFEST)).not.toMatch(
      /timeLimit|countdown|deadline|timer/i,
    );
  });
});
