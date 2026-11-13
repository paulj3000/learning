import { describe, expect, it } from 'vitest';
import {
  cameraPreferenceKey,
  loadCameraPreference,
  saveCameraPreference,
  type PreferenceStorage,
} from './cameraPreference';

function memory(): PreferenceStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

const broken: PreferenceStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
};

describe('camera preference (LAI-JMP-01a)', () => {
  it('remembers each child’s choice separately', () => {
    const storage = memory();
    expect(saveCameraPreference('child-a', 'first-person', storage)).toBe(true);
    expect(saveCameraPreference('child-b', 'third-person', storage)).toBe(true);
    expect(loadCameraPreference('child-a', storage)).toBe('first-person');
    expect(loadCameraPreference('child-b', storage)).toBe('third-person');
    expect(storage.data.get(cameraPreferenceKey('child-a'))).toBe('first-person');
  });

  it('is null when nothing (or nonsense) was saved', () => {
    const storage = memory();
    expect(loadCameraPreference('child-a', storage)).toBeNull();
    storage.data.set(cameraPreferenceKey('child-a'), 'drone');
    expect(loadCameraPreference('child-a', storage)).toBeNull();
  });

  it('never throws where storage is blocked or full, and never stores without a child', () => {
    expect(loadCameraPreference('child-a', broken)).toBeNull();
    expect(saveCameraPreference('child-a', 'first-person', broken)).toBe(false);
    expect(saveCameraPreference('', 'first-person', memory())).toBe(false);
    expect(loadCameraPreference('child-a', null)).toBeNull();
  });

  it('works with the browser’s own storage', () => {
    window.localStorage.clear();
    expect(saveCameraPreference('child-z', 'first-person')).toBe(true);
    expect(loadCameraPreference('child-z')).toBe('first-person');
    window.localStorage.clear();
  });
});
