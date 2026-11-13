import { Vector2, type WebGLRenderer } from 'three';
import type { FirstPersonController } from './firstPersonController';
import {
  GamepadReader,
  NO_GAMEPAD_INPUT,
  type GamepadBindings,
  type GamepadLike,
} from './gamepadInput';

export interface PointerControlsOptions {
  /** Fired on the interact key (`E` or `Enter`), desktop only - touch has its own on-screen button. */
  onInteract?: () => void;
  /** LAI-JMP-01a: fired on V or the gamepad camera button; the HUD has its own button. */
  onToggleCamera?: () => void;
  /** Gamepad button mapping. Defaults to `DEFAULT_GAMEPAD_BINDINGS`. */
  gamepadBindings?: GamepadBindings;
  /**
   * Multiplier on mouse, touch and right-stick look speed (a location's
   * `player.camera.rotationSensitivity`). Defaults to 1.
   */
  lookSensitivity?: () => number;
}

const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ']);

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

export interface PointerControls {
  /** Reads this frame's held/dragged input and advances `controller` by `deltaSeconds`. Call once per frame. */
  update(deltaSeconds: number): void;
  /**
   * Forgets every held key, drag and button (LAI-JMP-01), so nothing stays
   * stuck down when the window loses focus, the tab is hidden or a panel
   * opens over the scene. A key still held afterwards does nothing until it
   * is pressed again.
   */
  resetInput(): void;
  dispose(): void;
}

/** The keys that jump. Space only; `event.code` too, for layouts where `key` differs. */
function isJumpKey(event: KeyboardEvent): boolean {
  return event.key === ' ' || event.code === 'Space';
}

/** Connected pads, or none where the Gamepad API is missing (jsdom, old browsers). */
function readGamepads(): readonly (GamepadLike | null)[] {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
  try {
    return navigator.getGamepads();
  } catch {
    // Some browsers throw when a permissions policy blocks gamepads.
    return [];
  }
}

/**
 * Desktop keyboard/mouse (pointer-lock), tablet/touch and gamepad movement +
 * look input, wired to a `FirstPersonController`. Space (or gamepad A/Cross)
 * jumps (LAI-JMP-01); the on-screen Jump button lives in the HUD and reaches
 * the same `controller.pressJump()` through the engine handle
 * (`docs/ROADMAP.md` Phase 31: "desktop keyboard/mouse (pointer-lock) and
 * tablet/touch movement and look controls").
 *
 * Extracted at Phase 32 from the sandbox's inline listeners
 * (`sandboxScene.ts`) so Welcome Harbor's scene (`welcomeHarborScene.ts`)
 * does not duplicate the same ~90 lines of DOM wiring for a second region -
 * both now call this. The comfort tuning itself (eased acceleration, no
 * instant snaps) lives in `firstPersonController.ts` either way; this file
 * only turns raw browser input into that controller's per-frame calls.
 * Untested like every other `three`-touching glue file in this directory -
 * it needs a real DOM/pointer-lock context to exercise meaningfully, and
 * the math it delegates to (`FirstPersonController.update`/
 * `applyLookDelta`) is tested independently.
 */
export function attachPointerControls(
  renderer: WebGLRenderer,
  controller: FirstPersonController,
  options: PointerControlsOptions = {},
): PointerControls {
  const keysDown = new Set<string>();
  const gamepads = new GamepadReader(options.gamepadBindings);
  const sensitivity = () => {
    const value = options.lookSensitivity?.() ?? 1;
    return Number.isFinite(value) && value > 0 ? value : 1;
  };
  /** Every look delta goes through here, so the location's sensitivity applies to all of them. */
  const look = (dx: number, dy: number) => {
    const scale = sensitivity();
    controller.applyLookDelta(dx * scale, dy * scale);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    // Typing in a form field (an adventure's number input, a story answer) is
    // typing, not playing: no movement, no jump, no interact, and the page
    // keeps its usual Space and arrow behaviour there.
    if (isEditableTarget(event.target)) return;
    // Arrow keys and space move the player, so stop them also scrolling the page.
    if (SCROLL_KEYS.has(event.key)) {
      event.preventDefault();
    }
    const key = event.key.toLowerCase();
    // One jump per press: a held key's auto-repeat, or a key already down, never jumps again.
    if (isJumpKey(event) && !event.repeat && !keysDown.has(' ')) {
      controller.pressJump();
    }
    keysDown.add(isJumpKey(event) ? ' ' : key);
    if (key === 'e' || event.key === 'Enter') {
      options.onInteract?.();
    }
    // One switch per press: auto-repeat on a held V does not flip the view back and forth.
    if (key === 'v' && !event.repeat) {
      options.onToggleCamera?.();
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    keysDown.delete(isJumpKey(event) ? ' ' : event.key.toLowerCase());
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  const onPointerLockClick = () => {
    if (document.pointerLockElement !== renderer.domElement) {
      void renderer.domElement.requestPointerLock();
    }
  };
  renderer.domElement.addEventListener('click', onPointerLockClick);

  const onMouseMove = (event: MouseEvent) => {
    if (document.pointerLockElement !== renderer.domElement) return;
    look(event.movementX, event.movementY);
  };
  document.addEventListener('mousemove', onMouseMove);

  // Minimal two-zone touch controls: left half of the canvas drags a move
  // vector, right half drags the look direction, tuned for comfort (no
  // instant snaps - movement still runs through the same eased controller).
  const touchMoveVector = new Vector2(0, 0);
  let moveTouchId: number | null = null;
  let moveTouchStart = new Vector2(0, 0);
  let lookTouchId: number | null = null;
  let lookTouchLast = new Vector2(0, 0);

  const onTouchStart = (event: TouchEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    for (const touch of Array.from(event.changedTouches)) {
      const x = touch.clientX - rect.left;
      const isLeftHalf = x < rect.width / 2;
      if (isLeftHalf && moveTouchId === null) {
        moveTouchId = touch.identifier;
        moveTouchStart = new Vector2(touch.clientX, touch.clientY);
      } else if (!isLeftHalf && lookTouchId === null) {
        lookTouchId = touch.identifier;
        lookTouchLast = new Vector2(touch.clientX, touch.clientY);
      }
    }
  };
  const onTouchMove = (event: TouchEvent) => {
    for (const touch of Array.from(event.changedTouches)) {
      if (touch.identifier === moveTouchId) {
        const dx = touch.clientX - moveTouchStart.x;
        const dy = touch.clientY - moveTouchStart.y;
        const maxRadius = 40;
        touchMoveVector.set(
          Math.max(-1, Math.min(1, dx / maxRadius)),
          Math.max(-1, Math.min(1, dy / maxRadius)),
        );
      } else if (touch.identifier === lookTouchId) {
        const dx = touch.clientX - lookTouchLast.x;
        const dy = touch.clientY - lookTouchLast.y;
        look(dx * 8, dy * 8);
        lookTouchLast = new Vector2(touch.clientX, touch.clientY);
      }
    }
  };
  const onTouchEnd = (event: TouchEvent) => {
    for (const touch of Array.from(event.changedTouches)) {
      if (touch.identifier === moveTouchId) {
        moveTouchId = null;
        touchMoveVector.set(0, 0);
      } else if (touch.identifier === lookTouchId) {
        lookTouchId = null;
      }
    }
  };
  renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: true });
  renderer.domElement.addEventListener('touchmove', onTouchMove, { passive: true });
  renderer.domElement.addEventListener('touchend', onTouchEnd, { passive: true });
  renderer.domElement.addEventListener('touchcancel', onTouchEnd, { passive: true });

  function resetInput(): void {
    keysDown.clear();
    moveTouchId = null;
    lookTouchId = null;
    touchMoveVector.set(0, 0);
    gamepads.reset();
    controller.clearJumpInput();
  }
  // A key released while another window had focus never sends keyup here.
  const onBlur = () => resetInput();
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') resetInput();
  };
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibilityChange);

  function update(deltaSeconds: number): void {
    const keyboardForward =
      (keysDown.has('w') || keysDown.has('arrowup') ? 1 : 0) -
      (keysDown.has('s') || keysDown.has('arrowdown') ? 1 : 0);
    const keyboardStrafe =
      (keysDown.has('d') || keysDown.has('arrowright') ? 1 : 0) -
      (keysDown.has('a') || keysDown.has('arrowleft') ? 1 : 0);

    const pads = readGamepads();
    const pad = pads.length > 0 ? gamepads.read(pads, deltaSeconds) : NO_GAMEPAD_INPUT;
    if (pad.lookX !== 0 || pad.lookY !== 0) look(pad.lookX, pad.lookY);
    if (pad.jumpPressed) controller.pressJump();
    if (pad.interactPressed) options.onInteract?.();
    if (pad.cameraTogglePressed) options.onToggleCamera?.();

    controller.update(deltaSeconds, {
      forward: Math.max(-1, Math.min(1, keyboardForward - touchMoveVector.y + pad.forward)),
      strafe: Math.max(-1, Math.min(1, keyboardStrafe + touchMoveVector.x + pad.strafe)),
    });
  }

  function dispose(): void {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    document.removeEventListener('mousemove', onMouseMove);
    renderer.domElement.removeEventListener('click', onPointerLockClick);
    renderer.domElement.removeEventListener('touchstart', onTouchStart);
    renderer.domElement.removeEventListener('touchmove', onTouchMove);
    renderer.domElement.removeEventListener('touchend', onTouchEnd);
    renderer.domElement.removeEventListener('touchcancel', onTouchEnd);
    if (document.pointerLockElement === renderer.domElement) {
      document.exitPointerLock();
    }
  }

  return { update, resetInput, dispose };
}
