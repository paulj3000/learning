import { describe, expect, it, vi } from 'vitest';
import { createSoundManager } from '../SoundManager';
import { FakeEngine } from '../testing/fakes';
import { createSpatialEmitters } from '../world';
import { createMusicStates } from '../music';
import {
  createSpeechPlayer,
  type SpeechClipInfo,
  type SpeechReference,
  type SpeechSource,
} from './SpeechPlayer';

/**
 * SM-P7 and SM-P8 together (section 26 of the brief): one engine, one context, one voice channel,
 * one ducking path, one scope. Nothing here is audible; it is the same fake engine as every other
 * test, which is the point: a positional NPC voice is not a second audio system.
 */

const tick = () => new Promise((r) => setTimeout(r, 0));
const clip = (text: string): SpeechClipInfo => ({
  url: 'https://speech.test/quill.mp3',
  expiresInSeconds: 900,
  text,
  voiceProfile: 'keeper-quill',
  cached: true,
});

function world() {
  const engine = new FakeEngine();
  const manager = createSoundManager({ engine });
  manager.register({ id: 'music.x.explore', channel: 'music', url: 'm', loop: true });
  const scope = manager.createScope('castle');
  const request = vi.fn(async (ref: SpeechReference, _signal: AbortSignal) =>
    clip(ref.kind === 'npcNode' ? 'Welcome to the castle library.' : 'Follow the glowing path.'),
  );
  const source: SpeechSource = { request };
  const speech = createSpeechPlayer({ manager, player: scope, source });
  const music = createMusicStates({
    player: scope,
    states: { exploration: { sound: 'music.x.explore' } },
  });
  return { engine, manager, scope, request, speech, music };
}

describe('a positional NPC voice and accessible narration on one engine', () => {
  it('walks the whole path: reference, voice channel, position, ducking, caption, cleanup', async () => {
    const w = world();
    await w.music.setState('exploration');
    expect(w.engine.channelGains.get('music')).toBe(0.5);
    w.manager.setListener({ position: [0, 0, 0], forward: [0, 0, -1] });

    // 1 and 2: authorized speech by reference, cached or fresh, resolved by the server.
    const done = w.speech.speak({
      reference: { kind: 'npcNode', npcId: 'keeper-quill', nodeId: 'quill-greeting' },
      fallbackText: 'Welcome to the castle library.',
      // 4: the configured 3D position, with distance attenuation parameters.
      position: { position: [3, 0, -2], refDistance: 2.5, maxDistance: 20 },
    });
    await tick();
    expect(w.request).toHaveBeenCalledWith(
      { kind: 'npcNode', npcId: 'keeper-quill', nodeId: 'quill-greeting' },
      expect.anything(),
    );

    // 3: it plays on the existing voice channel, positionally, on the one engine.
    const voice = w.engine.voices.find((v) => v.options.channel === 'voice')!;
    expect(voice.options.spatial).toMatchObject({
      position: [3, 0, -2],
      refDistance: 2.5,
      maxDistance: 20,
    });
    expect(w.manager.getSpatialStats().active).toBe(1);

    // 6: background music ducks through the manager's own path, not a second one.
    expect(w.engine.channelGains.get('music')).toBeCloseTo(0.15);
    // The saved music volume is untouched.
    expect(w.manager.getSettings().channels.music.volume).toBe(0.5);

    // 7: the caption is the server's text, matching the audio.
    expect(w.speech.getState()).toMatchObject({
      phase: 'playing',
      caption: 'Welcome to the castle library.',
    });

    // 8 and 9: when the voice ends the music is restored.
    voice.finish('finished');
    await done;
    await tick();
    expect(w.engine.channelGains.get('music')).toBe(0.5);
    expect(w.manager.getSpatialStats().active).toBe(0);
  });

  it('keeps essential narration flat while a character’s line is placed', async () => {
    const w = world();
    void w.speech.speak({ reference: { kind: 'line', id: 'castle-instruction' } });
    await tick();
    const voice = w.engine.voices.find((v) => v.options.channel === 'voice')!;
    expect(voice.options.spatial).toBeUndefined();
    expect(w.manager.getSpatialStats().active).toBe(0);
  });

  it('stops a placed voice, its caption stays readable, and music returns when its scope is disposed', async () => {
    const w = world();
    await w.music.setState('exploration');
    void w.speech.speak({
      reference: { kind: 'line', id: 'quill' },
      position: { position: [1, 0, 1] },
    });
    await tick();
    w.scope.dispose();
    await tick();
    expect(w.engine.voices.every((v) => v.stopped)).toBe(true);
    expect(w.engine.channelGains.get('music')).toBe(0.5);
    expect(w.manager.getSpatialStats().active).toBe(0);
    expect(w.speech.getState().caption).toBeTruthy();
  });

  it('shares the one voice mix: the child’s voice volume and mute apply to a placed voice', async () => {
    const w = world();
    w.manager.setChannelVolume('voice', 0.3);
    void w.speech.speak({
      reference: { kind: 'line', id: 'quill' },
      position: { position: [1, 0, 1] },
    });
    await tick();
    expect(w.engine.channelGains.get('voice')).toBe(0.3);
    w.manager.muteChannel('voice', true);
    expect(w.engine.channelGains.get('voice')).toBe(0);
    expect(w.speech.getState().caption).toBeTruthy();
  });

  it('works with emitters and speech on the same scope without a second context or mix', async () => {
    const w = world();
    const emitters = createSpatialEmitters({
      player: w.scope,
      setListener: (pose) => w.manager.setListener(pose),
    });
    w.manager.register({ id: 'ambient.x.fall', channel: 'ambient', url: 'f', loop: true });
    emitters.add({
      id: 'fall',
      soundId: 'ambient.x.fall',
      loop: true,
      read: (out) => {
        out[0] = 5;
        out[1] = 0;
        out[2] = 0;
        return true;
      },
    });
    void w.speech.speak({
      reference: { kind: 'line', id: 'quill' },
      position: { position: [1, 0, 1] },
    });
    await tick();
    expect(w.manager.getSpatialStats().active).toBe(2);
    w.scope.dispose();
    await tick();
    expect(w.manager.getSpatialStats().active).toBe(0);
  });
});
