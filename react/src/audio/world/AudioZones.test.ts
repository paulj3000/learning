import { describe, expect, it } from 'vitest';
import { createSoundManager } from '../SoundManager';
import { FakeEngine, type FakeVoice } from '../testing/fakes';
import { createAudioZones, zonesFromAssignments, type ZoneSpec } from './AudioZones';

const tick = () => new Promise((r) => setTimeout(r, 0));
const CUES = ['ambient.z.sea', 'ambient.z.wood', 'ambient.z.cave', 'ambient.z.wind'];
const ZONES: ZoneSpec[] = [
  { id: 'landing', cue: 'ambient.z.sea', priority: 1 },
  { id: 'grove', cue: 'ambient.z.wood', priority: 2 },
  { id: 'ruins', cue: 'ambient.z.cave', priority: 3 },
  { id: 'lookout', cue: 'ambient.z.wind', priority: 2 },
  { id: 'quiet' },
];

function setup(missing: string[] = [], defaultCue: string | null = 'ambient.z.sea') {
  const engine = new FakeEngine();
  const manager = createSoundManager({ engine });
  for (const id of CUES.filter((c) => !missing.includes(c))) {
    manager.register({ id, channel: 'ambient', url: `u://${id}`, loop: true });
  }
  const urls = new Map<FakeVoice, string>();
  const original = engine.play.bind(engine);
  engine.play = (sound, voice, ended) => {
    const v = original(sound, voice, ended) as FakeVoice;
    urls.set(v, sound.url.replace('u://', ''));
    return v;
  };
  const scope = manager.createScope('zones');
  const zones = createAudioZones({
    player: scope,
    zones: ZONES,
    defaultCue: defaultCue ?? undefined,
    fadeMs: 500,
  });
  const live = () => engine.voices.filter((v) => !v.stopped).map((v) => urls.get(v));
  return { engine, manager, scope, zones, live };
}

describe('audio zones', () => {
  it('starts with the default bed before any zone is entered', async () => {
    const s = setup();
    await tick();
    expect(s.live()).toEqual(['ambient.z.sea']);
  });

  it('changes the bed on entry and falls back on exit, one bed at a time', async () => {
    const s = setup();
    s.zones.enter('grove');
    await tick();
    expect(s.live()).toEqual(['ambient.z.wood']);
    s.zones.exit('grove');
    await tick();
    expect(s.live()).toEqual(['ambient.z.sea']);
  });

  it('resolves overlapping zones by priority, then by most recent entry', async () => {
    const s = setup();
    s.zones.enter('landing');
    s.zones.enter('ruins');
    await tick();
    expect(s.live()).toEqual(['ambient.z.cave']);
    s.zones.enter('grove'); // lower priority than ruins: no change
    await tick();
    expect(s.live()).toEqual(['ambient.z.cave']);
    s.zones.exit('ruins');
    await tick();
    expect(s.live()).toEqual(['ambient.z.wood']);
    s.zones.enter('lookout'); // same priority as grove, entered later: it wins
    await tick();
    expect(s.live()).toEqual(['ambient.z.wind']);
  });

  it('does not restart a bed that the next zone shares, or when the same zone is re-entered', async () => {
    const s = setup();
    s.zones.enter('landing');
    await tick();
    const count = s.engine.voices.length;
    s.zones.enter('landing');
    s.zones.exit('landing');
    s.zones.enter('landing');
    await tick();
    expect(s.engine.voices).toHaveLength(count);
  });

  it('a zone with no cue keeps the bed of the zone it sits in', async () => {
    const s = setup();
    s.zones.enter('grove');
    s.zones.enter('quiet');
    await tick();
    expect(s.live()).toEqual(['ambient.z.wood']);
  });

  it('with no default and no zone, the bed fades to silence', async () => {
    const s = setup([], null);
    s.zones.enter('ruins');
    await tick();
    s.zones.exit('ruins');
    await tick();
    expect(s.live()).toEqual([]);
  });

  it('ignores unknown zones and repeated exits', async () => {
    const s = setup();
    s.zones.enter('nowhere');
    s.zones.exit('nowhere');
    s.zones.exit('grove');
    await tick();
    expect(s.zones.active).toEqual([]);
    expect(s.live()).toEqual(['ambient.z.sea']);
  });

  it('survives rapid region transitions and ends on the right bed', async () => {
    const s = setup();
    for (let i = 0; i < 6; i += 1) {
      s.zones.enter('grove');
      s.zones.exit('grove');
      s.zones.enter('ruins');
      s.zones.exit('ruins');
    }
    s.zones.enter('lookout');
    await tick();
    await tick();
    expect(s.live()).toEqual(['ambient.z.wind']);
  });

  it('is silent when a zone cue has no audio, and the game goes on', async () => {
    const s = setup(['ambient.z.cave']);
    s.zones.enter('ruins');
    await tick();
    // The cave bed has no audio: the default bed plays instead of silence.
    expect(s.live()).toEqual(['ambient.z.sea']);
    expect(() => s.zones.exit('ruins')).not.toThrow();
    await tick();
    expect(s.live()).toEqual(['ambient.z.sea']);
  });

  it('stops with the scope and ignores later events', async () => {
    const s = setup();
    s.zones.enter('grove');
    await tick();
    s.scope.dispose();
    await tick();
    expect(s.live()).toEqual([]);
    const count = s.engine.voices.length;
    s.zones.enter('ruins');
    await tick();
    expect(s.engine.voices).toHaveLength(count);
  });

  it('survives StrictMode style deactivate and activate with the same state', async () => {
    const s = setup();
    s.zones.enter('ruins');
    await tick();
    s.zones.deactivate();
    expect(s.live()).toEqual([]);
    s.zones.activate();
    await tick();
    expect(s.live()).toEqual(['ambient.z.cave']);
  });

  it('can take a new zone table from a manifest', async () => {
    const s = setup();
    s.zones.enter('grove');
    await tick();
    s.zones.setZones([{ id: 'grove', cue: 'ambient.z.wind', priority: 1 }]);
    await tick();
    expect(s.live()).toEqual(['ambient.z.wind']);
  });
});

describe('zonesFromAssignments', () => {
  it('reads zone entry assignments and their priority from a manifest', () => {
    expect(
      zonesFromAssignments([
        {
          event: 'on_enter',
          targetType: 'zone',
          targetId: 'ruins',
          soundId: 'ambient.z.cave',
          priority: 3,
        },
        { event: 'on_enter', targetType: 'zone', targetId: 'grove', soundId: 'ambient.z.wood' },
        { event: 'on_open', targetType: 'chest', targetId: 'c', soundId: 'sfx.x.y' },
        { event: 'on_exit', targetType: 'zone', targetId: 'grove', soundId: 'ambient.z.wood' },
      ]),
    ).toEqual([
      { id: 'ruins', cue: 'ambient.z.cave', priority: 3 },
      { id: 'grove', cue: 'ambient.z.wood', priority: 0 },
    ]);
  });
});
