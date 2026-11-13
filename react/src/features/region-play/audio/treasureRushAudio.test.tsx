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
import {
  hasSceneAudio,
  useTreasureRushAudio,
  type TreasureRushAudio,
  type TreasureRushSceneAudio,
} from './useTreasureRushAudio';
import { CUE_SOUNDS, LANDING_SOUND_MIN_SPEED, TR_SOUND, ZONE_AMBIENCE } from './treasureRushSounds';

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
  TR_SOUND.ambientWind,
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
  const scene = null as TreasureRushSceneAudio | null;
  return { engine, manager, source, fetchManifest, scene, bus: new WorldEngineEventBus() };
}

interface HarnessProps {
  manager: SoundManager;
  source: AudioManifestSource | null;
  bus: WorldEngineEventBus;
  scene?: TreasureRushSceneAudio | null;
  onAudio?: (audio: TreasureRushAudio) => void;
}

function Game({ source, bus, scene, onAudio }: Omit<HarnessProps, 'manager'>) {
  const audio = useTreasureRushAudio({
    childId: 'child-1',
    regionId: REGION,
    bus,
    source,
    scene,
  });
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

  /** The engine reports the entry and the exit of a move between zones, in that order. */
  const move = (bus: WorldEngineEventBus, from: string, to: string) =>
    act(() => {
      bus.emit('PlayerEnteredZone', { zoneId: to });
      bus.emit('PlayerLeftZone', { zoneId: from });
    });

  it('changes the ambience as the child moves between zones, one bed at a time', async () => {
    const { engine, bus } = await mount();
    act(() => bus.emit('PlayerEnteredZone', { zoneId: 'cove-zone-landing' }));
    move(bus, 'cove-zone-landing', 'cove-zone-grove');
    await flush();
    expect(engine.heard()).toContain(TR_SOUND.ambientJungle);
    expect(engine.heard()).not.toContain(TR_SOUND.ambientOcean);
    move(bus, 'cove-zone-grove', 'cove-zone-ruins');
    await flush();
    expect(engine.heard()).toContain(TR_SOUND.ambientCave);
    expect(engine.heard()).not.toContain(TR_SOUND.ambientJungle);
    move(bus, 'cove-zone-ruins', 'cove-zone-beach');
    await flush();
    const beds = engine.heard().filter((c) => c.startsWith('ambient.'));
    expect(beds).toEqual([TR_SOUND.ambientOcean]);
  });

  it('plays the wind at Lookout Point and returns to the shore bed when the child leaves it (SM-P7)', async () => {
    const { engine, bus } = await mount();
    act(() => bus.emit('PlayerEnteredZone', { zoneId: 'cove-zone-ruins' }));
    move(bus, 'cove-zone-ruins', 'cove-zone-lookout');
    await flush();
    expect(engine.heard().filter((c) => c.startsWith('ambient.'))).toEqual([TR_SOUND.ambientWind]);
    act(() => bus.emit('PlayerLeftZone', { zoneId: 'cove-zone-lookout' }));
    await flush();
    // Leaving every zone falls back to the entry bed.
    expect(engine.heard().filter((c) => c.startsWith('ambient.'))).toEqual([TR_SOUND.ambientOcean]);
  });

  it('lets a higher-priority zone win when zones overlap', async () => {
    const { engine, bus } = await mount();
    act(() => bus.emit('PlayerEnteredZone', { zoneId: 'cove-zone-grove' }));
    act(() => bus.emit('PlayerEnteredZone', { zoneId: 'cove-zone-ruins' }));
    await flush();
    expect(engine.heard().filter((c) => c.startsWith('ambient.'))).toEqual([TR_SOUND.ambientCave]);
  });

  it('survives a rapid run of region transitions and ends on the right bed', async () => {
    const { engine, bus } = await mount();
    for (let i = 0; i < 5; i += 1) {
      act(() => {
        bus.emit('PlayerEnteredZone', { zoneId: 'cove-zone-grove' });
        bus.emit('PlayerLeftZone', { zoneId: 'cove-zone-grove' });
        bus.emit('PlayerEnteredZone', { zoneId: 'cove-zone-ruins' });
        bus.emit('PlayerLeftZone', { zoneId: 'cove-zone-ruins' });
      });
    }
    act(() => bus.emit('PlayerEnteredZone', { zoneId: 'cove-zone-lookout' }));
    await flush();
    expect(engine.heard().filter((c) => c.startsWith('ambient.'))).toEqual([TR_SOUND.ambientWind]);
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

/** A stand-in for the 3D scene's audio view: positions, a camera matrix and a frame loop. */
function fakeScene() {
  const frames = new Set<(delta: number) => void>();
  const positions = new Map<string, [number, number, number]>();
  const camera = {
    matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
  };
  const reader = (position: [number, number, number]) => (out: [number, number, number]) => {
    out[0] = position[0];
    out[1] = position[1];
    out[2] = position[2];
    return true;
  };
  const api: TreasureRushSceneAudio = {
    entityPositionReader: (id) => (positions.has(id) ? reader(positions.get(id)!) : undefined),
    unlockPositionReader: () => reader([0, 0, -36]),
    listenerSource: () => camera,
    onFrame: (callback) => {
      frames.add(callback);
      return () => void frames.delete(callback);
    },
  };
  return {
    api,
    positions,
    camera,
    frames,
    tick: () => frames.forEach((callback) => callback(0.016)),
  };
}

describe('spatial one-shots and the listener (SM-P7-06)', () => {
  const withScene = async (cues: readonly string[] = ALL_CUES) => {
    const scene = fakeScene();
    scene.positions.set('cove-chest', [4, 0, 12]);
    scene.positions.set('cove-brass-key', [-20, 0, 5]);
    const mounted = await mount({ ...build(cues), scene: scene.api });
    return { ...mounted, scene };
  };
  const spatialOf = (engine: RecordingEngine, cue: string) =>
    engine.voices.find((v) => engine.cueOf.get(v) === cue)?.options.spatial;

  it('hears the chest from the chest: the opening and the reveal are placed there', async () => {
    const { engine } = await withScene();
    playCue('chestOpen', { entityId: 'cove-chest' });
    await flush();
    expect(spatialOf(engine, TR_SOUND.chestOpen)?.position).toEqual([4, 0, 12]);
    expect(spatialOf(engine, TR_SOUND.treasureReveal)?.position).toEqual([4, 0, 12]);
    expect(spatialOf(engine, TR_SOUND.chestOpen)).toMatchObject({
      refDistance: 3,
      maxDistance: 40,
    });
  });

  it('hears the key from the key, and the gate from the gate', async () => {
    const { engine } = await withScene();
    playCue('keyPickup', { entityId: 'cove-brass-key' });
    playCue('bridgeOpen', { unlock: true });
    await flush();
    expect(spatialOf(engine, TR_SOUND.keyDiscover)?.position).toEqual([-20, 0, 5]);
    expect(spatialOf(engine, TR_SOUND.bridgeOpen)?.position).toEqual([0, 0, -36]);
  });

  it('keeps feedback, rewards, quest completion and music flat, wherever they happened', async () => {
    const { engine } = await withScene();
    playCue('answerRight', { entityId: 'cove-chest' });
    playCue('answerRetry', { entityId: 'cove-chest' });
    playCue('celebrate', { entityId: 'cove-chest' });
    playCue('stoneRight', { entityId: 'cove-chest' });
    playCue('questComplete', { entityId: 'cove-chest' });
    await flush();
    for (const cue of [
      TR_SOUND.learningCorrect,
      TR_SOUND.learningRetry,
      TR_SOUND.rewardCollect,
      TR_SOUND.learningComplete,
      TR_SOUND.questComplete,
      TR_SOUND.musicVictory,
      TR_SOUND.musicExplore,
    ]) {
      expect(spatialOf(engine, cue)).toBeUndefined();
    }
  });

  it('plays flat when it does not know where something is (no scene, unknown entity)', async () => {
    const withoutScene = await mount();
    playCue('chestOpen', { entityId: 'cove-chest' });
    await flush();
    expect(spatialOf(withoutScene.engine, TR_SOUND.chestOpen)).toBeUndefined();
    expect(withoutScene.engine.heard()).toContain(TR_SOUND.chestOpen);

    const { engine } = await withScene();
    playCue('chestOpen', { entityId: 'somewhere-else' });
    await flush();
    expect(spatialOf(engine, TR_SOUND.chestOpen)).toBeUndefined();
  });

  it('follows the camera: the listener is updated on every frame, not by React', async () => {
    const { engine, scene } = await withScene();
    expect(scene.frames.size).toBe(1);
    scene.camera.matrixWorld.elements[12] = 7;
    scene.tick();
    expect(engine.listener?.position[0]).toBe(7);
    const updates = engine.listenerUpdates;
    scene.tick();
    expect(engine.listenerUpdates).toBe(updates + 1);
  });

  it('stops following the camera when the game is left, and plays nothing after', async () => {
    const { engine, scene, view } = await withScene();
    view.unmount();
    expect(scene.frames.size).toBe(0);
    playCue('chestOpen', { entityId: 'cove-chest' });
    await flush();
    expect(engine.heard()).toEqual([]);
  });

  it('is safe under StrictMode: one frame subscription and one placed sound', async () => {
    const scene = fakeScene();
    scene.positions.set('cove-chest', [1, 0, 1]);
    const { engine } = await mount({ ...build(), scene: scene.api }, true);
    expect(scene.frames.size).toBe(1);
    playCue('chestOpen', { entityId: 'cove-chest' });
    await flush();
    expect(engine.started().filter((c) => c === TR_SOUND.chestOpen)).toHaveLength(1);
  });

  it('keeps volume and mute for placed sounds', async () => {
    const { engine, manager } = await withScene();
    manager.muteChannel('sfx', true);
    expect(engine.channelGains.get('sfx')).toBe(0);
    manager.muteChannel('sfx', false);
    expect(engine.channelGains.get('sfx')).toBeGreaterThan(0);
  });

  it('a sound that is missing is silent and never blocks the rest', async () => {
    const { engine } = await withScene(ALL_CUES.filter((c) => c !== TR_SOUND.chestOpen));
    playCue('chestOpen', { entityId: 'cove-chest' });
    await flush();
    expect(engine.heard()).not.toContain(TR_SOUND.chestOpen);
    expect(engine.heard()).toContain(TR_SOUND.treasureReveal);
  });
});

describe('scene audio detection', () => {
  it('recognises a complete scene audio view and refuses a stub', () => {
    expect(hasSceneAudio(fakeScene().api)).toBe(true);
    expect(hasSceneAudio({ setChestOpen: () => undefined })).toBe(false);
    expect(hasSceneAudio(null)).toBe(false);
  });
});

describe('NPC moments (LAI-NPC-015)', () => {
  const PIP_HELLO = 'sfx.npc.pip_hello';
  function withNpcAssignment() {
    const world = build();
    const manifest = manifestOf([...ALL_CUES, PIP_HELLO]);
    manifest.assignments = [
      { event: 'on_approach', targetType: 'npc', targetId: 'pirate-pip', soundId: PIP_HELLO },
    ] as never;
    world.fetchManifest.mockImplementation(async () => manifest);
    return world;
  }

  it("plays the sound staff assigned to that NPC's event, once", async () => {
    const { engine } = await mount(withNpcAssignment());
    const before = engine.heard().length;
    playCue('npcGreet', { npcId: 'pirate-pip' });
    await flush();
    const played = engine.heard().slice(before);
    expect(played).toHaveLength(1);
    expect(played[0]).toContain('pip-hello');
  });

  it('is silent for another NPC, another event, or no assignment', async () => {
    const { engine } = await mount(withNpcAssignment());
    const before = engine.heard().length;
    playCue('npcGreet', { npcId: 'keeper-quill' });
    playCue('npcTalk', { npcId: 'pirate-pip' });
    playCue('npcGreet');
    await flush();
    expect(engine.heard().slice(before)).toEqual([]);
  });
});

describe('player movement sounds (LAI-JMP-01)', () => {
  const heardAfter = (engine: RecordingEngine, before: number) => engine.heard().slice(before);

  it('plays the jump cue when the child jumps', async () => {
    const { engine, bus } = await mount();
    const before = engine.heard().length;
    act(() => bus.emit('PlayerJumped', { airJump: false }));
    await flush();
    expect(heardAfter(engine, before)).toEqual([TR_SOUND.playerJump]);
  });

  it('plays the landing cue on a firm landing only, not on a little hop down', async () => {
    const { engine, bus } = await mount();
    const before = engine.heard().length;
    act(() => bus.emit('PlayerLanded', { impactSpeed: LANDING_SOUND_MIN_SPEED - 1 }));
    await flush();
    expect(heardAfter(engine, before)).toEqual([]);
    act(() => bus.emit('PlayerLanded', { impactSpeed: 7 }));
    await flush();
    expect(heardAfter(engine, before)).toEqual([TR_SOUND.playerLand]);
  });

  it('jumping still works, silently, when the region has no jump or landing audio', async () => {
    const world = build(
      ALL_CUES.filter((cue) => cue !== TR_SOUND.playerJump && cue !== TR_SOUND.playerLand),
    );
    const { engine, bus } = await mount(world);
    const before = engine.heard().length;
    expect(() =>
      act(() => {
        bus.emit('PlayerJumped', { airJump: false });
        bus.emit('PlayerLanded', { impactSpeed: 7 });
      }),
    ).not.toThrow();
    await flush();
    expect(heardAfter(engine, before)).toEqual([]);
  });
});

describe('footsteps (running & sprinting)', () => {
  it('plays the optional footstep cue for each step the engine reports', async () => {
    const { engine, bus } = await mount();
    const before = engine.heard().length;
    act(() => {
      bus.emit('PlayerFootstep', { gait: 'walk' });
      bus.emit('PlayerFootstep', { gait: 'sprint' });
    });
    await flush();
    expect(engine.heard().slice(before)).toEqual([
      TR_SOUND.playerFootstep,
      TR_SOUND.playerFootstep,
    ]);
  });

  it('keeps silent, and keeps going, with no footstep audio published', async () => {
    const world = build(ALL_CUES.filter((cue) => cue !== TR_SOUND.playerFootstep));
    const { engine, bus } = await mount(world);
    const before = engine.heard().length;
    expect(() => act(() => bus.emit('PlayerFootstep', { gait: 'run' }))).not.toThrow();
    await flush();
    expect(engine.heard().slice(before)).toEqual([]);
  });
});
