import { StrictMode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSoundManager } from '../../../audio/SoundManager';
import { resetSharedSoundManager } from '../../../audio/sharedSoundManager';
import { SoundProvider } from '../../../audio/react';
import { FakeEngine } from '../../../audio/testing/fakes';
import type { SoundManager, SoundSettings } from '../../../audio/AudioTypes';
import type { SpeechClipInfo, SpeechSource } from '../../../audio/speech/SpeechPlayer';
import type { NpcCommand } from '../contracts/engine';
import type { RuntimeNode } from '../contracts/types';
import { useNpcVoice, voiceIsSilent, type UseNpcVoice } from './useNpcVoice';

afterEach(() => resetSharedSoundManager());
const tick = () =>
  act(async () => {
    for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
const clip = (): SpeechClipInfo => ({
  url: 'https://s.test/a.mp3',
  expiresInSeconds: 900,
  text: 'Ahoy!',
  voiceProfile: 'pip',
  cached: false,
});
const NODE: RuntimeNode = {
  nodeKey: 'greet',
  text: 'Ahoy!',
  emotion: 'happy',
  animationState: null,
  audio: null,
  speech: {
    kind: 'npcDialogueNode',
    npcId: 'pip',
    release: 1,
    dialogueKey: 'hello',
    nodeKey: 'greet',
  },
  allowAiHint: false,
};

function Probe(props: {
  source: SpeechSource | null;
  send: (c: NpcCommand) => void;
  onReady: (v: UseNpcVoice) => void;
}) {
  const voice = useNpcVoice({
    childId: 'kid',
    placementKey: 'cove-pip',
    send: props.send,
    source: props.source,
  });
  props.onReady(voice);
  return <p role="status">{voice.state.caption ?? ''}</p>;
}

function world(strict = false) {
  const engine = new FakeEngine();
  const manager = createSoundManager({ engine });
  const request = vi.fn(async () => clip());
  const send = vi.fn();
  let voice!: UseNpcVoice;
  const wrap = (m: SoundManager = manager) => {
    const tree = (
      <SoundProvider manager={m} unlockOnGesture={false}>
        <Probe source={{ request }} send={send} onReady={(v) => (voice = v)} />
      </SoundProvider>
    );
    return strict ? <StrictMode>{tree}</StrictMode> : tree;
  };
  const live = () => engine.voices.filter((v) => v.options.channel === 'voice' && !v.stopped);
  return { engine, manager, request, send, wrap, live, voice: () => voice };
}

describe('useNpcVoice', () => {
  it('captions, speaks on the voice channel, drives talk and completes', async () => {
    const w = world(true);
    render(w.wrap());
    await tick();
    let done!: Promise<string>;
    act(() => {
      done = w.voice().play(NODE);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Ahoy!');
    await tick();
    expect(w.request).toHaveBeenCalledTimes(1);
    expect(w.live()).toHaveLength(1);
    expect(w.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'animate', state: 'talk' }),
    );
    act(() => w.live()[0]!.finish('finished'));
    await tick();
    expect(await done).toBe('spoken');
    expect(w.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'stop_animation', placementKey: 'cove-pip' }),
    );
  });

  it('muted in the Sound Manager: caption only, no request', async () => {
    const w = world();
    w.manager.setMuted(true);
    render(w.wrap());
    await tick();
    let outcome!: Promise<string>;
    act(() => {
      outcome = w.voice().play(NODE);
    });
    await tick();
    expect(await outcome).toBe('text_only');
    expect(w.request).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Ahoy!');
  });

  it('reports silent live from the Sound Manager, and speechAvailable from the source (LAI-NPC-038)', async () => {
    const w = world();
    render(w.wrap());
    await tick();
    expect(w.voice().silent).toBe(false);
    expect(w.voice().speechAvailable).toBe(true);
    act(() => w.manager.setMuted(true));
    expect(w.voice().silent).toBe(true);
    act(() => w.manager.setMuted(false));
    act(() => w.manager.setChannelVolume('voice', 0));
    expect(w.voice().silent).toBe(true);
    act(() => w.manager.setChannelVolume('voice', 1));
    expect(w.voice().silent).toBe(false);
  });

  it('a null source is captions only: speechAvailable is false', async () => {
    const engine = new FakeEngine();
    const manager = createSoundManager({ engine });
    let voice!: UseNpcVoice;
    render(
      <SoundProvider manager={manager} unlockOnGesture={false}>
        <Probe source={null} send={vi.fn()} onReady={(v) => (voice = v)} />
      </SoundProvider>,
    );
    await tick();
    expect(voice.speechAvailable).toBe(false);
    act(() => void voice.play(NODE));
    await tick();
    expect(screen.getByRole('status')).toHaveTextContent('Ahoy!');
  });

  it('unmounting stops the voice and the talk animation', async () => {
    const w = world();
    const view = render(w.wrap());
    await tick();
    let done!: Promise<string>;
    act(() => {
      done = w.voice().play(NODE);
    });
    await tick();
    view.unmount();
    expect(await done).toBe('interrupted');
    expect(w.live()).toHaveLength(0);
    expect(w.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'stop_animation' }));
  });
});

describe('voiceIsSilent', () => {
  const base = (patch: Partial<SoundSettings> = {}, voice = { volume: 1, muted: false }) =>
    ({
      masterVolume: 1,
      masterMuted: false,
      reducedIntensity: false,
      channels: { voice, music: voice, ambient: voice, sfx: voice, ui: voice },
      ...patch,
    }) as SoundSettings;
  it('is true for master mute, zero master, voice mute or zero voice', () => {
    expect(voiceIsSilent(base())).toBe(false);
    expect(voiceIsSilent(base({ masterMuted: true }))).toBe(true);
    expect(voiceIsSilent(base({ masterVolume: 0 }))).toBe(true);
    expect(voiceIsSilent(base({}, { volume: 1, muted: true }))).toBe(true);
    expect(voiceIsSilent(base({}, { volume: 0, muted: false }))).toBe(true);
  });
});
