import { getUrl, remove, uploadData } from 'aws-amplify/storage';

/**
 * Amplify Storage for child profile photos (amplify/storage/resource.ts):
 * objects under `child-photos/<parent identity id>/`, readable only by the
 * identity that uploaded them. Raw storage calls; the parent-facing
 * messages and the "a missing icon never breaks a screen" rule stay in
 * `features/child-profile/avatarPhoto.ts`.
 */

const CHILD_PHOTO_PREFIX = 'child-photos';

/** Uploads one icon under the signed-in parent's identity prefix and returns its path. */
export async function uploadPhotoObject(
  fileName: string,
  icon: Blob,
  contentType: string,
): Promise<string> {
  const { path } = await uploadData({
    path: ({ identityId }) => {
      if (!identityId) throw new Error('No storage identity.');
      return `${CHILD_PHOTO_PREFIX}/${identityId}/${fileName}`;
    },
    data: icon,
    options: { contentType },
  }).result;
  return path;
}

export async function removePhotoObject(path: string): Promise<void> {
  await remove({ path });
}

/** A short-lived signed URL for one stored photo. */
export async function getPhotoObjectUrl(path: string): Promise<string> {
  const { url } = await getUrl({ path });
  return url.toString();
}
