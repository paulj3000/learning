import { Vector2, type WebGLRenderer } from 'three';
import type { FirstPersonController } from './firstPersonController';

export interface PointerControlsOptions {
  /** Fired on the interact key (`E` or `Enter`), desktop only - touch has its own on-screen button. */
  onInteract?: () => void;
}

export interface PointerControls {
  /** Reads this frame's held/dragged input and advances `controller` by `deltaSeconds`. Call once per frame. */
  update(deltaSeconds: number): void;
  dispose(): void;
}

/**
 * Desktop keyboard/mouse (pointer-lock) and tablet/touch movement + look
 * input, wired to a `FirstPersonController`
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
  const onKeyDown = (event: KeyboardEvent) => {
    keysDown.add(event.key.toLowerCase());
    if (event.key.toLowerCase() === 'e' || event.key === 'Enter') {
      options.onInteract?.();
    }
  };
  const onKeyUp = (event: KeyboardEvent) => keysDown.delete(event.key.toLowerCase());
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
    controller.applyLookDelta(event.movementX, event.movementY);
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
        controller.applyLookDelta(dx * 8, dy * 8);
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

  function update(deltaSeconds: number): void {
    const keyboardForward =
      (keysDown.has('w') || keysDown.has('arrowup') ? 1 : 0) -
      (keysDown.has('s') || keysDown.has('arrowdown') ? 1 : 0);
    const keyboardStrafe =
      (keysDown.has('d') || keysDown.has('arrowright') ? 1 : 0) -
      (keysDown.has('a') || keysDown.has('arrowleft') ? 1 : 0);

    controller.update(deltaSeconds, {
      forward: Math.max(-1, Math.min(1, keyboardForward - touchMoveVector.y)),
      strafe: Math.max(-1, Math.min(1, keyboardStrafe + touchMoveVector.x)),
    });
  }

  function dispose(): void {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
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

  return { update, dispose };
}
