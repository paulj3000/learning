import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MoveInput } from '@lai/game-engine/movement';
import { manifestSpawnPoint } from './manifestWalkability';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import { mount, named, type Harness } from './testing/engineHarness';

/**
 * LAI-2104S B1 through the shared location runtime: the profile's `guidedSteering` (Sprouts)
 * selects the tap-to-move mode; every other band is exactly as before.
 */

let harness: Harness | null = null;
afterEach(() => {
  harness?.engine.dispose();
  harness = null;
  vi.restoreAllMocks();
});

const IDLE: MoveInput = { forward: 0, strafe: 0 };

function sprouts(): Harness {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  harness = mount({ ageBand: 'SPROUT', cameraMode: 'first-person' });
  return harness;
}

/** Drives the controller the way pointer controls do: manual input through `shapeInput`. */
function driveLikePointerControls(h: Harness, manual: () => MoveInput = () => IDLE) {
  h.setDrive((controller, delta) => {
    const shaped = h.attached?.shapeInput?.(manual(), delta) ?? manual();
    controller.update(delta, shaped);
  });
}

describe('guided mode selection by age band', () => {
  it('Sprouts get guided mode: no free look, taps, an assisted third-person camera', async () => {
    const h = sprouts();
    await h.engine.ready;
    expect(h.engine.guided).toBe(true);
    expect(h.attached?.freeLook).toBe(false);
    expect(h.attached?.onTap).toBeTypeOf('function');
    expect(h.attached?.shapeInput).toBeTypeOf('function');
    // Third person only, whatever perspective was saved; the HUD switch has nothing to offer.
    expect(h.engine.camera.allowModeSwitch).toBe(false);
    expect(h.engine.cameraMode()).toBe('third-person');
    expect(h.engine.setCameraMode('first-person')).toBe(false);
  });

  it.each(['PATHFINDER', 'EXPLORER'] as const)(
    '%s keeps today’s controls exactly',
    async (band) => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      harness = mount({ ageBand: band, cameraMode: 'first-person' });
      const h = harness;
      await h.engine.ready;
      expect(h.engine.guided).toBe(false);
      expect(h.attached?.freeLook).toBeUndefined();
      expect(h.attached?.onTap).toBeUndefined();
      expect(h.attached?.shapeInput).toBeUndefined();
      expect(h.engine.walkTo(0, 0)).toBe(false);
    },
  );

  it('no age band at all (every existing caller) is not guided', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness = mount({ cameraMode: 'first-person' });
    await harness.engine.ready;
    expect(harness.engine.guided).toBe(false);
    expect(harness.attached?.freeLook).toBeUndefined();
    expect(harness.engine.cameraMode()).toBe('first-person');
  });
});

describe('guided walking in Welcome Harbor', () => {
  const spawn = manifestSpawnPoint(WELCOME_HARBOR_MANIFEST);

  it('walks to a ground point on walking links: no jump, no fall, and arrives', async () => {
    const h = sprouts();
    await h.engine.ready;
    driveLikePointerControls(h);
    h.runFrames(2);
    const target = { x: spawn.x + 5, z: spawn.z - 4 };
    expect(h.engine.walkTo(target.x, target.z)).toBe(true);
    h.runFrames(60 * 8, 16);
    const at = h.engine.childPlacement();
    expect(Math.hypot(at.x - target.x, at.z - target.z)).toBeLessThan(0.6);
    expect(named(h.events, 'PlayerJumped')).toHaveLength(0);
    expect(named(h.events, 'PlayerRecovered')).toHaveLength(0);
  });

  it('turns the view behind the child as they walk, and keeps the look level (no free look)', async () => {
    const h = sprouts();
    await h.engine.ready;
    driveLikePointerControls(h);
    h.runFrames(2);
    const before = h.engine.childPlacement().yaw;
    // Walk toward -X: the heading is far from the spawn yaw.
    h.engine.walkTo(spawn.x - 6, spawn.z);
    h.runFrames(60, 16);
    const after = h.engine.childPlacement().yaw;
    expect(Math.abs(after - before)).toBeGreaterThan(0.5);
  });

  it('a joystick or key push overrides and cancels the walk', async () => {
    const h = sprouts();
    await h.engine.ready;
    let push: MoveInput = IDLE;
    driveLikePointerControls(h, () => push);
    h.runFrames(2);
    h.engine.walkTo(spawn.x + 6, spawn.z);
    h.runFrames(20, 16);
    const mid = h.engine.childPlacement();
    expect(mid.x).toBeGreaterThan(spawn.x + 0.2);
    // The child pushes back the other way: the walk stops steering, the push wins.
    push = { forward: -1, strafe: 0 };
    h.runFrames(45, 16);
    const later = h.engine.childPlacement();
    push = IDLE;
    h.runFrames(120, 16);
    const settled = h.engine.childPlacement();
    // Released: the walk does not resume toward the old goal.
    expect(Math.hypot(settled.x - later.x, settled.z - later.z)).toBeLessThan(1.5);
    expect(settled.x).toBeLessThan(spawn.x + 6 - 1);
  });

  it('a panel opening (resetInput) cancels the walk', async () => {
    const h = sprouts();
    await h.engine.ready;
    driveLikePointerControls(h);
    h.runFrames(2);
    h.engine.walkTo(spawn.x + 6, spawn.z);
    h.runFrames(10, 16);
    h.engine.resetInput();
    const stopped = h.engine.childPlacement();
    h.runFrames(60, 16);
    const later = h.engine.childPlacement();
    expect(Math.hypot(later.x - stopped.x, later.z - stopped.z)).toBeLessThan(0.5);
  });

  it('a tap on the canvas starts a walk', async () => {
    const h = sprouts();
    await h.engine.ready;
    driveLikePointerControls(h);
    h.runFrames(2);
    vi.spyOn(h.renderer.domElement, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const start = h.engine.childPlacement();
    // Below the screen centre: the ground in front of the child.
    h.attached?.onTap?.({ clientX: 400, clientY: 520 });
    h.runFrames(90, 16);
    const end = h.engine.childPlacement();
    expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeGreaterThan(0.5);
  });

  it('the Jump button still hops in place; a walk never jumps by itself', async () => {
    const h = sprouts();
    await h.engine.ready;
    driveLikePointerControls(h);
    h.runFrames(30);
    h.engine.pressJump();
    h.runFrames(40);
    expect(named(h.events, 'PlayerJumped')).toHaveLength(1);
  });
});
