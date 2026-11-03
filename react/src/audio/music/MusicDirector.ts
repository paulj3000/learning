import type { EndReason, SoundHandle, SoundPlayer } from '../AudioTypes';
import { createPlaylistCursor, type PlaylistCursor, type PlaylistDefinition } from './playlist';

/**
 * The shared music controller (SM-P6): true overlapping crossfades and playlists on the existing
 * Sound Manager, with no engine of its own. It plays through a `SoundPlayer` (a scope, so leaving
 * a game stops it) and uses only the handle fades the manager already has.
 *
 * - **Crossfade.** A new track is loaded and started with a fade-in; only once it is audible does
 *   the old track fade out over the same time, so the two overlap and there is never a gap, even
 *   when the new file is slow to load. Fades live on the sound's own gain, so master and music
 *   channel volume and mute apply unchanged, and ducking multiplies on top.
 * - **Rapid requests.** Each request supersedes the one before: a track that finishes loading
 *   after it was superseded stops itself and is never faded in. Only the latest request wins.
 * - **No duplicates.** Asking for the track that already plays does nothing.
 * - **Missing audio.** A track that cannot play is skipped; if nothing in a playlist can play, the
 *   current music keeps going and `onUnavailable` is told once. Nothing is retried on its own;
 *   `retry` tries the wanted target again (use it when a new manifest arrives).
 * - **Playlists.** Tracks come from logical sound ids; the next track starts when one finishes.
 */

export interface MusicTarget {
  /** A playlist id registered with `definePlaylist`, or ... */
  playlist?: string;
  /** ... a single logical sound id. Its own `loop` setting decides whether it repeats. */
  sound?: string;
}

export interface MusicDirectorOptions {
  player: SoundPlayer;
  /** Crossfade length. Default 1200 ms; 0 cuts. */
  crossfadeMs?: number;
  /** Injected for deterministic shuffle in tests. */
  random?: () => number;
  /** The target played to its end (a one-shot, or a finished sequential playlist). */
  onFinished?(target: MusicTarget): void;
  /** The target could not start at all (no definition, no asset, playback refused). */
  onUnavailable?(target: MusicTarget): void;
}

export interface MusicDirector {
  definePlaylist(definition: PlaylistDefinition): void;
  /** Crossfades to `target`. Resolves true when something of it started. */
  play(target: MusicTarget, options?: { crossfadeMs?: number }): Promise<boolean>;
  /** Fades the music out. */
  stop(options?: { fadeMs?: number }): void;
  /** Tries the wanted target again if nothing of it is playing. */
  retry(): Promise<boolean>;
  /** Stops everything at once and refuses starts until `activate`. The wanted target is kept. */
  deactivate(): void;
  /** Allows playback again and restarts the wanted target. */
  activate(): Promise<boolean>;
  /** Every handle still sounding, including tracks fading out (for leak tests). */
  readonly sounding: number;
  readonly wanted: MusicTarget | null;
  readonly currentSound: string | null;
}

export const DEFAULT_CROSSFADE_MS = 1200;

const sameTarget = (a: MusicTarget | null, b: MusicTarget | null): boolean =>
  a !== null && b !== null && a.playlist === b.playlist && a.sound === b.sound;

export function createMusicDirector(options: MusicDirectorOptions): MusicDirector {
  const { player } = options;
  const random = options.random ?? Math.random;
  const defaultFade = options.crossfadeMs ?? DEFAULT_CROSSFADE_MS;

  const playlists = new Map<string, PlaylistDefinition>();
  let cursor: PlaylistCursor | null = null;
  let wanted: MusicTarget | null = null;
  let current: { soundId: string; handle: SoundHandle } | null = null;
  const leaving = new Set<SoundHandle>();
  let generation = 0;
  let active = true;
  let fadeMs = defaultFade;

  const track = (handle: SoundHandle) => {
    void handle.whenEnded().then(() => leaving.delete(handle));
  };

  function retire(handle: SoundHandle, ms: number): void {
    leaving.add(handle);
    track(handle);
    handle.stop({ fadeOutMs: ms });
  }

  /**
   * Starts the first playable track `source` offers, trying each at most once per call (so a
   * playlist where nothing can play ends instead of looping). `'stale'` means a newer request or
   * a deactivation superseded this one while it loaded; whatever started has been stopped.
   */
  async function startFrom(
    mine: number,
    source: () => string | null,
    maxAttempts: number,
    isPlaylist: boolean,
  ): Promise<{ soundId: string; handle: SoundHandle } | 'stale' | null> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const soundId = source();
      if (soundId === null) return null;
      // A playlist track must end so the next can start; a single cue keeps its own loop setting.
      const handle = await player.play(
        soundId,
        isPlaylist ? { loop: false, fadeInMs: fadeMs } : { fadeInMs: fadeMs },
      );
      if (mine !== generation || !active) {
        handle?.stop();
        return 'stale';
      }
      if (handle) return { soundId, handle };
    }
    return null;
  }

  const attemptsFor = (target: MusicTarget): number =>
    target.playlist ? Math.max(1, playlists.get(target.playlist)?.tracks.length ?? 1) : 1;

  function onTrackEnd(handle: SoundHandle, mine: number, reason: EndReason): void {
    if (current?.handle !== handle) return;
    current = null;
    // Only a natural end advances; a stop, a steal or a disposed scope never restarts music.
    if (reason !== 'finished' || mine !== generation || !active) return;
    void advance(mine);
  }

  function watch(handle: SoundHandle, mine: number): void {
    void handle.whenEnded().then((reason) => onTrackEnd(handle, mine, reason));
  }

  async function advance(mine: number): Promise<void> {
    const target = wanted;
    if (!target) return;
    if (!cursor) {
      options.onFinished?.(target);
      return;
    }
    const started = await startFrom(mine, () => cursor?.next() ?? null, attemptsFor(target), true);
    if (started === 'stale') return;
    if (!started) {
      options.onFinished?.(target);
      return;
    }
    current = started;
    watch(started.handle, mine);
  }

  async function play(target: MusicTarget, playOptions?: { crossfadeMs?: number }) {
    const next: MusicTarget = {
      ...(target.playlist ? { playlist: target.playlist } : {}),
      ...(target.sound && !target.playlist ? { sound: target.sound } : {}),
    };
    if (!next.playlist && !next.sound) return false;

    // Asking for what already plays changes nothing (no restart, no second stream).
    if (sameTarget(wanted, next) && current) return true;
    const mine = (generation += 1);
    wanted = next;
    fadeMs = playOptions?.crossfadeMs ?? defaultFade;
    if (!active) return false;

    let source: () => string | null;
    let isPlaylist = false;
    if (next.playlist) {
      const definition = playlists.get(next.playlist);
      if (!definition || definition.tracks.length === 0) {
        cursor = null;
        options.onUnavailable?.(next);
        return false;
      }
      cursor = createPlaylistCursor(definition, random);
      isPlaylist = true;
      source = () => cursor?.next() ?? null;
    } else {
      cursor = null;
      const only = next.sound as string;
      // A single cue that is already the one playing is the same sound.
      if (current?.soundId === only) {
        return true;
      }
      let given = false;
      source = () => (given ? null : ((given = true), only));
    }

    const started = await startFrom(mine, source, attemptsFor(next), isPlaylist);
    if (started === 'stale') return false;
    if (!started) {
      // Nothing could play: the music already playing keeps going.
      options.onUnavailable?.(next);
      return false;
    }
    const previous = current;
    current = started;
    watch(started.handle, mine);
    if (previous) retire(previous.handle, fadeMs);
    return true;
  }

  return {
    definePlaylist(definition) {
      playlists.set(definition.id, definition);
    },
    play,
    stop(stopOptions) {
      generation += 1;
      wanted = null;
      cursor = null;
      const old = current;
      current = null;
      if (old) retire(old.handle, stopOptions?.fadeMs ?? defaultFade);
    },
    async retry() {
      if (!wanted || !active || current) return false;
      const again = wanted;
      wanted = null; // so the same-target shortcut does not swallow the retry
      return play(again, { crossfadeMs: fadeMs });
    },
    deactivate() {
      active = false;
      generation += 1;
      const old = current;
      current = null;
      old?.handle.stop();
      for (const handle of [...leaving]) handle.stop();
      leaving.clear();
    },
    async activate() {
      if (active) return false;
      active = true;
      const again = wanted;
      if (!again) return false;
      wanted = null;
      return play(again, { crossfadeMs: fadeMs });
    },
    get sounding() {
      return (current ? 1 : 0) + leaving.size;
    },
    get wanted() {
      return wanted;
    },
    get currentSound() {
      return current?.soundId ?? null;
    },
  };
}
