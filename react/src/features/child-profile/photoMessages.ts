/**
 * Parent-facing photo messages, shared by the browser-side checks (avatarPhoto.ts), the Django
 * photo client (djangoPhotos.ts, LAI-0905) and the legacy photo delete in deletion.ts. Kept free
 * of any backend import.
 */
export const PHOTO_TYPE_MESSAGE = 'Choose a JPEG, PNG, or WebP image.';
export const PHOTO_SIZE_MESSAGE = 'Choose an image smaller than 8 MB.';
export const PHOTO_PREPARE_MESSAGE = 'We could not read that image. Please try a different one.';
export const PHOTO_UPLOAD_MESSAGE = 'We could not save that photo. Please try again.';
export const PHOTO_REMOVE_MESSAGE = 'We could not delete that photo. Please try again.';
/** The profile itself was saved; only the photo step after it failed (`after-save` stores). */
export const PHOTO_AFTER_SAVE_PREFIX = 'The profile was saved, but the photo was not.';
