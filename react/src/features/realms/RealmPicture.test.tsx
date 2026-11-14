import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ImageResolverProvider, imageResolverFor } from './imageResolver';
import { RealmPicture } from './RealmPicture';

const resolverMock = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('../../api/assets/djangoAssetResolver', () => ({
  djangoAssetResolverFor: () => resolverMock,
}));

function renderPicture(assetId: string | null, resolve = vi.fn().mockResolvedValue(null)) {
  render(
    <ImageResolverProvider value={resolve}>
      <RealmPicture assetId={assetId} scene="treasure" label="Treasure Cove" />
    </ImageResolverProvider>,
  );
  return resolve;
}

describe('RealmPicture (AP-03)', () => {
  it('draws the scene, with its name, when there is no published picture', () => {
    const resolve = renderPicture(null);
    expect(screen.getByRole('img', { name: 'Treasure Cove' }).tagName.toLowerCase()).toBe('svg');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('shows a published picture lazily, over the drawing', async () => {
    renderPicture('cove-art', vi.fn().mockResolvedValue('https://cdn.example/cove.png'));
    const image = await waitFor(() => {
      const found = screen.getByRole('img', { name: 'Treasure Cove' });
      expect(found.tagName.toLowerCase()).toBe('img');
      return found;
    });
    expect(image).toHaveAttribute('src', 'https://cdn.example/cove.png');
    expect(image).toHaveAttribute('loading', 'lazy');
    // The drawing underneath is now decorative, so the name is read once.
    expect(screen.getAllByRole('img', { name: 'Treasure Cove' })).toHaveLength(1);
  });

  it('falls back to the drawing when the picture fails to load (no broken image)', async () => {
    renderPicture('cove-art', vi.fn().mockResolvedValue('https://cdn.example/gone.png'));
    const image = await waitFor(() => {
      const found = document.querySelector('img');
      expect(found).not.toBeNull();
      return found as HTMLImageElement;
    });
    fireEvent.error(image);
    await waitFor(() => expect(document.querySelector('img')).toBeNull());
    expect(screen.getByRole('img', { name: 'Treasure Cove' }).tagName.toLowerCase()).toBe('svg');
  });

  it('keeps the drawing when the picture cannot be resolved', async () => {
    const resolve = renderPicture('cove-art', vi.fn().mockResolvedValue(null));
    await waitFor(() => expect(resolve).toHaveBeenCalledWith('cove-art'));
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: 'Treasure Cove' })).toBeInTheDocument();
  });
});

describe('imageResolverFor', () => {
  const config = { enabled: true as const, baseUrl: '' };

  it('answers only published images from the asset library', async () => {
    resolverMock.resolve.mockResolvedValueOnce({
      id: 'a',
      url: '/api/v1/asset-files/t/image.png',
      source: 'PUBLISHED',
      family: 'image',
    });
    expect(await imageResolverFor('child-1', config)('a')).toBe('/api/v1/asset-files/t/image.png');
    expect(resolverMock.resolve).toHaveBeenLastCalledWith('a', 'image');

    resolverMock.resolve.mockResolvedValueOnce({ id: 'b', url: '/b.png', source: 'BUNDLED' });
    expect(await imageResolverFor('child-1', config)('b')).toBeNull();

    resolverMock.resolve.mockRejectedValueOnce(new Error('unknown asset'));
    expect(await imageResolverFor('child-1', config)('c')).toBeNull();
  });
});
