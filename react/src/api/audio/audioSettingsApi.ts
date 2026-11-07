import { CHANNEL_IDS, clampVolume } from '../../audio/AudioChannels';
import type { SoundSettings, SoundSettingsPatch } from '../../audio/AudioTypes';
import { getAccessToken } from '../auth';
import { createApiClient, type ApiClient } from '../client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../config';

/**
 * A child's saved audio mix (SM-P5): `GET|PATCH children/<id>/audio/settings/`. Child-scoped on
 * the server by the parent's token; another family's child is a 404. This file only moves the
 * mix: what it sounds like is the Sound Manager's business.
 */

export function audioSettingsPath(childId: string): string {
  return `children/${encodeURIComponent(childId)}/audio/settings/`;
}

/**
 * Reads the server's answer into a complete mix, or `null` when it is not one. Every number is
 * clamped and every missing or wrong-typed field refuses the whole answer, so a bad response can
 * never half-apply.
 */
export function parseAudioSettings(raw: unknown): SoundSettings | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const master = clampVolume(Number(value.masterVolume));
  if (master === undefined || typeof value.masterVolume !== 'number') return null;
  if (typeof value.masterMuted !== 'boolean' || typeof value.reducedIntensity !== 'boolean') {
    return null;
  }
  const rawChannels = value.channels;
  if (typeof rawChannels !== 'object' || rawChannels === null) return null;
  const channels = {} as SoundSettings['channels'];
  for (const id of CHANNEL_IDS) {
    const entry = (rawChannels as Record<string, unknown>)[id];
    if (typeof entry !== 'object' || entry === null) return null;
    const { volume, muted } = entry as Record<string, unknown>;
    if (typeof volume !== 'number' || typeof muted !== 'boolean') return null;
    const clamped = clampVolume(volume);
    if (clamped === undefined) return null;
    channels[id] = { volume: clamped, muted };
  }
  return {
    masterVolume: master,
    masterMuted: value.masterMuted,
    reducedIntensity: value.reducedIntensity,
    channels,
  };
}

/** The whole mix as an update body (a small document; sending all of it keeps the server simple). */
export function settingsBody(settings: SoundSettings): Record<string, unknown> {
  return {
    masterVolume: settings.masterVolume,
    masterMuted: settings.masterMuted,
    reducedIntensity: settings.reducedIntensity,
    channels: Object.fromEntries(
      CHANNEL_IDS.map((id) => [
        id,
        { volume: settings.channels[id].volume, muted: settings.channels[id].muted },
      ]),
    ),
  };
}

export function toPatch(settings: SoundSettings): SoundSettingsPatch {
  return {
    masterVolume: settings.masterVolume,
    masterMuted: settings.masterMuted,
    reducedIntensity: settings.reducedIntensity,
    channels: Object.fromEntries(CHANNEL_IDS.map((id) => [id, { ...settings.channels[id] }])),
  };
}

export interface AudioSettingsApi {
  /** Resolves a complete mix; rejects on any failure (the caller decides what silence means). */
  get(signal?: AbortSignal): Promise<SoundSettings>;
  save(settings: SoundSettings, signal?: AbortSignal): Promise<SoundSettings>;
}

export function createAudioSettingsApi(client: ApiClient, childId: string): AudioSettingsApi {
  const path = audioSettingsPath(childId);
  const read = (data: unknown): SoundSettings => {
    const parsed = parseAudioSettings(data);
    if (!parsed) throw new Error('the audio settings answer was not valid');
    return parsed;
  };
  return {
    async get(signal) {
      const response = await client.request('GET', path, signal ? { signal } : {});
      return read(response.data);
    },
    async save(settings, signal) {
      const response = await client.request('PATCH', path, {
        body: settingsBody(settings),
        ...(signal ? { signal } : {}),
      });
      return read(response.data);
    },
  };
}

/** The API for a child, or `null` when this build has no Django API (the mix is not saved). */
export function audioSettingsApiFor(
  childId: string,
  config: DjangoApiConfig = DJANGO_API_CONFIG,
): AudioSettingsApi | null {
  if (!config.enabled || !childId) return null;
  return createAudioSettingsApi(
    createApiClient({ baseUrl: config.baseUrl, getAccessToken }),
    childId,
  );
}
