import { describe, expect, it, vi, beforeEach } from 'vitest';

const { uploadData, remove, getUrl } = vi.hoisted(() => ({
  uploadData: vi.fn(),
  remove: vi.fn(),
  getUrl: vi.fn(),
}));

vi.mock('aws-amplify/storage', () => ({ uploadData, remove, getUrl }));

import {
  MAX_PHOTO_BYTES,
  computeSquareCrop,
  getChildPhotoUrl,
  persistPhotoSelection,
  uploadChildPhoto,
  validatePhotoFile,
} from './avatarPhoto';

describe('validatePhotoFile', () => {
  it('accepts the image types a browser can decode', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(validatePhotoFile({ type, size: 1024 })).toBeNull();
    }
  });

  it('rejects a non-image, and a video mis-picked from a camera roll', () => {
    expect(validatePhotoFile({ type: 'application/pdf', size: 1024 })).toMatch(
      /JPEG, PNG, or WebP/,
    );
    expect(validatePhotoFile({ type: 'video/mp4', size: 1024 })).toMatch(/JPEG, PNG, or WebP/);
  });

  it('rejects an image larger than the upload limit', () => {
    expect(validatePhotoFile({ type: 'image/jpeg', size: MAX_PHOTO_BYTES + 1 })).toMatch(/8 MB/);
    expect(validatePhotoFile({ type: 'image/jpeg', size: MAX_PHOTO_BYTES })).toBeNull();
  });

  it('rejects an empty file', () => {
    expect(validatePhotoFile({ type: 'image/jpeg', size: 0 })).not.toBeNull();
  });
});

describe('computeSquareCrop', () => {
  it('takes the whole image when it is already square', () => {
    expect(computeSquareCrop(400, 400)).toEqual({ sx: 0, sy: 0, size: 400 });
  });

  it('centres the crop on a landscape photo', () => {
    expect(computeSquareCrop(1000, 600)).toEqual({ sx: 200, sy: 0, size: 600 });
  });

  it('centres the crop on a portrait photo', () => {
    expect(computeSquareCrop(600, 1000)).toEqual({ sx: 0, sy: 200, size: 600 });
  });
});

describe('uploadChildPhoto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes into the identity prefix of the signed-in parent', async () => {
    uploadData.mockImplementation(
      ({ path }: { path: (input: { identityId?: string }) => string }) => ({
        result: Promise.resolve({ path: path({ identityId: 'identity-1' }) }),
      }),
    );

    const storedPath = await uploadChildPhoto(new Blob(['x']));

    expect(storedPath).toMatch(/^child-photos\/identity-1\/[0-9a-f-]+\.jpg$/);
  });

  it('reports a safe message rather than the underlying storage error', async () => {
    uploadData.mockImplementation(() => ({
      result: Promise.reject(new Error('AccessDenied: arn:aws:s3:::bucket/child-photos/...')),
    }));

    await expect(uploadChildPhoto(new Blob(['x']))).rejects.toThrow(
      'We could not save that photo. Please try again.',
    );
  });
});

describe('getChildPhotoUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a signed URL for a stored photo', async () => {
    getUrl.mockResolvedValue({ url: new URL('https://example.invalid/photo.jpg?signature=abc') });

    await expect(getChildPhotoUrl('child-photos/identity-1/photo.jpg')).resolves.toBe(
      'https://example.invalid/photo.jpg?signature=abc',
    );
  });

  it('returns null instead of throwing when the photo cannot be resolved', async () => {
    getUrl.mockRejectedValue(new Error('NoBucket'));

    await expect(getChildPhotoUrl('child-photos/identity-1/photo.jpg')).resolves.toBeNull();
  });
});

describe('persistPhotoSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadData.mockImplementation(() => ({
      result: Promise.resolve({ path: 'child-photos/identity-1/new.jpg' }),
    }));
    remove.mockResolvedValue(undefined);
  });

  it('keeps the existing photo when the parent did not touch the field', async () => {
    const saveProfile = vi.fn().mockResolvedValue(undefined);

    await persistPhotoSelection(
      { kind: 'unchanged' },
      'child-photos/identity-1/old.jpg',
      saveProfile,
    );

    expect(saveProfile).toHaveBeenCalledWith('child-photos/identity-1/old.jpg');
    expect(uploadData).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('uploads, saves, then deletes the replaced photo, in that order', async () => {
    const calls: string[] = [];
    uploadData.mockImplementation(() => {
      calls.push('upload');
      return { result: Promise.resolve({ path: 'child-photos/identity-1/new.jpg' }) };
    });
    remove.mockImplementation(async () => {
      calls.push('remove');
    });
    const saveProfile = vi.fn().mockImplementation(async () => {
      calls.push('save');
    });

    await persistPhotoSelection(
      { kind: 'replace', icon: new Blob(['x']) },
      'child-photos/identity-1/old.jpg',
      saveProfile,
    );

    expect(saveProfile).toHaveBeenCalledWith('child-photos/identity-1/new.jpg');
    expect(remove).toHaveBeenCalledWith({ path: 'child-photos/identity-1/old.jpg' });
    expect(calls).toEqual(['upload', 'save', 'remove']);
  });

  it('never deletes the old photo when saving the profile failed', async () => {
    const saveProfile = vi.fn().mockRejectedValue(new Error('Could not update the child profile.'));

    await expect(
      persistPhotoSelection(
        { kind: 'replace', icon: new Blob(['x']) },
        'child-photos/identity-1/old.jpg',
        saveProfile,
      ),
    ).rejects.toThrow('Could not update the child profile.');

    expect(remove).not.toHaveBeenCalled();
  });

  it('clears the stored key and deletes the object when the parent removes the photo', async () => {
    const saveProfile = vi.fn().mockResolvedValue(undefined);

    await persistPhotoSelection({ kind: 'remove' }, 'child-photos/identity-1/old.jpg', saveProfile);

    expect(saveProfile).toHaveBeenCalledWith(null);
    expect(remove).toHaveBeenCalledWith({ path: 'child-photos/identity-1/old.jpg' });
    expect(uploadData).not.toHaveBeenCalled();
  });

  it('still counts the save as successful when cleaning up the old photo fails', async () => {
    remove.mockRejectedValue(new Error('network'));
    const saveProfile = vi.fn().mockResolvedValue(undefined);

    await expect(
      persistPhotoSelection({ kind: 'remove' }, 'child-photos/identity-1/old.jpg', saveProfile),
    ).resolves.toBeUndefined();

    expect(saveProfile).toHaveBeenCalledWith(null);
  });
});
