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
  /** Amplify Storage path of an uploaded photo; always null from Django (photos are LAI-1103). */
  avatarPhotoKey: string | null;
  interests: string[];
  readingMode: ReadingModeValue;
  sessionMinutes: number;
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
   * Path of the parent-uploaded profile photo in Amplify Storage, or null
   * when this child uses their authored `avatarKey` character as the icon.
   * Written by `persistPhotoSelection` (avatarPhoto.ts), which uploads the
   * image before this input reaches the API and cleans up any replaced
   * object after it succeeds. Ignored where `supportsPhotos` is false.
   */
  avatarPhotoKey: string | null;
  interests: string[];
  readingMode: ReadingModeValue;
  sessionMinutes: number;
}

/** Where this build keeps parent and child profiles. See api.ts for which one is used. */
export interface ProfileStore {
  readonly source: 'django' | 'amplify';
  /** Whether a parent can upload a profile photo here (Amplify Storage only, for now). */
  readonly supportsPhotos: boolean;
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
