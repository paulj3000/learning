import { createContext } from 'react';
import { djangoAssetResolverFor } from '../../api/assets/djangoAssetResolver';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../../api/config';

/** A published image's URL, or null for "draw the illustration". Never rejects. */
export type ImageResolver = (assetId: string) => Promise<string | null>;

/**
 * The page's image resolver: the Django asset library's child-scoped resolver (LAI-2200), so a
 * picture is served only while its version is published and its asset active (ADR-030). Ids
 * asked for in the same tick go out as one request, so a grid of cards costs one call.
 * Anything but a published image (a bundled fallback, another family, any failure) is null.
 */
export function imageResolverFor(
  childId: string,
  config: DjangoApiConfig = DJANGO_API_CONFIG,
): ImageResolver {
  if (!config.enabled) return () => Promise.resolve(null);
  const resolver = djangoAssetResolverFor(childId, config);
  return (assetId) =>
    resolver.resolve(assetId, 'image').then(
      (asset) => (asset.source === 'PUBLISHED' && asset.family === 'image' ? asset.url : null),
      () => null,
    );
}

export const ImageResolverContext = createContext<ImageResolver | null>(null);
export const ImageResolverProvider = ImageResolverContext.Provider;
