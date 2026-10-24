import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { startModelUpload } = vi.hoisted(() => ({ startModelUpload: vi.fn() }));

vi.mock('./modelUpload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./modelUpload')>();
  return { ...actual, startModelUpload };
});

import { ModelUploadWizard } from './ModelUploadWizard';
import { AssetUploadError, type StartModelUploadInput } from './modelUpload';
import type { Asset } from './types';
import { glbFile } from './testGlb';

const existingAssets = [
  {
    id: 'a1',
    name: 'Pirate Captain',
    slug: 'pirate-captain',
    originalFileName: 'captain.glb',
  } as Asset,
];

interface Deferred {
  resolve: (asset: Asset) => void;
  reject: (error: unknown) => void;
  cancel: ReturnType<typeof vi.fn>;
  input: () => StartModelUploadInput;
}

function deferUpload(): Deferred {
  const deferred = {} as Deferred;
  deferred.cancel = vi.fn();
  startModelUpload.mockImplementation((input: StartModelUploadInput) => {
    deferred.input = () => input;
    return {
      result: new Promise<Asset>((resolve, reject) => {
        deferred.resolve = resolve;
        deferred.reject = reject;
      }),
      cancel: deferred.cancel,
    };
  });
  return deferred;
}

function renderWizard() {
  const onUploaded = vi.fn();
  const onCancel = vi.fn();
  const { unmount } = render(
    <ModelUploadWizard
      existingAssets={existingAssets}
      uploadedBy="admin-sub"
      onUploaded={onUploaded}
      onCancel={onCancel}
    />,
  );
  return { onUploaded, onCancel, unmount, user: userEvent.setup({ applyAccept: false }) };
}

async function chooseFile(user: ReturnType<typeof userEvent.setup>, file: File) {
  await user.upload(screen.getByLabelText('Model file'), file);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ModelUploadWizard', () => {
  it('walks through select, details, and upload, then reports the created asset', async () => {
    const upload = deferUpload();
    const { user, onUploaded } = renderWizard();

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await chooseFile(user, glbFile('rowing_boat.glb'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // The name is suggested from the file name.
    expect(screen.getByLabelText('Name')).toHaveValue('rowing boat');
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Rowing Boat');
    await user.selectOptions(screen.getByLabelText('Category'), 'VEHICLE');
    await user.selectOptions(
      screen.getByLabelText('World (optional)'),
      'learning-adventure-island',
    );
    await user.selectOptions(screen.getByLabelText('Region (optional)'), 'pirate-builder-bay');
    await user.click(screen.getByRole('button', { name: 'Upload model' }));

    expect(screen.getByRole('status')).toHaveTextContent('Uploading... 0%');
    const input = upload.input();
    expect(input.uploadedBy).toBe('admin-sub');
    expect(input.details).toMatchObject({
      name: 'Rowing Boat',
      category: 'VEHICLE',
      worldId: 'learning-adventure-island',
      regionId: 'pirate-builder-bay',
    });

    act(() => input.onProgress?.({ transferredBytes: 40, totalBytes: 64 }));
    expect(screen.getByRole('status')).toHaveTextContent('Uploading... 62%');

    upload.resolve({ id: 'new', name: 'Rowing Boat' } as Asset);
    await waitFor(() =>
      expect(onUploaded).toHaveBeenCalledWith({ id: 'new', name: 'Rowing Boat' }),
    );
  });

  it('blocks a file that is not a GLB', async () => {
    const { user } = renderWizard();
    await chooseFile(user, new File(['hello'], 'notes.txt', { type: 'text/plain' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Only .glb files can be uploaded');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('blocks a renamed file whose header is not glTF', async () => {
    const { user } = renderWizard();
    await chooseFile(user, new File([new Uint8Array(64)], 'fake.glb'));

    expect(await screen.findByRole('alert')).toHaveTextContent('not a valid GLB model');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('requires the admin to acknowledge a duplicate file name warning', async () => {
    const { user } = renderWizard();
    await chooseFile(user, glbFile('captain.glb'));

    expect(await screen.findByText(/already uploaded as "Pirate Captain"/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.click(screen.getByLabelText('I have reviewed the warnings and want to continue.'));
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('blocks a name that collides with an existing asset, without uploading', async () => {
    deferUpload();
    const { user } = renderWizard();
    await chooseFile(user, glbFile('new.glb'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Pirate captain');
    await user.click(screen.getByRole('button', { name: 'Upload model' }));

    expect(screen.getByRole('alert')).toHaveTextContent('too close to the existing asset');
    expect(startModelUpload).not.toHaveBeenCalled();
  });

  it('clears the region when the world changes', async () => {
    const { user } = renderWizard();
    await chooseFile(user, glbFile('a.glb'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByLabelText('Region (optional)')).toBeDisabled();
    await user.selectOptions(
      screen.getByLabelText('World (optional)'),
      'learning-adventure-island',
    );
    await user.selectOptions(screen.getByLabelText('Region (optional)'), 'wonderwild-forest');
    await user.selectOptions(screen.getByLabelText('World (optional)'), '');
    expect(screen.getByLabelText('Region (optional)')).toHaveValue('');
  });

  it('cancels an upload in progress and lets the admin retry', async () => {
    const upload = deferUpload();
    const { user } = renderWizard();
    await chooseFile(user, glbFile('a.glb'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Upload model' }));

    await user.click(screen.getByRole('button', { name: 'Cancel upload' }));
    expect(upload.cancel).toHaveBeenCalled();
    upload.reject(new AssetUploadError('CANCELED'));

    expect(await screen.findByRole('alert')).toHaveTextContent('The upload was canceled.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(startModelUpload).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('Uploading...');
  });

  it('shows the specific message for a failed upload', async () => {
    const upload = deferUpload();
    const { user } = renderWizard();
    await chooseFile(user, glbFile('a.glb'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Upload model' }));
    upload.reject(new AssetUploadError('UPLOAD_FAILED'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Check your connection');
  });

  it('cancels a running upload when the wizard is closed', async () => {
    const upload = deferUpload();
    const { user, unmount } = renderWizard();
    await chooseFile(user, glbFile('a.glb'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Upload model' }));

    unmount();
    expect(upload.cancel).toHaveBeenCalled();
  });
});
