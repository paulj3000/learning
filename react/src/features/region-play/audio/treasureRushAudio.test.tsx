import { StrictMode, useEffect, useState } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSoundManager } from '../../../audio/SoundManager';
import { resetSharedSoundManager } from '../../../audio/sharedSoundManager';
import { SoundProvider, type AudioManifestSource } from '../../../audio/react';
import type { LoadedSound, VoiceEndReason, VoiceOptions } from '../../../audio/AudioEngine';
import type { SoundManager } from '../../../audio/AudioTypes';
import type { ManifestScope } from '../../../audio/manifest/manifestTypes';
import { FakeEngine, type FakeVoice } from '../../../audio/testing/fakes';
import { WorldEngineEventBus } from '../../island-map/three/worldEngineEvents';
import { playCue, setSoundSink } from '../soundCues';
import { useTreasureRushAudio, type TreasureRushAudio } from './useTreasureRushAudio';
import { CUE_SOUNDS, TR_SOUND, ZONE_AMBIENCE } from './treasureRushSounds';

const REGION = 'treasure-rush-cove';
/** Asset ids are slugs: the cue id with dashes, as `seed_treasure_rush_sound` expects. */
const assetOf = (cue: string) => `${cue.replace(/[._]/g, '-')}@1`;
const CUE_OF_ASSET = new Map<string, string>();

class RecordingEngine extends FakeEngine {
  readonly cueOf = new Map<FakeVoice, string>();
  override play(sound: LoadedSound, options: VoiceOptions, onEnded: (r: VoiceEndReason) => void) {
    const voice = super.play(sound, options, onEnded) as FakeVoice;
    this.cueOf.set(voice, CUE_OF_ASSET.get(sound.url.replace('signed://', '')) ?? sound.url);
    return voice;
  }
  /** Cues of voices that are still sounding. */
  heard(): string[] {
    return this.voices.filter((v) => !v.stopped).map((v) => this.cueOf.get(v) ?? '?');
  }
  /** Every cue ever started, in order. */
  started(): string[] {
    return this.voices.map((v) => this.cueOf.get(v) ?? '?');
  }
  voiceFor(cue: string): FakeVoice {
    const voice = this.voices.find((v) => !v.stopped && this.cueOf.get(v) === cue);
    if (!voice) throw new Error(`${cue} is not playing`);
    return voice;
  }
}

const ALL_CUES = [
  ...new Set([
    ...Object.values(TR_SOUND),
    ...Object.values(CUE_SOUNDS).flat(),
    ...Object.values(ZONE_AMBIENCE),
  ]),
];

for (const cue of ALL_CUES) CUE_OF_ASSET.set(assetOf(cue), cue);

const LOOPING = new Set<string>([
  TR_SOUND.ambientOcean,
  TR_SOUND.ambientJungle,
  TR_SOUND.ambientCave,
  TR_SOUND.musicExplore,
  TR_SOUND.musicPuzzle,
]);

function manifestOf(cues: readonly string[], revision = 'r1') {
  return {
    schemaVersion: 1,
    revision,
    scope: { type: 'region', id: REGION },
    sounds: cues.map((id) => ({
      id,
      assetId: assetOf(id),
      channel: id.split('.')[0],
      volume: 1,
      loop: LOOPING.has(id),
    })),
    assignments: [],
  };
}

function build(cues: readonly string[] = ALL_CUES) {
  const engine = new RecordingEngine();
  const manager = createSoundManager({ engine });
  const fetchManifest = vi.fn(async (_scope: ManifestScope) => manifestOf(cues));
  const source = {
    fetchManifest,
    resolver: { resolve: async (id: string) => ({ id, url: `signed://${id}` }) },
  } as AudioManifestSource | null;
  return { engine, manager, source, fetchManifest, bus: new WorldEngineEventBus() };
}

interface HarnessProps {
  manager: SoundManager;
  source: AudioManifestSource | null;
  bus: WorldEngineEventBus;
  onAudio?: (audio: TreasureRushAudio) => void;
}

function Game({ source, bus, onAudio }: Omit<HarnessProps, 'manager'>) {
  const audio = useTreasureRushAudio({ childId: 'child-1', regionId: REGION, bus, source });
  useEffect(() => {
    onAudio?.(audio);
  }, [audio, onAudio]);
  return <p>game</p>;
}

function Harness({ manager, ...rest }: HarnessProps) {
  return (
    <SoundProvider manager={manager} unlockOnGesture={false}>
      <Game {...rest} />
    </SoundProvider>
  );
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });

afterEach(() => {
  setSoundSink(null);
  resetSharedSoundManager();
});

async function mount(world = build(), strict = false) {
  let audio: TreasureRushAudio | undefined;
  const props = { ...world, onAudio: (a: TreasureRushAudio) => (audio = a) };
  const tree = (p: HarnessProps) =>
    strict ? (
      <StrictMode>
        <Harness {...p} />
      </StrictMode>
    ) : (
      <Harness {...p} />
    );
  const view = render(tree(props));
  await flush();
  return {
    ...world,
    view,
    audio: () => audio as TreasureRushAudio,
    rerender: () => view.rerender(tree(props)),
  };
}

describe('manifest integration (SM-P3-02)', () => {
  it('loads the region manifest once and registers its sounds with the shared manager', async () => {
    const { fetchManifest, manager } = await mount();
    expect(fetchManifest).toHaveBeenCalledTimes(1);
    expect(fetchManifest.mock.calls[0]?.[0]).toEqual({ type: 'region', id: REGION });
    for (const cue of ALL_CUES) expect(manager.has(cue)).toBe(true);
  });

  it('resolves audio through the asset resolver, never a hardcoded url', async () => {
    const { engine } = await mount();
    expect(engine.loadLog.length).toBeGreaterThan(0);
    for (const entry of engine.loadLog) expect(entry.url).toMatch(/^signed:\/\//);
  });

  it('plays the cues that were waiting once a late manifest arrives', async () => {
    const world = build();
    let release!: (value: ReturnType<typeof manifestOf>) => void;
    world.fetchManifest.mockImplementation(
      () =>
        new Promise<ReturnType<typeof manifestOf>>((resolve) => {
          release = resolve;
        }),
    );
    const { engine } = await mount(world);
    expect(engine.heard()).toEqual([]);
    release(manifestOf(ALL_CUES));
    await flush();
    expect(engine.heard().sort()).toEqual([TR_SOUND.ambientOcean, TR_SOUND.musicExplore].sort());
  });
});

describe('ambience by zone (SM-P3-03)', () => {
  it('starts the entry ambience and the exploration music once', async () => {
    const { engine } = await mount();
    expect(engine.heard().sort()).toEqual([TR_SOUND.ambientOcean, TR_SOUND.musicExplore].sort());
  });

  it('changes the ambience as the child moves between zones, one bed at a time', async () => {
    const { engine, bus } = await mount();
    act(() => bus.emit('PlayerEnteredZone', { zoneId: 'cove-zone-grove' }));
    await flush();
    expect(engine.heard()).toContain(TR_SOUND.ambientJungle);
    expect(engine.heard()).not.toContain(TR_SOUND.ambientOcean);
    act(() => bus.emit('PlayerEnteredZone', { zoneId: 'cove-zone-ruins' }));
    await flush();
    expect(engine.heard()).toContain(TR_SOUND.ambientCave);
    expect(engine.heard()).not.toContain(TR_SOUND.ambientJungle);
    act(() => bus.emit('PlayerEnteredZone', { zoneId: 'cove-zone-beach' }));
    await flush();
    const beds = engine.heard().filter((c) => c.startsWith('ambient.'));
    expect(beds).toEqual([TR_SOUND.ambientOcean]);
  });

  it('does not restart a bed when the next zone shares it, or the same zone is re-entered', async () => {
    const { engine, bus } = await mount();
    const before = engine.voices.length;
    act(() => bus.emit('PlayerEnteredZone', { zoneId: 'cove-zone-landing' }));
    act(() => bus.emit('PlayerEnteredZone', { zoneId: 'cove-zone-beach' }));
    act(() => bus.emit('PlayerEnteredZone', { zoneId: 'cove-zone-beach' }));
    await flush();
    expect(engine.voices.length).toBe(before);
  });

  it('ignores a zone that has no ambience and keeps the current bed', async () => {
    const { engine, bus } = await mount();
    act(() => bus.emit('PlayerEnteredZone', { zoneId: 'some-other-zone' }));
    await flush();
    expect(engine.heard()).toContain(TR_SOUND.ambientOcean);
    expect(engine.voices).toHaveLength(2);
  });
});

describe('interactive and educational sounds (SM-P3-04, SM-P3-06)', () => {
  it.each([
    ['chestOpen', [TR_SOUND.chestOpen, TR_SOUND.treasureReveal]],
    ['keyPickup', [TR_SOUND.keyDiscover]],
    ['celebrate', [TR_SOUND.rewardCollect]],
    ['bridgeOpen', [TR_SOUND.bridgeOpen]],
    ['answerRight', [TR_SOUND.learningCorrect]],
    ['answerRetry', [TR_SOUND.learningRetry]],
    ['stoneRight', [TR_SOUND.learningComplete]],
    ['stoneWrong', [TR_SOUND.learningRetry]],
    ['replayWin', [TR_SOUND.learningCorrect]],
  ] as const)('%s plays its cues once each', async (cue, expected) => {
    const { engine } = await mount();
    const before = engine.started().length;
    playCue(cue);
    await flush();
    expect(engine.started().slice(before).sort()).toEqual([...expected].sort());
  });

  it('lets rapid collection overlap instead of cutting itself off', async () => {
    const { engine } = await mount();
    playCue('keyPickup');
    playCue('keyPickup');
    playCue('keyPickup');
    await flush();
    expect(engine.heard().filter((c) => c === TR_SOUND.keyDiscover)).toHaveLength(3);
  });

  it('does not replay a sound when the component re-renders', async () => {
    const world = await mount();
    playCue('chestOpen');
    await flush();
    const count = world.engine.voices.length;
    world.rerender();
    world.rerender();
    await flush();
    expect(world.engine.voices.length).toBe(count);
  });

  it('retry feedback is soft: it uses only the retry cue, never an alarm sound', async () => {
    expect(CUE_SOUNDS.answerRetry).toEqual([TR_SOUND.learningRetry]);
    expect(CUE_SOUNDS.stoneWrong).toEqual([TR_SOUND.learningRetry]);
  });
});

describe('music (SM-P3-05)', () => {
  it('switches to the puzzle theme while a puzzle is out and back afterwards', async () => {
    const { engine, audio } = await mount();
    act(() => audio().setPuzzleActive(true));
    await flush();
    expect(engine.heard()).toContain(TR_SOUND.musicPuzzle);
    expect(engine.heard()).not.toContain(TR_SOUND.musicExplore);
    act(() => audio().setPuzzleActive(true));
    act(() => audio().setPuzzleActive(false));
    await flush();
    expect(engine.heard().filter((c) => c.startsWith('music.'))).toEqual([TR_SOUND.musicExplore]);
  });

  it('fades the old track out rather than cutting it', async () => {
    const { engine, audio } = await mount();
    const explore = engine.voiceFor(TR_SOUND.musicExplore);
    act(() => audio().setPuzzleActive(true));
    await flush();
    expect(explore.stopped).toBe(true);
    expect(explore.stopFadeMs).toBeGreaterThan(0);
  });

  it('plays the victory theme on quest completion, then restores exploration music', async () => {
    const { engine } = await mount();
    playCue('questComplete');
    await flush();
    expect(engine.heard()).toContain(TR_SOUND.questComplete);
    expect(engine.heard().filter((c) => c.startsWith('music.'))).toEqual([TR_SOUND.musicVictory]);
    act(() => engine.voiceFor(TR_SOUND.musicVictory).finish('finished'));
    await flush();
    expect(engine.heard().filter((c) => c.startsWith('music.'))).toEqual([TR_SOUND.musicExplore]);
  });

  it('plays victory only once for a repeated completion moment', async () => {
    const { engine } = await mount();
    playCue('questComplete');
    playCue('questComplete');
    await flush();
    expect(engine.started().filter((c) => c === TR_SOUND.musicVictory)).toHaveLength(1);
  });

  it('returns to exploration music at once when the victory audio is missing', async () => {
    const { engine } = await mount(build(ALL_CUES.filter((c) => c !== TR_SOUND.musicVictory)));
    playCue('questComplete');
    await flush();
    expect(engine.heard().filter((c) => c.startsWith('music.'))).toEqual([TR_SOUND.musicExplore]);
  });
});

describe('lifecycle and cleanup (SM-P3-07)', () => {
  it('stops every Treasure Rush sound when the game unmounts and ignores later moments', async () => {
    const { engine, view } = await mount();
    playCue('keyPickup');
    await flush();
    view.unmount();
    expect(engine.heard()).toEqual([]);
    const count = engine.voices.length;
    playCue('chestOpen');
    await flush();
    expect(engine.voices.length).toBe(count);
  });

  it('never starts audio from a manifest that arrives after the game was left', async () => {
    const world = build();
    let release!: (value: ReturnType<typeof manifestOf>) => void;
    world.fetchManifest.mockImplementation(
      () =>
        new Promise<ReturnType<typeof manifestOf>>((resolve) => {
          release = resolve;
        }),
    );
    const { engine, view } = await mount(world);
    view.unmount();
    release(manifestOf(ALL_CUES));
    await flush();
    expect(engine.voices).toHaveLength(0);
  });

  it('does not stop sounds that belong to the app, outside the game scope', async () => {
    const world = build();
    world.manager.register({ id: 'ui.menu.select', channel: 'ui', url: 'signed://ui' });
    const { engine, view } = await mount(world);
    await world.manager.play('ui.menu.select');
    view.unmount();
    expect(engine.heard()).toEqual(['signed://ui']);
  });

  it('replay: leaving and re-entering leaves exactly one bed and one track, none from before', async () => {
    const world = build();
    const first = await mount(world);
    first.view.unmount();
    const second = await mount(world);
    expect(second.engine.heard().sort()).toEqual(
      [TR_SOUND.ambientOcean, TR_SOUND.musicExplore].sort(),
    );
  });

  it('survives rapid entry and exit', async () => {
    const world = build();
    for (let i = 0; i < 5; i += 1) {
      const m = await mount(world);
      m.view.unmount();
    }
    expect(world.engine.heard()).toEqual([]);
    const last = await mount(world);
    expect(last.engine.heard()).toHaveLength(2);
  });

  it('is safe under React StrictMode: one bed, one track, one sink', async () => {
    const { engine } = await mount(build(), true);
    expect(engine.heard().sort()).toEqual([TR_SOUND.ambientOcean, TR_SOUND.musicExplore].sort());
    playCue('keyPickup');
    await flush();
    expect(engine.started().filter((c) => c === TR_SOUND.keyDiscover)).toHaveLength(1);
  });
});

describe('fallback without audio (SM-P3-08)', () => {
  it('stays silent and does not throw when the manifest cannot be loaded', async () => {
    const world = build();
    world.fetchManifest.mockRejectedValue(new Error('network down'));
    const { engine, manager } = await mount(world);
    expect(() => playCue('chestOpen')).not.toThrow();
    await flush();
    expect(engine.voices).toHaveLength(0);
    expect(manager.getDiagnostics().some((d) => d.code === 'manifest-failed')).toBe(true);
  });

  it('is silent with an empty manifest, and records the missing cues for developers', async () => {
    const { engine, manager } = await mount(build([]));
    playCue('answerRight');
    await flush();
    expect(engine.voices).toHaveLength(0);
    expect(manager.getDiagnostics().some((d) => d.code === 'missing-sound')).toBe(true);
  });

  it('plays the cues that exist when one is missing', async () => {
    const { engine } = await mount(build(ALL_CUES.filter((c) => c !== TR_SOUND.questComplete)));
    playCue('questComplete');
    await flush();
    expect(engine.heard()).not.toContain(TR_SOUND.questComplete);
    expect(engine.heard()).toContain(TR_SOUND.musicVictory);
  });

  it('is silent, and requests nothing, when the build has no audio source', async () => {
    const world = build();
    const { engine, fetchManifest } = await mount({ ...world, source: null });
    playCue('keyPickup');
    await flush();
    expect(engine.voices).toHaveLength(0);
    expect(fetchManifest).not.toHaveBeenCalled();
  });

  it('does not retry a failing cue on its own', async () => {
    const world = build();
    world.engine.failLoad = Object.assign(new Error('x'), { code: 'load-failed' }) as never;
    const { engine } = await mount(world);
    const loads = engine.loadLog.length;
    await flush();
    await flush();
    expect(engine.loadLog.length).toBe(loads);
  });

  it('survives a blocked or suspended audio context', async () => {
    const world = build();
    world.engine.setState('suspended');
    const { engine } = await mount(world);
    expect(() => playCue('chestOpen')).not.toThrow();
    await flush();
    expect(engine.voices.length).toBeGreaterThanOrEqual(0);
  });
});

describe('volume and mute (SM-P3-09)', () => {
  it('mute and volume act on the mixer without restarting or stopping the loops', async () => {
    const { engine, manager } = await mount();
    const started = engine.voices.length;
    manager.muteChannel('music', true);
    manager.muteChannel('ambient', true);
    manager.setMasterVolume(0.3);
    await flush();
    expect(engine.channelGains.get('music')).toBe(0);
    expect(engine.channelGains.get('ambient')).toBe(0);
    expect(engine.voices).toHaveLength(started);
    expect(engine.heard()).toHaveLength(2);
    manager.muteChannel('music', false);
    expect(engine.channelGains.get('music')).toBeGreaterThan(0);
  });

  it('a muted effects channel still lets the game run', async () => {
    const { manager } = await mount();
    manager.muteChannel('sfx', true);
    expect(() => playCue('chestOpen')).not.toThrow();
  });
});

describe('the game does not depend on the shared mount state', () => {
  it('a re-mounted child under a stateful parent keeps one sink', async () => {
    const world = build();
    function Parent() {
      const [shown, setShown] = useState(true);
      return (
        <>
          <button onClick={() => setShown((s) => !s)}>toggle</button>
          {shown ? <Harness {...world} /> : null}
        </>
      );
    }
    const view = render(<Parent />);
    await flush();
    act(() => view.getByText('toggle').click());
    await flush();
    act(() => view.getByText('toggle').click());
    await flush();
    playCue('keyPickup');
    await flush();
    expect(world.engine.started().filter((c) => c === TR_SOUND.keyDiscover)).toHaveLength(1);
  });
});
