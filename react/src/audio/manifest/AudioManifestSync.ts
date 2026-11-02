import { AudioError } from '../AudioTypes';
import type {
  PlayOptions,
  SoundAssetResolver,
  SoundHandle,
  SoundManager,
  SoundScope,
} from '../AudioTypes';
import { parseAudioManifest } from './parseManifest';
import type { ManifestAssignment, ManifestScope } from './manifestTypes';

/**
 * Keeps one Sound Manager's registry in step with the published manifest for one scope
 * (an Island, Place or 3D Area). It is the only bridge between Django's sound configuration and the
 * Phase 1 engine, and it has no React, no network client and no game knowledge: the caller supplies
 * `fetchManifest`.
 *
 * - Definitions are registered under this sync's own owner, so a refresh replaces exactly what the
 *   manifest put there and never touches sounds the application registered itself.
 * - Moving to another scope stops the sounds the previous scope started and replaces its
 *   definitions; a failed move leaves silence, never the previous scope's sounds.
 * - Failures never throw. A manifest that cannot be fetched or is not valid keeps the last good
 *   state for the same scope, and is recorded as a diagnostic.
 */

export interface ManifestSyncOptions {
  manager: SoundManager;
  /** Fetches the raw manifest JSON for a scope. Should honour `signal`. */
  fetchManifest(scope: ManifestScope, signal: AbortSignal): Promise<unknown>;
  /** Installed on the manager while this sync is alive; removed again on `dispose`. */
  resolver?: SoundAssetResolver;
}

export type LoadStatus = 'loaded' | 'unchanged' | 'failed' | 'superseded' | 'disposed';

export interface LoadResult {
  status: LoadStatus;
  revision: string | null;
}

export interface ManifestSync {
  readonly scope: ManifestScope | null;
  readonly revision: string | null;
  load(scope: ManifestScope): Promise<LoadResult>;
  /** Fetches the current scope again; sounds whose revision changed are replaced. */
  refresh(): Promise<LoadResult>;
  /** The sound assigned to an event on a target, or `null`. */
  soundFor(event: string, targetType: string, targetId?: string): string | null;
  /** Plays the assigned sound, if any, owned by the current scope. Resolves `null` otherwise. */
  trigger(
    event: string,
    targetType: string,
    targetId?: string,
    options?: PlayOptions,
  ): Promise<SoundHandle | null>;
  dispose(): void;
}

let syncCount = 0;

const sameScope = (a: ManifestScope | null, b: ManifestScope): boolean =>
  a !== null && a.type === b.type && a.id === b.id;

const keyOf = (event: string, targetType: string, targetId: string): string =>
  `${targetType}\u0000${targetId}\u0000${event}`;

export function createManifestSync(options: ManifestSyncOptions): ManifestSync {
  const { manager } = options;
  const owner = `manifest:${(syncCount += 1)}`;

  let current: ManifestScope | null = null;
  let revision: string | null = null;
  let assignments = new Map<string, ManifestAssignment[]>();
  let player: SoundScope | null = null;
  let generation = 0;
  let inflight: { scope: ManifestScope; promise: Promise<LoadResult>; abort(): void } | null = null;
  let disposed = false;
  let installedResolver = false;

  if (options.resolver) {
    manager.setAssetResolver(options.resolver);
    installedResolver = true;
  }

  function clear(): void {
    player?.dispose();
    player = null;
    manager.releaseDefinitions(owner);
    assignments = new Map();
    revision = null;
  }

  async function run(scope: ManifestScope, controller: AbortController): Promise<LoadResult> {
    const mine = (generation += 1);
    const settle = (status: LoadStatus): LoadResult => ({
      status,
      revision: sameScope(current, scope) ? revision : null,
    });

    let parsed;
    try {
      const raw = await options.fetchManifest(scope, controller.signal);
      if (mine !== generation || disposed) return settle(disposed ? 'disposed' : 'superseded');
      parsed = parseAudioManifest(raw);
      const { manifest } = parsed;
      if (manifest.scope.type !== scope.type || manifest.scope.id !== scope.id) {
        throw new AudioError('invalid-manifest', 'the manifest is for a different scope');
      }
    } catch (cause) {
      if (mine !== generation || disposed) return settle(disposed ? 'disposed' : 'superseded');
      const invalid = cause instanceof AudioError && cause.code === 'invalid-manifest';
      manager.reportIssue(
        invalid ? 'invalid-manifest' : 'manifest-failed',
        invalid && cause instanceof Error
          ? cause.message
          : 'the audio manifest could not be loaded',
      );
      // Same scope: keep the last good sounds. A different scope: do not leak the old one's.
      if (!sameScope(current, scope)) {
        clear();
        current = null;
      }
      return { status: 'failed', revision: sameScope(current, scope) ? revision : null };
    }

    const { manifest, skipped } = parsed;
    if (sameScope(current, scope) && revision === manifest.revision) {
      return { status: 'unchanged', revision };
    }

    if (!sameScope(current, scope)) {
      player?.dispose(); // what the previous scope started stops with it
      player = manager.createScope(`manifest-${scope.type}-${scope.id}`);
    }
    const refused = manager.replaceDefinitions(owner, manifest.sounds);
    const grouped = new Map<string, ManifestAssignment[]>();
    for (const assignment of manifest.assignments) {
      if (refused.includes(assignment.soundId)) continue;
      const key = keyOf(assignment.event, assignment.targetType, assignment.targetId);
      grouped.set(key, [...(grouped.get(key) ?? []), assignment]);
    }
    assignments = grouped;
    current = scope;
    revision = manifest.revision;

    if (skipped.length > 0) {
      manager.reportIssue('invalid-manifest', `${skipped.length} manifest entries were skipped`);
    }
    for (const id of refused) {
      manager.reportIssue('invalid-manifest', 'a manifest sound clashes with another', id);
    }
    return { status: 'loaded', revision };
  }

  function start(scope: ManifestScope): Promise<LoadResult> {
    if (disposed) return Promise.resolve({ status: 'disposed', revision: null });
    // The same scope is already loading: share that request.
    if (inflight && sameScope(inflight.scope, scope)) return inflight.promise;
    inflight?.abort();
    const controller = new AbortController();
    const promise = run(scope, controller).finally(() => {
      if (inflight?.promise === promise) inflight = null;
    });
    inflight = { scope, promise, abort: () => controller.abort() };
    return promise;
  }

  const sync: ManifestSync = {
    get scope() {
      return current;
    },
    get revision() {
      return revision;
    },
    load: start,
    refresh() {
      const scope = current ?? inflight?.scope ?? null;
      if (!scope) return Promise.resolve({ status: 'failed', revision: null });
      return start(scope);
    },
    soundFor(event, targetType, targetId = '') {
      const found = assignments.get(keyOf(event, targetType, targetId));
      return found?.[0]?.soundId ?? null;
    },
    trigger(event, targetType, targetId = '', playOptions) {
      const soundId = sync.soundFor(event, targetType, targetId);
      if (!soundId || !player) return Promise.resolve(null);
      return player.play(soundId, playOptions);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      inflight?.abort();
      inflight = null;
      clear();
      current = null;
      if (installedResolver) manager.setAssetResolver(undefined);
    },
  };
  return sync;
}
