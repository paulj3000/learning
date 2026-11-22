import { describe, expect, it } from 'vitest';
import { SOURCE_MANIFEST_REGISTRIES } from './sourceManifestRegistries';
import { validateLocationManifest } from './validateLocationManifest';
import type { ThreeLocationManifest } from './locationManifest';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';

/**
 * `entryRequirements` is validated like any other requirement list (`checkRequirements`): every
 * item and discovery reference must name a real one, so a typo there can never leave a place
 * silently open or permanently shut. World-change keys are free strings (authored per adventure,
 * no registry yet), so only their shape is typed. Optional, so absent is valid and every existing
 * region (none of which has one) is unaffected.
 */
const withGate = (
  entryRequirements: ThreeLocationManifest['entryRequirements'],
): ThreeLocationManifest => ({ ...WELCOME_HARBOR_MANIFEST, entryRequirements });

const issuesAt = (manifest: ThreeLocationManifest) =>
  validateLocationManifest(manifest, SOURCE_MANIFEST_REGISTRIES).filter((issue) =>
    issue.path.startsWith('entryRequirements'),
  );

describe('entryRequirements validation', () => {
  it('is optional: absent and empty are valid', () => {
    expect(issuesAt(withGate(undefined))).toEqual([]);
    expect(issuesAt(withGate([]))).toEqual([]);
  });

  it('accepts the always-true and world-change requirements', () => {
    expect(issuesAt(withGate([{ type: 'ALWAYS' }]))).toEqual([]);
    expect(
      issuesAt(
        withGate([{ type: 'WORLD_CHANGE_PRESENT', changeKey: 'THE_CASTLES_SECRET_DOOR_COMPLETE' }]),
      ),
    ).toEqual([]);
  });

  it('reports an unknown item or discovery, with the path of the bad entry', () => {
    const bad = withGate([
      { type: 'ALWAYS' },
      { type: 'ITEM_OWNED', itemId: 'not-a-real-item' },
      { type: 'DISCOVERY_PRESENT', discoveryId: 'not-a-real-discovery' },
    ]);
    const paths = issuesAt(bad).map((issue) => issue.path);
    expect(paths.some((path) => path.startsWith('entryRequirements[1]'))).toBe(true);
    expect(paths.some((path) => path.startsWith('entryRequirements[2]'))).toBe(true);
    expect(paths.some((path) => path.startsWith('entryRequirements[0]'))).toBe(false);
  });

  it('does not require entryRequirements on any shipped manifest', () => {
    expect(WELCOME_HARBOR_MANIFEST.entryRequirements).toBeUndefined();
  });
});
