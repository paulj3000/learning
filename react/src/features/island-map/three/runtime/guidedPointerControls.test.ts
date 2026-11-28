import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebGLRenderer } from 'three';
import { FirstPersonController } from '@lai/game-engine/movement';
import { attachPointerControls, type PointerControls } from '@lai/game-engine/input';

/**
 * LAI-2104S B1: the opt-in pointer options the guided mode uses (`freeLook`, `onTap`,
 * `shapeInput`). With none of them set, the controls behave exactly as before.
 */

let controls: PointerControls | null = null;
afterEach(() => {
  controls?.dispose();
  controls = null;
});

function setup(options: Parameters<typeof attachPointerControls>[2]) {
  const canvas = document.createElement('canvas');
  canvas.requestPointerLock = vi.fn();
  document.body.appendChild(canvas);
  const controller = new FirstPersonController({ colliders: [] });
  controls = attachPointerControls(
    { domElement: canvas } as unknown as WebGLRenderer,
    controller,
    options,
  );
  return { canvas, controller };
}

describe('guided pointer options', () => {
  it('default: a click captures the pointer, no tap is reported, input is the keys as ever', () => {
    const onTap = vi.fn();
    const { canvas, controller } = setup({ onTap });
    canvas.dispatchEvent(new MouseEvent('click', { clientX: 5, clientY: 6 }));
    // `freeLook` unset: pointer lock as before, and `onTap` is guided-mode only.
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
    expect(onTap).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    controls?.update(0.1);
    expect(controller.position.z).toBeGreaterThan(0);
  });

  it('freeLook false: a click is a tap with its coordinates, and the pointer stays free', () => {
    const onTap = vi.fn();
    const { canvas } = setup({ freeLook: false, onTap });
    canvas.dispatchEvent(new MouseEvent('click', { clientX: 120, clientY: 340 }));
    expect(onTap).toHaveBeenCalledWith({ clientX: 120, clientY: 340 });
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  });

  it('freeLook false: mouse look does nothing', () => {
    const { canvas, controller } = setup({ freeLook: false });
    Object.defineProperty(document, 'pointerLockElement', { value: canvas, configurable: true });
    try {
      const yaw = controller.yaw;
      const move = new MouseEvent('mousemove');
      Object.defineProperty(move, 'movementX', { value: 200 });
      Object.defineProperty(move, 'movementY', { value: 50 });
      document.dispatchEvent(move);
      expect(controller.yaw).toBe(yaw);
    } finally {
      Object.defineProperty(document, 'pointerLockElement', { value: null, configurable: true });
    }
  });

  it('shapeInput sees the manual input, and what it returns drives the controller', () => {
    const seen: { forward: number; strafe: number }[] = [];
    const { controller } = setup({
      shapeInput: (manual) => {
        seen.push({ forward: manual.forward, strafe: manual.strafe });
        return { forward: 0, strafe: 1 };
      },
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
    controls?.update(0.1);
    expect(seen).toEqual([{ forward: 1, strafe: 0 }]);
    // The shaped input (strafe right) moved the child, not the held key (forward).
    expect(controller.position.z).toBeCloseTo(0, 6);
    expect(controller.position.x).toBeLessThan(0);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w' }));
  });
});
