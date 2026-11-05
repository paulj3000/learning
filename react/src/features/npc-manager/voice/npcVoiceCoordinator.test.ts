import { describe, expect, it, vi } from 'vitest';
import { createSoundManager } from '../../../audio/SoundManager';
import { FakeEngine } from '../../../audio/testing/fakes';
import {
  createSpeechPlayer,
  type SpeechClipInfo,
  type SpeechReference,
  type SpeechSource,
} from '../../../audio/speech/SpeechPlayer';
import type { NpcCommand } from '../contracts/engine';
import type { RuntimeNode } from '../contracts/types';
import {
  createNpcVoiceCoordinator,
  isNpcSpeechRef,
  toSpeechReference,
  type NpcVoiceEvent,
} from './npcVoiceCoordinator';

const tick = () => new Promise((r) => setTimeout(r, 0));
const clip = (text = 'Ahoy there!'): SpeechClipInfo => ({
  url: 'https://speech.test/clip.mp3',
  expiresInSeconds: 900,
  text,
  voiceProfile: 'pip',
  cached: false,
});

function node(nodeKey = 'greet', text = 'Ahoy there!', voiced = true): RuntimeNode {
  return {
    nodeKey,
    text,
    emotion: 'happy',
    animationState: 'wave',
    audio: null,
    speech: voiced
      ? { kind: 'npcDialogueNode', npcId: 'pip', release: 3, dialogueKey: 'hello', nodeKey }
      : null,
    allowAiHint: false,
  };
}

function setup(
  opts: { source?: SpeechSource | null; muted?: boolean; placement?: string | null } = {},
) {
  const engine = new FakeEngine();
  const manager = createSoundManager({ engine });
  const scope = manager.createScope('npc-voice');
  const request = vi.fn(async (_ref: SpeechReference, _signal: AbortSignal) => clip());
  const source = opts.source === undefined ? { request } : opts.source;
  const player = createSpeechPlayer({ manager, player: scope, source });
  const commands: NpcCommand[] = [];
  const events: NpcVoiceEvent[] = [];
  let muted = opts.muted ?? false;
  const voice = createNpcVoiceCoordinator({
    speaker: player,
    send: (c) => commands.push(c),
    placementKey: () => (opts.placement === undefined ? 'cove-pip' : opts.placement),
    isMuted: () => muted,
  });
  voice.onEvent((e) => events.push(e));
  const live = () => engine.voices.filter((v) => v.options.channel === 'voice' && !v.stopped);
  return {
    engine,
    manager,
    player,
    voice,
    request,
    commands,
    events,
    live,
    setMuted: (m: boolean) => (muted = m),
  };
}

describe('references', () => {
  it('asks the speech API with the npcDialogueNode reference, never text', async () => {
    const s = setup();
    void s.voice.play(node());
    await tick();
    expect(s.request).toHaveBeenCalledTimes(1);
    expect(s.request.mock.calls[0]?.[0]).toEqual({
      kind: 'npcDialogueNode',
      npcId: 'pip',
      release: 3,
      dialogueKey: 'hello',
      nodeKey: 'greet',
    });
    expect(JSON.stringify(s.request.mock.calls[0]?.[0])).not.toContain('Ahoy');
  });

  it('validates references and copies only the reference keys', () => {
    expect(isNpcSpeechRef(node().speech)).toBe(true);
    for (const bad of [
      null,
      { kind: 'utterance', id: 'x' },
      { ...node().speech, release: 0 },
      { ...node().speech, release: 1.5 },
      { ...node().speech, nodeKey: '' },
    ]) {
      expect(isNpcSpeechRef(bad)).toBe(false);
    }
    const extra = { ...node().speech!, text: 'injected' } as never;
    expect(toSpeechReference(extra)).not.toHaveProperty('text');
  });
});

describe('captions always show', () => {
  it('shows the authored text while loading, playing and after', async () => {
    const s = setup();
    let release!: (c: SpeechClipInfo) => void;
    s.request.mockReturnValueOnce(new Promise((r) => (release = r)));
    const done = s.voice.play(node());
    expect(s.voice.getState()).toMatchObject({ caption: 'Ahoy there!', phase: 'loading' });
    release(clip());
    await tick();
    expect(s.voice.getState()).toMatchObject({ caption: 'Ahoy there!', phase: 'speaking' });
    s.live()[0]!.finish('finished');
    expect(await done).toBe('spoken');
    expect(s.voice.getState()).toMatchObject({ caption: 'Ahoy there!', phase: 'done' });
  });

  it('a character without a voice is caption only and makes no request', async () => {
    const s = setup();
    expect(await s.voice.play(node('greet', 'Hello!', false))).toBe('text_only');
    expect(s.request).not.toHaveBeenCalled();
    expect(s.voice.getState()).toMatchObject({ caption: 'Hello!', textOnly: true });
    expect(s.commands).toEqual([]);
  });

  it('muted: no request, caption shown, completes as text only', async () => {
    const s = setup({ muted: true });
    expect(await s.voice.play(node())).toBe('text_only');
    expect(s.request).not.toHaveBeenCalled();
    expect(s.voice.getState().caption).toBe('Ahoy there!');
  });

  it('a failed request keeps the caption and completes as text only', async () => {
    const s = setup();
    s.request.mockRejectedValueOnce(new Error('503'));
    expect(await s.voice.play(node())).toBe('text_only');
    expect(s.voice.getState()).toMatchObject({ caption: 'Ahoy there!', textOnly: true });
    expect(s.commands).toEqual([]); // never talked without audio
  });

  it('speech off in this build (no source) is caption only', async () => {
    const s = setup({ source: null });
    expect(await s.voice.play(node())).toBe('text_only');
    expect(s.voice.getState().caption).toBe('Ahoy there!');
  });

  it('a playback failure stops the talk animation and keeps the caption', async () => {
    const s = setup();
    const done = s.voice.play(node());
    await tick();
    s.live()[0]!.finish('failed');
    expect(await done).toBe('text_only');
    expect(s.commands.map((c) => c.type)).toEqual(['animate', 'stop_animation']);
    expect(s.voice.getState().caption).toBe('Ahoy there!');
  });
});

describe('talk animation', () => {
  it('animates talk at the dialogue band while speaking, then returns to the base state', async () => {
    const s = setup();
    const done = s.voice.play(node());
    expect(s.commands).toEqual([]); // not while loading
    await tick();
    expect(s.commands).toEqual([
      { type: 'animate', placementKey: 'cove-pip', state: 'talk', mode: 'loop', priority: 2 },
    ]);
    s.live()[0]!.finish('finished');
    await done;
    expect(s.commands[1]).toEqual({
      type: 'stop_animation',
      placementKey: 'cove-pip',
      priority: 2,
    });
    expect(s.voice.getState().talking).toBe(false);
  });

  it('no placement means no commands, but the voice still plays', async () => {
    const s = setup({ placement: null });
    const done = s.voice.play(node());
    await tick();
    expect(s.live()).toHaveLength(1);
    s.live()[0]!.finish('finished');
    expect(await done).toBe('spoken');
    expect(s.commands).toEqual([]);
  });

  it('an engine that throws never breaks the voice', async () => {
    const engine = new FakeEngine();
    const manager = createSoundManager({ engine });
    const player = createSpeechPlayer({
      manager,
      player: manager.createScope('x'),
      source: { request: async () => clip() },
    });
    const voice = createNpcVoiceCoordinator({
      speaker: player,
      send: () => {
        throw new Error('engine gone');
      },
      placementKey: () => 'p',
    });
    const done = voice.play(node());
    await tick();
    engine.voices.find((v) => !v.stopped)!.finish('finished');
    expect(await done).toBe('spoken');
  });
});

describe('interruption', () => {
  it('a new node interrupts the old one, stops its audio and talk, and plays the new one', async () => {
    const s = setup();
    const first = s.voice.play(node('greet'));
    await tick();
    const old = s.live()[0]!;
    const second = s.voice.play(node('bye', 'See you!'));
    expect(await first).toBe('interrupted');
    expect(old.stopped).toBe(true);
    expect(s.commands.map((c) => c.type)).toEqual(['animate', 'stop_animation']);
    expect(s.voice.getState()).toMatchObject({ nodeKey: 'bye', caption: 'See you!' });
    await tick();
    s.live()[0]!.finish('finished');
    expect(await second).toBe('spoken');
    expect(s.events).toEqual([
      { type: 'voice.started', nodeKey: 'greet', spoken: true },
      { type: 'voice.completed', nodeKey: 'greet', outcome: 'interrupted' },
      { type: 'voice.started', nodeKey: 'bye', spoken: true },
      { type: 'voice.completed', nodeKey: 'bye', outcome: 'spoken' },
    ]);
  });

  it('interrupting while loading aborts the request and nothing plays late', async () => {
    const s = setup();
    let signal!: AbortSignal;
    let release!: (c: SpeechClipInfo) => void;
    s.request.mockImplementationOnce((_ref, sig) => {
      signal = sig;
      return new Promise((r) => (release = r));
    });
    const done = s.voice.play(node());
    await Promise.resolve();
    s.voice.interrupt(); // a choice was made
    expect(await done).toBe('interrupted');
    expect(signal.aborted).toBe(true);
    release(clip());
    await tick();
    expect(s.live()).toHaveLength(0);
    expect(s.commands).toEqual([]);
    expect(s.voice.getState().caption).toBe('Ahoy there!'); // still readable
  });

  it('closing (play null or interrupt clear) clears the caption', async () => {
    const s = setup();
    const done = s.voice.play(node());
    await tick();
    expect(await s.voice.play(null)).toBe('interrupted');
    expect(await done).toBe('interrupted');
    expect(s.voice.getState()).toMatchObject({ caption: null, phase: 'idle', talking: false });
    void s.voice.play(node());
    s.voice.interrupt({ clear: true });
    expect(s.voice.getState().caption).toBeNull();
  });

  it('dispose (unmount) stops audio and talk, and is idempotent', async () => {
    const s = setup();
    const done = s.voice.play(node());
    await tick();
    s.voice.dispose();
    s.voice.dispose();
    expect(await done).toBe('interrupted');
    expect(s.live()).toHaveLength(0);
    expect(s.commands.at(-1)).toMatchObject({ type: 'stop_animation' });
    expect(await s.voice.play(node())).toBe('interrupted');
  });
});

describe('sound manager settings', () => {
  it('plays on the voice channel so volume and mute apply', async () => {
    const s = setup();
    void s.voice.play(node());
    await tick();
    expect(s.live()[0]?.options.channel).toBe('voice');
  });

  it('checks mute per node', async () => {
    const s = setup();
    s.setMuted(true);
    await s.voice.play(node('a'));
    s.setMuted(false);
    void s.voice.play(node('b'));
    await tick();
    expect(s.request).toHaveBeenCalledTimes(1);
    expect(s.request.mock.calls[0]?.[0]).toMatchObject({ nodeKey: 'b' });
  });
});
