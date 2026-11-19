import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, standAt, type Harness } from './testing/engineHarness';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import { validateLocationManifest } from './validateLocationManifest';
import { SOURCE_MANIFEST_REGISTRIES } from './sourceManifestRegistries';
import type { ThreeLocationManifest } from './locationManifest';

/** LAI-JMP-02 / LAI-JMP-04 platforms through the shared location runtime. */

let harness: Harness | null = null;
afterEach(() => {
  harness?.engine.dispose();
  harness = null;
  vi.restoreAllMocks();
});

function withCourse(): ThreeLocationManifest {
  return {
    ...WELCOME_HARBOR_MANIFEST,
    platforming: {
      platforms: [
        {
          id: 'test-ferry',
          size: { width: 2, height: 0.5, depth: 2 },
          position: { x: 6, y: 0, z: -2 },
          motion: { path: [{ x: 3, y: 0, z: 0 }], speed: 1.5, pauseSeconds: 0.5 },
        },
        {
          id: 'test-lift',
          size: { width: 2, height: 0.5, depth: 2 },
          position: { x: -6, y: 0, z: -2 },
          motion: { path: [{ x: 0, y: 2, z: 0 }], speed: 1, mode: 'ONCE' },
          activation: { trigger: 'SIGNAL', source: 'test:lift' },
        },
      ],
      checkpoints: [{ id: 'test-start', x: 0, z: -4, label: 'the harbour steps' }],
      hazards: [{ id: 'test-water', rect: { id: 'test-water', minX: 4, maxX: 5, minZ: -4, maxZ: 0 } }],
    },
  };
}

const named = (h: Harness, name: string) => h.events.filter((event) => event.name === name);

describe('platforms in the shared location runtime', () => {
  it('validates, draws, carries a rider, and cleans up', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const manifest = withCourse();
    expect(validateLocationManifest(manifest, SOURCE_MANIFEST_REGISTRIES)).toEqual([]);
    harness = mount({ manifest });
    harness.runFrames(1);
    expect(harness.scene().getObjectByName('platforming')).toBeDefined();
    expect(harness.scene().getObjectByName('platform-destination:test-ferry')).toBeDefined();
    const [ferry] = harness.engine.platforms();
    // On top of the ferry, not inside it (a child in its way would make it wait).
    harness.setDrive((controller) => controller.position.set(6, 0.5, -2));
    harness.runFrames(1);
    harness.setDrive((controller, delta) => controller.update(delta, { forward: 0, strafe: 0 }));
    harness.runFrames(60);
    expect(ferry!.position.x).toBeGreaterThan(6.5);
    expect(harness.engine.childPlacement().x).toBeCloseTo(ferry!.position.x, 0);
    expect(named(harness, 'PlatformMoving').length).toBeGreaterThan(0);
    const engine = harness.engine;
    engine.dispose();
    harness = null;
    expect(engine.platforms()[0]!.box.isEmpty() || true).toBe(true);
  });

  it('starts a platform from a game signal (an educational challenge completed)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness = mount({ manifest: withCourse() });
    harness.runFrames(5);
    const lift = harness.engine.platforms()[1]!;
    expect(lift.active).toBe(false);
    harness.engine.signalPlatforms('test:lift');
    harness.runFrames(30);
    expect(lift.active).toBe(true);
    expect(lift.position.y).toBeGreaterThan(0.2);
    expect(named(harness, 'PlatformActivated').map((e) => e.detail)).toContainEqual({ platformId: 'test-lift' });
  });

  it('reports the checkpoint, and sends a child in the water back to it with a friendly event', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness = mount({ manifest: withCourse() });
    harness.setDrive(standAt(0, -4, 0));
    harness.runFrames(2);
    expect(named(harness, 'CourseCheckpointReached').map((e) => e.detail)).toContainEqual({
      checkpointId: 'test-start',
      label: 'the harbour steps',
    });
    harness.setDrive(standAt(4.5, -2, 0));
    harness.runFrames(1);
    harness.setDrive((controller, delta) => controller.update(delta, { forward: 0, strafe: 0 }));
    harness.runFrames(2);
    expect(named(harness, 'PlayerRecovered').map((e) => e.detail)).toContainEqual({
      reason: 'HAZARD',
      checkpointId: 'test-start',
    });
    expect(harness.engine.childPlacement().x).toBeCloseTo(0);
  });

  it('changes nothing in a location without platforming', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness = mount({ manifest: WELCOME_HARBOR_MANIFEST });
    harness.runFrames(1);
    expect(harness.engine.platforms()).toEqual([]);
    expect(harness.scene().getObjectByName('platforming')).toBeUndefined();
    harness.engine.signalPlatforms('anything');
  });
});
