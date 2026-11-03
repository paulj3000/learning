import { describe, expect, it, vi } from 'vitest';
import { createDefaultSettings } from '../../audio/AudioChannels';
import type { ApiClient } from '../client';
import {
  audioSettingsApiFor,
  audioSettingsPath,
  createAudioSettingsApi,
  parseAudioSettings,
  settingsBody,
} from './audioSettingsApi';

const valid = () => settingsBody(createDefaultSettings());

describe('parseAudioSettings', () => {
  it('reads a complete mix', () => {
    const parsed = parseAudioSettings(valid());
    expect(parsed?.channels.music).toEqual({ volume: 0.5, muted: false });
    expect(parsed?.reducedIntensity).toBe(false);
  });

  it('refuses a mix with a missing or wrong-typed field, whole', () => {
    expect(parseAudioSettings(null)).toBeNull();
    expect(parseAudioSettings({ ...valid(), masterVolume: 'loud' })).toBeNull();
    expect(parseAudioSettings({ ...valid(), masterMuted: 1 })).toBeNull();
    expect(parseAudioSettings({ ...valid(), reducedIntensity: undefined })).toBeNull();
    const channels = { ...(valid().channels as Record<string, unknown>) };
    delete channels.voice;
    expect(parseAudioSettings({ ...valid(), channels })).toBeNull();
    expect(
      parseAudioSettings({
        ...valid(),
        channels: { ...channels, voice: { volume: 'x', muted: false } },
      }),
    ).toBeNull();
  });

  it('clamps an out-of-range volume instead of trusting it', () => {
    const parsed = parseAudioSettings({ ...valid(), masterVolume: 7 });
    expect(parsed?.masterVolume).toBe(1);
  });
});

describe('the audio settings client', () => {
  it('addresses only the child it was made for', () => {
    expect(audioSettingsPath('abc/def')).toBe('children/abc%2Fdef/audio/settings/');
  });

  it('gets and saves through the child-scoped route', async () => {
    const request = vi.fn(async () => ({ status: 200, data: valid() }));
    const api = createAudioSettingsApi({ request } as unknown as ApiClient, 'child-1');
    await api.get();
    expect(request).toHaveBeenLastCalledWith('GET', 'children/child-1/audio/settings/', {});
    await api.save(createDefaultSettings());
    expect(request).toHaveBeenLastCalledWith(
      'PATCH',
      'children/child-1/audio/settings/',
      expect.objectContaining({ body: expect.objectContaining({ masterVolume: 1 }) }),
    );
  });

  it('rejects an answer that is not a mix', async () => {
    const request = vi.fn(async () => ({ status: 200, data: { nope: true } }));
    const api = createAudioSettingsApi({ request } as unknown as ApiClient, 'c');
    await expect(api.get()).rejects.toThrow();
  });

  it('is null in a build without the Django API, and for no child', () => {
    expect(audioSettingsApiFor('c', { enabled: false })).toBeNull();
    expect(audioSettingsApiFor('', { enabled: true, baseUrl: 'http://x' })).toBeNull();
  });
});
