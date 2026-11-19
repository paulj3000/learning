import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConeGeometry, type Group, type Object3D } from 'three';
import { mount, type Harness } from './testing/engineHarness';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import type { ThreeLocationManifest } from './locationManifest';
import type { WorldExtensionContext } from './extensionRegistry';

/** Final D: a change of `prefers-reduced-motion` reaches a running engine, no remount. */

let harness: Harness | null = null;
afterEach(() => {
  harness?.engine.dispose();
  harness = null;
  vi.restoreAllMocks();
});

const PROBE = 'reduced-motion-probe';

function course(): ThreeLocationManifest {
  return {
    ...WELCOME_HARBOR_MANIFEST,
    platforming: {
      platforms: [
        {
          id: 'test-ferry',
          size: { width: 2, height: 0.5, depth: 2 },
          position: { x: 6, y: 0, z: -2 },
          motion: { path: [{ x: 9, y: 0, z: -2 }], speed: 1.5, pauseSeconds: 0 },
        },
      ],
      checkpoints: [],
      hazards: [],
    },
  };
}

function gull(h: Harness): Group {
  let found: Group | undefined;
  h.scene().traverse((node: Object3D) => {
    if (node.children.some((child) => (child as { geometry?: unknown }).geometry instanceof ConeGeometry)) {
      found ??= node as Group;
    }
  });
  if (!found) throw new Error('no gull');
  return found;
}

describe('engine.setReducedMotion (live)', () => {
  it('holds ambient movers still and resumes them, in both directions', () => {
    harness = mount({ manifest: WELCOME_HARBOR_MANIFEST });
    harness.runFrames(5, 1000);
    const flying = gull(harness).position.clone();
    harness.runFrames(5, 1000);
    expect(gull(harness).position.distanceTo(flying)).toBeGreaterThan(0.01);

    harness.engine.setReducedMotion(true);
    harness.runFrames(1, 16);
    const still = gull(harness).position.clone();
    harness.runFrames(10, 1000);
    expect(gull(harness).position.distanceTo(still)).toBeLessThan(1e-9);

    harness.engine.setReducedMotion(false);
    harness.runFrames(10, 1000);
    expect(gull(harness).position.distanceTo(still)).toBeGreaterThan(0.01);
  });

  it('slows moving platforms by the reduced factor and restores full speed', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness = mount({ manifest: course() });
    const [ferry] = harness.engine.platforms();
    harness.runFrames(1);
    const travel = (frames: number) => {
      const before = ferry!.position.x;
      harness!.runFrames(frames, 100);
      return ferry!.position.x - before;
    };
    const normal = travel(4);
    harness.engine.setReducedMotion(true);
    const slow = travel(4);
    expect(normal).toBeGreaterThan(0);
    expect(slow).toBeGreaterThan(0); // still moves: the course stays playable
    expect(slow).toBeLessThan(normal);
    harness.engine.setReducedMotion(false);
  });

  it('leaves movement and colliders alone', () => {
    harness = mount({ manifest: WELCOME_HARBOR_MANIFEST });
    harness.setDrive((controller, delta) => controller.update(delta, { forward: 1, strafe: 0 }));
    harness.runFrames(2);
    const before = harness.engine.childPlacement();
    harness.engine.setReducedMotion(true);
    harness.runFrames(30);
    const after = harness.engine.childPlacement();
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(0.5);
    expect(harness.engine.placeChild({ x: 0, z: -3 })).toBe(true);
  });

  it('reaches an extension through its live context flag, and is ignored once disposed', () => {
    let context: WorldExtensionContext | undefined;
    harness = mount({
      manifest: {
        ...WELCOME_HARBOR_MANIFEST,
        extensions: [{ extensionId: PROBE, config: {} }],
      },
      extensions: [
        {
          id: PROBE,
          mount(ctx) {
            context = ctx;
          },
        },
      ],
    });
    expect(context?.reducedMotion).toBe(false);
    harness.engine.setReducedMotion(true);
    expect(context?.reducedMotion).toBe(true);
    harness.engine.setReducedMotion(false);
    expect(context?.reducedMotion).toBe(false);
    const engine = harness.engine;
    engine.dispose();
    harness = null;
    expect(() => engine.setReducedMotion(true)).not.toThrow();
    expect(context?.reducedMotion).toBe(false);
  });

  it('starts reduced when the option says so, and can be switched off', () => {
    harness = mount({ manifest: WELCOME_HARBOR_MANIFEST, reducedMotion: true });
    harness.runFrames(2, 16);
    const still = gull(harness).position.clone();
    harness.runFrames(10, 1000);
    expect(gull(harness).position.distanceTo(still)).toBeLessThan(1e-9);
    harness.engine.setReducedMotion(false);
    harness.runFrames(10, 1000);
    expect(gull(harness).position.distanceTo(still)).toBeGreaterThan(0.01);
  });
});
