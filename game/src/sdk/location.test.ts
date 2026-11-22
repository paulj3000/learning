import { createStandardCapabilityRegistry } from '../engine/standardRegistry';
import {
  capabilityRequestsFromManifest,
  defineLocation,
  validateLocation,
  type LocationDefinition,
} from './location';

const registry = createStandardCapabilityRegistry();

function location(overrides: Partial<LocationDefinition> = {}): LocationDefinition {
  const { requests } = capabilityRequestsFromManifest({});
  return {
    id: 'welcome-harbor',
    version: '1.0.0',
    engineApi: '^0.1.0',
    contentSource: 'MANIFEST',
    capabilities: requests,
    requiredServices: [],
    ...overrides,
  };
}

describe('location definitions (GE-075)', () => {
  it('a manifest with no movement or player blocks becomes the standard, valid capability set', () => {
    const { requests, issues } = capabilityRequestsFromManifest({});
    expect(issues).toEqual([]);
    expect(requests.map((r) => r.id)).toEqual([
      'movement.locomotion',
      'movement.jump',
      'camera.thirdPerson',
      'camera.firstPerson',
      'camera.collision',
      'character.avatar',
      'character.animation',
    ]);
    expect(validateLocation(location(), registry).ok).toBe(true);
  });

  it('carries authored tuning into the matching capability configs', () => {
    const { requests, issues } = capabilityRequestsFromManifest({
      movement: { jump: { jumpHeight: 0.9 }, locomotion: { walkSpeed: 3 } },
      player: {
        camera: { maxHeight: 4, collisionEnabled: false, distance: 3 },
        avatar: { scale: 1.1 },
      },
    });
    expect(issues).toEqual([]);
    const config = Object.fromEntries(requests.map((r) => [r.id, r.config]));
    expect(config['movement.jump']).toEqual({ jumpHeight: 0.9 });
    expect(config['movement.locomotion']).toEqual({ walkSpeed: 3 });
    expect(config['camera.thirdPerson']).toEqual({ maxHeight: 4, distance: 3 });
    expect(config['camera.collision']).toEqual({ enabled: false });
    expect(config['character.avatar']).toEqual({ scale: 1.1 });
    expect(validateLocation(location({ capabilities: requests }), registry).ok).toBe(true);
  });

  it('reports what a migration would lose instead of dropping it', () => {
    const { issues } = capabilityRequestsFromManifest({
      movement: { collision: { radius: 0.4 } },
      player: { camera: { wobble: 1 } as never },
    });
    expect(issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(['movement.collision', 'player.camera.wobble']),
    );
  });

  it('rejects invalid tuning, timers, bad versions and unknown keys with paths', () => {
    const bad = validateLocation(
      {
        ...location({ capabilities: [{ id: 'movement.jump', config: { jumpHeight: 9 } }] }),
        engineApi: '^9.0.0',
        countdownSeconds: 30,
      },
      registry,
    );
    expect(bad.ok).toBe(false);
    expect(bad.issues.map((i) => i.path)).toEqual(
      expect.arrayContaining([
        'engineApi',
        'countdownSeconds',
        'capabilities.movement.jump.jumpHeight',
      ]),
    );
    expect(() => defineLocation(location({ version: 'one' }), registry)).toThrow(/invalid/);
    expect(Object.isFrozen(defineLocation(location(), registry))).toBe(true);
  });
});
