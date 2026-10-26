import { describe, expect, it, vi } from 'vitest';

const photos = vi.hoisted(() => ({
  uploadPhotoObject: vi.fn(),
  removePhotoObject: vi.fn(),
  getPhotoObjectUrl: vi.fn(),
}));
vi.mock('../../api/childPhotos', () => ({ childPhotosApi: photos }));

import { ApiError } from '../../api/errors';
import { unsupported } from '../../api/select';
import { getChildPhotoUrl, removeChildPhoto, uploadChildPhoto } from './avatarPhoto';

describe('child photo storage behind the API layer (LAI-0501B)', () => {
  it('uploads a JPEG through the selected backend', async () => {
    photos.uploadPhotoObject.mockResolvedValueOnce('child-photos/id/x.jpg');
    await expect(uploadChildPhoto(new Blob(['x']))).resolves.toBe('child-photos/id/x.jpg');
    expect(photos.uploadPhotoObject).toHaveBeenCalledWith(
      expect.stringMatching(/\.jpg$/),
      expect.any(Blob),
      'image/jpeg',
    );
  });

  it('says when the backend has no photo storage, instead of a generic retry message', async () => {
    photos.uploadPhotoObject.mockRejectedValueOnce(unsupported('childPhotos'));
    await expect(uploadChildPhoto(new Blob(['x']))).rejects.toMatchObject({
      code: 'childPhotos_unavailable',
    });
    photos.removePhotoObject.mockRejectedValueOnce(unsupported('childPhotos'));
    await expect(removeChildPhoto('p')).rejects.toMatchObject({ kind: 'unsupported' });
  });

  it('still hides storage details behind the parent-facing message', async () => {
    photos.uploadPhotoObject.mockRejectedValueOnce(new Error('s3://bucket/child-photos/identity'));
    await expect(uploadChildPhoto(new Blob(['x']))).rejects.toThrow(
      'We could not save that photo. Please try again.',
    );
  });

  it('degrades a missing icon to null on any failure, a backend gap included', async () => {
    photos.getPhotoObjectUrl.mockRejectedValueOnce(new ApiError('unsupported'));
    await expect(getChildPhotoUrl('p')).resolves.toBeNull();
  });
});
