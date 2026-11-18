import {
  PreviewError,
  fetchPreviewModel,
  isPreviewFormat,
  parsePreviewModel,
  toPreviewError,
} from './previewModelSource';
import {
  createModelPreviewViewer,
  type ModelPreviewViewer,
  type PreviewRenderer,
  type ViewerDependencies,
} from './modelPreviewViewer';
import { createKtx2Loader } from '../../island-map/three/assets/gltfDecoders';
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

/**
 * Wires the Django Admin preview page (`admin/assets/assetversion/preview.html`)
 * to the viewer: reads the page's `data-` attributes, loads the model, drives
 * the toolbar and the status line, and cleans up when the page goes away.
 */

export type PreviewState = 'loading' | 'ready' | 'error';

export interface MountDependencies {
  fetchImpl?: typeof fetch;
  viewer?: ViewerDependencies;
  createViewer?: (host: HTMLElement, dependencies?: ViewerDependencies) => ModelPreviewViewer;
  /** Builds the KTX2 loader for the viewer's renderer (null: no KTX2 support). */
  createKtx2?: (renderer: PreviewRenderer | undefined) => KTX2Loader | null;
}

/** A KTX2 loader matched to a real WebGL renderer, or null (no renderer, or a test double). */
export function defaultKtx2(renderer: PreviewRenderer | undefined): KTX2Loader | null {
  if (!renderer || !('extensions' in renderer)) return null;
  try {
    return createKtx2Loader(renderer as unknown as Parameters<typeof createKtx2Loader>[0]);
  } catch {
    return null;
  }
}

export interface MountedPreview {
  /** Settles when loading finished, successfully or not. */
  readonly loaded: Promise<PreviewState>;
  dispose(): void;
}

const ZOOM_STEP = 0.8;

export function mountAssetPreview(
  root: HTMLElement,
  dependencies: MountDependencies = {},
): MountedPreview {
  const status = root.querySelector<HTMLElement>('[data-preview-status]');
  const stage = root.querySelector<HTMLElement>('[data-preview-stage]');
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-preview-action]'));
  const abort = new AbortController();
  let viewer: ModelPreviewViewer | null = null;
  let disposed = false;

  function show(state: PreviewState, message: string): PreviewState {
    root.dataset.state = state;
    if (status) {
      status.dataset.state = state;
      status.setAttribute('role', state === 'error' ? 'alert' : 'status');
      status.textContent = message;
    }
    for (const button of buttons) button.disabled = state !== 'ready';
    return state;
  }

  function onAction(event: Event): void {
    const action = (event.currentTarget as HTMLElement).dataset.previewAction;
    if (!viewer) return;
    if (action === 'reset') viewer.resetCamera();
    else if (action === 'fit') viewer.fitModel();
    else if (action === 'zoom-in') viewer.zoom(ZOOM_STEP);
    else if (action === 'zoom-out') viewer.zoom(1 / ZOOM_STEP);
  }

  for (const button of buttons) button.addEventListener('click', onAction);

  async function load(): Promise<PreviewState> {
    show('loading', 'Loading the model...');
    const { modelUrl, format, maxBytes, tokenHeader, token } = root.dataset;
    const limit = Number(maxBytes);
    if (!stage || !modelUrl || !tokenHeader || !token || !(limit > 0)) {
      return show('error', new PreviewError('missing').message);
    }
    if (!isPreviewFormat(format)) {
      return show('error', new PreviewError('unsupported_format').message);
    }
    try {
      const data = await fetchPreviewModel({
        url: modelUrl,
        tokenHeader,
        token,
        maxBytes: limit,
        fetchImpl: dependencies.fetchImpl,
        signal: abort.signal,
      });
      if (disposed) return 'loading';
      // The viewer (and so its renderer) comes first: a KTX2 texture is
      // transcoded for the GPU that will draw it (ADR-070).
      const create = dependencies.createViewer ?? createModelPreviewViewer;
      viewer = create(stage, dependencies.viewer);
      const ktx2 = (dependencies.createKtx2 ?? defaultKtx2)(viewer.renderer);
      let parsed;
      try {
        parsed = await parsePreviewModel(data, format, ktx2 ? { ktx2 } : {});
      } finally {
        ktx2?.dispose(); // textures are decoded by now; only the workers go
      }
      if (disposed) return 'loading';
      const { scene, clipNames } = parsed;
      viewer.showModel(scene);
      const clips = clipNames.length
        ? ` It has ${clipNames.length} animation clip(s); the preview shows its rest pose.`
        : '';
      return show('ready', `Model loaded.${clips}`);
    } catch (error) {
      if (disposed) return 'loading';
      viewer?.dispose();
      viewer = null;
      return show('error', toPreviewError(error, 'invalid_model').message);
    }
  }

  const loaded = load();

  return {
    loaded,
    dispose() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      for (const button of buttons) button.removeEventListener('click', onAction);
      viewer?.dispose();
      viewer = null;
    },
  };
}
