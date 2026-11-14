import { isCameraMode, type CameraMode } from './playerPresentation';

/**
 * The child's chosen camera perspective, remembered across visits
 * (LAI-JMP-01a).
 *
 * Stored in this browser, per child, and nothing else: the value is
 * "first-person" or "third-person" under a key holding the child's profile
 * id (already in every play URL). No name, no free text, nothing sent
 * anywhere. Server-side child preferences have no field for it (audio is the
 * only synced preference, `ChildAudioSettings`), and adding one is a schema
 * change this task avoids; syncing across devices is follow-up card
 * LAI-JMP-01d.
 *
 * Every read and write is guarded: in a private window, with storage blocked
 * or full, the preference simply is not remembered and play is unaffected.
 */

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY_PREFIX = 'lai:camera-mode:';

export function cameraPreferenceKey(childId: string): string {
  return `${KEY_PREFIX}${childId}`;
}

function defaultStorage(): PreferenceStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    // Accessing localStorage itself throws where site data is blocked.
    return null;
  }
}

/** The child's saved perspective, or `null` when none was saved or it cannot be read. */
export function loadCameraPreference(
  childId: string,
  storage: PreferenceStorage | null = defaultStorage(),
): CameraMode | null {
  if (!childId || !storage) return null;
  try {
    const value = storage.getItem(cameraPreferenceKey(childId));
    return isCameraMode(value) ? value : null;
  } catch {
    return null;
  }
}

/** Saves the child's perspective. Returns whether it was saved. Never throws. */
export function saveCameraPreference(
  childId: string,
  mode: CameraMode,
  storage: PreferenceStorage | null = defaultStorage(),
): boolean {
  if (!childId || !storage || !isCameraMode(mode)) return false;
  try {
    storage.setItem(cameraPreferenceKey(childId), mode);
    return true;
  } catch {
    return false;
  }
}

/*
  Running & sprinting: whether Shift is held or pressed to sprint, remembered
  the same way (this browser, per child, the value only).
*/
const SPRINT_KEY_PREFIX = 'lai:sprint-mode:';

export type SprintModePreference = 'hold' | 'toggle';

function isSprintMode(value: unknown): value is SprintModePreference {
  return value === 'hold' || value === 'toggle';
}

export function sprintModePreferenceKey(childId: string): string {
  return `${SPRINT_KEY_PREFIX}${childId}`;
}

export function loadSprintModePreference(
  childId: string,
  storage: PreferenceStorage | null = defaultStorage(),
): SprintModePreference | null {
  if (!childId || !storage) return null;
  try {
    const value = storage.getItem(sprintModePreferenceKey(childId));
    return isSprintMode(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveSprintModePreference(
  childId: string,
  mode: SprintModePreference,
  storage: PreferenceStorage | null = defaultStorage(),
): boolean {
  if (!childId || !storage || !isSprintMode(mode)) return false;
  try {
    storage.setItem(sprintModePreferenceKey(childId), mode);
    return true;
  } catch {
    return false;
  }
}
