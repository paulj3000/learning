/**
 * Data-driven music playlists (SM-P6). A playlist is a list of logical sound ids from the sound
 * library plus a mode; it holds no url and no file. The cursor is pure: it only says which id is
 * next, so it is tested without audio, and `random` is injectable so shuffle is deterministic.
 */

export type PlaylistMode =
  /** Tracks in order, once. */
  | 'sequential'
  /** A random order that is reshuffled each time through, never repeating a track back to back. */
  | 'shuffle'
  /** Tracks in order, forever. */
  | 'loop-all'
  /** The current track, forever. */
  | 'repeat-one'
  /** The first track, once, then finished. */
  | 'one-shot';

export interface PlaylistDefinition {
  id: string;
  tracks: readonly string[];
  mode: PlaylistMode;
}

export const PLAYLIST_MODES: readonly PlaylistMode[] = [
  'sequential',
  'shuffle',
  'loop-all',
  'repeat-one',
  'one-shot',
];

export interface PlaylistCursor {
  /** The next track to play, or `null` when the playlist is finished (or empty). */
  next(): string | null;
  /** Starts again from the beginning. */
  reset(): void;
}

function shuffled(tracks: readonly string[], random: () => number, avoid: string | null) {
  const order = [...tracks];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [order[i], order[j]] = [order[j] as string, order[i] as string];
  }
  // Do not open a new round with the track that just ended.
  if (order.length > 1 && order[0] === avoid) {
    [order[0], order[1]] = [order[1] as string, order[0] as string];
  }
  return order;
}

export function createPlaylistCursor(
  definition: PlaylistDefinition,
  random: () => number = Math.random,
): PlaylistCursor {
  const tracks = definition.tracks.filter((id) => typeof id === 'string' && id.length > 0);
  let position = 0;
  let order: string[] | null = null;
  let last: string | null = null;

  return {
    next() {
      if (tracks.length === 0) return null;
      switch (definition.mode) {
        case 'one-shot': {
          if (position > 0) return null;
          position = 1;
          return (last = tracks[0] as string);
        }
        case 'sequential': {
          if (position >= tracks.length) return null;
          return (last = tracks[position++] as string);
        }
        case 'loop-all': {
          const id = tracks[position % tracks.length] as string;
          position += 1;
          return (last = id);
        }
        case 'repeat-one': {
          return (last ??= tracks[0] as string);
        }
        case 'shuffle': {
          if (!order || position >= order.length) {
            order = shuffled(tracks, random, last);
            position = 0;
          }
          return (last = order[position++] as string);
        }
        default:
          return null;
      }
    },
    reset() {
      position = 0;
      order = null;
      last = null;
    },
  };
}
