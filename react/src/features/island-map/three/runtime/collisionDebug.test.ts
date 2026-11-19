import { Box3, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COLLISION_DEBUG_STORAGE_KEY,
  collisionDebugEnabled,
  createCollisionDebugOverlay,
} from './collisionDebug';
import { mount, type Harness } from './testing/engineHarness';

describe('the development collision view', () => {
  it('is off by default, off in production builds, and on only with an explicit flag', () => {
    const storage = (value: string | null) => ({ getItem: () => value });
    expect(collisionDebugEnabled(true, '', null)).toBe(false);
    expect(collisionDebugEnabled(true, '?collisionDebug=1', null)).toBe(true);
    expect(collisionDebugEnabled(true, '?collisionDebug=0', null)).toBe(false);
    expect(collisionDebugEnabled(true, '', storage('1'))).toBe(true);
    // A production build never shows it, whatever the URL or storage says.
    expect(collisionDebugEnabled(false, '?collisionDebug=1', storage('1'))).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(collisionDebugEnabled(true, '', throwing)).toBe(false);
    expect(COLLISION_DEBUG_STORAGE_KEY).toBe('lai.collisionDebug');
  });

  it('draws the footprint, both positions and nearby colliders as copies, and reports drift', () => {
    const parent = document.createElement('div');
    const overlay = createCollisionDebugOverlay(parent);
    const near = new Box3(new Vector3(1, 0, 1), new Vector3(2, 3, 2));
    const far = new Box3(new Vector3(40, 0, 40), new Vector3(41, 3, 41));
    const before = near.clone();
    overlay.update(1, {
      feet: { x: 0, y: 0, z: 0 },
      avatar: { x: 0.5, y: 0, z: 0 },
      aim: { x: 0, y: 1.5, z: 0 },
      radius: 0.35,
      skin: 0.02,
      bodyHeight: 1.7,
      colliders: [near, far],
      jumpable: new Set(),
      movementState: 'IDLE',
      locomotionSpeed: 0,
      cameraMode: 'third-person',
      cameraDistance: 4,
    });
    const footprint = overlay.root.getObjectByName('collision-debug:footprint')!;
    expect(footprint.scale.x).toBeCloseTo(0.37);
    expect(footprint.scale.y).toBeCloseTo(1.7);
    expect(overlay.root.getObjectByName('collision-debug:colliders')!.children).toHaveLength(1);
    expect(overlay.status()).toContain('avatar drift 0.500 m');
    expect(parent.querySelector('[data-testid="collision-debug"]')?.textContent).toContain('IDLE');
    expect(near.equals(before)).toBe(true);
    overlay.dispose();
    expect(parent.querySelector('[data-testid="collision-debug"]')).toBeNull();
  });
});

describe('the collision view in the runtime', () => {
  let harness: Harness | null = null;
  afterEach(() => {
    harness?.engine.dispose();
    harness = null;
    vi.restoreAllMocks();
  });

  it('is not in the scene unless asked for', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness = mount({});
    await harness.engine.ready;
    harness.runFrames(2);
    expect(harness.scene().getObjectByName('collision-debug')).toBeUndefined();
  });

  it('when asked for, follows the child and shows the avatar in sync with them', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness = mount({ collisionDebug: true, cameraMode: 'third-person' });
    await harness.engine.ready;
    harness.setDrive((controller, delta) => controller.update(delta, { forward: 1, strafe: 0 }));
    harness.runFrames(30);
    const root = harness.scene().getObjectByName('collision-debug');
    expect(root).toBeDefined();
    const label = harness.parent.querySelector('[data-testid="collision-debug"]');
    expect(label?.textContent).toMatch(/WALK .* \| r 0\.35\+0\.02 \| avatar drift 0\.000 m/);
    harness.engine.dispose();
    harness = null;
    expect(label?.isConnected).toBe(false);
  });
});
