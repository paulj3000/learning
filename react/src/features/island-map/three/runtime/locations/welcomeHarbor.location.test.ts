import { describe, expect, it } from 'vitest';
import { resolvePlayerAvatar, resolvePlayerCamera } from '@lai/game-engine/camera';
import { createStandardCapabilityRegistry } from '@lai/game-engine/engine';
import { resolveJumpConfiguration, resolveLocomotion } from '@lai/game-engine/movement';
import { checkContentCompatibility, validateLocation } from '@lai/game-engine/sdk';
import { WELCOME_HARBOR_MANIFEST } from '../manifests/welcomeHarbor';
import { WELCOME_HARBOR_ADAPTER_ISSUES, WELCOME_HARBOR_LOCATION } from './welcomeHarbor.location';

const registry = createStandardCapabilityRegistry();
const resolution = registry.resolve(WELCOME_HARBOR_LOCATION.capabilities);

function resolved(id: string): Record<string, unknown> {
  const entry = resolution.order.find((item) => item.definition.id === id);
  expect(entry, id).toBeDefined();
  return entry!.config as Record<string, unknown>;
}

/** The migrated location plays with what its manifest resolves to today (parity, GE-075). */
describe('welcomeHarbor location (GE-075)', () => {
  it('loses nothing from the manifest and validates against the standard registry', () => {
    expect(WELCOME_HARBOR_ADAPTER_ISSUES).toEqual([]);
    expect(validateLocation(WELCOME_HARBOR_LOCATION, registry)).toMatchObject({
      ok: true,
      issues: [],
    });
    expect(resolution.issues).toEqual([]);
    expect(WELCOME_HARBOR_LOCATION).toMatchObject({
      id: WELCOME_HARBOR_MANIFEST.regionId,
      contentSource: 'MANIFEST',
      version: '1.0.0',
    });
  });

  it('jumps and walks exactly as the manifest resolves', () => {
    expect(resolved('movement.jump')).toEqual(
      resolveJumpConfiguration(WELCOME_HARBOR_MANIFEST.movement?.jump),
    );
    expect(resolved('movement.locomotion')).toEqual(
      resolveLocomotion(WELCOME_HARBOR_MANIFEST.movement?.locomotion),
    );
  });

  it('has the same third-person camera, collision avoidance and avatar', () => {
    const camera = resolvePlayerCamera(WELCOME_HARBOR_MANIFEST.player?.camera);
    const thirdPerson = resolved('camera.thirdPerson');
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
      expect(thirdPerson[field], field).toEqual(camera[field]);
    }
    expect(resolved('camera.collision').enabled).toBe(camera.collisionEnabled);

    const avatar = resolvePlayerAvatar(WELCOME_HARBOR_MANIFEST.player?.avatar);
    const character = resolved('character.avatar');
    for (const field of ['enabled', 'assetKey', 'scale', 'rotationOffset'] as const) {
      expect(character[field], field).toEqual(avatar[field]);
    }
  });

  it('passes the content compatibility check as a hand-written manifest', () => {
    const untrusted: unknown = JSON.parse(JSON.stringify(WELCOME_HARBOR_MANIFEST));
    expect(checkContentCompatibility(untrusted, registry)).toEqual({ ok: true, issues: [] });
  });

  it('declares no timers (ADR-053) and only the services it needs', () => {
    expect(JSON.stringify(WELCOME_HARBOR_MANIFEST)).not.toMatch(
      /timeLimit|countdown|deadline|timer/i,
    );
    expect(JSON.stringify(WELCOME_HARBOR_LOCATION)).not.toMatch(
      /timeLimit|countdown|deadline|timer/i,
    );
    expect(WELCOME_HARBOR_LOCATION.requiredServices).toEqual([
      'lai.assetManager',
      'lai.npcManager',
    ]);
  });
});
