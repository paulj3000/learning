import { ApiError } from '../../api/errors';
import { read } from '../../api/parse';
import * as parse from '../../api/play/parse';
import type { PlayApi } from '../../api/play/playApi';
import { resolveSpawnCheckpoint, unpublishRegionCheckpoints } from '../discovery/checkpoints';
import {
  InvalidLocationManifestError,
  LocationManifestNotFoundError,
  type LocationManifestRepository,
} from '../island-map/three/runtime/locationManifestRepository';
import { SOURCE_MANIFEST_REGISTRIES } from '../island-map/three/runtime/sourceManifestRegistries';
import { sourceLocationManifestRepository } from '../island-map/three/runtime/manifests';
import { ISLAND_LOCATIONS } from '../island/locations';
import { bootstrapJson } from '../../test/playFixtures';
import { createRegionManifestRepository } from './regionManifestRepository';
import { regionRepositoryForChild } from './regionRepositoryForChild';

const REGION = 'treasure-rush-cove';

function repositoryWith(getRegion: PlayApi['getRegion']): LocationManifestRepository {
  return createRegionManifestRepository({
    source: sourceLocationManifestRepository,
    api: { getRegion } as PlayApi,
    registries: SOURCE_MANIFEST_REGISTRIES,
    worldSlugFor: (slug) => ISLAND_LOCATIONS.find((location) => location.slug === slug)?.worldSlug,
  });
}

afterEach(() => unpublishRegionCheckpoints(REGION));

describe('createRegionManifestRepository', () => {
  it('serves source regions from source, without asking the server', async () => {
    const getRegion = vi.fn();
    const sourceId = sourceLocationManifestRepository.listRegionIds()[0];
    const manifest = await repositoryWith(getRegion).getPublished(sourceId);
    expect(manifest.regionId).toBe(sourceId);
    expect(getRegion).not.toHaveBeenCalled();
  });

  it('builds, validates, and serves a published region, with its spawn in the catalogue', async () => {
    const getRegion = vi.fn(async () => read(bootstrapJson(), parse.regionBootstrap));
    const manifest = await repositoryWith(getRegion).getPublished(REGION);
    expect(getRegion).toHaveBeenCalledWith(REGION);
    expect(manifest.regionId).toBe(REGION);
    expect(manifest.locationSlug).toBe('pirate-builder-bay');
    expect(resolveSpawnCheckpoint(REGION, undefined)).toMatchObject({ x: 0, z: 10, label: 'the landing' });
  });

  it('reads the server on every visit, so a chest opened elsewhere is drawn open', async () => {
    const getRegion = vi
      .fn()
      .mockResolvedValueOnce(read(bootstrapJson(), parse.regionBootstrap))
      .mockResolvedValueOnce(read(bootstrapJson({}, { isOpen: true }), parse.regionBootstrap));
    const repository = repositoryWith(getRegion);
    const chestOpen = async () =>
      (await repository.getPublished(REGION)).extensions[0].config.chests as unknown as { isOpen: boolean }[];
    expect((await chestOpen())[0].isOpen).toBe(false);
    expect((await chestOpen())[0].isOpen).toBe(true);
  });

  it.each(['not_found', 'disabled'] as const)('treats %s as a region that is not open', async (kind) => {
    const repository = repositoryWith(async () => {
      throw new ApiError(kind);
    });
    await expect(repository.getPublished(REGION)).rejects.toBeInstanceOf(LocationManifestNotFoundError);
  });

  it('passes a network failure through for the view’s calm error', async () => {
    const repository = repositoryWith(async () => {
      throw new ApiError('network');
    });
    await expect(repository.getPublished(REGION)).rejects.toMatchObject({ kind: 'network' });
  });

  it('refuses a region that fails validation, and one without a spawn point', async () => {
    const badAsset = repositoryWith(async () => read(bootstrapJson({}, { assetId: 'no-such-chest' }), parse.regionBootstrap));
    await expect(badAsset.getPublished(REGION)).rejects.toBeInstanceOf(InvalidLocationManifestError);
    const noSpawn = repositoryWith(async () => read(bootstrapJson({ spawn: null }), parse.regionBootstrap));
    await expect(noSpawn.getPublished(REGION)).rejects.toBeInstanceOf(InvalidLocationManifestError);
  });

  it('refuses a published region that claims a source region’s id', async () => {
    const sourceId = 'welcome-harbor-impostor';
    const repository = repositoryWith(async () =>
      read(bootstrapJson({ region: { ...bootstrapJson().region, regionId: sourceId, locationSlug: 'nowhere' } }), parse.regionBootstrap),
    );
    await expect(repository.getPublished(sourceId)).rejects.toBeInstanceOf(InvalidLocationManifestError);
  });
});

describe('regionRepositoryForChild', () => {
  it('is the source repository itself when the build has no Django API', () => {
    expect(regionRepositoryForChild('child', sourceLocationManifestRepository, { enabled: false })).toBe(
      sourceLocationManifestRepository,
    );
  });

  it('wraps the source repository when the Django API is on', () => {
    const repository = regionRepositoryForChild('child', sourceLocationManifestRepository, { enabled: true, baseUrl: '' });
    expect(repository).not.toBe(sourceLocationManifestRepository);
    expect(repository.listRegionIds()).toEqual(sourceLocationManifestRepository.listRegionIds());
  });
});
