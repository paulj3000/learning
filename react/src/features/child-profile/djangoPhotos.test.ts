import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../../api/client';
import { errorJson, jsonResponse } from '../../test/playFixtures';
import { createDjangoPhotoClient, parsePhotoBody } from './djangoPhotos';
import { ProfileRequestError } from './profileErrors';

const PRESIGNED = {
  photo: {
    id: 'ph1',
    contentType: 'image/jpeg',
    byteSize: 1234,
    width: 256,
    height: 256,
    uploadedAt: '2026-10-31T10:00:00Z',
    delivery: 'presigned',
    url: 'https://lai-child-photos-dev.s3.amazonaws.com/children/x/y?X-Amz-Signature=abc',
    urlExpiresAt: '2026-10-31T10:05:00Z',
  },
};

function apiPhoto(id: string, childId = 'c1') {
  return {
    photo: {
      ...PRESIGNED.photo,
      id,
      delivery: 'api',
      url: `http://testserver/api/v1/children/${childId}/photo/content/`,
      urlExpiresAt: null,
    },
  };
}

function setup(responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  const client = createApiClient({
    baseUrl: 'https://lai.example',
    getAccessToken: async () => 'token-1',
    fetch,
  });
  let next = 0;
  const createObjectUrl = vi.fn(() => `blob:photo-${++next}`);
  const revokeObjectUrl = vi.fn();
  const photos = createDjangoPhotoClient(client, { createObjectUrl, revokeObjectUrl });
  return { photos, fetch, createObjectUrl, revokeObjectUrl };
}

function jpegResponse(): Response {
  return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
    status: 200,
    headers: { 'Content-Type': 'image/jpeg' },
  });
}

async function rejection(promise: Promise<unknown>): Promise<ProfileRequestError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProfileRequestError);
    return error as ProfileRequestError;
  }
  throw new Error('expected a rejection');
}

describe('Django photo client (LAI-0905)', () => {
  it('uploads the prepared JPEG as the raw PUT body with the bearer token', async () => {
    const { photos, fetch } = setup([jsonResponse(200, PRESIGNED)]);
    const icon = new Blob(['jpeg-bytes'], { type: 'image/jpeg' });

    await expect(photos.upload('c1', icon)).resolves.toEqual({
      id: 'ph1',
      delivery: 'presigned',
      url: PRESIGNED.photo.url,
    });

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://lai.example/api/v1/children/c1/photo/');
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBe(icon);
    const headers = init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('image/jpeg');
    expect(headers.Authorization).toBe('Bearer token-1');
  });

  it('removes the photo with DELETE', async () => {
    const { photos, fetch } = setup([new Response(null, { status: 204 })]);
    await photos.remove('c1');
    expect(fetch.mock.calls[0][0]).toBe('https://lai.example/api/v1/children/c1/photo/');
    expect(fetch.mock.calls[0][1]?.method).toBe('DELETE');
  });

  it('shows a presigned URL directly, without fetching the bytes', async () => {
    const { photos, fetch } = setup([jsonResponse(200, PRESIGNED)]);
    await expect(photos.getDisplayUrl('c1')).resolves.toBe(PRESIGNED.photo.url);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('fetches an api URL with the token from the configured API origin, once per photo', async () => {
    const { photos, fetch, createObjectUrl } = setup([
      jsonResponse(200, apiPhoto('ph1')),
      jpegResponse(),
      jsonResponse(200, apiPhoto('ph1')),
    ]);

    await expect(photos.getDisplayUrl('c1')).resolves.toBe('blob:photo-1');
    const [contentUrl, contentInit] = fetch.mock.calls[1];
    // The response named http://testserver; the token still only goes to the API origin.
    expect(contentUrl).toBe('https://lai.example/api/v1/children/c1/photo/content/');
    const contentHeaders = contentInit?.headers as Record<string, string> | undefined;
    expect(contentHeaders?.Authorization).toBe('Bearer token-1');

    await expect(photos.getDisplayUrl('c1')).resolves.toBe('blob:photo-1');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
  });

  it('releases the old bytes when the photo is replaced or removed', async () => {
    const { photos, revokeObjectUrl } = setup([
      jsonResponse(200, apiPhoto('ph1')),
      jpegResponse(),
      jsonResponse(200, apiPhoto('ph2')),
      jsonResponse(200, apiPhoto('ph2')),
      jpegResponse(),
      new Response(null, { status: 204 }),
    ]);

    await photos.getDisplayUrl('c1');
    await photos.upload('c1', new Blob(['jpeg']));
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:photo-1');
    await expect(photos.getDisplayUrl('c1')).resolves.toBe('blob:photo-2');
    await photos.remove('c1');
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:photo-2');
  });

  it('returns null, never throws, when there is no photo or it cannot be read', async () => {
    const { photos } = setup([
      jsonResponse(200, { photo: null }),
      jsonResponse(503, errorJson('photo_storage_unavailable')),
      jsonResponse(404, errorJson('not_found')),
    ]);
    await expect(photos.getDisplayUrl('c1')).resolves.toBeNull();
    await expect(photos.getDisplayUrl('c1')).resolves.toBeNull();
    await expect(photos.getDisplayUrl('other-family')).resolves.toBeNull();
  });

  it.each([
    [400, 'photo_invalid'],
    [400, 'photo_dimensions'],
    [413, 'photo_too_large'],
    [415, 'photo_type_unsupported'],
  ])('maps a %i %s rejection to the existing "could not read" message', async (status, code) => {
    const { photos } = setup([jsonResponse(status, errorJson(code))]);
    const error = await rejection(photos.upload('c1', new Blob(['x'])));
    expect(error.message).toBe('We could not read that image. Please try a different one.');
    expect(error.code).toBe(code);
  });

  it('maps storage outages and unknown children to the existing save and delete messages', async () => {
    const { photos } = setup([
      jsonResponse(503, errorJson('photo_storage_unavailable')),
      jsonResponse(404, errorJson('not_found')),
      jsonResponse(500, errorJson('server_error')),
    ]);
    expect((await rejection(photos.upload('c1', new Blob(['x'])))).message).toBe(
      'We could not save that photo. Please try again.',
    );
    expect((await rejection(photos.upload('c2', new Blob(['x'])))).message).toBe(
      'We could not save that photo. Please try again.',
    );
    expect((await rejection(photos.remove('c1'))).message).toBe(
      'We could not delete that photo. Please try again.',
    );
  });

  it('asks the parent to sign in again after a second 401', async () => {
    const { photos } = setup([
      jsonResponse(401, errorJson('not_authenticated')),
      jsonResponse(401, errorJson('not_authenticated')),
    ]);
    expect((await rejection(photos.upload('c1', new Blob(['x'])))).message).toBe(
      'Please sign in again.',
    );
  });

  it('treats an upload answer outside the contract as a failed save', async () => {
    const { photos } = setup([jsonResponse(200, { photo: null })]);
    expect((await rejection(photos.upload('c1', new Blob(['x'])))).code).toBe('invalid_response');
  });
});

describe('parsePhotoBody', () => {
  it('accepts only https presigned URLs', () => {
    expect(parsePhotoBody(PRESIGNED, 'c1')?.delivery).toBe('presigned');
    const plain = { photo: { ...PRESIGNED.photo, url: 'http://bucket.example/p' } };
    expect(parsePhotoBody(plain, 'c1')).toBeNull();
    const script = { photo: { ...PRESIGNED.photo, url: 'javascript:alert(1)' } };
    expect(parsePhotoBody(script, 'c1')).toBeNull();
  });

  it("accepts an api URL only for this child's content route", () => {
    expect(parsePhotoBody(apiPhoto('ph1'), 'c1')?.delivery).toBe('api');
    expect(parsePhotoBody(apiPhoto('ph1', 'c2'), 'c1')).toBeNull();
    const elsewhere = { photo: { ...apiPhoto('ph1').photo, url: 'https://evil.example/steal' } };
    expect(parsePhotoBody(elsewhere, 'c1')).toBeNull();
  });

  it('rejects unknown delivery modes and malformed bodies', () => {
    expect(parsePhotoBody({ photo: { ...PRESIGNED.photo, delivery: 'cdn' } }, 'c1')).toBeNull();
    expect(parsePhotoBody({ photo: { ...PRESIGNED.photo, id: '' } }, 'c1')).toBeNull();
    expect(parsePhotoBody(null, 'c1')).toBeNull();
    expect(parsePhotoBody({ photo: null }, 'c1')).toBeNull();
  });
});
