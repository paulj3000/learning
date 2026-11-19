import { djangoAssetResolverFor } from '../../api/assets/djangoAssetResolver';
import { childAvatarFor } from '../../api/play/avatarApi';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../../api/config';
import { createAssetLoader } from '../island-map/three/assets/assetLoader';
import type { AssetResolver } from '../island-map/three/assets/assetResolver';
import type { PlayerAvatarModel } from '../island-map/three/playerAvatarCatalog';
import type { LoadedModel } from '../island-map/three/runtime/extensionRegistry';
import type { PlayerAvatarAnswer } from '../island-map/three/playerAvatarCatalog';

/**
 * Where a child's 3D avatar comes from (LAI-JMP-01c), for any 3D location.
 *
 * - `published`: the play API's answer for the child's own avatar identity (only a published
 *   model staff made available). It is a promise the scene does not wait for: the placeholder
 *   shows until the model has loaded, and anything failing keeps the placeholder.
 * - `loadModel`: loads that model through the existing Django asset resolver and the shared
 *   asset loader (signed URLs, published-only, parsed-model cache), so a pinned `asset-id@n`
 *   reference resolves exactly as the asset library says. Builds without the Django API return
 *   no loader, and the location's own (bundled) loader is used.
 *
 * Call once per visit, like `regionAssetsFor`: a newly published avatar is picked up on the next
 * visit, and within a visit the parsed model is cached and every placement clones it.
 */
export interface PlayerAvatarSource {
  published: Promise<PlayerAvatarModel | null>;
  loadModel?: (ref: string) => Promise<LoadedModel>;
}

export function playerAvatarSourceFor(
  childId: string,
  config: DjangoApiConfig = DJANGO_API_CONFIG,
  fetchAnswer: (
    childId: string,
    config: DjangoApiConfig,
  ) => Promise<PlayerAvatarAnswer | null> = childAvatarFor,
  resolverFor: (childId: string, config: DjangoApiConfig) => AssetResolver = djangoAssetResolverFor,
): PlayerAvatarSource {
  const published = fetchAnswer(childId, config)
    .then((answer) => answer?.model ?? null)
    .catch(() => null);
  if (!childId) return { published };
  const loader = createAssetLoader(resolverFor(childId, config));
  return { published, loadModel: (ref) => loader.loadAsset(ref) };
}
