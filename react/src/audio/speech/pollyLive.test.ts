import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../api/client';
import { createSpeechApi } from '../../api/speech/speechApi';
import { createSoundManager } from '../SoundManager';
import { FakeEngine } from '../testing/fakes';
import { createSpeechPlayer, type SpeechReference } from './SpeechPlayer';

/**
 * SM-P8-LIVE (client): the real speech API client over a fake `fetch`, driving the real
 * SpeechPlayer on the shared Sound Manager. Every answer the live Polly path can give (a fresh
 * clip, a cache hit, throttling, a timeout, IAM denial, an invalid voice, malformed input, a
 * storage failure, another family's child, a malformed answer) leaves the child with a readable
 * caption and never an exception. Mute and volume come from the child's voice channel, and
 * Pirate Pip's published lines are asked for by reference only.
 */

const BASE = 'https://api.test';
const CHILD = 'child-1';
const PIP: SpeechReference = {
  kind: 'npcDialogueNode',
  npcId: 'pirate-pip',
  release: 3,
  dialogueKey: 'greeting',
  nodeKey: 'hello',
};
const PIP_LINE = 'Ahoy, matey! Welcome to Treasure Cove.';
const tick = () => new Promise((r) => setTimeout(r, 0));

const ok = (cached: boolean, url = '/api/v1/speech-files/tok/speech.mp3') => ({
  status: 200,
  body: {
    speech: {
      url,
      expiresInSeconds: 900,
      text: PIP_LINE,
      voiceProfile: 'pirate-pip',
      language: 'en-US',
      characters: PIP_LINE.length,
      cached,
    },
  },
});
const failure = (status: number, code: string, message: string) => ({
  status,
  body: { error: { code, message }, request_id: 'req-1' },
});

function setup(answers: Array<{ status: number; body: unknown } | Error>) {
  const queue = [...answers];
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = queue.shift();
    if (!next) throw new Error('no more answers');
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const client = createApiClient({
    baseUrl: BASE,
    getAccessToken: async () => 'token',
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  const api = createSpeechApi(client, CHILD, BASE);
  const engine = new FakeEngine();
  const manager = createSoundManager({ engine });
  const scope = manager.createScope('pip');
  const speech = createSpeechPlayer({ manager, player: scope, source: api });
  const voices = () => engine.voices.filter((v) => v.options.channel === 'voice' && !v.stopped);
  return { fetch, engine, manager, speech, voices };
}

describe('Pirate Pip on the live Polly path', () => {
  it('asks for a published Pip node by reference only, plays it, and shows his words', async () => {
    const s = setup([ok(false)]);
    void s.speech.speak({
      reference: PIP,
      fallbackText: PIP_LINE,
      position: { position: [1, 1, 0] },
    });
    await tick();
    await tick();
    const [url, init] = s.fetch.mock.calls[0]!;
    expect(url).toBe(`${BASE}/api/v1/children/${CHILD}/audio/speech/`);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual({ reference: PIP });
    expect(JSON.stringify(body)).not.toContain(PIP_LINE);
    expect(s.voices()).toHaveLength(1);
    expect(s.engine.loadLog.map((l) => l.url)).toEqual([
      `${BASE}/api/v1/speech-files/tok/speech.mp3`,
    ]);
    expect(s.speech.getState()).toMatchObject({ phase: 'playing', caption: PIP_LINE });
  });

  it('plays a cached clip the same way and accepts a presigned https url', async () => {
    const s = setup([ok(true, 'https://speech.s3.amazonaws.com/speech/shared/ab/x.mp3?sig=1')]);
    void s.speech.speak({ reference: PIP });
    await tick();
    await tick();
    expect(s.engine.loadLog[0]?.url).toMatch(/^https:\/\/speech\.s3\.amazonaws\.com\//);
  });

  it('respects the child’s mute: silent playback, caption still shown', async () => {
    const s = setup([ok(true)]);
    s.manager.setChannelVolume('voice', 0.6);
    s.manager.muteChannel('voice', true);
    void s.speech.speak({ reference: PIP, fallbackText: PIP_LINE });
    await tick();
    await tick();
    expect(s.engine.channelGains.get('voice')).toBe(0);
    expect(s.speech.getState().caption).toBe(PIP_LINE);
    s.manager.muteChannel('voice', false);
    expect(s.engine.channelGains.get('voice')).toBe(0.6);
  });

  it.each([
    ['throttling', failure(503, 'speech_unavailable', 'Speech could not be made right now.')],
    ['a timeout', failure(503, 'speech_unavailable', 'Speech could not be made right now.')],
    ['IAM denial', failure(503, 'speech_unavailable', 'Speech could not be made right now.')],
    ['an invalid voice', failure(503, 'speech_unavailable', 'This voice is not available.')],
    ['a storage failure', failure(503, 'speech_unavailable', 'Speech could not be saved.')],
    ['the daily limit', failure(429, 'rate_limited', 'Too much speech today. Try again tomorrow.')],
    [
      'malformed input',
      failure(400, 'invalid_reference', 'That is not something that can be spoken.'),
    ],
    ['rejected text', failure(422, 'speech_rejected', 'That line cannot be spoken.')],
    ['another family’s child', failure(404, 'not_found', 'That line is not available.')],
    ['speech switched off', failure(503, 'speech_disabled', 'Spoken dialogue is turned off.')],
    ['a malformed answer', { status: 200, body: { speech: { url: 'javascript:alert(1)' } } }],
  ])('falls back to the caption on %s, without throwing or playing', async (_name, answer) => {
    const s = setup([answer]);
    await expect(
      s.speech.speak({ reference: PIP, fallbackText: PIP_LINE }),
    ).resolves.toBeUndefined();
    expect(s.speech.getState()).toMatchObject({
      phase: 'failed',
      caption: PIP_LINE,
      captionFrom: 'fallback',
      textOnly: true,
    });
    expect(s.voices()).toHaveLength(0);
  });

  it('falls back to the caption when the network itself fails', async () => {
    const s = setup([new TypeError('Failed to fetch')]);
    await s.speech.speak({ reference: PIP, fallbackText: PIP_LINE });
    expect(s.speech.getState()).toMatchObject({ phase: 'failed', textOnly: true });
  });

  it('can be heard again after a failure once the server recovers', async () => {
    const s = setup([
      failure(503, 'speech_unavailable', 'Speech could not be made right now.'),
      ok(true),
    ]);
    await s.speech.speak({ reference: PIP, fallbackText: PIP_LINE });
    expect(s.speech.getState().phase).toBe('failed');
    void s.speech.speak({ reference: PIP, fallbackText: PIP_LINE });
    await tick();
    await tick();
    expect(s.speech.getState().phase).toBe('playing');
  });
});
