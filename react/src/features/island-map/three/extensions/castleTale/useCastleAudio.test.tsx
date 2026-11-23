import { StrictMode, useEffect } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createSoundManager } from '../../../../../audio/SoundManager';
import { resetSharedSoundManager } from '../../../../../audio/sharedSoundManager';
import { SoundProvider, type AudioManifestSource } from '../../../../../audio/react';
import type { LoadedSound, VoiceEndReason, VoiceOptions } from '../../../../../audio/AudioEngine';
import type { SoundManager } from '../../../../../audio/AudioTypes';
import type { ManifestScope } from '../../../../../audio/manifest/manifestTypes';
import { FakeEngine, type FakeVoice } from '../../../../../audio/testing/fakes';
import type { AgeBandValue } from '../../../../child-profile/constants';
import { WorldEngineEventBus } from '../../worldEngineEvents';
import type { CastleRoomId } from '../../castleLayout';
import { playCastleCue, setCastleSoundSink } from './castleSoundCues';
import { CASTLE_CUE_SOUNDS, CASTLE_SOUND, ROOM_AMBIENCE, SHARED_MOVEMENT } from './castleSounds';
import type { CastleTaleSceneApi } from './castleTaleScene';
import {
  AMBIENCE_FADE_MS,
  CASTLE_AUDIO_SCOPE,
  useCastleAudio,
  type CastleAudio,
} from './useCastleAudio';

const QUILL = 'keeper-quill';
const assetOf = (cue: string) => `${cue.replace(/[._]/g, '-')}@1`;
const CUE_OF_ASSET = new Map<string, string>();

class RecordingEngine extends FakeEngine {
  readonly cueOf = new Map<FakeVoice, string>();
  override play(sound: LoadedSound, options: VoiceOptions, onEnded: (r: VoiceEndReason) => void) {
    const voice = super.play(sound, options, onEnded) as FakeVoice;
    this.cueOf.set(voice, CUE_OF_ASSET.get(sound.url.replace('signed://', '')) ?? sound.url);
    return voice;
  }
  heard(): string[] {
    return this.voices.filter((v) => !v.stopped).map((v) => this.cueOf.get(v) ?? '?');
  }
  started(): string[] {
    return this.voices.map((v) => this.cueOf.get(v) ?? '?');
  }
  beds(): string[] {
    return this.heard().filter((cue) => cue.startsWith('ambient.'));
  }
}

const ALL_CUES = [
  ...new Set([
    ...Object.values(CASTLE_SOUND),
    ...Object.values(CASTLE_CUE_SOUNDS).flat(),
    ...Object.values(ROOM_AMBIENCE),
    ...Object.values(SHARED_MOVEMENT),
  ]),
];
for (const cue of ALL_CUES) CUE_OF_ASSET.set(assetOf(cue), cue);

const looping = (id: string) => id.startsWith('ambient.') || id.startsWith('music.');

function manifestOf(cues: readonly string[]) {
  return {
    schemaVersion: 1,
    revision: 'r1',
    scope: CASTLE_AUDIO_SCOPE,
    sounds: cues.map((id) => ({
      id,
      assetId: assetOf(id),
      channel: id.split('.')[0],
      volume: 1,
      loop: looping(id),
    })),
    assignments: [],
  };
}

/** A stand-in castle scene: the room the child stands in is whatever the test says. */
function fakeScene(start: CastleRoomId | undefined = 'entry-hall') {
  const state = { room: start as CastleRoomId | undefined };
  const api = {
    currentRoomId: () => state.room,
    quillPositionReader: () => (out: [number, number, number]) => {
      out[0] = 2;
      out[1] = 0;
      out[2] = -3;
      return true;
    },
  } as unknown as CastleTaleSceneApi;
  return { api, state };
}

interface World {
  engine: RecordingEngine;
  manager: SoundManager;
  source: AudioManifestSource | null;
  fetchManifest: ReturnType<typeof vi.fn>;
  bus: WorldEngineEventBus;
  scene: ReturnType<typeof fakeScene>;
  preferences: { applySessionDefault: Mock<(value: { reducedIntensity: boolean }) => () => void> };
  undo: Mock<() => void>;
}

function build(cues: readonly string[] = ALL_CUES): World {
  const engine = new RecordingEngine();
  const manager = createSoundManager({ engine });
  const fetchManifest = vi.fn(async (_scope: ManifestScope) => manifestOf(cues));
  const source = {
    fetchManifest,
    resolver: { resolve: async (id: string) => ({ id, url: `signed://${id}` }) },
  } as AudioManifestSource;
  const undo = vi.fn<() => void>();
  return {
    engine,
    manager,
    source,
    fetchManifest,
    bus: new WorldEngineEventBus(),
    scene: fakeScene(),
    preferences: { applySessionDefault: vi.fn((_value: { reducedIntensity: boolean }) => undo) },
    undo,
  };
}

const POLL_MS = 5;

function Castle({
  world,
  ageBand,
  onAudio,
}: {
  world: World;
  ageBand: AgeBandValue;
  onAudio: (audio: CastleAudio) => void;
}) {
  const audio = useCastleAudio({
    childId: 'child-1',
    ageBand,
    bus: world.bus,
    scene: world.scene.api,
    quillEntityId: QUILL,
    source: world.source,
    preferences: world.preferences,
    pollMs: POLL_MS,
  });
  useEffect(() => {
    onAudio(audio);
  }, [audio, onAudio]);
  return <p>castle</p>;
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
/** Long enough for the room poll to run. */
const poll = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS * 4));
    for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });

afterEach(() => {
  setCastleSoundSink(null);
  resetSharedSoundManager();
});

async function mount(world = build(), options: { ageBand?: AgeBandValue; strict?: boolean } = {}) {
  let audio: CastleAudio | undefined;
  const tree = (
    <SoundProvider manager={world.manager} unlockOnGesture={false}>
      <Castle
        world={world}
        ageBand={options.ageBand ?? 'PATHFINDER'}
        onAudio={(a) => (audio = a)}
      />
    </SoundProvider>
  );
  const view = render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
  await flush();
  return { ...world, view, audio: () => audio as CastleAudio };
}

describe('manifest and beds (SC-R06-01)', () => {
  it('loads the castle Place manifest once, never a 3D Area one (GE-090-D7)', async () => {
    const { fetchManifest } = await mount();
    expect(fetchManifest).toHaveBeenCalledTimes(1);
    // The castle has no Django WorldRegion, so a region manifest is a 404 by design.
    expect(fetchManifest.mock.calls[0]?.[0]).toEqual({ type: 'place', id: 'storykeeper-castle' });
  });

  it('starts the room bed and the exploration music once', async () => {
    const { engine } = await mount();
    expect(engine.heard().sort()).toEqual(
      [CASTLE_SOUND.ambientHall, CASTLE_SOUND.musicExplore].sort(),
    );
  });

  it('crossfades to the new room bed, one bed at a time, with a door cue', async () => {
    const world = await mount();
    world.scene.state.room = 'great-library';
    await poll();
    expect(world.engine.beds()).toEqual([CASTLE_SOUND.ambientLibrary]);
    expect(world.engine.started()).toContain(CASTLE_SOUND.door);
    const hall = world.engine.voices.find(
      (v) => world.engine.cueOf.get(v) === CASTLE_SOUND.ambientHall,
    );
    expect(hall?.stopped).toBe(true);
    expect(hall?.stopFadeMs).toBe(AMBIENCE_FADE_MS);
    world.scene.state.room = 'secret-chamber';
    await poll();
    expect(world.engine.beds()).toEqual([CASTLE_SOUND.ambientSecret]);
  });

  it('keeps the bed in a doorway (no room) and does not restart a shared bed', async () => {
    const world = await mount();
    const before = world.engine.voices.length;
    world.scene.state.room = undefined;
    await poll();
    world.scene.state.room = 'story-hall'; // the same hall bed as the entry hall
    await poll();
    expect(world.engine.beds()).toEqual([CASTLE_SOUND.ambientHall]);
    // Only the door cue started; the bed did not restart.
    expect(world.engine.started().slice(before)).toEqual([CASTLE_SOUND.door]);
  });

  it('falls back to the hall bed when a room bed has no audio', async () => {
    const world = await mount(build(ALL_CUES.filter((c) => c !== CASTLE_SOUND.ambientTower)));
    world.scene.state.room = 'setting-tower';
    await poll();
    expect(world.engine.beds()).toEqual([CASTLE_SOUND.ambientHall]);
  });

  it('plays the story theme while the Storybook is open, and exploration after', async () => {
    const { engine, audio } = await mount();
    act(() => audio().setStoryOpen(true));
    await flush();
    expect(engine.heard().filter((c) => c.startsWith('music.'))).toEqual([CASTLE_SOUND.musicStory]);
    act(() => audio().setStoryOpen(false));
    await flush();
    expect(engine.heard().filter((c) => c.startsWith('music.'))).toEqual([
      CASTLE_SOUND.musicExplore,
    ]);
  });
});

describe('moments (SC-R06-01)', () => {
  it.each([
    ['bookOpen', [CASTLE_SOUND.bookOpen]],
    ['bookClose', [CASTLE_SOUND.bookClose]],
    ['pageRestored', [CASTLE_SOUND.pageRestore]],
    ['questStart', [CASTLE_SOUND.questStart]],
    ['questComplete', ['sfx.quest.complete']],
    ['hint', [CASTLE_SOUND.hintChime]],
    ['answerRight', ['sfx.learning.correct']],
    ['answerRetry', ['sfx.learning.retry']],
    ['artifactFound', [CASTLE_SOUND.artifactFound]],
  ] as const)('%s plays its cue once', async (moment, expected) => {
    const { engine } = await mount();
    const before = engine.started().length;
    playCastleCue(moment);
    await flush();
    expect(engine.started().slice(before)).toEqual([...expected]);
  });

  it('reuses the shared learning and quest cues rather than castle copies', () => {
    expect(CASTLE_CUE_SOUNDS.answerRight).toEqual(['sfx.learning.correct']);
    expect(CASTLE_CUE_SOUNDS.answerRetry).toEqual(['sfx.learning.retry']);
    expect(CASTLE_CUE_SOUNDS.questComplete).toEqual(['sfx.quest.complete']);
  });

  it('a missing page-restore cue plays the shared reveal instead', async () => {
    const { engine } = await mount(build(ALL_CUES.filter((c) => c !== CASTLE_SOUND.pageRestore)));
    const before = engine.started().length;
    playCastleCue('pageRestored');
    await flush();
    expect(engine.started().slice(before)).toEqual([CASTLE_SOUND.treasureReveal]);
  });

  it('greets any approaching NPC (Quill from where he stands, others flat)', async () => {
    const { engine, bus } = await mount();
    act(() => bus.emit('NpcApproached', { entityId: QUILL }));
    act(() => bus.emit('NpcApproached', { entityId: 'professor-orion' }));
    await flush();
    const greets = engine.voices.filter((v) => engine.cueOf.get(v) === CASTLE_SOUND.npcGreet);
    expect(greets).toHaveLength(2);
    expect(greets[0]?.options.spatial).toMatchObject({ position: [2, 0, -3], refDistance: 2.5 });
    expect(greets[1]?.options.spatial).toBeUndefined();
  });

  it('plays the shared jump and landing cues from the castle course', async () => {
    const { engine, bus } = await mount();
    const before = engine.started().length;
    act(() => {
      bus.emit('PlayerJumped', { airJump: false });
      bus.emit('PlayerLanded', { impactSpeed: 1 });
      bus.emit('PlayerLanded', { impactSpeed: 7 });
    });
    await flush();
    expect(engine.started().slice(before)).toEqual([
      SHARED_MOVEMENT.playerJump,
      SHARED_MOVEMENT.playerLand,
    ]);
  });
});

describe('mute, volume and Sprouts (SC-R06-02)', () => {
  it('mute and volume act on the mixer without restarting the loops', async () => {
    const { engine, manager } = await mount();
    const started = engine.voices.length;
    manager.muteChannel('ambient', true);
    manager.muteChannel('music', true);
    manager.setMasterVolume(0.2);
    await flush();
    expect(engine.channelGains.get('ambient')).toBe(0);
    expect(engine.channelGains.get('music')).toBe(0);
    expect(engine.voices).toHaveLength(started);
  });

  it('never changes the child mix itself for an older child', async () => {
    const world = await mount();
    expect(world.preferences.applySessionDefault).not.toHaveBeenCalled();
    expect(world.manager.getSettings().reducedIntensity).toBe(false);
  });

  it('asks for reduced intensity as a session default for a Sprout, undone on leaving', async () => {
    const world = await mount(build(), { ageBand: 'SPROUT' });
    expect(world.preferences.applySessionDefault).toHaveBeenCalledWith({ reducedIntensity: true });
    world.view.unmount();
    expect(world.undo).toHaveBeenCalled();
  });

  it('a Sprout hears no try-again sound, but still hears right and the hint', async () => {
    const { engine } = await mount(build(), { ageBand: 'SPROUT' });
    const before = engine.started().length;
    playCastleCue('answerRetry');
    playCastleCue('answerRight');
    playCastleCue('hint');
    await flush();
    expect(engine.started().slice(before)).toEqual([
      'sfx.learning.correct',
      CASTLE_SOUND.hintChime,
    ]);
  });
});

describe('lifecycle and fallback', () => {
  it('stops every castle sound on leaving and ignores later moments', async () => {
    const world = await mount();
    world.view.unmount();
    expect(world.engine.heard()).toEqual([]);
    const count = world.engine.voices.length;
    playCastleCue('bookOpen');
    world.scene.state.room = 'trophy-room';
    await poll();
    expect(world.engine.voices.length).toBe(count);
  });

  it('is silent and does not throw when the manifest cannot be loaded', async () => {
    const world = build();
    world.fetchManifest.mockRejectedValue(new Error('offline'));
    const { engine } = await mount(world);
    expect(() => playCastleCue('pageRestored')).not.toThrow();
    await flush();
    expect(engine.voices).toHaveLength(0);
  });

  it('is silent with no audio source at all', async () => {
    const world = build();
    const { engine, fetchManifest } = await mount({ ...world, source: null });
    playCastleCue('questStart');
    await flush();
    expect(engine.voices).toHaveLength(0);
    expect(fetchManifest).not.toHaveBeenCalled();
  });

  it('is safe under StrictMode: one bed, one track, one sink', async () => {
    const { engine } = await mount(build(), { strict: true });
    expect(engine.heard().sort()).toEqual(
      [CASTLE_SOUND.ambientHall, CASTLE_SOUND.musicExplore].sort(),
    );
    playCastleCue('bookOpen');
    await flush();
    expect(engine.started().filter((c) => c === CASTLE_SOUND.bookOpen)).toHaveLength(1);
  });
});
