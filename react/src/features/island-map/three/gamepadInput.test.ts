import { describe, expect, it } from 'vitest';
import {
  applyDeadzone,
  GAMEPAD_BUTTON_INTERACT,
  GAMEPAD_BUTTON_JUMP,
  GamepadReader,
  type GamepadLike,
} from './gamepadInput';

function pad(
  options: { axes?: number[]; pressed?: number[]; connected?: boolean } = {},
): GamepadLike {
  const pressed = new Set(options.pressed ?? []);
  return {
    connected: options.connected ?? true,
    mapping: 'standard',
    axes: options.axes ?? [0, 0, 0, 0],
    buttons: Array.from({ length: 16 }, (_, index) => ({ pressed: pressed.has(index) })),
  };
}

describe('gamepad input (LAI-JMP-01)', () => {
  it('ignores stick travel inside the deadzone and rescales the rest', () => {
    expect(applyDeadzone(0.1)).toBe(0);
    expect(applyDeadzone(-0.2)).toBe(0);
    expect(applyDeadzone(1)).toBe(1);
    expect(applyDeadzone(-1)).toBe(-1);
    expect(applyDeadzone(0.6)).toBeCloseTo(0.5);
    expect(applyDeadzone(Number.NaN)).toBe(0);
  });

  it('maps the left stick to movement (up is forward) and the right stick to look', () => {
    const frame = new GamepadReader().read([pad({ axes: [1, -1, 1, 0] })], 0.5);
    expect(frame.forward).toBe(1);
    expect(frame.strafe).toBe(1);
    expect(frame.lookX).toBeGreaterThan(0);
    expect(frame.lookY).toBe(0);
  });

  it('jumps once per press of A/Cross, however long it is held', () => {
    const reader = new GamepadReader();
    const held = [pad({ pressed: [GAMEPAD_BUTTON_JUMP] })];
    expect(reader.read(held, 0.016).jumpPressed).toBe(true);
    expect(reader.read(held, 0.016).jumpPressed).toBe(false);
    expect(reader.read(held, 0.016).jumpPressed).toBe(false);
    expect(reader.read([pad()], 0.016).jumpPressed).toBe(false);
    expect(reader.read(held, 0.016).jumpPressed).toBe(true);
  });

  it('reports interact on X/Square, separately from jump', () => {
    const frame = new GamepadReader().read([pad({ pressed: [GAMEPAD_BUTTON_INTERACT] })], 0.016);
    expect(frame.interactPressed).toBe(true);
    expect(frame.jumpPressed).toBe(false);
  });

  it('after reset, a button still held does not count until released and pressed again', () => {
    const reader = new GamepadReader();
    const held = [pad({ pressed: [GAMEPAD_BUTTON_JUMP] })];
    reader.read(held, 0.016);
    reader.reset();
    expect(reader.read(held, 0.016).jumpPressed).toBe(false);
    reader.read([pad()], 0.016);
    expect(reader.read(held, 0.016).jumpPressed).toBe(true);
  });

  it('skips disconnected pads and empty slots', () => {
    const frame = new GamepadReader().read(
      [null, pad({ connected: false, axes: [1, 1, 1, 1], pressed: [GAMEPAD_BUTTON_JUMP] })],
      0.016,
    );
    expect(frame).toMatchObject({ forward: 0, strafe: 0, jumpPressed: false });
  });
});
