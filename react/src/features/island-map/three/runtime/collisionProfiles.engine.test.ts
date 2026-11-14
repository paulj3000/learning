import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Harness } from './testing/engineHarness';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import type { CollisionProfile, CollisionProfiles } from './collisionProfile';
import type { ThreeLocationManifest } from './locationManifest';

/** Asset Manager collision profiles applied by the shared location runtime. */

let harness: Harness | null = null;
afterEach(() => {
  harness?.engine.dispose();
  harness = null;
  vi.restoreAllMocks();
});

const STATUE: CollisionProfile = {
  behavior: 'SOLID',
  shape: 'BOX',
  boxes: [{ minX: -0.5, minY: 0, minZ: -0.5, maxX: 0.5, maxY: 2, maxZ: 0.5 }],
};

function withPieces(): ThreeLocationManifest {
  return {
    ...WELCOME_HARBOR_MANIFEST,
    scenery: [
      ...WELCOME_HARBOR_MANIFEST.scenery,
      { kind: 'CLUSTER', id: 'test-crates', assetId: 'crate', positions: [{ x: 4, z: -4 }] },
      { kind: 'CLUSTER', id: 'test-statues', assetId: 'statue-x', positions: [{ x: -4, z: -4 }, { x: -6, z: -4 }] },
    ],
  };
}

describe('collision profiles in the location runtime', () => {
  it('asks once for the location\'s asset ids, then swaps the derived boxes for the profiles', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let answer!: (profiles: CollisionProfiles) => void;
    const collisionProfiles = vi.fn(
      (_ids: readonly string[]) => new Promise<CollisionProfiles>((resolve) => (answer = resolve)),
    );
    harness = mount({ manifest: withPieces(), collisionProfiles });
    expect(collisionProfiles).toHaveBeenCalledTimes(1);
    const ids = collisionProfiles.mock.calls[0]![0];
    expect(ids).toContain('crate');
    expect(ids).toContain('statue-x');

    // Before the answer: the crate's built-in default blocks, the unknown statue does not.
    expect(harness.engine.placeChild({ x: 4, z: -4 })).toBe(false);
    expect(harness.engine.placeChild({ x: -6, z: -4 })).toBe(true);
    // The child now stands where the second statue's profile box will go.

    answer(
      new Map<string, CollisionProfile>([
        ['crate', { behavior: 'DECORATIVE', shape: 'NONE', boxes: [] }],
        ['statue-x', STATUE],
      ]),
    );
    await harness.engine.ready;

    expect(harness.engine.placeChild({ x: 4, z: -4 })).toBe(true); // decorative: walk through
    expect(harness.engine.placeChild({ x: -4, z: -4 })).toBe(false); // the statue's profile blocks
    // The box that would have landed on the child was left out, so they could walk away.
    expect(harness.engine.placeChild({ x: -6, z: -4 })).toBe(true);
  });

  it('keeps the built-in defaults when the resolver has no profiles or fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness = mount({
      manifest: withPieces(),
      collisionProfiles: () => Promise.reject(new Error('offline')),
    });
    await harness.engine.ready;
    expect(harness.engine.placeChild({ x: 4, z: -4 })).toBe(false);
  });
});
