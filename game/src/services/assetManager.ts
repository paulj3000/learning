/**
 * Asset Manager port. The host implements it over the real Asset Library (signed urls,
 * versions, caching); the engine only resolves ids and holds handles.
 */

import { EngineError } from '../core/errors';
import { defineService } from '../core/services';

export type AssetKind = 'model' | 'texture' | 'image' | 'audio' | 'other';

export interface AssetMetadata {
  assetId: string;
  /** The frozen version, or null for "current". */
  version: number | null;
  kind: AssetKind;
  url: string;
  byteSize?: number;
}

/** A loaded asset. Dispose it when the owner (an entity or system) goes away. */
export interface AssetHandle {
  readonly assetId: string;
  readonly metadata: Readonly<AssetMetadata>;
  readonly disposed: boolean;
  dispose(): void;
}

export interface AssetManagerPort {
  /** Resolves an asset id to its url and metadata, or null when unknown or not yet published. */
  resolve(assetId: string, version?: number | null): Promise<AssetMetadata | null>;
  /** Resolves and loads. Rejects with an `ASSET_LOAD_FAILED` `EngineError`. */
  load(assetId: string, version?: number | null): Promise<AssetHandle>;
  /** Disposes every live handle this port issued. */
  disposeAll(): void;
}

export const ASSET_MANAGER = defineService<AssetManagerPort>('lai.assetManager');

export interface FakeAssetManager extends AssetManagerPort {
  /** Live (not disposed) handles, for leak assertions. */
  liveHandles(): AssetHandle[];
  loadCount(): number;
}

export function createFakeAssetManager(assets: readonly AssetMetadata[] = []): FakeAssetManager {
  const byId = new Map(assets.map((asset) => [asset.assetId, asset] as const));
  const live = new Set<AssetHandle>();
  let loads = 0;
  return {
    async resolve(assetId) {
      return byId.get(assetId) ?? null;
    },
    async load(assetId) {
      const metadata = byId.get(assetId);
      if (!metadata) {
        throw new EngineError('ASSET_LOAD_FAILED', `Asset "${assetId}" is not available`, { assetId });
      }
      loads += 1;
      const handle: AssetHandle = {
        assetId,
        metadata,
        get disposed() {
          return !live.has(handle);
        },
        dispose() {
          live.delete(handle);
        },
      };
      live.add(handle);
      return handle;
    },
    disposeAll() {
      live.clear();
    },
    liveHandles: () => [...live],
    loadCount: () => loads,
  };
}
