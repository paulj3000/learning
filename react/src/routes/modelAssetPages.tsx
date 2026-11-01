import type { ReactElement } from 'react';
import { djangoAssetManager, type DjangoAssetManager } from '../features/assets/assetBackend';
import { DjangoModelAssetDetail } from '../features/assets/django/DjangoModelAssetDetail';
import { DjangoModelAssets } from '../features/assets/django/DjangoModelAssets';
import { DjangoNewModelAsset } from '../features/assets/django/DjangoNewModelAsset';
import { AdminModelAssets } from './AdminModelAssets';
import { AdminNewModelAsset } from './AdminNewModelAsset';

export interface ModelAssetPages {
  list: ReactElement;
  create: ReactElement;
  /** The per-asset page exists only in the Django asset manager. */
  detail: ReactElement | null;
}

/**
 * The model asset pages for this build (AM-15): the Django asset manager when
 * the build has the Django API, otherwise the Amplify pages, unchanged until
 * cutover (LAI-1301).
 */
export function modelAssetPages(
  manager: DjangoAssetManager | null = djangoAssetManager(),
): ModelAssetPages {
  if (manager) {
    return {
      list: <DjangoModelAssets manager={manager} />,
      create: <DjangoNewModelAsset manager={manager} />,
      detail: <DjangoModelAssetDetail manager={manager} />,
    };
  }
  return { list: <AdminModelAssets />, create: <AdminNewModelAsset />, detail: null };
}
