import { getAccessToken } from '../auth';
import { createApiClient, type ApiClient } from '../client';
import { DJANGO_API_CONFIG, type DjangoApiConfig } from '../config';
import type {
  SpeechClipInfo,
  SpeechReference,
  SpeechSource,
} from '../../audio/speech/SpeechPlayer';

/**
 * Django's speech API (SM-P8): `POST children/<id>/audio/speech/` with a reference to something
 * the server approved. There is no way to send text. Read-only on the client otherwise; staff
 * manage voices and lines in Django Admin.
 */

export function speechPath(childId: string): string {
  return `children/${encodeURIComponent(childId)}/audio/speech/`;
}

/** A clip's url must be a same-origin path or https; anything else (for example javascript:) is refused. */
function safeUrl(url: unknown, baseUrl: string): string | null {
  if (typeof url !== 'string' || url.length === 0 || url.length > 2048) return null;
  if (url.startsWith('/') && !url.startsWith('//')) return `${baseUrl.replace(/\/+$/, '')}${url}`;
  return /^https:\/\/[^\s]+$/.test(url) ? url : null;
}

/** Reads the server's answer into a clip, or `null` when it is not a valid one. */
export function parseSpeechClip(raw: unknown, baseUrl = ''): SpeechClipInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const speech = (raw as { speech?: unknown }).speech;
  if (typeof speech !== 'object' || speech === null) return null;
  const s = speech as Record<string, unknown>;
  const url = safeUrl(s.url, baseUrl);
  if (!url) return null;
  if (typeof s.text !== 'string' || s.text.trim() === '' || s.text.length > 3000) return null;
  const expires = s.expiresInSeconds;
  if (typeof expires !== 'number' || !Number.isFinite(expires) || expires < 1 || expires > 3600) {
    return null;
  }
  return {
    url,
    expiresInSeconds: expires,
    text: s.text,
    voiceProfile: typeof s.voiceProfile === 'string' ? s.voiceProfile : '',
    cached: s.cached === true,
  };
}

export interface SpeechApi extends SpeechSource {
  /** Whether the server has speech switched on. Never rejects. */
  enabled(signal?: AbortSignal): Promise<boolean>;
}

export function createSpeechApi(client: ApiClient, childId: string, baseUrl = ''): SpeechApi {
  const path = speechPath(childId);
  return {
    async enabled(signal) {
      try {
        const response = await client.request('GET', path, signal ? { signal } : {});
        return (response.data as { enabled?: unknown } | null)?.enabled === true;
      } catch {
        return false;
      }
    },
    async request(reference: SpeechReference, signal) {
      const response = await client.request('POST', path, {
        body: { reference },
        ...(signal ? { signal } : {}),
      });
      const clip = parseSpeechClip(response.data, baseUrl);
      if (!clip) throw new Error('the speech answer was not valid');
      return clip;
    },
  };
}

/** The speech API for a child, or `null` when this build has no Django API (text only). */
export function speechApiFor(
  childId: string,
  config: DjangoApiConfig = DJANGO_API_CONFIG,
): SpeechApi | null {
  if (!childId) return null;
  return createSpeechApi(
    createApiClient({ baseUrl: config.baseUrl, getAccessToken }),
    childId,
    config.baseUrl,
  );
}
