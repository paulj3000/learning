import { sourceLocationManifestRepository } from '../island-map/three/runtime/manifests';
import { SOURCE_VIEW_EXTENSIONS } from '../island-map/three/extensions';
import { MULTIPLAYER_PRESENCE_EXTENSION_ID } from '../island-map/three/extensions/multiplayerPresence/multiplayerPresenceViewExtension';
import {
  locationRepositoryForThisBuild,
  withDevMultiplayerPresence,
} from './devMultiplayerRepository';

const base = sourceLocationManifestRepository;

describe('withDevMultiplayerPresence', () => {
  it('returns the base repository when no dev region is listed', () => {
    expect(withDevMultiplayerPresence(base, [])).toBe(base);
  });

  it('adds the presence binding only to the listed regions', async () => {
    const repository = withDevMultiplayerPresence(base, ['welcome-harbor']);
    const harbor = await repository.getPublished('welcome-harbor');
    const bay = await repository.getPublished('pirate-builder-bay');
    expect(harbor.extensions.map((b) => b.extensionId)).toContain(
      MULTIPLAYER_PRESENCE_EXTENSION_ID,
    );
    expect(bay.extensions.map((b) => b.extensionId)).not.toContain(
      MULTIPLAYER_PRESENCE_EXTENSION_ID,
    );
    expect(await repository.listRegionIds()).toEqual(await base.listRegionIds());
  });

  it('does not change the shared, cached manifest', async () => {
    await withDevMultiplayerPresence(base, ['welcome-harbor']).getPublished('welcome-harbor');
    const original = await base.getPublished('welcome-harbor');
    expect(original.extensions.map((b) => b.extensionId)).not.toContain(
      MULTIPLAYER_PRESENCE_EXTENSION_ID,
    );
  });

  it('binds an extension id that is registered', () => {
    expect(SOURCE_VIEW_EXTENSIONS.get(MULTIPLAYER_PRESENCE_EXTENSION_ID)).toBeDefined();
  });
});

describe('locationRepositoryForThisBuild', () => {
  it('is the plain source repository when multiplayer is not configured (the default)', () => {
    expect(locationRepositoryForThisBuild).toBe(base);
  });
});

describe('shipped manifests', () => {
  it('stay single-player: none binds multiplayer presence yet', async () => {
    for (const regionId of await base.listRegionIds()) {
      const manifest = await base.getPublished(regionId);
      expect(manifest.extensions.map((b) => b.extensionId)).not.toContain(
        MULTIPLAYER_PRESENCE_EXTENSION_ID,
      );
    }
  });
});
