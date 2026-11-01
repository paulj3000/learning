import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../client';
import { ApiError } from '../errors';
import { errorJson, jsonResponse } from '../../test/playFixtures';
import {
  AssetUploadFailure,
  assetAdminMessage,
  createAssetAdminApi,
  findingsFrom,
  parseAssetDetail,
  uploadAssetVersion,
} from './djangoAssetAdmin';

const VERSION = {
  number: 1,
  versionId: '7c3e0d6a-0000-4000-8000-000000000001',
  status: 'VALIDATED',
  originalFilename: 'crane.glb',
  contentType: 'model/gltf-binary',
  sizeBytes: 2048,
  sha256: 'a'.repeat(64),
  format: 'glb',
  clips: ['Idle'],
  dimensions: null,
  validationReport: [],
  createdAt: '2026-11-01T10:00:00Z',
  validatedAt: '2026-11-01T10:00:00Z',
  publishedAt: null,
  retiredAt: null,
};

const DEFINITION = {
  assetId: 'harbor-crane',
  displayName: 'Harbor crane',
  description: '',
  kind: 'prop',
  category: 'building',
  tags: [],
  status: 'ACTIVE',
  origin: 'DJANGO',
  defaultVersion: null,
  versionCount: 1,
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-01T10:00:00Z',
};

function setup(responses: Response[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  const client = createApiClient({
    baseUrl: 'https://lai.example',
    getAccessToken: async () => 'token-1',
    fetch,
  });
  return { api: createAssetAdminApi(client), fetch };
}

describe('Django asset admin API (AM-15)', () => {
  it('lists definitions and reads one with its versions', async () => {
    const { api, fetch } = setup([
      jsonResponse(200, { assets: [DEFINITION] }),
      jsonResponse(200, { ...DEFINITION, versions: [VERSION], publishedReferences: 2 }),
    ]);
    const listed = await api.listModels();
    expect(listed.map((a) => a.assetId)).toEqual(['harbor-crane']);
    expect(fetch.mock.calls[0][0]).toBe('https://lai.example/api/v1/admin/assets/');

    const detail = await api.getAsset('harbor-crane');
    expect(detail.versions[0]).toMatchObject({ number: 1, status: 'VALIDATED' });
    expect(detail.publishedReferences).toBe(2);
    expect(fetch.mock.calls[1][0]).toBe('https://lai.example/api/v1/admin/assets/harbor-crane/');
  });

  it('sends lifecycle actions to the version routes', async () => {
    const { api, fetch } = setup([
      jsonResponse(200, { ...VERSION, status: 'PUBLISHED', publishedAt: '2026-11-01T11:00:00Z' }),
      jsonResponse(200, { ...VERSION, status: 'RETIRED' }),
    ]);
    await expect(api.publish('harbor-crane', 1)).resolves.toMatchObject({ status: 'PUBLISHED' });
    await api.retire('harbor-crane', 1, 2);
    expect(fetch.mock.calls[0][0]).toBe(
      'https://lai.example/api/v1/admin/assets/harbor-crane/versions/1/publish/',
    );
    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe('https://lai.example/api/v1/admin/assets/harbor-crane/versions/1/retire/');
    expect(init?.body).toBe(JSON.stringify({ replacement: 2 }));
  });

  it('treats deleting an already deleted version as done', async () => {
    const { api } = setup([jsonResponse(404, errorJson('not_found'))]);
    await expect(api.deleteVersion('harbor-crane', 1)).resolves.toBeUndefined();
  });

  it('reports a required recent sign-in in plain language (LAI-0209)', async () => {
    const { api } = setup([
      jsonResponse(403, errorJson('recent_auth_required')),
      jsonResponse(503, errorJson('recent_auth_unavailable')),
    ]);
    const error = await api.publish('harbor-crane', 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('recent_auth_required');
    expect(assetAdminMessage(error)).toBe('Please confirm your sign-in to make this change.');
    const down = await api.publish('harbor-crane', 1).catch((e: unknown) => e);
    expect(assetAdminMessage(down)).toMatch(/could not confirm your sign-in just now/);
  });

  it('rejects answers outside the contract', () => {
    expect(() => parseAssetDetail({ ...DEFINITION, versions: [{ number: 'one' }] })).toThrow(
      ApiError,
    );
    expect(() => parseAssetDetail({ ...DEFINITION })).toThrow(ApiError);
  });
});

// --- the XHR upload ----------------------------------------------------------------------------

class FakeRequest {
  static sent: FakeRequest[] = [];
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: FormData | null = null;
  status = 0;
  responseText = '';
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: FormData) {
    this.body = body;
    FakeRequest.sent.push(this);
  }
  abort() {
    this.onabort?.();
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ loaded, total, lengthComputable: true } as ProgressEvent);
  }
}

function startUpload(getAccessToken: () => Promise<string | null> = vi.fn(async () => 'token-1')) {
  FakeRequest.sent = [];
  const onProgress = vi.fn();
  const file = new File([new Uint8Array([1, 2, 3])], 'crane.glb');
  const handle = uploadAssetVersion('harbor-crane', file, {
    baseUrl: 'https://lai.example',
    getAccessToken,
    onProgress,
    createRequest: () => new FakeRequest() as unknown as XMLHttpRequest,
  });
  return { handle, onProgress, getAccessToken, file };
}

async function nextRequest(index: number): Promise<FakeRequest> {
  await vi.waitFor(() => expect(FakeRequest.sent.length).toBeGreaterThan(index));
  return FakeRequest.sent[index];
}

async function failureOf(promise: Promise<unknown>): Promise<AssetUploadFailure> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(AssetUploadFailure);
  return error as AssetUploadFailure;
}

describe('uploadAssetVersion', () => {
  it('posts the file to Django with the token and reports progress', async () => {
    const { handle, onProgress, file } = startUpload();
    const request = await nextRequest(0);
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://lai.example/api/v1/admin/assets/harbor-crane/versions/');
    expect(request.headers.Authorization).toBe('Bearer token-1');
    const sent = request.body?.get('file');
    expect(sent).toBeInstanceOf(File);
    expect(sent instanceof File ? sent.name : '').toBe(file.name);

    request.progress(1, 3);
    expect(onProgress).toHaveBeenCalledWith({ transferredBytes: 1, totalBytes: 3 });
    request.respond(201, VERSION);
    await expect(handle.result).resolves.toMatchObject({ number: 1, status: 'VALIDATED' });
  });

  it('refreshes the token once after a 401', async () => {
    const tokens = vi.fn(async (options?: { forceRefresh?: boolean }) =>
      options?.forceRefresh ? 'token-2' : 'token-1',
    );
    const { handle } = startUpload(tokens);
    (await nextRequest(0)).respond(401, errorJson('not_authenticated'));
    const retry = await nextRequest(1);
    expect(retry.headers.Authorization).toBe('Bearer token-2');
    retry.respond(201, VERSION);
    await expect(handle.result).resolves.toMatchObject({ number: 1 });
  });

  it('names the existing version when the file was already uploaded', async () => {
    const { handle } = startUpload();
    (await nextRequest(0)).respond(409, {
      error: { code: 'duplicate_version', message: 'x', details: { version: 3 } },
    });
    const failure = await failureOf(handle.result);
    expect(failure.existingVersion).toBe(3);
  });

  it('keeps the severity of each validation finding', async () => {
    const { handle } = startUpload();
    (await nextRequest(0)).respond(400, {
      error: {
        code: 'invalid_model',
        message: 'x',
        details: {
          findings: [
            { code: 'not_gltf', severity: 'error', message: 'Not a model.', path: '' },
            { code: 'big', severity: 'warning', message: 'Large.', path: '' },
          ],
        },
      },
    });
    const failure = await failureOf(handle.result);
    expect(findingsFrom(failure).map((f) => f.severity)).toEqual(['error', 'warning']);
    expect(assetAdminMessage(failure)).toMatch(/did not pass validation/);
  });

  it('reports a dropped connection and a cancel', async () => {
    const dropped = startUpload();
    (await nextRequest(0)).onerror?.();
    expect((await failureOf(dropped.handle.result)).error.kind).toBe('network');

    const canceled = startUpload();
    await nextRequest(0);
    canceled.handle.cancel();
    const failure = await failureOf(canceled.handle.result);
    expect(failure.error.kind).toBe('aborted');
    expect(assetAdminMessage(failure)).toBe('The upload was canceled. Nothing was saved.');
  });

  it('never sends a request without a token', async () => {
    const { handle } = startUpload(vi.fn(async () => null));
    expect((await failureOf(handle.result)).error.kind).toBe('unauthenticated');
    expect(FakeRequest.sent).toHaveLength(0);
  });
});
