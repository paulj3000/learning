import { describe, expect, it } from 'vitest';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import { SOURCE_LOCATION_MANIFESTS } from './manifests';
import { SOURCE_MANIFEST_REGISTRIES } from './sourceManifestRegistries';
import type { ColliderSpec, ThreeLocationManifest } from './locationManifest';
import { validateLocationManifest } from './validateLocationManifest';
import { solidColliders } from './sceneLayout';

/** LAI-JMP-01: what the validator says about movement blocks and jumpable colliders. */

const rect = { id: 'jump-test:rock', minX: 1, maxX: 2, minZ: 1, maxZ: 2 };

function withColliders(...extra: ColliderSpec[]): ThreeLocationManifest {
  return {
    ...WELCOME_HARBOR_MANIFEST,
    colliders: [...WELCOME_HARBOR_MANIFEST.colliders, ...extra],
  };
}

function issuesAt(manifest: ThreeLocationManifest, prefix: string) {
  return validateLocationManifest(manifest, SOURCE_MANIFEST_REGISTRIES)
    .filter((issue) => issue.path.startsWith(prefix))
    .map((issue) => issue.detail);
}

const lastCollider = `colliders[${WELCOME_HARBOR_MANIFEST.colliders.length}]`;

describe('validateLocationManifest movement (LAI-JMP-01)', () => {
  it('every shipped location still validates with its movement settings', () => {
    for (const manifest of SOURCE_LOCATION_MANIFESTS) {
      expect(
        validateLocationManifest(manifest, SOURCE_MANIFEST_REGISTRIES),
        manifest.regionId,
      ).toEqual([]);
    }
  });

  it('accepts a low jumpable obstacle with an authored height', () => {
    expect(
      issuesAt(withColliders({ rect, minY: 0, maxY: 0.8, jumpable: true }), lastCollider),
    ).toEqual([]);
  });

  it('refuses a jumpable progression gate', () => {
    const gate: ColliderSpec = {
      rect,
      minY: 0,
      maxY: 0.5,
      jumpable: true,
      requirements: [{ type: 'ALWAYS' }],
    };
    expect(issuesAt(withColliders(gate), lastCollider)).toContain(
      'a collider with requirements is a progression gate and cannot be jumpable',
    );
  });

  it('refuses a jumpable collider without a height, or with an upside-down one', () => {
    expect(issuesAt(withColliders({ rect, jumpable: true }), lastCollider)).toEqual([
      'a jumpable collider must author minY and maxY',
    ]);
    expect(
      issuesAt(withColliders({ rect, minY: 1, maxY: 0.5, jumpable: true }), lastCollider),
    ).toEqual(['minY must be below maxY']);
  });

  it('reports bad movement settings by path', () => {
    const manifest = {
      ...WELCOME_HARBOR_MANIFEST,
      movement: { jump: { jumpHeight: 40, allowDoubleJump: 'yes' } },
    } as unknown as ThreeLocationManifest;
    expect(validateLocationManifest(manifest, SOURCE_MANIFEST_REGISTRIES)).toEqual([
      {
        kind: 'INVALID_VALUE',
        path: 'movement.jump.jumpHeight',
        detail: 'must be between 0.2 and 2.5',
      },
      {
        kind: 'INVALID_VALUE',
        path: 'movement.jump.allowDoubleJump',
        detail: 'must be true or false',
      },
    ]);
  });

  it('never builds a gated collider as jumpable, even if one slipped past validation', () => {
    const manifest = withColliders({
      rect,
      minY: 0,
      maxY: 0.5,
      jumpable: true,
      requirements: [{ type: 'ALWAYS' }],
    });
    const built = solidColliders(manifest).find((solid) => solid.id === rect.id);
    expect(built?.jumpable).toBeUndefined();
    const plain = solidColliders(withColliders({ rect, minY: 0, maxY: 0.5, jumpable: true })).find(
      (solid) => solid.id === rect.id,
    );
    expect(plain?.jumpable).toBe(true);
  });
});
