import type { WebGLRenderer } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FirstPersonController } from './firstPersonController';
import { attachPointerControls, type PointerControls } from './pointerControls';
import { GAMEPAD_BUTTON_JUMP, type GamepadLike } from './gamepadInput';

const FRAME = 1 / 60;
let controls: PointerControls | null = null;

function setup() {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const renderer = { domElement: canvas } as unknown as WebGLRenderer;
  const controller = new FirstPersonController({ acceleration: 1000 });
  const pressJump = vi.spyOn(controller, 'pressJump');
  const onInteract = vi.fn();
  controls = attachPointerControls(renderer, controller, { onInteract });
  return { controller, pressJump, onInteract, controls };
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
