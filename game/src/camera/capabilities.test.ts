import { describe, expect, it } from 'vitest';
import { createCapabilityRegistry } from '../core/capabilities';
import {
  registerCameraCapabilities,
  cameraCollisionCapability,
  cameraFirstPersonCapability,
  cameraRigOptionsFromCapabilities,
  cameraThirdPersonCapability,
  DEFAULT_CAMERA_CAPABILITIES,
} from './capabilities';
import { CameraRig } from './cameraRig';
import { CAMERA_LIMITS } from './playerPresentation';

describe('camera capabilities', () => {
  it('register and resolve together, third-person by default', () => {
    const registry = createCapabilityRegistry();
    registerCameraCapabilities(registry);
    const resolution = registry.resolve(DEFAULT_CAMERA_CAPABILITIES.map((id) => ({ id })));
    expect(resolution.ok).toBe(true);
    expect(resolution.order.map((r) => r.definition.id)).toEqual([
      'camera.thirdPerson',
      'camera.collision',
    ]);
  });

  it('collision pulls in third-person automatically', () => {
    const registry = createCapabilityRegistry();
    registerCameraCapabilities(registry);
    const resolution = registry.resolve([{ id: 'camera.collision' }]);
    expect(resolution.order.map((r) => r.definition.id)).toEqual([
      'camera.thirdPerson',
      'camera.collision',
    ]);
  });

  it('accepts the defaults and a partial override', () => {
    expect(cameraThirdPersonCapability.validate({}).ok).toBe(true);
    const result = cameraThirdPersonCapability.validate({ distance: 6, maxDistance: 8 });
    expect(result.ok && result.value.distance).toBe(6);
  });

  it('reports values outside the presentation limits instead of clamping', () => {
    const result = cameraThirdPersonCapability.validate({
      distance: CAMERA_LIMITS.distance.max + 1,
      followDamping: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.path).sort()).toEqual(['distance', 'followDamping']);
  });

  it('reports unknown keys, wrong types and a min distance above the max', () => {
    expect(cameraThirdPersonCapability.validate({ distnace: 4 }).issues[0]?.path).toBe('distnace');
    expect(cameraThirdPersonCapability.validate({ defaultMode: 'orbit' }).ok).toBe(false);
    expect(cameraThirdPersonCapability.validate({ allowModeSwitch: 'yes' }).ok).toBe(false);
    expect(cameraThirdPersonCapability.validate({ minDistance: 6, maxDistance: 2 }).ok).toBe(false);
    expect(cameraCollisionCapability.validate({ radius: 1 }).ok).toBe(false);
    expect(cameraFirstPersonCapability.validate({ eyeHeight: 9 }).ok).toBe(false);
  });

  it('never throws on hostile input', () => {
    for (const input of [
      null,
      7,
      'x',
      [],
      { __proto__: 1 },
      { distance: NaN },
      Object.create(null),
    ]) {
      expect(() => cameraThirdPersonCapability.validate(input)).not.toThrow();
      expect(() => cameraFirstPersonCapability.validate(input)).not.toThrow();
      expect(() => cameraCollisionCapability.validate(input)).not.toThrow();
    }
    expect(cameraThirdPersonCapability.validate([]).ok).toBe(false);
    expect(cameraThirdPersonCapability.validate(null).ok).toBe(true);
  });

  it('builds rig options from resolved configs', () => {
    const third = cameraThirdPersonCapability.validate({ distance: 5 });
    const collision = cameraCollisionCapability.validate({ enabled: false });
    if (!third.ok || !collision.ok) throw new Error('expected valid');
    const options = cameraRigOptionsFromCapabilities({
      thirdPerson: third.value,
      collision: collision.value,
    });
    const rig = new CameraRig(options);
    expect(rig.configuration.distance).toBe(5);
    expect(rig.configuration.collisionEnabled).toBe(false);
    expect(rig.mode).toBe('third-person');
  });

  it('first-person only means first-person with no switching', () => {
    const rig = new CameraRig(
      cameraRigOptionsFromCapabilities({ firstPerson: { eyeHeight: 1.4, rotationSensitivity: 1 } }),
    );
    expect(rig.mode).toBe('first-person');
    expect(rig.setMode('third-person')).toBe(false);
  });
});
