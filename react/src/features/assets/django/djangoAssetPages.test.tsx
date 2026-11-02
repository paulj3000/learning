import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentUser, signIn, signOut } from 'aws-amplify/auth';
import {
  AssetUploadFailure,
  type AdminAssetDetail,
  type AdminAssetVersion,
  type AssetAdminApi,
  type VersionUploadHandle,
} from '../../../api/assets/djangoAssetAdmin';
import { ApiError } from '../../../api/errors';
import { modelAssetPages } from '../../../routes/modelAssetPages';
import { AdminModelAssets } from '../../../routes/AdminModelAssets';
import { AdminNewModelAsset } from '../../../routes/AdminNewModelAsset';
import { assetManagerBackend, djangoAssetManager, type DjangoAssetManager } from '../assetBackend';
import { DjangoModelAssetDetail } from './DjangoModelAssetDetail';
import { DjangoModelAssets } from './DjangoModelAssets';
import { DjangoNewModelAsset } from './DjangoNewModelAsset';

const HERE = dirname(fileURLToPath(import.meta.url));

// The recent sign-in (LAI-0209) uses Amplify Auth; Cognito itself is never reached in tests.
vi.mock('aws-amplify/auth', () => ({
  getCurrentUser: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
const signInMock = vi.mocked(signIn);

beforeEach(() => {
  vi.mocked(getCurrentUser)
    .mockReset()
    .mockResolvedValue({
      userId: 'admin-1',
      username: 'admin-1',
      signInDetails: { loginId: 'admin@example.com' },
    });
  vi.mocked(signOut).mockReset().mockResolvedValue(undefined);
  signInMock.mockReset().mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } });
});

function version(number: number, status: AdminAssetVersion['status']): AdminAssetVersion {
  return {
    number,
    status,
    originalFilename: `crane-${number}.glb`,
    sizeBytes: 2048,
    format: 'glb',
    clips: ['Idle'],
    validationReport: [],
    createdAt: null,
    publishedAt: null,
  };
}

function detail(versions: AdminAssetVersion[], defaultVersion: number | null): AdminAssetDetail {
  return {
    assetId: 'harbor-crane',
    displayName: 'Harbor crane',
    description: '',
    kind: 'prop',
    category: 'building',
    status: 'ACTIVE',
    origin: 'DJANGO',
    defaultVersion,
    versionCount: versions.length,
    updatedAt: null,
    versions,
    publishedReferences: 1,
  };
}

function fakeManager(overrides: Partial<AssetAdminApi> = {}) {
  const api: AssetAdminApi = {
    listModels: vi.fn(async () => []),
    getAsset: vi.fn(async () => detail([version(1, 'VALIDATED')], null)),
    createDefinition: vi.fn(async () => detail([], null)),
    publish: vi.fn(async () => version(1, 'PUBLISHED')),
    makeDefault: vi.fn(async () => version(1, 'PUBLISHED')),
    retire: vi.fn(async () => version(1, 'RETIRED')),
    deleteVersion: vi.fn(async () => undefined),
    ...overrides,
  };
  const outcomes: (() => Promise<AdminAssetVersion>)[] = [];
  const upload = vi.fn((): VersionUploadHandle => ({
    result: outcomes.shift()?.() ?? Promise.resolve(version(1, 'VALIDATED')),
    cancel: vi.fn(),
  }));
  const manager: DjangoAssetManager = { api, upload };
  return { manager, api, upload, outcomes };
}

function renderAt(path: string, element: React.ReactElement, route = path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={element} />
        <Route path="/admin/assets/models/:assetId" element={<p>detail page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('asset manager selection (AM-15)', () => {
  it('uses Django when the build has the Django API, and Amplify otherwise', () => {
    expect(assetManagerBackend({ enabled: false })).toBe('amplify');
    expect(assetManagerBackend({ enabled: true, baseUrl: '' })).toBe('django');
    expect(djangoAssetManager({ enabled: false })).toBeNull();

    const amplify = modelAssetPages(null);
    expect(amplify.list.type).toBe(AdminModelAssets);
    expect(amplify.create.type).toBe(AdminNewModelAsset);
    expect(amplify.detail).toBeNull();

    const django = modelAssetPages(fakeManager().manager);
    expect(django.list.type).toBe(DjangoModelAssets);
    expect(django.create.type).toBe(DjangoNewModelAsset);
    expect(django.detail?.type).toBe(DjangoModelAssetDetail);
  });

  // Runtime imports only: `import type` is erased by the compiler and loads nothing.
  it('keeps Amplify Storage out of every module the Django pages load', () => {
    const seen = new Set<string>();
    const pending = [
      resolve(HERE, 'DjangoModelAssets.tsx'),
      resolve(HERE, 'DjangoNewModelAsset.tsx'),
      resolve(HERE, 'DjangoModelAssetDetail.tsx'),
      resolve(HERE, '../assetBackend.ts'),
    ];
    while (pending.length > 0) {
      const file = pending.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/from '(aws-amplify|@aws-amplify|@aws-sdk)[^']*'/);
      for (const match of source.matchAll(
        /^(?:import|export)(?! type )[^;]*?from '(\.[^']+)'/gms,
      )) {
        const base = resolve(dirname(file), match[1]);
        const candidates = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`];
        const found = candidates.find((candidate) => {
          try {
            readFileSync(candidate);
            return true;
          } catch {
            return false;
          }
        });
        // Shared admin UI and the API client are walked too; only the Amplify auth helpers are
        // allowed (the Cognito token, and the recent sign-in of LAI-0209), not storage modules.
        if (found && !found.endsWith('/api/auth.ts') && !found.endsWith('/recentSignIn.ts'))
          pending.push(found);
      }
    }
    expect(seen.size).toBeGreaterThan(5);
  });
});

describe('DjangoModelAssets', () => {
  it('lists definitions and explains a failed load', async () => {
    const { manager } = fakeManager({
      listModels: vi
        .fn()
        .mockRejectedValueOnce(
          new ApiError('forbidden', { status: 403, code: 'permission_denied' }),
        )
        .mockResolvedValueOnce([detail([], 2)]),
    });
    renderAt('/admin/assets/models', <DjangoModelAssets manager={manager} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('not an administrator');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Harbor crane' })).toHaveAttribute(
      'href',
      '/admin/assets/models/harbor-crane',
    );
    expect(screen.getByText('v2')).toBeInTheDocument();
  });
});

describe('DjangoNewModelAsset', () => {
  async function fillAndSubmit() {
    await userEvent.type(screen.getByLabelText('Name'), 'Harbor Crane');
    expect(screen.getByLabelText('Asset id')).toHaveValue('harbor-crane');
    const file = new File([new Uint8Array([1])], 'crane.glb');
    await userEvent.upload(screen.getByLabelText(/Model file/), file);
    await userEvent.click(screen.getByRole('button', { name: 'Add and upload' }));
    return file;
  }

  it('creates the definition, uploads through Django, and opens the asset', async () => {
    const { manager, api, upload } = fakeManager();
    renderAt('/admin/assets/models/new', <DjangoNewModelAsset manager={manager} />);
    const file = await fillAndSubmit();
    expect(await screen.findByText('detail page')).toBeInTheDocument();
    expect(api.createDefinition).toHaveBeenCalledWith({
      assetId: 'harbor-crane',
      displayName: 'Harbor Crane',
      description: '',
      kind: 'prop',
      category: 'prop',
    });
    expect(upload).toHaveBeenCalledWith('harbor-crane', file, expect.any(Function));
  });

  it('retries only the upload after a failed upload, never a second definition', async () => {
    const { manager, api, upload, outcomes } = fakeManager();
    outcomes.push(() =>
      Promise.reject(
        new AssetUploadFailure(
          new ApiError('unavailable', { status: 503, code: 'storage_failed' }),
          null,
        ),
      ),
    );
    renderAt('/admin/assets/models/new', <DjangoNewModelAsset manager={manager} />);
    await fillAndSubmit();
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be stored');
    expect(screen.getByRole('alert')).toHaveTextContent('Trying again only uploads the file');

    await userEvent.click(screen.getByRole('button', { name: 'Try the upload again' }));
    expect(await screen.findByText('detail page')).toBeInTheDocument();
    expect(api.createDefinition).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it('counts a file Django already holds as uploaded', async () => {
    const { manager, outcomes } = fakeManager();
    outcomes.push(() =>
      Promise.reject(
        new AssetUploadFailure(
          new ApiError('conflict', { status: 409, code: 'duplicate_version' }),
          1,
        ),
      ),
    );
    renderAt('/admin/assets/models/new', <DjangoNewModelAsset manager={manager} />);
    await fillAndSubmit();
    expect(await screen.findByText('detail page')).toBeInTheDocument();
  });

  it('asks for a recent sign-in, keeps the form, and adds the model after confirming', async () => {
    const { manager, api, upload } = fakeManager({
      createDefinition: vi
        .fn()
        .mockRejectedValueOnce(
          new ApiError('forbidden', { status: 403, code: 'recent_auth_required' }),
        )
        .mockResolvedValue(detail([], null)),
    });
    renderAt('/admin/assets/models/new', <DjangoNewModelAsset manager={manager} />);
    await fillAndSubmit();

    const dialog = await screen.findByRole('dialog', { name: 'Please confirm it is you' });
    expect(screen.getByLabelText('Name')).toHaveValue('Harbor Crane'); // the form is kept
    await userEvent.type(within(dialog).getByLabelText('Password'), 'correct horse');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm sign-in' }));
    expect(signInMock).toHaveBeenCalledWith({
      username: 'admin@example.com',
      password: 'correct horse',
    });
    expect(api.createDefinition).toHaveBeenCalledTimes(1); // nothing retried yet

    await userEvent.click(await screen.findByRole('button', { name: 'Add model' }));
    expect(await screen.findByText('detail page')).toBeInTheDocument();
    expect(api.createDefinition).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('cancelling the sign-in changes nothing and keeps the form', async () => {
    const { manager, api, upload } = fakeManager({
      createDefinition: vi
        .fn()
        .mockRejectedValue(
          new ApiError('forbidden', { status: 403, code: 'recent_auth_required' }),
        ),
    });
    renderAt('/admin/assets/models/new', <DjangoNewModelAsset manager={manager} />);
    await fillAndSubmit();
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.createDefinition).toHaveBeenCalledTimes(1);
    expect(upload).not.toHaveBeenCalled();
    expect(signInMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Name')).toHaveValue('Harbor Crane');
    expect(screen.getByRole('button', { name: 'Add and upload' })).toBeEnabled();
  });

  it('shows field errors', async () => {
    const { manager, upload } = fakeManager({
      createDefinition: vi.fn().mockRejectedValue(
        new ApiError('invalid_request', {
          status: 400,
          code: 'validation_error',
          details: { assetId: [{ message: 'Taken.', code: 'invalid' }] },
        }),
      ),
    });
    renderAt('/admin/assets/models/new', <DjangoNewModelAsset manager={manager} />);
    await fillAndSubmit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Check the highlighted fields');
    expect(upload).not.toHaveBeenCalled();
  });
});

describe('DjangoModelAssetDetail', () => {
  function renderDetail(manager: DjangoAssetManager) {
    return renderAt(
      '/admin/assets/models/harbor-crane',
      <DjangoModelAssetDetail manager={manager} />,
      '/admin/assets/models/:assetId',
    );
  }

  it('offers only the actions the version state allows', async () => {
    const { manager } = fakeManager({
      getAsset: vi.fn(async () =>
        detail([version(3, 'VALIDATED'), version(2, 'PUBLISHED'), version(1, 'PUBLISHED')], 1),
      ),
    });
    renderDetail(manager);
    expect(await screen.findByRole('button', { name: 'Publish version 3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete version 3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make version 2 the default' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retire version 2' })).toBeInTheDocument();
    // The default is neither deletable nor retirable from here.
    expect(screen.queryByRole('button', { name: 'Retire version 1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete version 1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete version 2' })).toBeNull();
  });

  it('publishes, and deletes only after confirmation', async () => {
    const { manager, api } = fakeManager();
    renderDetail(manager);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish version 1' }));
    await waitFor(() => expect(api.publish).toHaveBeenCalledWith('harbor-crane', 1));
    expect(await screen.findByRole('status')).toHaveTextContent('Published version 1.');

    await userEvent.click(screen.getByRole('button', { name: 'Delete version 1' }));
    expect(api.deleteVersion).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(api.deleteVersion).toHaveBeenCalledWith('harbor-crane', 1));
  });

  it('shows validation findings for a refused upload', async () => {
    const { manager, outcomes } = fakeManager();
    outcomes.push(() =>
      Promise.reject(
        new AssetUploadFailure(
          new ApiError('invalid_request', { status: 400, code: 'invalid_model' }),
          null,
          [{ code: 'not_gltf', severity: 'error', message: 'This is not a glTF model.' }],
        ),
      ),
    );
    renderDetail(manager);
    await userEvent.upload(
      await screen.findByLabelText('Upload a new version'),
      new File([new Uint8Array([1])], 'bad.glb'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('did not pass validation');
    expect(screen.getByRole('list', { name: 'Validation findings' })).toHaveTextContent(
      'Error: This is not a glTF model.',
    );
  });
});

describe('DjangoModelAssetDetail recent sign-in (LAI-0209)', () => {
  const stale = () => new ApiError('forbidden', { status: 403, code: 'recent_auth_required' });

  function renderDetail(manager: DjangoAssetManager) {
    return renderAt(
      '/admin/assets/models/harbor-crane',
      <DjangoModelAssetDetail manager={manager} />,
      '/admin/assets/models/:assetId',
    );
  }

  async function verify() {
    const dialog = await screen.findByRole('dialog', { name: 'Please confirm it is you' });
    await userEvent.type(within(dialog).getByLabelText('Password'), 'pw');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm sign-in' }));
  }

  it('publishes once after the administrator signs in again and confirms', async () => {
    const { manager, api } = fakeManager({
      publish: vi.fn().mockRejectedValueOnce(stale()).mockResolvedValue(version(1, 'PUBLISHED')),
    });
    renderDetail(manager);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish version 1' }));
    await verify();
    const confirm = await screen.findByRole('dialog', { name: 'Publish version 1' });
    expect(api.publish).toHaveBeenCalledTimes(1); // explicit confirmation before the retry
    await userEvent.click(within(confirm).getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('Published version 1.')).toBeInTheDocument();
    expect(api.publish).toHaveBeenCalledTimes(2);
  });

  it('never retries more than once', async () => {
    const { manager, api } = fakeManager({ publish: vi.fn().mockRejectedValue(stale()) });
    renderDetail(manager);
    await userEvent.click(await screen.findByRole('button', { name: 'Publish version 1' }));
    await verify();
    await userEvent.click(await screen.findByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/still could not confirm your sign-in/)).toBeInTheDocument();
    expect(api.publish).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.publish).toHaveBeenCalledTimes(2);
  });

  it('keeps the chosen file while signing in, and uploads it after confirming', async () => {
    const { manager, upload, outcomes } = fakeManager();
    outcomes.push(() => Promise.reject(new AssetUploadFailure(stale(), null)));
    renderDetail(manager);
    const file = new File([new Uint8Array([1])], 'crane-2.glb');
    await userEvent.upload(await screen.findByLabelText('Upload a new version'), file);
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await verify();
    const confirm = await screen.findByRole('dialog', { name: 'Upload crane-2.glb' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(upload).toHaveBeenLastCalledWith('harbor-crane', file, expect.any(Function));
  });
});
