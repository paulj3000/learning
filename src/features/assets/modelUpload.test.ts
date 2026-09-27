import { beforeEach, describe, expect, it, vi } from 'vitest';

const { uploadData, remove, assetCreate, assetDelete, versionCreate, calls } = vi.hoisted(() => ({
  uploadData: vi.fn(),
  remove: vi.fn(),
  assetCreate: vi.fn(),
  assetDelete: vi.fn(),
  versionCreate: vi.fn(),
  calls: [] as string[],
}));

class CanceledError extends Error {}

vi.mock('aws-amplify/storage', () => ({
  uploadData,
  remove,
  isCancelError: (error: unknown) => error instanceof CanceledError,
}));

vi.mock('../../lib/data-client', () => ({
  client: {
    models: {
      Asset: { create: assetCreate, delete: assetDelete },
      AssetVersion: { create: versionCreate },
    },
  },
}));

import { AssetUploadError, progressPercent, startModelUpload } from './modelUpload';
import type { ModelAssetDetails } from './types';
import { glbFile } from './testGlb';

const details: ModelAssetDetails = {
  name: '  Rowing Boat ',
  description: '',
  category: 'VEHICLE',
  worldId: 'learning-adventure-island',
  regionId: 'pirate-builder-bay',
  source: 'THIRD_PARTY_PACK',
  sourceNotes: 'Kenney Watercraft Pack (CC0)',
};

function mockUpload(result: Promise<unknown>) {
  const cancel = vi.fn();
  uploadData.mockImplementation(
    (input: {
      options: { onProgress: (p: { transferredBytes: number; totalBytes?: number }) => void };
    }) => {
      calls.push('upload');
      input.options.onProgress({ transferredBytes: 32, totalBytes: 64 });
      return { result, cancel };
    },
  );
  return cancel;
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  assetCreate.mockImplementation(async (input: Record<string, unknown>) => {
    calls.push('createAsset');
    return { data: { ...input, createdAt: 'now', updatedAt: 'now' }, errors: undefined };
  });
  versionCreate.mockImplementation(async (input: Record<string, unknown>) => {
    calls.push('createVersion');
    return { data: input, errors: undefined };
  });
  assetDelete.mockResolvedValue({ data: null });
  remove.mockImplementation(async () => {
    calls.push('remove');
  });
});

describe('startModelUpload', () => {
  it('uploads to S3 before creating any record, then creates a draft asset and its first version', async () => {
    mockUpload(Promise.resolve({ path: 'x' }));
    const onProgress = vi.fn();

    const asset = await startModelUpload({
      file: glbFile('boat.glb'),
      details,
      uploadedBy: 'admin-sub',
      onProgress,
    }).result;

    expect(calls).toEqual(['upload', 'createAsset', 'createVersion']);
    expect(onProgress).toHaveBeenCalledWith({ transferredBytes: 32, totalBytes: 64 });

    const [uploadInput] = uploadData.mock.calls[0] as [
      { path: string; options: { contentType: string } },
    ];
    const [assetInput] = assetCreate.mock.calls[0] as [Record<string, unknown>];
    const [versionInput] = versionCreate.mock.calls[0] as [Record<string, unknown>];

    expect(uploadInput.path).toBe(`assets/models/vehicles/${String(assetInput.id)}/v1/model.glb`);
    expect(uploadInput.options.contentType).toBe('model/gltf-binary');
    expect(assetInput).toMatchObject({
      name: 'Rowing Boat',
      slug: 'rowing-boat',
      description: undefined,
      assetType: 'MODEL_3D',
      category: 'VEHICLE',
      status: 'DRAFT',
      currentVersion: 1,
      currentVersionId: versionInput.id,
      s3Key: uploadInput.path,
      fileName: 'model.glb',
      originalFileName: 'boat.glb',
      fileSize: 64,
      createdBy: 'admin-sub',
      lastModifiedBy: 'admin-sub',
      regionId: 'pirate-builder-bay',
    });
    expect(versionInput).toMatchObject({
      assetId: assetInput.id,
      version: 1,
      s3Key: uploadInput.path,
      uploadedBy: 'admin-sub',
    });
    expect(asset.status).toBe('DRAFT');
  });

  it('never creates a published asset', async () => {
    mockUpload(Promise.resolve({}));
    await startModelUpload({ file: glbFile('a.glb'), details, uploadedBy: 'u' }).result;
    const [assetInput] = assetCreate.mock.calls[0] as [Record<string, unknown>];
    expect(assetInput.status).not.toBe('PUBLISHED');
    expect(assetInput.publishedAt).toBeUndefined();
  });

  it('creates no record when the S3 upload fails', async () => {
    mockUpload(Promise.reject(new Error('network down')));

    const result = startModelUpload({ file: glbFile('a.glb'), details, uploadedBy: 'u' }).result;

    await expect(result).rejects.toMatchObject({ code: 'UPLOAD_FAILED' });
    expect(assetCreate).not.toHaveBeenCalled();
    expect(versionCreate).not.toHaveBeenCalled();
  });

  it('reports a cancelled upload as CANCELED and creates nothing', async () => {
    const cancel = mockUpload(Promise.reject(new CanceledError('canceled')));

    const handle = startModelUpload({ file: glbFile('a.glb'), details, uploadedBy: 'u' });
    handle.cancel();

    await expect(handle.result).rejects.toMatchObject({ code: 'CANCELED' });
    expect(cancel).toHaveBeenCalled();
    expect(assetCreate).not.toHaveBeenCalled();
  });

  it('removes the uploaded object when the asset record cannot be created', async () => {
    mockUpload(Promise.resolve({}));
    assetCreate.mockResolvedValue({ data: null, errors: [{ message: 'Unauthorized' }] });

    const result = startModelUpload({ file: glbFile('a.glb'), details, uploadedBy: 'u' }).result;

    await expect(result).rejects.toMatchObject({ code: 'RECORD_FAILED' });
    expect(versionCreate).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith({
      path: (uploadData.mock.calls[0] as [{ path: string }])[0].path,
    });
  });

  it('removes both the asset record and the object when the version record fails', async () => {
    mockUpload(Promise.resolve({}));
    versionCreate.mockImplementation(async () => {
      calls.push('createVersion');
      throw new Error('boom');
    });
    assetDelete.mockImplementation(async () => {
      calls.push('deleteAsset');
      return { data: null };
    });

    const result = startModelUpload({ file: glbFile('a.glb'), details, uploadedBy: 'u' }).result;

    await expect(result).rejects.toBeInstanceOf(AssetUploadError);
    expect(calls).toEqual(['upload', 'createAsset', 'createVersion', 'deleteAsset', 'remove']);
  });

  it('cleans up the same way when the version record returns GraphQL errors', async () => {
    mockUpload(Promise.resolve({}));
    versionCreate.mockResolvedValue({ data: null, errors: [{ message: 'Unauthorized' }] });

    await expect(
      startModelUpload({ file: glbFile('a.glb'), details, uploadedBy: 'u' }).result,
    ).rejects.toMatchObject({ code: 'RECORD_FAILED' });
    expect(assetDelete).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('still reports the original failure when the cleanup delete also fails', async () => {
    mockUpload(Promise.resolve({}));
    assetCreate.mockResolvedValue({ data: null, errors: [{ message: 'x' }] });
    remove.mockRejectedValue(new Error('also down'));

    await expect(
      startModelUpload({ file: glbFile('a.glb'), details, uploadedBy: 'u' }).result,
    ).rejects.toMatchObject({ code: 'RECORD_FAILED' });
  });

  it('gives a fresh asset id to every upload', async () => {
    mockUpload(Promise.resolve({}));
    await startModelUpload({ file: glbFile('a.glb'), details, uploadedBy: 'u' }).result;
    await startModelUpload({ file: glbFile('a.glb'), details, uploadedBy: 'u' }).result;
    const ids = assetCreate.mock.calls.map(([input]) => (input as { id: string }).id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('AssetUploadError', () => {
  it('carries a safe, specific message for each code', () => {
    expect(new AssetUploadError('CANCELED').message).toContain('Nothing was saved');
    expect(new AssetUploadError('UPLOAD_FAILED').message).toContain('connection');
    expect(new AssetUploadError('RECORD_FAILED').message).toContain('removed');
  });
});

describe('progressPercent', () => {
  it.each([
    [{ transferredBytes: 0, totalBytes: 100 }, 0],
    [{ transferredBytes: 499, totalBytes: 1000 }, 49],
    [{ transferredBytes: 100, totalBytes: 100 }, 100],
    [{ transferredBytes: 150, totalBytes: 100 }, 100],
    [{ transferredBytes: 5, totalBytes: 0 }, 0],
  ])('%j -> %d', (progress, percent) => {
    expect(progressPercent(progress)).toBe(percent);
  });
});
