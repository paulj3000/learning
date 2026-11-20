import { describe, expect, it } from 'vitest';
import { resolvePlayerAvatar, resolvePlayerCamera } from '@lai/game-engine/camera';
import { createStandardCapabilityRegistry } from '@lai/game-engine/engine';
import { resolveJumpConfiguration, resolveLocomotion } from '@lai/game-engine/movement';
import { checkContentCompatibility, validateLocation } from '@lai/game-engine/sdk';
import { CASTLE_ENGINE_PROFILE } from '../../castleEngineProfile';
import { STORYKEEPER_CASTLE_MANIFEST } from '../manifests/storykeeperCastle';
import {
  STORYKEEPER_CASTLE_ADAPTER_ISSUES,
  STORYKEEPER_CASTLE_LOCATION,
} from './storykeeperCastle.location';

const registry = createStandardCapabilityRegistry();
const resolution = registry.resolve(STORYKEEPER_CASTLE_LOCATION.capabilities);

function resolved(id: string): Record<string, unknown> {
  const entry = resolution.order.find((item) => item.definition.id === id);
  expect(entry, id).toBeDefined();
  return entry!.config as Record<string, unknown>;
}

/** The migrated castle plays with what its manifest resolves to today (parity, GE-072). */
describe('Storykeeper Castle location (GE-072)', () => {
  it('loses nothing from the manifest and validates against the standard registry', () => {
    expect(STORYKEEPER_CASTLE_ADAPTER_ISSUES).toEqual([]);
    expect(validateLocation(STORYKEEPER_CASTLE_LOCATION, registry)).toMatchObject({
      ok: true,
      issues: [],
    });
    expect(resolution.issues).toEqual([]);
    expect(STORYKEEPER_CASTLE_LOCATION).toMatchObject({
      id: 'storykeeper-castle',
      contentSource: 'MANIFEST',
      version: '1.0.0',
    });
  });

  it('walks, runs and sprints at the castle’s gentler indoor speeds', () => {
    const locomotion = resolved('movement.locomotion');
    expect(locomotion).toEqual(resolveLocomotion(STORYKEEPER_CASTLE_MANIFEST.movement?.locomotion));
    expect(locomotion.runSpeed).toBe(CASTLE_ENGINE_PROFILE.movement.locomotion.runSpeed);
    expect(locomotion.sprintSpeed).toBe(CASTLE_ENGINE_PROFILE.movement.locomotion.sprintSpeed);
  });

  it('supports jumping as the shared capability, tuned low for the ceilings, with no double jump', () => {
    const jump = resolved('movement.jump');
    expect(jump).toEqual(resolveJumpConfiguration(STORYKEEPER_CASTLE_MANIFEST.movement?.jump));
    expect(jump.enabled).toBe(true);
    expect(jump.jumpHeight).toBe(CASTLE_ENGINE_PROFILE.movement.jump.jumpHeight);
    expect(jump.allowDoubleJump).toBe(false);
  });

  it('keeps the indoor third-person camera, its ceiling cap, collision avoidance and the avatar', () => {
    const camera = resolvePlayerCamera(STORYKEEPER_CASTLE_MANIFEST.player?.camera);
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
    expect(thirdPerson.maxHeight).toBe(CASTLE_ENGINE_PROFILE.camera.maxHeight);
    expect(resolved('camera.collision').enabled).toBe(true);
    resolved('camera.firstPerson');

    const avatar = resolvePlayerAvatar(STORYKEEPER_CASTLE_MANIFEST.player?.avatar);
    const character = resolved('character.avatar');
    for (const field of ['enabled', 'assetKey', 'scale', 'rotationOffset'] as const) {
      expect(character[field], field).toEqual(avatar[field]);
    }
    resolved('character.animation');
  });

  it('passes the content compatibility check as a hand-written manifest', () => {
    const untrusted: unknown = JSON.parse(JSON.stringify(STORYKEEPER_CASTLE_MANIFEST));
    expect(checkContentCompatibility(untrusted, registry)).toEqual({ ok: true, issues: [] });
  });

  it('declares no timers (ADR-053) and only the services it needs', () => {
    expect(JSON.stringify(STORYKEEPER_CASTLE_LOCATION)).not.toMatch(
      /timeLimit|countdown|deadline|timer/i,
    );
    expect(STORYKEEPER_CASTLE_LOCATION.requiredServices).toEqual([
      'lai.assetManager',
      'lai.npcManager',
      'lai.soundManager',
    ]);
  });
});
