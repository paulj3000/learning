import type { WebGLRenderer } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FirstPersonController } from './firstPersonController';
import { attachPointerControls, touchDrag, type PointerControls } from './pointerControls';
import { GAMEPAD_BUTTON_JUMP, GAMEPAD_BUTTON_SPRINT, type GamepadLike } from './gamepadInput';

const FRAME = 1 / 60;
let controls: PointerControls | null = null;

function setup(extra: { lookSensitivity?: () => number } = {}) {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const renderer = { domElement: canvas } as unknown as WebGLRenderer;
  const controller = new FirstPersonController({ acceleration: 1000 });
  const pressJump = vi.spyOn(controller, 'pressJump');
  const onInteract = vi.fn();
  const onToggleCamera = vi.fn();
  controls = attachPointerControls(renderer, controller, { onInteract, onToggleCamera, ...extra });
  return { controller, pressJump, onInteract, onToggleCamera, controls, canvas };
}

function key(type: 'keydown' | 'keyup', init: KeyboardEventInit, target: EventTarget = window) {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  controls?.dispose();
  controls = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('attachPointerControls jump input (LAI-JMP-01)', () => {
  it('Space jumps once and does not scroll the page', () => {
    const { pressJump } = setup();
    const event = key('keydown', { key: ' ', code: 'Space' });
    expect(pressJump).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('holding Space (auto-repeat) never jumps again until it is released', () => {
    const { pressJump } = setup();
    key('keydown', { key: ' ', code: 'Space' });
    key('keydown', { key: ' ', code: 'Space', repeat: true });
    key('keydown', { key: ' ', code: 'Space' });
    expect(pressJump).toHaveBeenCalledTimes(1);
    key('keyup', { key: ' ', code: 'Space' });
    key('keydown', { key: ' ', code: 'Space' });
    expect(pressJump).toHaveBeenCalledTimes(2);
  });

  it('jumps and walks at the same time', () => {
    const { controller, controls: attached } = setup();
    key('keydown', { key: 'w' });
    key('keydown', { key: ' ', code: 'Space' });
    attached.update(FRAME);
    attached.update(FRAME);
    expect(controller.grounded).toBe(false);
    expect(controller.position.z).toBeGreaterThan(0);
  });

  it('leaves Space alone while the child types in a form field', () => {
    const { pressJump, controller, controls: attached } = setup();
    const input = document.createElement('input');
    document.body.appendChild(input);
    const space = key('keydown', { key: ' ', code: 'Space' }, input);
    key('keydown', { key: 'w' }, input);
    attached.update(FRAME);
    expect(pressJump).not.toHaveBeenCalled();
    expect(space.defaultPrevented).toBe(false);
    expect(controller.position.z).toBe(0);
  });

  it('forgets held keys when the window loses focus, so nothing stays stuck', () => {
    const { controller, controls: attached } = setup();
    key('keydown', { key: 'w' });
    window.dispatchEvent(new Event('blur'));
    for (let i = 0; i < 30; i += 1) attached.update(FRAME);
    expect(controller.horizontalSpeed).toBe(0);
  });

  it('resetInput forgets held keys and any buffered jump', () => {
    const { controller, controls: attached } = setup();
    key('keydown', { key: 'w' });
    key('keydown', { key: ' ', code: 'Space' });
    attached.resetInput();
    attached.update(FRAME);
    expect(controller.grounded).toBe(true);
    expect(controller.horizontalSpeed).toBe(0);
    // Space is no longer considered held: the next press jumps.
    key('keydown', { key: ' ', code: 'Space' });
    attached.update(FRAME);
    expect(controller.grounded).toBe(false);
  });

  it('reads a gamepad: left stick moves, A/Cross jumps once per press', () => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
    buttons[GAMEPAD_BUTTON_JUMP] = { pressed: true };
    const gamepad: GamepadLike = {
      connected: true,
      mapping: 'standard',
      axes: [0, -1, 0, 0],
      buttons,
    };
    vi.stubGlobal('navigator', { ...navigator, getGamepads: () => [gamepad] });
    const { controller, pressJump, controls: attached } = setup();
    attached.update(FRAME);
    attached.update(FRAME);
    attached.update(FRAME);
    expect(pressJump).toHaveBeenCalledTimes(1);
    expect(controller.position.z).toBeGreaterThan(0);
    expect(controller.grounded).toBe(false);
  });

  it('works where the Gamepad API is missing', () => {
    vi.stubGlobal('navigator', { ...navigator, getGamepads: undefined });
    const { controls: attached } = setup();
    expect(() => attached.update(FRAME)).not.toThrow();
  });

  it('stops listening once disposed', () => {
    const { pressJump, controls: attached } = setup();
    attached.dispose();
    controls = null;
    key('keydown', { key: ' ', code: 'Space' });
    expect(pressJump).not.toHaveBeenCalled();
  });
});

describe('attachPointerControls camera input (LAI-JMP-01a)', () => {
  it('V switches the camera once per press, not on auto-repeat', () => {
    const { onToggleCamera } = setup();
    key('keydown', { key: 'v' });
    key('keydown', { key: 'v', repeat: true });
    expect(onToggleCamera).toHaveBeenCalledTimes(1);
    key('keyup', { key: 'v' });
    key('keydown', { key: 'V' });
    expect(onToggleCamera).toHaveBeenCalledTimes(2);
  });

  it('V does nothing while the child types in a form field', () => {
    const { onToggleCamera } = setup();
    const input = document.createElement('input');
    document.body.appendChild(input);
    key('keydown', { key: 'v' }, input);
    expect(onToggleCamera).not.toHaveBeenCalled();
  });

  it('the gamepad camera button (Y/Triangle) switches the camera', () => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
    buttons[3] = { pressed: true };
    const gamepad: GamepadLike = {
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons,
    };
    vi.stubGlobal('navigator', { ...navigator, getGamepads: () => [gamepad] });
    const { onToggleCamera, controls: attached } = setup();
    attached.update(FRAME);
    attached.update(FRAME);
    expect(onToggleCamera).toHaveBeenCalledTimes(1);
  });

  it('touch drag on the right half orbits the view, and the move drag stays independent', () => {
    const { controller, canvas, controls: attached } = setup();
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 }) as DOMRect;
    const touch = (id: number, x: number, y: number) =>
      ({ identifier: id, clientX: x, clientY: y }) as Touch;
    const fire = (type: string, touches: Touch[]) => {
      const event = new Event(type) as TouchEvent;
      Object.defineProperty(event, 'changedTouches', { value: touches });
      canvas.dispatchEvent(event);
    };
    fire('touchstart', [touch(1, 50, 200), touch(2, 300, 150)]);
    fire('touchmove', [touch(1, 50, 160), touch(2, 320, 150)]);
    attached.update(FRAME);
    expect(controller.yaw).not.toBe(0);
    expect(controller.position.z).not.toBe(0);
  });

  it('applies the location’s look sensitivity to mouse, touch and stick look', () => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
    const gamepad: GamepadLike = {
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 1, 0],
      buttons,
    };
    vi.stubGlobal('navigator', { ...navigator, getGamepads: () => [gamepad] });
    const usual = setup();
    usual.controls.update(0.1);
    const normalYaw = usual.controller.yaw;
    usual.controls.dispose();
    controls = null;
    const doubled = setup({ lookSensitivity: () => 2 });
    doubled.controls.update(0.1);
    expect(doubled.controller.yaw).toBeCloseTo(normalYaw * 2);
  });
});

describe('attachPointerControls running & sprinting', () => {
  function sprintSetup(mode: 'hold' | 'toggle' = 'hold') {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 }) as DOMRect;
    const renderer = { domElement: canvas } as unknown as WebGLRenderer;
    const controller = new FirstPersonController();
    controls = attachPointerControls(renderer, controller, { sprintMode: () => mode });
    return { controller, controls, canvas };
  }
  const settle = (attached: PointerControls, seconds = 1) => {
    for (let i = 0; i < Math.round(seconds * 60); i += 1) attached.update(FRAME);
  };

  it('holding Shift sprints, letting go walks again', () => {
    const { controller, controls: attached } = sprintSetup();
    key('keydown', { key: 'w' });
    key('keydown', { key: 'Shift' });
    settle(attached, 1.5);
    expect(controller.gait).toBe('sprint');
    key('keyup', { key: 'Shift' });
    settle(attached, 1.5);
    expect(controller.gait).toBe('walk');
  });

  it('in toggle mode, a Shift press switches sprint on and another switches it off', () => {
    const { controller, controls: attached } = sprintSetup('toggle');
    key('keydown', { key: 'w' });
    key('keydown', { key: 'Shift' });
    key('keyup', { key: 'Shift' });
    settle(attached, 1.5);
    expect(controller.gait).toBe('sprint');
    key('keydown', { key: 'Shift' });
    key('keyup', { key: 'Shift' });
    settle(attached, 1.5);
    expect(controller.gait).toBe('walk');
  });

  it('a toggled sprint ends when the child stops', () => {
    const { controller, controls: attached } = sprintSetup('toggle');
    key('keydown', { key: 'w' });
    key('keydown', { key: 'Shift' });
    settle(attached, 1);
    key('keyup', { key: 'w' });
    settle(attached, 0.5);
    key('keydown', { key: 'w' });
    settle(attached, 1.5);
    expect(controller.gait).toBe('walk');
  });

  it('Shift while typing does nothing', () => {
    const { controller, controls: attached } = sprintSetup('toggle');
    const input = document.createElement('input');
    document.body.appendChild(input);
    key('keydown', { key: 'Shift' }, input);
    key('keydown', { key: 'w' });
    settle(attached, 1.5);
    expect(controller.gait).toBe('walk');
  });

  it('losing focus, or a panel opening (resetInput), ends a sprint', () => {
    const { controller, controls: attached } = sprintSetup('toggle');
    key('keydown', { key: 'w' });
    key('keydown', { key: 'Shift' });
    settle(attached, 1);
    window.dispatchEvent(new Event('blur'));
    key('keydown', { key: 'w' });
    settle(attached, 1.5);
    expect(controller.gait).toBe('walk');
    key('keydown', { key: 'Shift' });
    settle(attached, 1);
    attached.resetInput();
    key('keydown', { key: 'w' });
    settle(attached, 1.5);
    expect(controller.gait).toBe('walk');
  });

  it('maps the move drag: 40 px walks as before, 60 px runs, past 72 px sprints', () => {
    expect(Math.hypot(touchDrag(40, 0).x, touchDrag(40, 0).y)).toBeCloseTo(0.8);
    expect(Math.hypot(touchDrag(0, 20).x, touchDrag(0, 20).y)).toBeCloseTo(0.4);
    expect(touchDrag(60, 0).x).toBeCloseTo(1);
    expect(touchDrag(100, 0).x).toBeCloseTo(1);
    expect(touchDrag(71, 0).sprint).toBe(false);
    expect(touchDrag(72, 0).sprint).toBe(true);
    expect(touchDrag(0, 0)).toEqual({ x: 0, y: 0, sprint: false });
  });

  it('a short drag walks, a long drag runs, a drag past the edge sprints, and jumping still works', () => {
    const { controller, controls: attached, canvas } = sprintSetup();
    const touch = (x: number, y: number) => ({ identifier: 1, clientX: x, clientY: y }) as Touch;
    const fire = (type: string, at: Touch) => {
      const event = new Event(type) as TouchEvent;
      Object.defineProperty(event, 'changedTouches', { value: [at] });
      canvas.dispatchEvent(event);
    };
    fire('touchstart', touch(100, 200));
    fire('touchmove', touch(100, 170)); // 30 px: walking
    settle(attached);
    expect(controller.gait).toBe('walk');
    fire('touchmove', touch(100, 140)); // 60 px: running
    settle(attached);
    expect(controller.gait).toBe('run');
    fire('touchmove', touch(100, 110)); // 90 px: sprinting
    controller.pressJump();
    settle(attached, 0.1);
    expect(controller.grounded).toBe(false);
    settle(attached, 1.5);
    expect(controller.gait).toBe('sprint');
    fire('touchend', touch(100, 110));
    settle(attached, 0.5);
    expect(controller.gait).toBe('idle');
  });

  it('a gamepad stick walks when partly tilted, runs fully tilted, and L3 sprints until the child stops', () => {
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
    const gamepad = { connected: true, mapping: 'standard', axes: [0, -0.55, 0, 0], buttons };
    vi.stubGlobal('navigator', { ...navigator, getGamepads: () => [gamepad] });
    const { controller, controls: attached } = sprintSetup();
    settle(attached);
    expect(controller.gait).toBe('walk');
    gamepad.axes = [0, -1, 0, 0];
    settle(attached);
    expect(controller.gait).toBe('run');
    buttons[GAMEPAD_BUTTON_SPRINT] = { pressed: true };
    attached.update(FRAME);
    buttons[GAMEPAD_BUTTON_SPRINT] = { pressed: false };
    settle(attached, 1.5);
    expect(controller.gait).toBe('sprint');
    gamepad.axes = [0, 0, 0, 0];
    settle(attached, 0.5);
    gamepad.axes = [0, -1, 0, 0];
    settle(attached, 1.5);
    expect(controller.gait).toBe('run');
  });
});
