/**
 * Backend-neutral shapes for parent accounts and child profiles (LAI-0501A).
 *
 * Both implementations return these: Amplify's generated records already fit
 * them (they carry extra fields, which callers here never read), and the
 * Django children API (docs/android/ANDROID_API_CONTRACT.md) is mapped onto
 * them in `children.ts`. Optional fields keep Amplify's nullability, so the
 * existing screens compile and behave the same on either backend.
 */

export type AgeBand = 'SPROUT' | 'PATHFINDER' | 'EXPLORER';
export type ReadingMode = 'VOICE_FIRST' | 'READ_ALONG' | 'INDEPENDENT';

export interface ChildProfile {
  /** Stable for the record's lifetime. On Django, the same UUID the Android app uses. */
  id: string;
  nickname: string;
  ageBand: AgeBand;
  avatarKey: string;
  /**
   * Amplify Storage path of a parent-uploaded photo. Always null on Django,
   * which never exposes a storage path (see `hasPhoto`).
   */
  avatarPhotoKey?: string | null;
  /** Django only: whether a photo exists. Undefined on Amplify, where `avatarPhotoKey` says it. */
  hasPhoto?: boolean;
  interests?: (string | null)[] | null;
  readingMode: ReadingMode;
  sessionMinutes: number;
  active: boolean;
  aiEnabled?: boolean | null;
  createdAt: string;
  updatedAt: string;
}

/** What a parent can write. The owner is never part of it: each backend takes it from the session. */
export interface ChildProfileInput {
  nickname: string;
  ageBand: AgeBand;
  avatarKey: string;
  /**
   * Path of the parent-uploaded profile photo in Amplify Storage, or null
   * when this child uses their authored `avatarKey` character as the icon.
   * Written by `persistPhotoSelection` (avatarPhoto.ts), which uploads the
   * image before this input reaches the API and cleans up any replaced
   * object after it succeeds. Django has no photo contract, so a non-null
   * value is refused there (`child_photo_unavailable`).
   */
  avatarPhotoKey: string | null;
  interests: string[];
  readingMode: ReadingMode;
  sessionMinutes: number;
}

export interface ParentProfile {
  id: string;
  displayName: string;
  timezone?: string | null;
  createdAt?: string;
  updatedAt?: string;
}
