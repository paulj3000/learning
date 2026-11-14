import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../client';
import { createSpeechApi, parseSpeechClip, speechPath } from './speechApi';

const valid = (overrides: object = {}) => ({
  speech: {
    url: '/api/v1/speech-files/abc/speech.mp3',
    expiresInSeconds: 900,
    text: 'Hello there',
    voiceProfile: 'chatty',
    language: 'en-US',
    characters: 11,
    cached: false,
    ...overrides,
  },
});

describe('parseSpeechClip', () => {
  it('reads a valid clip and makes a same-origin path absolute', () => {
    expect(parseSpeechClip(valid(), 'https://api.test')).toMatchObject({
      url: 'https://api.test/api/v1/speech-files/abc/speech.mp3',
      text: 'Hello there',
      voiceProfile: 'chatty',
      expiresInSeconds: 900,
    });
  });

  it('accepts an https url (presigned) and nothing else', () => {
    expect(parseSpeechClip(valid({ url: 'https://s3.test/x.mp3' }))?.url).toBe(
      'https://s3.test/x.mp3',
    );
    for (const url of [
      'javascript:alert(1)',
      'http://x.test/a.mp3',
      '//evil.test/a.mp3',
      'data:audio/mp3;base64,AA',
      '',
      5,
    ]) {
      expect(parseSpeechClip(valid({ url }))).toBeNull();
    }
  });

  it('refuses a malformed answer whole', () => {
    expect(parseSpeechClip(null)).toBeNull();
    expect(parseSpeechClip({})).toBeNull();
    expect(parseSpeechClip(valid({ text: '' }))).toBeNull();
    expect(parseSpeechClip(valid({ text: 5 }))).toBeNull();
    expect(parseSpeechClip(valid({ expiresInSeconds: 0 }))).toBeNull();
    expect(parseSpeechClip(valid({ expiresInSeconds: 99999 }))).toBeNull();
  });
});

describe('the speech client', () => {
  it('addresses only its child and sends a reference, never text', async () => {
    const request = vi.fn(async () => ({ status: 200, data: valid() }));
    const api = createSpeechApi({ request } as unknown as ApiClient, 'kid/1');
    const clip = await api.request({ kind: 'utterance', id: 'u1' }, new AbortController().signal);
    expect(clip.text).toBe('Hello there');
    const [method, path, options] = request.mock.calls[0] as unknown as [
      string,
      string,
      { body: unknown },
    ];
    expect(method).toBe('POST');
    expect(path).toBe(speechPath('kid/1'));
    expect(options.body).toEqual({ reference: { kind: 'utterance', id: 'u1' } });
  });

  it('rejects an invalid answer', async () => {
    const request = vi.fn(async () => ({ status: 200, data: { speech: { url: 'javascript:1' } } }));
    const api = createSpeechApi({ request } as unknown as ApiClient, 'c');
    await expect(
      api.request({ kind: 'line', id: 'x' }, new AbortController().signal),
    ).rejects.toThrow();
  });

  it('reports whether speech is switched on, and false on any error', async () => {
    const on = createSpeechApi(
      { request: async () => ({ status: 200, data: { enabled: true } }) } as unknown as ApiClient,
      'c',
    );
    const broken = createSpeechApi(
      {
        request: async () => {
          throw new Error('x');
        },
      } as unknown as ApiClient,
      'c',
    );
    expect(await on.enabled()).toBe(true);
    expect(await broken.enabled()).toBe(false);
  });
});
