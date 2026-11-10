import { describe, expect, it } from 'vitest';
import source from './avatarPhoto.ts?raw';
import { MAX_PHOTO_BYTES, computeSquareCrop, validatePhotoFile } from './avatarPhoto';

describe('avatarPhoto (AMP-04)', () => {
  it('never calls Amplify Storage: photos are stored through Django only', () => {
    expect(source).not.toMatch(/aws-amplify/);
    expect(source).not.toMatch(/uploadData|getUrl|remove\(/);
  });
});

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
