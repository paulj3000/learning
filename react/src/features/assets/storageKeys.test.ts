import { describe, expect, it } from 'vitest';
import { MODEL_CATEGORY_FOLDERS, modelObjectKey } from './storageKeys';
import { ASSET_CATEGORIES } from './types';
import { formatFileSize } from './config';

describe('modelObjectKey', () => {
  it('builds a versioned key under the category folder', () => {
    expect(modelObjectKey('CHARACTER', 'abc-123', 3)).toBe(
      'assets/models/characters/abc-123/v3/model.glb',
    );
  });

  it('gives every version its own object, so a replacement never overwrites', () => {
    expect(modelObjectKey('PROP', 'id', 1)).not.toBe(modelObjectKey('PROP', 'id', 2));
  });

  it('keeps every key inside the Admins-only assets/ prefix', () => {
    for (const category of ASSET_CATEGORIES) {
      expect(modelObjectKey(category, 'id', 1)).toMatch(/^assets\/models\/[a-z-]+\/id\/v1\//);
    }
  });

  it('has a distinct folder for every category', () => {
    const folders = Object.values(MODEL_CATEGORY_FOLDERS);
    expect(new Set(folders).size).toBe(folders.length);
  });

  it.each([
    ['', 1],
    ['../escape', 1],
    ['id', 0],
    ['id', 1.5],
  ])('rejects id %j with version %j', (id, version) => {
    expect(() => modelObjectKey('PROP', id, version)).toThrow();
  });
});

describe('formatFileSize', () => {
  it.each([
    [512, '512 B'],
    [2048, '2.0 KB'],
    [15_518_924, '14.8 MB'],
  ])('%d -> %s', (bytes, label) => {
    expect(formatFileSize(bytes)).toBe(label);
  });
});
