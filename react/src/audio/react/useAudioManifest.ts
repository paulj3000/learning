import { useCallback, useEffect, useRef, useState } from 'react';
import { createManifestSync, type ManifestSync } from '../manifest/AudioManifestSync';
import type { ManifestScope } from '../manifest/manifestTypes';
import type { PlayOptions, SoundAssetResolver, SoundHandle } from '../AudioTypes';
import { useSoundManager } from './hooks';

export interface AudioManifestSource {
  fetchManifest(scope: ManifestScope, signal: AbortSignal): Promise<unknown>;
  resolver?: SoundAssetResolver;
}

export type ManifestState = 'idle' | 'loading' | 'ready' | 'failed';

export interface UseAudioManifest {
  status: ManifestState;
  revision: string | null;
  /** Plays the sound assigned to an event, if the manifest has one. Resolves `null` otherwise. */
  trigger(
    event: string,
    targetType: string,
    targetId?: string,
    options?: PlayOptions,
  ): Promise<SoundHandle | null>;
  /** Fetches the manifest again. */
  refresh(): void;
}

interface Outcome {
  key: string;
  status: 'ready' | 'failed';
  revision: string | null;
}

/**
 * Loads the published audio manifest for `scope` into the shared Sound Manager for as long as the
 * component is mounted. Unmounting or changing scope stops that scope's sounds and removes its
 * definitions. Safe under StrictMode: each effect run builds its own sync and the cleanup disposes
 * it, so a double mount loads twice but leaves exactly one live registration.
 *
 * Pass a stable `source` (memoize it per child). `null` source or scope means "no manifest".
 */
export function useAudioManifest(
  source: AudioManifestSource | null,
  scope: ManifestScope | null,
): UseAudioManifest {
  const manager = useSoundManager();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const syncRef = useRef<ManifestSync | null>(null);
  const key = scope ? `${scope.type}:${scope.id}` : '';
  const scopeType = scope?.type;
  const scopeId = scope?.id;

  useEffect(() => {
    if (!source || !scopeType || !scopeId) return undefined;
    const loadKey = `${scopeType}:${scopeId}`;
    const sync = createManifestSync({
      manager,
      fetchManifest: source.fetchManifest,
      resolver: source.resolver,
    });
    syncRef.current = sync;
    let live = true;
    void sync.load({ type: scopeType, id: scopeId }).then((result) => {
      if (!live || result.status === 'superseded' || result.status === 'disposed') return;
      setOutcome({
        key: loadKey,
        status: result.status === 'failed' ? 'failed' : 'ready',
        revision: result.revision,
      });
    });
    return () => {
      live = false;
      if (syncRef.current === sync) syncRef.current = null;
      sync.dispose();
    };
  }, [manager, source, scopeType, scopeId]);

  const trigger = useCallback<UseAudioManifest['trigger']>(
    (event, targetType, targetId, options) =>
      syncRef.current?.trigger(event, targetType, targetId, options) ?? Promise.resolve(null),
    [],
  );

  const refresh = useCallback(() => {
    const sync = syncRef.current;
    if (!sync) return;
    void sync.refresh().then((result) => {
      if (result.status === 'loaded' || result.status === 'unchanged') {
        setOutcome((previous) =>
          previous ? { ...previous, status: 'ready', revision: result.revision } : previous,
        );
      }
    });
  }, []);

  const active = source !== null && scope !== null;
  const settled = outcome !== null && outcome.key === key;
  const status: ManifestState = !active ? 'idle' : settled ? outcome.status : 'loading';
  return { status, revision: settled ? outcome.revision : null, trigger, refresh };
}
