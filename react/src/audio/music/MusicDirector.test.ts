import { describe, expect, it, vi } from 'vitest';
import { createSoundManager } from '../SoundManager';
import { FakeEngine, type FakeVoice } from '../testing/fakes';
import { createMusicDirector, type MusicDirectorOptions } from './MusicDirector';

const TRACKS = ['music.t.explore', 'music.t.puzzle', 'music.t.victory', 'music.t.b', 'music.t.c'];

function setup(options: Partial<MusicDirectorOptions> = {}, missing: string[] = []) {
  const engine = new FakeEngine();
  const manager = createSoundManager({ engine });
  for (const id of TRACKS.filter((t) => !missing.includes(t))) {
    manager.register({ id, channel: 'music', url: `u://${id}`, stream: true });
  }
  const scope = manager.createScope('music');
  const director = createMusicDirector({ player: scope, crossfadeMs: 1000, ...options });
  const urls = new Map<FakeVoice, string>();
  const original = engine.play.bind(engine);
  engine.play = (sound, voice, ended) => {
    const v = original(sound, voice, ended) as FakeVoice;
    urls.set(v, sound.url.replace('u://', ''));
    return v;
  };
  const live = () => engine.voices.filter((v) => !v.stopped).map((v) => urls.get(v));
  const voice = (id: string) => engine.voices.find((v) => urls.get(v) === id && !v.stopped)!;
  const voiceEver = (id: string) => engine.voices.find((v) => urls.get(v) === id)!;
  return { engine, manager, scope, director, live, voice, voiceEver };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('crossfade', () => {
  it('fades the new track in while the old one fades out, over the same time', async () => {
    const s = setup();
    await s.director.play({ sound: 'music.t.explore' });
    const explore = s.voice('music.t.explore');
    await s.director.play({ sound: 'music.t.puzzle' });
    const puzzle = s.voice('music.t.puzzle');
    expect(puzzle.options.fadeInMs).toBe(1000);
    expect(explore.stopped).toBe(true);
    expect(explore.stopFadeMs).toBe(1000);
    expect(s.director.currentSound).toBe('music.t.puzzle');
  });

  it('keeps the old track playing until the new one is actually audible (no gap)', async () => {
    const s = setup();
    await s.director.play({ sound: 'music.t.explore' });
    s.engine.autoLoad = false;
    const pending = s.director.play({ sound: 'music.t.puzzle' });
    await tick();
    expect(s.voice('music.t.explore').stopped).toBe(false);
    s.engine.loads[0]!.resolve();
    await pending;
    expect(s.voiceEver('music.t.explore').stopped).toBe(true);
    expect(s.live()).toEqual(['music.t.puzzle']);
  });

  it('honours a per-call crossfade length, and 0 cuts', async () => {
    const s = setup();
    await s.director.play({ sound: 'music.t.explore' });
    await s.director.play({ sound: 'music.t.puzzle' }, { crossfadeMs: 0 });
    expect(s.voiceEver('music.t.explore').stopFadeMs).toBe(0);
    expect(s.voice('music.t.puzzle').options.fadeInMs).toBe(0);
  });

  it('asking for what already plays does nothing', async () => {
    const s = setup();
    await s.director.play({ sound: 'music.t.explore' });
    await s.director.play({ sound: 'music.t.explore' });
    expect(s.engine.voices).toHaveLength(1);
  });

  it('streams music rather than decoding it whole', async () => {
    const s = setup();
    await s.director.play({ sound: 'music.t.explore' });
    expect(s.engine.loadLog[0]?.options.stream).toBe(true);
  });
});

describe('rapid transitions', () => {
  it('only the latest request wins; superseded loads stop and never fade in', async () => {
    const s = setup();
    await s.director.play({ sound: 'music.t.explore' });
    s.engine.autoLoad = false;
    const toB = s.director.play({ sound: 'music.t.b' });
    const toC = s.director.play({ sound: 'music.t.c' });
    await tick();
    s.engine.loads[0]!.resolve();
    s.engine.loads[1]!.resolve();
    expect(await toB).toBe(false);
    expect(await toC).toBe(true);
    expect(s.live()).toEqual(['music.t.c']);
    expect(s.director.currentSound).toBe('music.t.c');
    // The superseded track was started and immediately stopped: no orphan keeps sounding.
    expect(s.voiceEver('music.t.b').stopped).toBe(true);
    expect(s.director.sounding).toBe(1);
  });

  it('a burst of requests leaves one stream', async () => {
    const s = setup();
    const ids = ['music.t.explore', 'music.t.puzzle', 'music.t.b', 'music.t.c', 'music.t.explore'];
    await Promise.all(ids.map((id) => s.director.play({ sound: id })));
    expect(s.live()).toEqual(['music.t.explore']);
  });
});

describe('mixing with mute and volume', () => {
  it('a mute during a transition applies to the channel, not the fades', async () => {
    const s = setup();
    await s.director.play({ sound: 'music.t.explore' });
    s.manager.muteChannel('music', true);
    await s.director.play({ sound: 'music.t.puzzle' });
    expect(s.engine.channelGains.get('music')).toBe(0);
    expect(s.live()).toEqual(['music.t.puzzle']);
    s.manager.muteChannel('music', false);
    expect(s.engine.channelGains.get('music')).toBe(0.5);
  });
});

describe('cleanup', () => {
  it('deactivate stops everything at once, including tracks mid-fade, and late loads', async () => {
    const s = setup();
    await s.director.play({ sound: 'music.t.explore' });
    await s.director.play({ sound: 'music.t.puzzle' });
    s.engine.autoLoad = false;
    const pending = s.director.play({ sound: 'music.t.b' });
    await tick();
    s.director.deactivate();
    s.engine.loads[0]!.resolve();
    await pending;
    expect(s.live()).toEqual([]);
    expect(s.director.sounding).toBe(0);
  });

  it('activate restarts the wanted music', async () => {
    const s = setup();
    await s.director.play({ sound: 'music.t.explore' });
    s.director.deactivate();
    expect(s.live()).toEqual([]);
    await s.director.activate();
    expect(s.live()).toEqual(['music.t.explore']);
  });

  it('disposing the scope stops the music and never restarts it', async () => {
    const s = setup();
    s.director.definePlaylist({
      id: 'loop',
      tracks: ['music.t.explore', 'music.t.puzzle'],
      mode: 'loop-all',
    });
    await s.director.play({ playlist: 'loop' });
    s.scope.dispose();
    await tick();
    expect(s.live()).toEqual([]);
    const count = s.engine.voices.length;
    await tick();
    expect(s.engine.voices).toHaveLength(count);
  });

  it('stop fades the music out and forgets it', async () => {
    const s = setup();
    await s.director.play({ sound: 'music.t.explore' });
    s.director.stop({ fadeMs: 400 });
    expect(s.voiceEver('music.t.explore').stopFadeMs).toBe(400);
    expect(s.director.wanted).toBeNull();
    await tick();
    expect(s.director.sounding).toBe(0);
  });
});

describe('playlists', () => {
  const define = (
    s: ReturnType<typeof setup>,
    mode: 'sequential' | 'loop-all' | 'shuffle',
    t = TRACKS.slice(0, 3),
  ) => s.director.definePlaylist({ id: 'p', tracks: t, mode });

  it('plays the next track when one finishes, in order', async () => {
    const s = setup();
    define(s, 'sequential');
    await s.director.play({ playlist: 'p' });
    expect(s.director.currentSound).toBe('music.t.explore');
    s.voice('music.t.explore').finish('finished');
    await tick();
    expect(s.director.currentSound).toBe('music.t.puzzle');
    s.voice('music.t.puzzle').finish('finished');
    await tick();
    expect(s.director.currentSound).toBe('music.t.victory');
  });

  it('a finished sequential playlist reports it once and goes quiet', async () => {
    const onFinished = vi.fn();
    const s = setup({ onFinished });
    define(s, 'sequential', ['music.t.explore']);
    await s.director.play({ playlist: 'p' });
    s.voice('music.t.explore').finish('finished');
    await tick();
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(s.live()).toEqual([]);
  });

  it('loop-all wraps to the first track', async () => {
    const s = setup();
    define(s, 'loop-all', ['music.t.explore', 'music.t.puzzle']);
    await s.director.play({ playlist: 'p' });
    s.voice('music.t.explore').finish('finished');
    await tick();
    s.voice('music.t.puzzle').finish('finished');
    await tick();
    expect(s.director.currentSound).toBe('music.t.explore');
  });

  it('shuffle follows the injected random source', async () => {
    const run = async () => {
      const s = setup({ random: () => 0 });
      define(s, 'shuffle');
      await s.director.play({ playlist: 'p' });
      const order = [s.director.currentSound];
      for (let i = 0; i < 3; i += 1) {
        s.voice(order.at(-1)!).finish('finished');
        await tick();
        order.push(s.director.currentSound);
      }
      return order;
    };
    expect(await run()).toEqual(await run());
  });

  it('plays tracks as plain one-shots so the next can follow, whatever the cue says', async () => {
    const s = setup();
    define(s, 'loop-all');
    await s.director.play({ playlist: 'p' });
    expect(s.voice('music.t.explore').options.loop).toBe(false);
  });

  it('skips a missing track and plays the next', async () => {
    const s = setup({}, ['music.t.explore']);
    define(s, 'sequential');
    await s.director.play({ playlist: 'p' });
    expect(s.director.currentSound).toBe('music.t.puzzle');
  });

  it('keeps the current music and reports once when no track can play', async () => {
    const onUnavailable = vi.fn();
    const s = setup({ onUnavailable }, ['music.t.b', 'music.t.c']);
    await s.director.play({ sound: 'music.t.explore' });
    define(s, 'loop-all', ['music.t.b', 'music.t.c']);
    expect(await s.director.play({ playlist: 'p' })).toBe(false);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(s.live()).toEqual(['music.t.explore']);
  });

  it('an empty or unknown playlist is unavailable, not an error', async () => {
    const onUnavailable = vi.fn();
    const s = setup({ onUnavailable });
    s.director.definePlaylist({ id: 'empty', tracks: [], mode: 'sequential' });
    expect(await s.director.play({ playlist: 'empty' })).toBe(false);
    expect(await s.director.play({ playlist: 'nope' })).toBe(false);
    expect(onUnavailable).toHaveBeenCalledTimes(2);
  });

  it('retry tries the wanted music again, once it exists', async () => {
    const s = setup({}, ['music.t.explore']);
    expect(await s.director.play({ sound: 'music.t.explore' })).toBe(false);
    s.manager.register({ id: 'music.t.explore', channel: 'music', url: 'u://music.t.explore' });
    expect(await s.director.retry()).toBe(true);
    expect(s.live()).toEqual(['music.t.explore']);
  });
});
