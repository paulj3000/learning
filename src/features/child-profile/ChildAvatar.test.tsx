import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { getChildPhotoUrl } = vi.hoisted(() => ({ getChildPhotoUrl: vi.fn() }));

vi.mock('./avatarPhoto', () => ({ getChildPhotoUrl }));

import { ChildAvatar } from './ChildAvatar';

describe('ChildAvatar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the authored avatar character when there is no photo', () => {
    render(<ChildAvatar avatarKey="FOX" photoKey={null} label="Robin" />);

    expect(screen.getByRole('img', { name: 'Robin' })).toHaveTextContent('\u{1F98A}');
    expect(getChildPhotoUrl).not.toHaveBeenCalled();
  });

  it('shows the uploaded photo once its signed URL resolves', async () => {
    getChildPhotoUrl.mockResolvedValue('https://example.invalid/photo.jpg?signature=abc');

    render(
      <ChildAvatar avatarKey="FOX" photoKey="child-photos/identity-1/photo.jpg" label="Robin" />,
    );

    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Robin' })).toHaveAttribute(
        'src',
        'https://example.invalid/photo.jpg?signature=abc',
      ),
    );
    expect(getChildPhotoUrl).toHaveBeenCalledWith('child-photos/identity-1/photo.jpg');
  });

  it('falls back to the avatar character when the photo URL cannot be resolved', async () => {
    getChildPhotoUrl.mockResolvedValue(null);

    render(
      <ChildAvatar avatarKey="OWL" photoKey="child-photos/identity-1/photo.jpg" label="Robin" />,
    );

    await waitFor(() => expect(getChildPhotoUrl).toHaveBeenCalled());
    expect(screen.getByRole('img', { name: 'Robin' })).toHaveTextContent('\u{1F989}');
  });

  it('renders decoratively, with no accessible name, when no label is given', () => {
    render(<ChildAvatar avatarKey="FOX" photoKey={null} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('re-mints an expired URL once when the image fails to load', async () => {
    getChildPhotoUrl
      .mockResolvedValueOnce('https://example.invalid/photo.jpg?signature=expired')
      .mockResolvedValueOnce('https://example.invalid/photo.jpg?signature=fresh');

    render(
      <ChildAvatar avatarKey="FOX" photoKey="child-photos/identity-1/photo.jpg" label="Robin" />,
    );

    // Wait for the real <img> - until the URL resolves, the accessible
    // "img" on screen is still the fallback character's span.
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Robin' })).toHaveAttribute(
        'src',
        'https://example.invalid/photo.jpg?signature=expired',
      ),
    );
    fireEvent.error(screen.getByRole('img', { name: 'Robin' }));

    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Robin' })).toHaveAttribute(
        'src',
        'https://example.invalid/photo.jpg?signature=fresh',
      ),
    );
    expect(getChildPhotoUrl).toHaveBeenCalledTimes(2);
  });

  it('falls back to the avatar character when the re-minted URL also fails', async () => {
    getChildPhotoUrl.mockResolvedValue('https://example.invalid/photo.jpg?signature=abc');

    render(
      <ChildAvatar avatarKey="FOX" photoKey="child-photos/identity-1/photo.jpg" label="Robin" />,
    );

    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Robin' })).toHaveAttribute(
        'src',
        'https://example.invalid/photo.jpg?signature=abc',
      ),
    );
    fireEvent.error(screen.getByRole('img', { name: 'Robin' }));

    // The re-mint returns the same URL, so there is nothing new to try.
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Robin' })).toHaveTextContent('\u{1F98A}'),
    );
    expect(getChildPhotoUrl).toHaveBeenCalledTimes(2);
  });

  it('prefers a local preview over fetching a stored photo', () => {
    render(
      <ChildAvatar
        avatarKey="FOX"
        photoKey="child-photos/identity-1/photo.jpg"
        previewUrl="blob:preview"
        label="Robin"
      />,
    );

    expect(screen.getByRole('img', { name: 'Robin' })).toHaveAttribute('src', 'blob:preview');
    expect(getChildPhotoUrl).not.toHaveBeenCalled();
  });
});
