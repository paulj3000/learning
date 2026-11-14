import { PHOTO_PREPARE_MESSAGE, PHOTO_SIZE_MESSAGE, PHOTO_TYPE_MESSAGE } from './photoMessages';
import type { PhotoSelection } from './profileTypes';

export type { PhotoSelection };

/**
 * The optional photo a parent may upload as a child's profile icon: choosing, checking and
 * preparing it in the browser. Storing it is Django's job (`djangoPhotos.ts`,
 * `children/<id>/photo/`; ADR-042, AMP-04). Nothing here talks to a backend, and the Amplify
 * Storage path (identity-scoped `child-photos/<identity id>/` objects) is gone: existing objects
 * are copied into the Django photo bucket by `manage.py migrate_amplify_child_photos`
 * (docs/platform/AMPLIFY_STORAGE_CUTOVER.md).
 *
 * Everything here is parent-initiated and parent-only: the field lives on the parent-managed
 * profile form, and the photo is never part of any AI prompt context (CLAUDE.md section 7).
 *
 * The browser re-encodes the picture before upload rather than sending the camera file as-is.
 * That is not only a size optimization: drawing through a canvas discards every EXIF tag the
 * original carried, including GPS coordinates, so a photo taken at home does not ship the
 * family's location with it. Django strips metadata again on the server (`photo_validation.py`).
 */

/** Formats a browser can reliably decode; HEIC and friends are rejected up front. */
export const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Generous for a phone photo, small enough that a mis-picked video file is rejected. */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/** Icons are never displayed larger than a few rem; 256px covers 2x displays. */
export const ICON_PIXEL_SIZE = 256;

const ICON_MIME_TYPE = 'image/jpeg';
const ICON_QUALITY = 0.85;

export { PHOTO_SIZE_MESSAGE, PHOTO_TYPE_MESSAGE };

/** Only the fields this check needs, so callers can validate without a real `File`. */
export interface PhotoFileFacts {
  type: string;
  size: number;
}

/** Returns a parent-facing message, or null when the file is acceptable. */
export function validatePhotoFile(file: PhotoFileFacts): string | null {
  if (!(ACCEPTED_PHOTO_TYPES as readonly string[]).includes(file.type)) {
    return PHOTO_TYPE_MESSAGE;
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return PHOTO_SIZE_MESSAGE;
  }
  if (file.size === 0) {
    return PHOTO_PREPARE_MESSAGE;
  }
  return null;
}

export interface SquareCrop {
  sx: number;
  sy: number;
  size: number;
}

/**
 * The largest centered square inside a `width` x `height` image. Icons are
 * round, so cropping to a square beats squashing a portrait photo into one.
 */
export function computeSquareCrop(width: number, height: number): SquareCrop {
  const size = Math.min(width, height);
  return {
    sx: Math.round((width - size) / 2),
    sy: Math.round((height - size) / 2),
    size,
  };
}

/**
 * Decodes, centre-crops, downsizes, and re-encodes the chosen picture into
 * the square JPEG that actually gets uploaded. `imageOrientation:
 * 'from-image'` applies the EXIF rotation flag while decoding, since the
 * re-encode below then throws that metadata away.
 */
export async function prepareIconBlob(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(PHOTO_PREPARE_MESSAGE);
  }

  try {
    const { sx, sy, size } = computeSquareCrop(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = ICON_PIXEL_SIZE;
    canvas.height = ICON_PIXEL_SIZE;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error(PHOTO_PREPARE_MESSAGE);
    }
    context.drawImage(bitmap, sx, sy, size, size, 0, 0, ICON_PIXEL_SIZE, ICON_PIXEL_SIZE);

    const icon = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, ICON_MIME_TYPE, ICON_QUALITY);
    });
    if (!icon) {
      throw new Error(PHOTO_PREPARE_MESSAGE);
    }
    return icon;
  } finally {
    bitmap.close();
  }
}
