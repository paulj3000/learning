import { describe, expect, it } from 'vitest';
import {
  createSourceManifestRepository,
  InvalidLocationManifestError,
  LocationManifestNotFoundError,
} from './locationManifestRepository';
import { SOURCE_LOCATION_MANIFESTS, sourceLocationManifestRepository } from './manifests';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';
import { SOURCE_MANIFEST_REGISTRIES } from './sourceManifestRegistries';

describe('createSourceManifestRepository', () => {
  it('serves a published manifest by its stable region id', async () => {
    const repository = createSourceManifestRepository(
      [WELCOME_HARBOR_MANIFEST],
      SOURCE_MANIFEST_REGISTRIES,
    );
    await expect(repository.getPublished('welcome-harbor')).resolves.toBe(WELCOME_HARBOR_MANIFEST);
    expect(repository.listRegionIds()).toEqual(['welcome-harbor']);
  });

  it('rejects an unknown region with a typed not-found error', async () => {
    const repository = createSourceManifestRepository([], SOURCE_MANIFEST_REGISTRIES);
    const error = await repository.getPublished('nowhere').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LocationManifestNotFoundError);
    expect((error as LocationManifestNotFoundError).regionId).toBe('nowhere');
  });

  it('refuses to serve a manifest that fails validation, listing its issues', async () => {
    const broken = { ...WELCOME_HARBOR_MANIFEST, worldSlug: 'no-such-world' };
    const repository = createSourceManifestRepository([broken], SOURCE_MANIFEST_REGISTRIES);
    const error = await repository
      .getPublished('welcome-harbor')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InvalidLocationManifestError);
    expect((error as InvalidLocationManifestError).issues.map((issue) => issue.kind)).toEqual([
      'UNKNOWN_WORLD',
    ]);
  });

  it('refuses two manifests claiming one region id', () => {
    expect(() =>
      createSourceManifestRepository(
        [WELCOME_HARBOR_MANIFEST, WELCOME_HARBOR_MANIFEST],
        SOURCE_MANIFEST_REGISTRIES,
      ),
    ).toThrow(/welcome-harbor/);
  });
});

describe('sourceLocationManifestRepository', () => {
  it('serves every shipped manifest without a validation error', async () => {
    for (const manifest of SOURCE_LOCATION_MANIFESTS) {
      await expect(sourceLocationManifestRepository.getPublished(manifest.regionId)).resolves.toBe(
        manifest,
      );
    }
  });
});
