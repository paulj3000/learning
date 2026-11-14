import { describe, expect, it } from 'vitest';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import { STORYKEEPER_CASTLE_MANIFEST } from './manifests/storykeeperCastle';
import { SOURCE_MANIFEST_REGISTRIES } from './sourceManifestRegistries';
import type { ThreeLocationManifest } from './locationManifest';
import { validateLocationManifest } from './validateLocationManifest';

/** LAI-JMP-01a: what the validator says about a location's camera and avatar settings. */
describe('validateLocationManifest player (LAI-JMP-01a)', () => {
  const issues = (player: unknown) =>
    validateLocationManifest(
      { ...WELCOME_HARBOR_MANIFEST, player } as ThreeLocationManifest,
      SOURCE_MANIFEST_REGISTRIES,
    );

  it('accepts the castle’s indoor camera', () => {
    expect(
      validateLocationManifest(STORYKEEPER_CASTLE_MANIFEST, SOURCE_MANIFEST_REGISTRIES),
    ).toEqual([]);
  });

  it('accepts a costume that is a real asset, and rejects one that is not', () => {
    expect(issues({ avatar: { assetKey: 'npc-harbor-master' } })).toEqual([]);
    expect(issues({ avatar: { assetKey: 'no-such-model' } })).toEqual([
      { kind: 'UNKNOWN_ASSET', path: 'player.avatar.assetKey', detail: 'no asset "no-such-model"' },
    ]);
  });

  it('reports a bad perspective by path', () => {
    expect(issues({ camera: { defaultMode: 'top-down' } })).toEqual([
      {
        kind: 'INVALID_VALUE',
        path: 'player.camera.defaultMode',
        detail: 'must be one of first-person, third-person',
      },
    ]);
  });
});
