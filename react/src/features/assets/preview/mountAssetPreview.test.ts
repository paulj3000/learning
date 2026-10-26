import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mountAssetPreview } from './mountAssetPreview';
import { PreviewError } from './previewModelSource';
import type { ModelPreviewViewer } from './modelPreviewViewer';
import { fakeResponse, glbFile, gltfFile } from './previewFixtures';

/** The markup `admin/assets/assetversion/preview.html` renders. */
function page(overrides: Record<string, string | null> = {}): HTMLElement {
  const attributes: Record<string, string | null> = {
    'data-model-url': '/admin/assets/assetversion/7/preview/model/',
    'data-format': 'glb',
    'data-max-bytes': '52428800',
    'data-token-header': 'X-Asset-Preview-Token',
    'data-token': 'signed-token',
    ...overrides,
  };
  const root = document.createElement('div');
  root.setAttribute('data-asset-preview', '');
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== null) root.setAttribute(name, value);
  }
  root.innerHTML = `
    <button type="button" data-preview-action="reset" disabled>Reset camera</button>
    <button type="button" data-preview-action="fit" disabled>Fit model</button>
    <button type="button" data-preview-action="zoom-in" disabled>+</button>
    <button type="button" data-preview-action="zoom-out" disabled>-</button>
    <div data-preview-stage></div>
    <p data-preview-status role="status">Loading the model...</p>`;
  document.body.appendChild(root);
  return root;
}

type FakeViewer = { [K in keyof ModelPreviewViewer]: Mock<ModelPreviewViewer[K]> };

function fakeViewer(): FakeViewer {
  return {
    showModel: vi.fn(),
    resetCamera: vi.fn(),
    fitModel: vi.fn(),
    zoom: vi.fn(),
    dispose: vi.fn(),
  };
}

const status = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-preview-status]')!;
const buttons = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLButtonElement>('[data-preview-action]'));
const button = (root: HTMLElement, action: string) =>
  root.querySelector<HTMLButtonElement>(`[data-preview-action="${action}"]`)!;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('mountAssetPreview', () => {
  it('shows loading with the controls disabled, then the model with the controls enabled', async () => {
    const root = page();
    const viewer = fakeViewer();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetchImpl = vi.fn(async () => {
      await gate;
      return fakeResponse(200, glbFile());
    });
    const createViewer = vi.fn(() => viewer);
    const mounted = mountAssetPreview(root, { fetchImpl, createViewer });
    expect(root.dataset.state).toBe('loading');
    expect(status(root).textContent).toBe('Loading the model...');
    expect(buttons(root).every((b) => b.disabled)).toBe(true);
    release();
    expect(await mounted.loaded).toBe('ready');
    expect(createViewer).toHaveBeenCalledWith(root.querySelector('[data-preview-stage]'), undefined);
    expect(viewer.showModel).toHaveBeenCalledTimes(1);
    expect(status(root).getAttribute('role')).toBe('status');
    expect(status(root).textContent).toBe('Model loaded.');
    expect(buttons(root).every((b) => !b.disabled)).toBe(true);
  });

  it('drives the camera from the toolbar', async () => {
    const root = page();
    const viewer = fakeViewer();
    const mounted = mountAssetPreview(root, {
      fetchImpl: async () => fakeResponse(200, glbFile()),
      createViewer: () => viewer,
    });
    await mounted.loaded;
    button(root, 'reset').click();
    button(root, 'fit').click();
    button(root, 'zoom-in').click();
    button(root, 'zoom-out').click();
    expect(viewer.resetCamera).toHaveBeenCalledTimes(1);
    expect(viewer.fitModel).toHaveBeenCalledTimes(1);
    expect(viewer.zoom).toHaveBeenNthCalledWith(1, 0.8);
    expect(viewer.zoom).toHaveBeenNthCalledWith(2, 1.25);
  });

  it('says how many clips a model has without playing them', async () => {
    const root = page({ 'data-format': 'gltf' });
    const mounted = mountAssetPreview(root, {
      fetchImpl: async () => fakeResponse(200, gltfFile({ clips: ['Idle', 'Talk'] })),
      createViewer: fakeViewer,
    });
    expect(await mounted.loaded).toBe('ready');
    expect(status(root).textContent).toContain('2 animation clip(s)');
  });

  it.each([
    [410, { error: { code: 'preview_expired' } }, 'expired'],
    [403, { error: { code: 'forbidden' } }, 'forbidden'],
    [404, { error: { code: 'not_found' } }, 'missing'],
    [503, { error: { code: 'content_unavailable' } }, 'storage'],
  ] as const)('shows HTTP %i as an alert and keeps the controls off', async (code, body, kind) => {
    const root = page();
    const createViewer = vi.fn(fakeViewer);
    const mounted = mountAssetPreview(root, {
      fetchImpl: async () => fakeResponse(code, body),
      createViewer,
    });
    expect(await mounted.loaded).toBe('error');
    expect(status(root).getAttribute('role')).toBe('alert');
    expect(status(root).textContent).toBe(new PreviewError(kind).message);
    expect(buttons(root).every((b) => b.disabled)).toBe(true);
    expect(createViewer).not.toHaveBeenCalled();
  });

  it('shows a model that fails to parse as invalid, without a stack trace', async () => {
    const root = page();
    const mounted = mountAssetPreview(root, {
      fetchImpl: async () => fakeResponse(200, gltfFile()), // JSON, but the page says glb
      createViewer: fakeViewer,
    });
    expect(await mounted.loaded).toBe('error');
    expect(status(root).textContent).toBe(new PreviewError('invalid_model').message);
    expect(status(root).textContent).not.toMatch(/at |Error:/);
  });

  it('reports WebGL being unavailable', async () => {
    const root = page();
    const mounted = mountAssetPreview(root, {
      fetchImpl: async () => fakeResponse(200, glbFile()),
      createViewer: () => {
        throw new PreviewError('webgl_unavailable');
      },
    });
    expect(await mounted.loaded).toBe('error');
    expect(status(root).textContent).toContain('WebGL');
  });

  it('disposes the viewer when the model has nothing to show', async () => {
    const root = page();
    const viewer = fakeViewer();
    viewer.showModel.mockImplementation(() => {
      throw new PreviewError('empty_model');
    });
    const mounted = mountAssetPreview(root, {
      fetchImpl: async () => fakeResponse(200, glbFile()),
      createViewer: () => viewer,
    });
    expect(await mounted.loaded).toBe('error');
    expect(viewer.dispose).toHaveBeenCalledTimes(1);
    expect(status(root).textContent).toBe(new PreviewError('empty_model').message);
  });

  it('refuses an unsupported format or a page without its data, without fetching', async () => {
    const broken: Array<Record<string, string | null>> = [
      { 'data-format': 'fbx' },
      { 'data-token': null },
    ];
    for (const overrides of broken) {
      const root = page(overrides);
      const fetchImpl = vi.fn();
      const mounted = mountAssetPreview(root, { fetchImpl, createViewer: fakeViewer });
      expect(await mounted.loaded).toBe('error');
      expect(fetchImpl).not.toHaveBeenCalled();
      root.remove();
    }
  });

  it('aborts the download and disposes the viewer when the page goes away', async () => {
    const root = page();
    const viewer = fakeViewer();
    let signal: AbortSignal | undefined;
    const mounted = mountAssetPreview(root, {
      fetchImpl: async (_url, init) => {
        signal = init?.signal ?? undefined;
        return fakeResponse(200, glbFile());
      },
      createViewer: () => viewer,
    });
    await mounted.loaded;
    mounted.dispose();
    mounted.dispose();
    expect(signal?.aborted).toBe(true);
    expect(viewer.dispose).toHaveBeenCalledTimes(1);
    button(root, 'reset').click();
    expect(viewer.resetCamera).not.toHaveBeenCalled();
  });

  it('never builds a viewer when disposed while the model is still downloading', async () => {
    const root = page();
    const createViewer = vi.fn(fakeViewer);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const mounted = mountAssetPreview(root, {
      fetchImpl: async () => {
        await gate;
        return fakeResponse(200, glbFile());
      },
      createViewer,
    });
    mounted.dispose();
    release();
    await mounted.loaded;
    expect(createViewer).not.toHaveBeenCalled();
  });
});
