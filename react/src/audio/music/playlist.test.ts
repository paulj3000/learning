import { describe, expect, it } from 'vitest';
import { createPlaylistCursor, type PlaylistMode } from './playlist';

const take = (cursor: ReturnType<typeof createPlaylistCursor>, n: number) =>
  Array.from({ length: n }, () => cursor.next());

const def = (mode: PlaylistMode, tracks = ['music.a.one', 'music.a.two', 'music.a.three']) => ({
  id: 'p',
  tracks,
  mode,
});

/** A repeatable "random": cycles through fixed values. */
const fixed = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length] as number;
};

describe('playlist modes', () => {
  it('sequential plays in order once, then finishes', () => {
    const cursor = createPlaylistCursor(def('sequential'));
    expect(take(cursor, 5)).toEqual(['music.a.one', 'music.a.two', 'music.a.three', null, null]);
  });

  it('loop-all wraps round forever', () => {
    const cursor = createPlaylistCursor(def('loop-all'));
    expect(take(cursor, 5)).toEqual([
      'music.a.one',
      'music.a.two',
      'music.a.three',
      'music.a.one',
      'music.a.two',
    ]);
  });

  it('repeat-one repeats the first track', () => {
    expect(take(createPlaylistCursor(def('repeat-one')), 3)).toEqual(Array(3).fill('music.a.one'));
  });

  it('one-shot plays the first track once', () => {
    expect(take(createPlaylistCursor(def('one-shot')), 3)).toEqual(['music.a.one', null, null]);
  });

  it('shuffle is deterministic for a given random source and covers every track each round', () => {
    const a = take(createPlaylistCursor(def('shuffle'), fixed([0.1, 0.9, 0.4])), 6);
    const b = take(createPlaylistCursor(def('shuffle'), fixed([0.1, 0.9, 0.4])), 6);
    expect(a).toEqual(b);
    expect(new Set(a.slice(0, 3)).size).toBe(3);
    expect(new Set(a.slice(3, 6)).size).toBe(3);
  });

  it('shuffle never repeats a track across the start of a new round', () => {
    for (const seed of [[0], [0.99], [0.5], [0.2, 0.8]]) {
      const run = take(createPlaylistCursor(def('shuffle'), fixed(seed)), 30) as string[];
      for (let i = 1; i < run.length; i += 1) expect(run[i]).not.toBe(run[i - 1]);
    }
  });

  it('a one-track shuffle just repeats it', () => {
    expect(take(createPlaylistCursor(def('shuffle', ['music.a.one'])), 3)).toEqual(
      Array(3).fill('music.a.one'),
    );
  });
});

describe('edge cases', () => {
  it('an empty playlist yields nothing in every mode', () => {
    for (const mode of ['sequential', 'shuffle', 'loop-all', 'repeat-one', 'one-shot'] as const) {
      expect(createPlaylistCursor(def(mode, [])).next()).toBeNull();
    }
  });

  it('ignores blank ids', () => {
    expect(take(createPlaylistCursor(def('sequential', ['', 'music.a.one'])), 3)).toEqual([
      'music.a.one',
      null,
      null,
    ]);
  });

  it('reset starts again', () => {
    const cursor = createPlaylistCursor(def('sequential'));
    take(cursor, 4);
    cursor.reset();
    expect(cursor.next()).toBe('music.a.one');
  });
});
