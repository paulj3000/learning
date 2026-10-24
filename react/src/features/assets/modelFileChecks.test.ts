import { describe, expect, it } from 'vitest';
import {
  checkModelDetails,
  checkModelFile,
  hasErrors,
  slugify,
  warningsOf,
  MODEL_NAME_MAX_LENGTH,
} from './modelFileChecks';
import { MODEL_MAX_UPLOAD_BYTES, MODEL_WARN_UPLOAD_BYTES } from './config';
import { glbHeader } from './testGlb';

const existing = [
  { id: 'a1', name: 'Pirate Captain', slug: 'pirate-captain', originalFileName: 'captain.glb' },
];

function codes(issues: { code: string }[]): string[] {
  return issues.map((issue) => issue.code);
}

describe('checkModelFile', () => {
  it('accepts a valid GLB with no issues', () => {
    const issues = checkModelFile(
      { fileName: 'boat.glb', size: 2048, header: glbHeader(2048) },
      existing,
    );
    expect(issues).toEqual([]);
  });

  it('accepts an upper-case extension', () => {
    expect(checkModelFile({ fileName: 'BOAT.GLB', size: 100, header: glbHeader(100) }, [])).toEqual(
      [],
    );
  });

  it('rejects a file that is not .glb', () => {
    const issues = checkModelFile({ fileName: 'boat.gltf', size: 100, header: glbHeader(100) }, []);
    expect(codes(issues)).toEqual(['WRONG_EXTENSION']);
    expect(hasErrors(issues)).toBe(true);
  });

  it('rejects an empty file', () => {
    expect(
      codes(checkModelFile({ fileName: 'boat.glb', size: 0, header: new Uint8Array() }, [])),
    ).toEqual(['EMPTY_FILE']);
  });

  it('rejects a file over the upload limit before reading its header', () => {
    const size = MODEL_MAX_UPLOAD_BYTES + 1;
    const issues = checkModelFile({ fileName: 'huge.glb', size, header: glbHeader(size) }, []);
    expect(codes(issues)).toEqual(['TOO_LARGE']);
    expect(issues[0]?.message).toContain('50 MB');
  });

  it('warns, without blocking, above the recommended size', () => {
    const size = MODEL_WARN_UPLOAD_BYTES + 1;
    const issues = checkModelFile({ fileName: 'big.glb', size, header: glbHeader(size) }, []);
    expect(codes(issues)).toEqual(['LARGE_FILE']);
    expect(hasErrors(issues)).toBe(false);
    expect(warningsOf(issues)).toHaveLength(1);
  });

  it('rejects a renamed non-GLB file by its header', () => {
    const header = new TextEncoder().encode('PK\u0003\u0004 not a model');
    const issues = checkModelFile({ fileName: 'archive.glb', size: 100, header }, []);
    expect(codes(issues)).toEqual(['NOT_GLB']);
  });

  it('rejects a file too short to hold a header', () => {
    const issues = checkModelFile(
      { fileName: 'tiny.glb', size: 4, header: new Uint8Array([0x67, 0x6c, 0x54, 0x46]) },
      [],
    );
    expect(codes(issues)).toEqual(['NOT_GLB']);
  });

  it('rejects glTF 1.0', () => {
    const issues = checkModelFile(
      { fileName: 'old.glb', size: 100, header: glbHeader(100, { version: 1 }) },
      [],
    );
    expect(codes(issues)).toEqual(['UNSUPPORTED_GLB_VERSION']);
  });

  it('rejects a truncated file whose header declares a different length', () => {
    const issues = checkModelFile({ fileName: 'cut.glb', size: 500, header: glbHeader(1000) }, []);
    expect(codes(issues)).toEqual(['GLB_LENGTH_MISMATCH']);
  });

  it('warns about a file name that was already uploaded, ignoring case', () => {
    const issues = checkModelFile(
      { fileName: 'Captain.GLB', size: 100, header: glbHeader(100) },
      existing,
    );
    expect(codes(issues)).toEqual(['DUPLICATE_FILE_NAME']);
    expect(issues[0]?.severity).toBe('warning');
    expect(issues[0]?.message).toContain('Pirate Captain');
  });
});

describe('slugify', () => {
  it.each([
    ['Pirate Captain Male', 'pirate-captain-male'],
    ['  Café  Table (v3) ', 'cafe-table-v3'],
    ['rock_small--2', 'rock-small-2'],
    ['!!!', ''],
  ])('%s -> %s', (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });

  it('caps length without leaving a trailing dash', () => {
    const slug = slugify(`${'a'.repeat(63)} b`);
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('checkModelDetails', () => {
  it('accepts a new, unique name', () => {
    expect(checkModelDetails({ name: 'Rowing Boat' }, existing)).toEqual([]);
  });

  it('requires a name', () => {
    expect(codes(checkModelDetails({ name: '   ' }, existing))).toEqual(['NAME_REQUIRED']);
  });

  it('rejects an over-long name', () => {
    expect(
      codes(checkModelDetails({ name: 'x'.repeat(MODEL_NAME_MAX_LENGTH + 1) }, existing)),
    ).toEqual(['NAME_TOO_LONG']);
  });

  it('rejects a name with no letters or numbers', () => {
    expect(codes(checkModelDetails({ name: '???' }, existing))).toEqual(['NAME_NEEDS_LETTERS']);
  });

  it('rejects a name whose slug collides with an existing asset', () => {
    const issues = checkModelDetails({ name: 'pirate  CAPTAIN!' }, existing);
    expect(codes(issues)).toEqual(['DUPLICATE_SLUG']);
    expect(issues[0]?.message).toContain('Pirate Captain');
  });
});
