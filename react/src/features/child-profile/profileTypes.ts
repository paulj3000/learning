import type { AgeBandValue, ReadingModeValue } from './constants';

/**
 * Hand-owned profile shapes (LAI-CHILD-001, ADR-039). Screens use these, never a backend's own
 * record type, so the data source can change without touching them.
 */
export interface ChildProfile {
  id: string;
  nickname: string;
  ageBand: AgeBandValue;
  avatarKey: string;
  /**
   * An opaque reference to the parent-uploaded photo, or null when there is none. Only the store
   * that produced it can resolve it (`ProfileStore.getChildPhotoUrl`): the child id
   * (`hasPhoto`, LAI-0905). Never a Django storage key: those stay on the server.
   */
  avatarPhotoKey: string | null;
  interests: string[];
  readingMode: ReadingModeValue;
  active: boolean;
  aiEnabled: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ParentProfile {
  id: string;
  displayName: string;
  timezone: string | null;
}

export interface ChildProfileInput {
  nickname: string;
  ageBand: AgeBandValue;
  avatarKey: string;
  /**
   * The profile's existing photo reference, sent back unchanged. The Django store never sends
   * it, because its photo is a child sub-resource (`applyChildPhotoSelection`).
   */
  avatarPhotoKey: string | null;
  interests: string[];
  readingMode: ReadingModeValue;
}

/** What the parent did to the photo field before submitting the form. */
export type PhotoSelection =
  { kind: 'unchanged' } | { kind: 'replace'; icon: Blob } | { kind: 'remove' };

/** Where parent and child profiles live: Django (AMP-03). */
export interface ProfileStore {
  readonly source: 'django';
  /**
   * Whether a parent can upload a profile photo here (AMP-04). The photo
   * belongs to a saved child, so the profile is saved first and then `applyChildPhotoSelection`
   * uploads or removes it (LAI-0905).
   */
  readonly supportsPhotos: boolean;
  /**
   * A URL an `<img>` can show for `ChildProfile.avatarPhotoKey`, or null. Never throws: a missing
   * photo degrades to the authored avatar character. Each call may mint a fresh short-lived URL.
   */
  getChildPhotoUrl(photoKey: string): Promise<string | null>;
  /** Upload (`replace`) or delete (`remove`) a saved child's photo (`supportsPhotos` stores). */
  applyChildPhotoSelection(childId: string, selection: PhotoSelection): Promise<void>;
  getOrCreateParentProfile(): Promise<ParentProfile>;
  updateParentProfileDisplayName(id: string, displayName: string): Promise<ParentProfile>;
  listChildProfiles(): Promise<ChildProfile[]>;
  getChildProfile(id: string): Promise<ChildProfile | null>;
  createChildProfile(parentProfileId: string, input: ChildProfileInput): Promise<ChildProfile>;
  updateChildProfile(id: string, input: ChildProfileInput): Promise<ChildProfile>;
  setChildProfileActive(id: string, active: boolean): Promise<ChildProfile>;
  setChildProfileAIEnabled(id: string, aiEnabled: boolean): Promise<ChildProfile>;
  ensureChildProfileOwnerSub(childProfileId: string): Promise<void>;
  deleteChildProfileData(childProfileId: string): Promise<void>;
  deleteAccountAndAllData(): Promise<void>;
}
