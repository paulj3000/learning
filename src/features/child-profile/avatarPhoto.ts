import { getUrl, remove, uploadData } from 'aws-amplify/storage';

/**
 * The optional photo a parent may upload as a child's profile icon.
 *
 * Everything here is parent-initiated and parent-only: the field lives on
 * the parent-managed profile form, the bytes land in an identity-scoped
 * prefix of the Storage bucket (amplify/storage/resource.ts), and the key
 * is never part of any AI prompt context (CLAUDE.md section 7).
 *
 * The browser re-encodes the picture before upload rather than sending the
 * camera file as-is. That is not only a size optimization: drawing through
 * a canvas discards every EXIF tag the original carried, including GPS
 * coordinates, so a photo taken at home does not ship the family's
 * location to S3 with it.
 */

/** Formats a browser can reliably decode; HEIC and friends are rejected up front. */
export const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Generous for a phone photo, small enough that a mis-picked video file is rejected. */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/** Icons are never displayed larger than a few rem; 256px covers 2x displays. */
export const ICON_PIXEL_SIZE = 256;

const ICON_MIME_TYPE = 'image/jpeg';
const ICON_QUALITY = 0.85;

/** Objects live under `child-photos/<identity id>/`, matching the access rule in amplify/storage/resource.ts. */
const CHILD_PHOTO_PREFIX = 'child-photos';

export const PHOTO_TYPE_MESSAGE = 'Choose a JPEG, PNG, or WebP image.';
export const PHOTO_SIZE_MESSAGE = 'Choose an image smaller than 8 MB.';
const PHOTO_PREPARE_MESSAGE = 'We could not read that image. Please try a different one.';
const PHOTO_UPLOAD_MESSAGE = 'We could not save that photo. Please try again.';
const PHOTO_REMOVE_MESSAGE = 'We could not delete that photo. Please try again.';

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

/**
 * Uploads one prepared icon and returns the stored path.
 *
 * The file name is a fresh UUID on every upload rather than the child's id:
 * replacing a photo writes a new object and deletes the old one, which
 * keeps a stale browser or CDN copy from being shown after a parent has
 * changed or removed the picture.
 */
export async function uploadChildPhoto(icon: Blob): Promise<string> {
  const fileName = `${crypto.randomUUID()}.jpg`;
  try {
    const { path } = await uploadData({
      path: ({ identityId }) => {
        if (!identityId) {
          throw new Error(PHOTO_UPLOAD_MESSAGE);
        }
        return `${CHILD_PHOTO_PREFIX}/${identityId}/${fileName}`;
      },
      data: icon,
      options: { contentType: ICON_MIME_TYPE },
    }).result;
    return path;
  } catch {
    // Deliberately not re-thrown or logged as-is: the underlying error can
    // carry the bucket path, which contains the parent's identity id.
    throw new Error(PHOTO_UPLOAD_MESSAGE);
  }
}

/** Deletes one stored photo. S3 deletes are idempotent, so a missing object is not an error. */
export async function removeChildPhoto(path: string): Promise<void> {
  try {
    await remove({ path });
  } catch {
    throw new Error(PHOTO_REMOVE_MESSAGE);
  }
}

/**
 * A short-lived signed URL for one stored photo, or null if it cannot be
 * resolved (no Storage backend deployed yet, object already deleted,
 * expired credentials). Never throws: a missing icon must degrade to the
 * authored avatar character, not break the screen it appears on.
 */
export async function getChildPhotoUrl(path: string): Promise<string | null> {
  try {
    const { url } = await getUrl({ path });
    return url.toString();
  } catch {
    return null;
  }
}

/** What the parent did to the photo field before submitting the form. */
export type PhotoSelection =
  { kind: 'unchanged' } | { kind: 'replace'; icon: Blob } | { kind: 'remove' };

/**
 * Applies a photo selection around saving the profile, in the one order
 * that cannot strand a profile pointing at an object that no longer
 * exists: upload the new icon first, save the profile (which is what makes
 * the new path authoritative), and only then clean up the object the
 * profile no longer references.
 *
 * The cleanup is best effort by design. If it fails, the parent sees the
 * photo they asked for and the bucket holds one orphaned 256px object;
 * failing the whole save instead would be a worse trade for them.
 */
export async function persistPhotoSelection(
  selection: PhotoSelection,
  existingKey: string | null,
  saveProfile: (avatarPhotoKey: string | null) => Promise<void>,
): Promise<void> {
  const nextKey =
    selection.kind === 'replace'
      ? await uploadChildPhoto(selection.icon)
      : selection.kind === 'remove'
        ? null
        : existingKey;

  await saveProfile(nextKey);

  if (existingKey && existingKey !== nextKey) {
    try {
      await removeChildPhoto(existingKey);
    } catch {
      // Orphaned object, not a broken profile - see the note above.
    }
  }
}
