import { describe, expect, it } from 'vitest';
import { createSoundManager } from '../SoundManager';
import { FakeEngine, type FakeVoice } from '../testing/fakes';
import { createMusicStates, type MusicStatesOptions } from './musicStates';

function setup(missing: string[] = [], extra: Partial<MusicStatesOptions> = {}) {
  const engine = new FakeEngine();
  const manager = createSoundManager({ engine });
  for (const id of ['music.g.explore', 'music.g.puzzle', 'music.g.win', 'music.g.tense']) {
    if (!missing.includes(id)) manager.register({ id, channel: 'music', url: `u://${id}` });
  }
  const urls = new Map<FakeVoice, string>();
  const original = engine.play.bind(engine);
  engine.play = (sound, voice, ended) => {
    const v = original(sound, voice, ended) as FakeVoice;
    urls.set(v, sound.url.replace('u://', ''));
    return v;
  };
  const states = createMusicStates({
    player: manager.createScope('m'),
    crossfadeMs: 500,
    states: {
      exploration: { sound: 'music.g.explore' },
      puzzle: { sound: 'music.g.puzzle' },
      victory: { sound: 'music.g.win' },
    },
    returnTo: (finished) => (finished === 'victory' ? 'exploration' : null),
    ...extra,
  });
  const live = () => engine.voices.filter((v) => !v.stopped).map((v) => urls.get(v));
  const voice = (id: string) => engine.voices.find((v) => urls.get(v) === id && !v.stopped)!;
  return { engine, states, live, voice };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('music states', () => {
  it('moves between mapped states with crossfades', async () => {
    const s = setup();
    await s.states.setState('exploration');
    await s.states.setState('puzzle');
    expect(s.live()).toEqual(['music.g.puzzle']);
    expect(s.states.state).toBe('puzzle');
    await s.states.setState('exploration');
    expect(s.live()).toEqual(['music.g.explore']);
  });

  it('ignores a state the game did not map, and keeps playing', async () => {
    const s = setup();
    await s.states.setState('exploration');
    expect(await s.states.setState('suspense')).toBe(false);
    expect(await s.states.setState('narration')).toBe(false);
    expect(s.live()).toEqual(['music.g.explore']);
    expect(s.states.state).toBe('exploration');
  });

  it('idle is silence with a fade', async () => {
    const s = setup();
    await s.states.setState('exploration');
    await s.states.setState('idle');
    expect(s.live()).toEqual([]);
    expect(s.states.state).toBe('idle');
  });

  it('a one-shot victory hands back to exploration when it finishes', async () => {
    const s = setup();
    await s.states.setState('exploration');
    await s.states.setState('victory');
    expect(s.live()).toEqual(['music.g.win']);
    s.voice('music.g.win').finish('finished');
    await tick();
    expect(s.states.state).toBe('exploration');
    expect(s.live()).toEqual(['music.g.explore']);
  });

  it('a victory with no audio keeps the exploration music and returns to it', async () => {
    const s = setup(['music.g.win']);
    await s.states.setState('exploration');
    await s.states.setState('victory');
    await tick();
    expect(s.live()).toEqual(['music.g.explore']);
    expect(s.states.state).toBe('exploration');
  });

  it('deactivate stops all music and activate restores the state', async () => {
    const s = setup();
    await s.states.setState('puzzle');
    s.states.deactivate();
    expect(s.live()).toEqual([]);
    await s.states.activate();
    expect(s.live()).toEqual(['music.g.puzzle']);
  });

  it('can map a state to a playlist', async () => {
    const s = setup([], {
      playlists: [{ id: 'calm', tracks: ['music.g.explore', 'music.g.tense'], mode: 'loop-all' }],
      states: { suspense: { playlist: 'calm' } },
    });
    await s.states.setState('suspense');
    expect(s.live()).toEqual(['music.g.explore']);
    s.voice('music.g.explore').finish('finished');
    await tick();
    expect(s.live()).toEqual(['music.g.tense']);
  });
});
