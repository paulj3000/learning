import type { ApiClient } from '../../api/client';
import { isApiError } from '../../api/errors';
import { PROFILE_MESSAGES, ProfileRequestError } from './profileErrors';
import { PHOTO_PREPARE_MESSAGE, PHOTO_REMOVE_MESSAGE, PHOTO_UPLOAD_MESSAGE } from './photoMessages';

/**
 * The Django child photo API client (LAI-0905, ADR-042; docs/platform/CHILD_PHOTO_STORAGE.md
 * section 4). A photo is a sub-resource of a saved child:
 *
 * - `PUT children/<id>/photo/` with the prepared 256 px JPEG as the raw body (never multipart,
 *   never a file name; `prepareIconBlob` already stripped the camera metadata);
 * - `GET children/<id>/photo/` for `{"photo": null}` or the photo with a display `url`;
 * - `DELETE children/<id>/photo/`, which succeeds whether or not there was a photo.
 *
 * Django authorizes every call for the owning parent; nothing here decides ownership. Storage keys
 * never reach the client, and this module never logs a child id or a URL.
 */

export const CHILD_PHOTO_CONTENT_TYPE = 'image/jpeg';

/** What the API says about the child's current photo. Only the fields the client uses. */
export interface DjangoChildPhoto {
  id: string;
  /** `presigned`: `url` works in an `<img>` without credentials. `api`: it needs the token. */
  delivery: 'presigned' | 'api';
  url: string;
}

export interface DjangoPhotoClient {
  /** Uploads or replaces the photo. Throws a `ProfileRequestError` with a parent-facing message. */
  upload(childId: string, icon: Blob): Promise<DjangoChildPhoto>;
  /** Removes the photo. Throws a `ProfileRequestError` with a parent-facing message. */
  remove(childId: string): Promise<void>;
  /** A URL an `<img>` can show, or null. Never throws. */
  getDisplayUrl(childId: string): Promise<string | null>;
}

export interface DjangoPhotoClientOptions {
  /** Injected for tests; defaults to the browser's `URL.createObjectURL` / `revokeObjectURL`. */
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
}

export function createDjangoPhotoClient(
  client: ApiClient,
  options: DjangoPhotoClientOptions = {},
): DjangoPhotoClient {
  const createObjectUrl = options.createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revokeObjectUrl = options.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));

  /**
   * `api` delivery: one object URL per child, keyed by the photo id, so a re-render reuses the
   * bytes already fetched and a replaced or removed photo releases its old blob. At most one blob
   * per child stays in memory.
   */
  const objectUrls = new Map<string, { photoId: string; url: string }>();

  function release(childId: string) {
    const cached = objectUrls.get(childId);
    if (!cached) return;
    objectUrls.delete(childId);
    revokeObjectUrl(cached.url);
  }

  async function bytesUrl(childId: string, photo: DjangoChildPhoto): Promise<string | null> {
    const cached = objectUrls.get(childId);
    if (cached?.photoId === photo.id) return cached.url;
    const { data } = await client.request('GET', contentPath(childId), { responseType: 'blob' });
    if (!(data instanceof Blob) || data.size === 0) return null;
    release(childId);
    const url = createObjectUrl(data);
    objectUrls.set(childId, { photoId: photo.id, url });
    return url;
  }

  return {
    async upload(childId, icon) {
      try {
        const { data } = await client.request('PUT', photoPath(childId), {
          rawBody: { data: icon, contentType: CHILD_PHOTO_CONTENT_TYPE },
        });
        const photo = parsePhotoBody(data, childId);
        if (!photo) {
          throw new ProfileRequestError(PHOTO_UPLOAD_MESSAGE, { code: 'invalid_response' });
        }
        return photo;
      } catch (error) {
        if (error instanceof ProfileRequestError) throw error;
        throw toPhotoError(error, PHOTO_UPLOAD_MESSAGE);
      } finally {
        // The next display fetches the new photo; the old blob is not shown again.
        release(childId);
      }
    },
    async remove(childId) {
      try {
        await client.request('DELETE', photoPath(childId));
      } catch (error) {
        throw toPhotoError(error, PHOTO_REMOVE_MESSAGE);
      } finally {
        release(childId);
      }
    },
    async getDisplayUrl(childId) {
      try {
        const { data } = await client.request('GET', photoPath(childId));
        const photo = parsePhotoBody(data, childId);
        if (!photo) {
          release(childId);
          return null;
        }
        return photo.delivery === 'presigned' ? photo.url : await bytesUrl(childId, photo);
      } catch {
        return null;
      }
    },
  };
}

function photoPath(childId: string): string {
  return `children/${encodeURIComponent(childId)}/photo/`;
}

function contentPath(childId: string): string {
  return `${photoPath(childId)}content/`;
}

/**
 * Validates `{"photo": null | {...}}`. A `presigned` URL must be `https:` (it is shown without
 * credentials). An `api` URL must be this child's content route: the client then calls that route
 * through the API client, so the bearer token only ever goes to the configured API origin, never
 * to a host named in a response.
 */
export function parsePhotoBody(data: unknown, childId: string): DjangoChildPhoto | null {
  if (!isRecord(data) || !isRecord(data.photo)) return null;
  const { id, delivery, url } = data.photo;
  if (typeof id !== 'string' || id === '' || typeof url !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(url, 'https://relative.invalid');
  } catch {
    return null;
  }
  if (delivery === 'presigned') {
    return parsed.protocol === 'https:' ? { id, delivery, url } : null;
  }
  if (delivery === 'api') {
    return parsed.pathname.endsWith(`/api/v1/${contentPath(childId)}`)
      ? { id, delivery, url }
      : null;
  }
  return null;
}

/** Maps the photo API's errors onto the messages parents already see in Amplify builds. */
export function toPhotoError(error: unknown, fallback: string): ProfileRequestError {
  if (!isApiError(error)) return new ProfileRequestError(fallback, { cause: error });
  const code = error.code;
  const rejected =
    code === 'photo_invalid' ||
    code === 'photo_dimensions' ||
    code === 'photo_too_large' ||
    code === 'photo_type_unsupported';
  const message = rejected
    ? PHOTO_PREPARE_MESSAGE
    : error.kind === 'unauthenticated'
      ? PROFILE_MESSAGES.signedOut
      : fallback;
  return new ProfileRequestError(message, { code, cause: error });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
