/**
 * Gamepad input for the shared movement controls (LAI-JMP-01), as pure math
 * over the browser's `Gamepad` snapshot so it is testable without hardware.
 *
 * Standard mapping (https://w3c.github.io/gamepad/#remapping), which every
 * mainstream controller reports in the browser:
 * - left stick: move; right stick: look;
 * - button 0 (A on Xbox, Cross on PlayStation): jump;
 * - button 2 (X on Xbox, Square on PlayStation): interact;
 * - button 3 (Y on Xbox, Triangle on PlayStation): switch camera perspective;
 * - button 10 (L3, pressing the left stick): sprint on or off;
 * - the left stick's tilt sets the speed: partly tilted walks, fully tilted runs.
 *
 * Every button is rebindable through `GamepadBindings`.
 *
 * Buttons are edge-triggered: holding A jumps once.
 */

/** The parts of `Gamepad` this reads. */
export interface GamepadLike {
  readonly connected: boolean;
  readonly mapping?: string;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean }[];
}

export const GAMEPAD_BUTTON_JUMP = 0;
export const GAMEPAD_BUTTON_INTERACT = 2;
/** LAI-JMP-01a: Y (Xbox) / Triangle (PlayStation) switches first- and third-person. */
export const GAMEPAD_BUTTON_CAMERA = 3;
/** Running & sprinting: L3 (press the left stick) switches sprint on until pressed again or stopped. */
export const GAMEPAD_BUTTON_SPRINT = 10;

/** Which standard-mapping button does what. Change one entry to rebind it. */
export interface GamepadBindings {
  jump: number;
  interact: number;
  cameraToggle: number;
  sprint: number;
}

export const DEFAULT_GAMEPAD_BINDINGS: Readonly<GamepadBindings> = Object.freeze({
  jump: GAMEPAD_BUTTON_JUMP,
  interact: GAMEPAD_BUTTON_INTERACT,
  cameraToggle: GAMEPAD_BUTTON_CAMERA,
  sprint: GAMEPAD_BUTTON_SPRINT,
});
/** Stick travel ignored around the centre, so a worn stick does not drift. */
export const GAMEPAD_DEADZONE = 0.2;
/** Look speed at full right-stick deflection, in the same units as a mouse's movementX per second. */
export const GAMEPAD_LOOK_SPEED = 900;

export interface GamepadFrame {
  /** -1 (back) to 1 (forward). */
  forward: number;
  /** -1 (left) to 1 (right). */
  strafe: number;
  /** Look delta for this frame, in mouse-movement units. */
  lookX: number;
  lookY: number;
  /** Jump was pressed since the last frame. */
  jumpPressed: boolean;
  /** Interact was pressed since the last frame. */
  interactPressed: boolean;
  /** The camera-perspective button was pressed since the last frame. */
  cameraTogglePressed: boolean;
  /** The sprint button was pressed since the last frame. */
  sprintPressed: boolean;
}

export const NO_GAMEPAD_INPUT: GamepadFrame = Object.freeze({
  forward: 0,
  strafe: 0,
  lookX: 0,
  lookY: 0,
  jumpPressed: false,
  interactPressed: false,
  cameraTogglePressed: false,
  sprintPressed: false,
});

/** Rescales a stick axis so the deadzone edge is 0 and full travel stays 1. */
export function applyDeadzone(value: number, deadzone = GAMEPAD_DEADZONE): number {
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  const scaled = (Math.min(1, magnitude) - deadzone) / (1 - deadzone);
  return Math.sign(value) * scaled;
}

function isPressed(pad: GamepadLike, index: number): boolean {
  return pad.buttons[index]?.pressed === true;
}

/**
 * Reads every connected pad each frame and remembers which buttons were down,
 * so a press is reported once. `reset()` forgets held buttons (focus lost), so
 * a button still held when the child comes back does not count as a new press
 * until it is released and pressed again.
 */
export class GamepadReader {
  private held = new Set<string>();
  private suppressed = new Set<string>();

  private readonly bindings: Readonly<GamepadBindings>;

  constructor(bindings: Readonly<GamepadBindings> = DEFAULT_GAMEPAD_BINDINGS) {
    this.bindings = bindings;
  }

  read(pads: readonly (GamepadLike | null)[], deltaSeconds: number): GamepadFrame {
    let forward = 0;
    let strafe = 0;
    let lookX = 0;
    let lookY = 0;
    let jumpPressed = false;
    let interactPressed = false;
    let cameraTogglePressed = false;
    let sprintPressed = false;
    const { jump, interact, cameraToggle, sprint } = this.bindings;
    const nowHeld = new Set<string>();

    pads.forEach((pad, padIndex) => {
      if (!pad || !pad.connected) return;
      const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
      strafe += applyDeadzone(lx);
      // Stick up is negative on the standard mapping, and up means forward.
      forward -= applyDeadzone(ly);
      lookX += applyDeadzone(rx) * GAMEPAD_LOOK_SPEED * deltaSeconds;
      lookY += applyDeadzone(ry) * GAMEPAD_LOOK_SPEED * deltaSeconds;
      for (const button of new Set([jump, interact, cameraToggle, sprint])) {
        if (!isPressed(pad, button)) continue;
        const key = `${padIndex}:${button}`;
        nowHeld.add(key);
        if (this.held.has(key) || this.suppressed.has(key)) continue;
        if (button === jump) jumpPressed = true;
        if (button === interact) interactPressed = true;
        if (button === cameraToggle) cameraTogglePressed = true;
        if (button === sprint) sprintPressed = true;
      }
    });

    // A suppressed button counts again once it has been let go.
    for (const key of this.suppressed) if (!nowHeld.has(key)) this.suppressed.delete(key);
    this.held = nowHeld;
    return {
      forward: clampUnit(forward),
      strafe: clampUnit(strafe),
      lookX,
      lookY,
      jumpPressed,
      interactPressed,
      cameraTogglePressed,
      sprintPressed,
    };
  }

  reset(): void {
    for (const key of this.held) this.suppressed.add(key);
    this.held = new Set();
  }
}

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}
