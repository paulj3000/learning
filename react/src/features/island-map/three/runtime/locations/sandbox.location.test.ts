import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStandardCapabilityRegistry } from '@lai/game-engine/engine';
import { DEFAULT_JUMP_CONFIGURATION, DEFAULT_LOCOMOTION } from '@lai/game-engine/movement';
import { validateLocation } from '@lai/game-engine/sdk';
import { SANDBOX_LOCATION } from './sandbox.location';

const registry = createStandardCapabilityRegistry();
const resolution = registry.resolve(SANDBOX_LOCATION.capabilities);
const resolved = (id: string) =>
  resolution.order.find((item) => item.definition.id === id)?.config as
    Record<string, unknown> | undefined;

describe('sandbox location (GE-075)', () => {
  it('validates against the standard registry', () => {
    expect(validateLocation(SANDBOX_LOCATION, registry)).toMatchObject({ ok: true, issues: [] });
  });

  it('walks and jumps with the controller defaults, as sandboxScene builds it', () => {
    expect(resolved('movement.jump')).toEqual({ ...DEFAULT_JUMP_CONFIGURATION });
    expect(resolved('movement.locomotion')).toEqual({ ...DEFAULT_LOCOMOTION });
    // Pin the source of truth: the sandbox constructs its controller with no tuning at all.
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/island-map/three/sandboxScene.ts'),
      'utf8',
    );
    const construction = source.slice(
      source.indexOf('new FirstPersonController('),
      source.indexOf('});', source.indexOf('new FirstPersonController(')),
    );
    expect(construction).not.toMatch(/\b(jump|locomotion|collision|maxSpeed|acceleration)\s*:/);
  });

  it('is first-person only, with no avatar and no third-person camera', () => {
    expect(resolved('camera.firstPerson')).toBeDefined();
    expect(resolved('camera.thirdPerson')).toBeUndefined();
    expect(resolved('character.avatar')).toBeUndefined();
  });
});
