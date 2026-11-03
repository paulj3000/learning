import { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { installE2EProbe } from './e2eProbe';

function setup(walkable: (x: number, z: number) => boolean = () => true) {
  const root = new Object3D();
  root.position.set(4, 0, 2);
  root.updateMatrixWorld();
  const position = {
    x: 0,
    z: 0,
    set(x: number, _y: number, z: number) {
      this.x = x;
      this.z = z;
    },
  };
  const controller = { position, yaw: 0, pitch: 0.4 };
  const uninstall = installE2EProbe({
    controller,
    targets: [{ entityId: 'pip', kind: 'NPC', root, focusable: true }],
    walkable,
    focused: () => 'pip',
  });
  return { controller, uninstall };
}

describe('installE2EProbe', () => {
  it('stands the player near the entity on walkable ground, facing it', () => {
    const { controller, uninstall } = setup();
    expect(window.__laiE2E?.standFacing('pip', 2)).toBe(true);
    const { x, z, yaw } = window.__laiE2E!.player();
    expect(Math.hypot(4 - x, 2 - z)).toBeCloseTo(2);
    // Forward at `yaw` is (sin, cos); it points at the entity.
    expect(Math.sin(yaw) * (4 - x) + Math.cos(yaw) * (2 - z)).toBeCloseTo(2);
    expect(controller.pitch).toBe(0);
    uninstall();
  });

  it('skips blocked spots and refuses when nowhere around the entity is walkable', () => {
    const { uninstall } = setup((x) => x < 4);
    expect(window.__laiE2E?.standFacing('pip')).toBe(true);
    expect(window.__laiE2E!.player().x).toBeLessThan(4);
    uninstall();
    const blocked = setup(() => false);
    expect(window.__laiE2E?.standFacing('pip')).toBe(false);
    expect(window.__laiE2E?.standFacing('nobody')).toBe(false);
    blocked.uninstall();
  });

  it('lists entities and focus, and removes itself on uninstall', () => {
    const { uninstall } = setup();
    expect(window.__laiE2E?.entities()).toEqual([
      { entityId: 'pip', kind: 'NPC', x: 4, z: 2, focusable: true },
    ]);
    expect(window.__laiE2E?.focused()).toBe('pip');
    window.__laiE2E?.standAt(1, -2, Math.PI);
    expect(window.__laiE2E?.player()).toEqual({ x: 1, z: -2, yaw: Math.PI });
    uninstall();
    expect(window.__laiE2E).toBeUndefined();
  });
});
