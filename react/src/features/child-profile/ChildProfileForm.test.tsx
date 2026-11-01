import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  uploadData,
  remove,
  getUrl,
  prepareIconBlob,
  applyChildPhotoSelection,
  updateChildProfile,
  getChildPhotoUrl,
} = vi.hoisted(() => ({
  uploadData: vi.fn(),
  remove: vi.fn(),
  getUrl: vi.fn(),
  prepareIconBlob: vi.fn(),
  applyChildPhotoSelection: vi.fn(),
  updateChildProfile: vi.fn(),
  getChildPhotoUrl: vi.fn(),
}));

vi.mock('aws-amplify/storage', () => ({ uploadData, remove, getUrl }));

// Only the canvas re-encode is stubbed - jsdom has no image decoder. The
// validation, upload-ordering, and cleanup logic under test stays real.
vi.mock('./avatarPhoto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./avatarPhoto')>()),
  prepareIconBlob,
}));

// The Django photo calls (LAI-0905) are spied on; the build's default store stays Amplify.
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  applyChildPhotoSelection,
  updateChildProfile,
  getChildPhotoUrl,
}));

import { ChildProfileForm } from './ChildProfileForm';
import type { ChildProfile } from './profileTypes';

const SAVED_CHILD: ChildProfile = {
  id: 'c1',
  nickname: 'Robin',
  ageBand: 'SPROUT',
  avatarKey: 'OWL',
  avatarPhotoKey: null,
  interests: [],
  readingMode: 'VOICE_FIRST',
  sessionMinutes: 5,
  active: true,
  aiEnabled: true,
  createdAt: null,
  updatedAt: null,
};

const IMAGE_FILE = new File(['fake-image-bytes'], 'child.jpg', { type: 'image/jpeg' });

beforeEach(() => {
  vi.clearAllMocks();
  prepareIconBlob.mockResolvedValue(new Blob(['icon'], { type: 'image/jpeg' }));
  uploadData.mockImplementation(() => ({
    result: Promise.resolve({ path: 'child-photos/identity-1/new.jpg' }),
  }));
  remove.mockResolvedValue(undefined);
  getUrl.mockResolvedValue({ url: new URL('https://example.invalid/stored.jpg') });
  getChildPhotoUrl.mockResolvedValue('https://example.invalid/stored.jpg');
  applyChildPhotoSelection.mockResolvedValue(undefined);
  updateChildProfile.mockResolvedValue(SAVED_CHILD);
  // jsdom implements neither, and the photo preview needs both.
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

describe('ChildProfileForm', () => {
  it('blocks submission and reports an error when the nickname is empty', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ChildProfileForm submitLabel="Create profile" onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: /create profile/i }));

    expect(await screen.findByText(/enter a nickname/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits a filled-in profile', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ChildProfileForm submitLabel="Create profile" onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/nickname/i), 'Robin');
    await user.click(screen.getByRole('button', { name: /create profile/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ nickname: 'Robin', ageBand: 'SPROUT' }),
    );
  });

  it('shows a submit error returned by the onSubmit handler', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Could not create the child profile.'));
    const user = userEvent.setup();
    render(<ChildProfileForm submitLabel="Create profile" onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/nickname/i), 'Robin');
    await user.click(screen.getByRole('button', { name: /create profile/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not create/i);
  });
});

describe('ChildProfileForm photo icon', () => {
  it('saves a profile with no photo when the parent does not choose one', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ChildProfileForm submitLabel="Create profile" onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/nickname/i), 'Robin');
    await user.click(screen.getByRole('button', { name: /create profile/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ avatarPhotoKey: null }));
    expect(uploadData).not.toHaveBeenCalled();
  });

  it('offers no photo upload where photos are turned off', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <ChildProfileForm submitLabel="Create profile" onSubmit={onSubmit} photosEnabled={false} />,
    );

    expect(screen.queryByLabelText(/choose a photo/i)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/nickname/i), 'Robin');
    await user.click(screen.getByRole('button', { name: /create profile/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ avatarPhotoKey: null }));
    expect(uploadData).not.toHaveBeenCalled();
  });

  it('uploads a chosen photo and saves the profile with its stored path', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ChildProfileForm submitLabel="Create profile" onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/nickname/i), 'Robin');
    await user.upload(screen.getByLabelText(/choose a photo/i), IMAGE_FILE);
    await waitFor(() => expect(prepareIconBlob).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: /create profile/i }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ avatarPhotoKey: 'child-photos/identity-1/new.jpg' }),
      ),
    );
  });

  it('rejects an oversized photo, and prepares or uploads nothing', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ChildProfileForm submitLabel="Create profile" onSubmit={onSubmit} />);

    // A real 9 MB file would just slow the suite down; only `size` is read.
    const oversized = new File(['x'], 'huge.jpg', { type: 'image/jpeg' });
    Object.defineProperty(oversized, 'size', { value: 9 * 1024 * 1024 });

    await user.upload(screen.getByLabelText(/choose a photo/i), oversized);

    expect(await screen.findByRole('alert')).toHaveTextContent(/smaller than 8 MB/i);
    expect(prepareIconBlob).not.toHaveBeenCalled();
    expect(uploadData).not.toHaveBeenCalled();
  });

  /**
   * The file input's `accept` attribute already filters most of these out in
   * a real file picker, but it is a hint, not a guarantee (drag and drop, a
   * misreporting OS), so the type check is enforced in code as well - see
   * `validatePhotoFile` in avatarPhoto.test.ts.
   */
  it('only offers the image types the browser can decode', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ChildProfileForm submitLabel="Create profile" onSubmit={onSubmit} />);

    expect(screen.getByLabelText(/choose a photo/i)).toHaveAttribute(
      'accept',
      'image/jpeg,image/png,image/webp',
    );
  });

  it('clears the stored photo and deletes it when the parent removes it', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <ChildProfileForm
        submitLabel="Save changes"
        initialValue={{
          nickname: 'Robin',
          avatarPhotoKey: 'child-photos/identity-1/old.jpg',
        }}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole('button', { name: /remove photo/i }));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ avatarPhotoKey: null })),
    );
    expect(remove).toHaveBeenCalledWith({ path: 'child-photos/identity-1/old.jpg' });
  });

  it('reports a failed upload without saving the profile', async () => {
    uploadData.mockImplementation(() => ({ result: Promise.reject(new Error('AccessDenied')) }));
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ChildProfileForm submitLabel="Create profile" onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/nickname/i), 'Robin');
    await user.upload(screen.getByLabelText(/choose a photo/i), IMAGE_FILE);
    await waitFor(() => expect(prepareIconBlob).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: /create profile/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save that photo/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('ChildProfileForm photo icon with the Django photo API (after-save, LAI-0905)', () => {
  async function fillAndPickPhoto(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/nickname/i), 'Robin');
    await user.upload(screen.getByLabelText(/choose a photo/i), IMAGE_FILE);
    await waitFor(() => expect(prepareIconBlob).toHaveBeenCalled());
  }

  it('saves the profile first, then uploads the prepared icon for the saved child', async () => {
    const order: string[] = [];
    const onSubmit = vi.fn(async () => {
      order.push('save');
      return SAVED_CHILD;
    });
    applyChildPhotoSelection.mockImplementation(async () => {
      order.push('photo');
    });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <ChildProfileForm
        submitLabel="Create profile"
        onSubmit={onSubmit}
        onSaved={onSaved}
        photoWrite="after-save"
      />,
    );

    await fillAndPickPhoto(user);
    await user.click(screen.getByRole('button', { name: /create profile/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['save', 'photo']);
    expect(applyChildPhotoSelection).toHaveBeenCalledWith('c1', {
      kind: 'replace',
      icon: expect.any(Blob),
    });
    expect(uploadData).not.toHaveBeenCalled();
  });

  it('removes the photo of the saved child', async () => {
    const onSubmit = vi.fn().mockResolvedValue({ ...SAVED_CHILD, avatarPhotoKey: 'c1' });
    const user = userEvent.setup();
    render(
      <ChildProfileForm
        submitLabel="Save changes"
        initialValue={{ nickname: 'Robin', avatarPhotoKey: 'c1' }}
        onSubmit={onSubmit}
        photoWrite="after-save"
      />,
    );

    await user.click(screen.getByRole('button', { name: /remove photo/i }));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() =>
      expect(applyChildPhotoSelection).toHaveBeenCalledWith('c1', { kind: 'remove' }),
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it('makes no photo call when the photo is unchanged', async () => {
    const onSubmit = vi.fn().mockResolvedValue(SAVED_CHILD);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <ChildProfileForm
        submitLabel="Create profile"
        onSubmit={onSubmit}
        onSaved={onSaved}
        photoWrite="after-save"
      />,
    );

    await user.type(screen.getByLabelText(/nickname/i), 'Robin');
    await user.click(screen.getByRole('button', { name: /create profile/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(applyChildPhotoSelection).not.toHaveBeenCalled();
  });

  it('says the profile was saved when only the photo failed, and retries without a duplicate', async () => {
    applyChildPhotoSelection.mockRejectedValueOnce(
      new Error('We could not save that photo. Please try again.'),
    );
    const onSubmit = vi.fn().mockResolvedValue(SAVED_CHILD);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(
      <ChildProfileForm
        submitLabel="Create profile"
        onSubmit={onSubmit}
        onSaved={onSaved}
        photoWrite="after-save"
      />,
    );

    await fillAndPickPhoto(user);
    await user.click(screen.getByRole('button', { name: /create profile/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The profile was saved, but the photo was not. We could not save that photo. Please try again.',
    );
    expect(onSaved).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /create profile/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(updateChildProfile).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ nickname: 'Robin' }),
    );
    expect(applyChildPhotoSelection).toHaveBeenCalledTimes(2);
  });

  it('uploads nothing when the profile save fails', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Could not create the child profile.'));
    const user = userEvent.setup();
    render(
      <ChildProfileForm submitLabel="Create profile" onSubmit={onSubmit} photoWrite="after-save" />,
    );

    await fillAndPickPhoto(user);
    await user.click(screen.getByRole('button', { name: /create profile/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not create/i);
    expect(applyChildPhotoSelection).not.toHaveBeenCalled();
  });
});
