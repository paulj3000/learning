import {
  PreviewError,
  fetchPreviewModel,
  isPreviewFormat,
  parsePreviewModel,
  toPreviewError,
} from '../preview/previewModelSource';
import {
  CaptureError,
  assertSameOriginUrl,
  clampOutputSize,
  type EncodedCapture,
} from './captureOutput';
import {
  createThumbnailCapture,
  type CaptureDependencies,
  type ThumbnailCapture,
} from './thumbnailCapture';
import { uploadCapture } from './uploadCapture';

/**
 * Wires the Django Admin capture page (`admin/assets/assetversion/capture.html`) to the capture
 * component (ADR-069). The model comes only from the page's own staff-only preview route; the
 * result is sent only to the page's own capture endpoint.
 */

export type CaptureState = 'loading' | 'ready' | 'error';

export interface CaptureMountDependencies {
  fetchImpl?: typeof fetch;
  capture?: CaptureDependencies;
  createCapture?: (host: HTMLElement, dependencies?: CaptureDependencies) => ThumbnailCapture;
  origin?: string;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
}

export interface MountedCapture {
  readonly loaded: Promise<CaptureState>;
  dispose(): void;
}

const ZOOM_STEP = 0.8;

export function mountAssetCapture(
  root: HTMLElement,
  dependencies: CaptureMountDependencies = {},
): MountedCapture {
  const status = root.querySelector<HTMLElement>('[data-capture-status]');
  const stage = root.querySelector<HTMLElement>('[data-capture-stage]');
  const resultImage = root.querySelector<HTMLImageElement>('[data-capture-result]');
  const sizeSelect = root.querySelector<HTMLSelectElement>('[data-capture-size]');
  const transparentBox = root.querySelector<HTMLInputElement>('[data-capture-transparent]');
  const csrf = root.querySelector<HTMLInputElement>('input[name="csrfmiddlewaretoken"]');
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-capture-action]'));
  const abort = new AbortController();
  const origin = dependencies.origin ?? window.location.origin;
  const makeUrl = dependencies.createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const dropUrl = dependencies.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));
  let capture: ThumbnailCapture | null = null;
  let pending: EncodedCapture | null = null;
  let objectUrl: string | null = null;
  let busy = false;
  let disposed = false;

  function show(state: CaptureState, message: string, alert = state === 'error'): CaptureState {
    root.dataset.state = state;
    if (status) {
      status.dataset.state = state;
      status.setAttribute('role', alert ? 'alert' : 'status');
      status.textContent = message;
    }
    sync(state === 'ready');
    return state;
  }

  function sync(ready: boolean): void {
    for (const button of buttons) {
      const action = button.dataset.captureAction;
      button.disabled =
        busy || !ready || (action === 'save' || action === 'discard' ? pending === null : false);
    }
  }

  function clearPending(): void {
    pending = null;
    if (objectUrl) dropUrl(objectUrl);
    objectUrl = null;
    if (resultImage) {
      resultImage.removeAttribute('src');
      resultImage.hidden = true;
    }
  }

  async function onAction(event: Event): Promise<void> {
    const action = (event.currentTarget as HTMLElement).dataset.captureAction;
    if (!capture || busy) return;
    if (action === 'reset') capture.resetView();
    else if (action === 'zoom-in') capture.zoom(ZOOM_STEP);
    else if (action === 'zoom-out') capture.zoom(1 / ZOOM_STEP);
    else if (action === 'discard') {
      clearPending();
      show('ready', 'Capture discarded.', false);
    } else if (action === 'capture') {
      busy = true;
      sync(true);
      try {
        clearPending();
        pending = await capture.capture(clampOutputSize(sizeSelect?.value));
        objectUrl = makeUrl(pending.blob);
        if (resultImage) {
          resultImage.src = objectUrl;
          resultImage.hidden = false;
        }
        const kb = Math.max(1, Math.round(pending.blob.size / 1024));
        busy = false;
        show(
          'ready',
          `Captured as ${pending.type === 'image/png' ? 'PNG' : 'WebP'}, ${kb} KiB. Save it for review, or capture again.`,
          false,
        );
      } catch (error) {
        busy = false;
        clearPending();
        show(
          'ready',
          error instanceof CaptureError ? error.message : 'The capture failed. Try again.',
          true,
        );
      }
    } else if (action === 'save') {
      if (!pending) return;
      const { captureUrl, versionId, sourceSha256 } = root.dataset;
      if (!captureUrl || !versionId || !sourceSha256 || !csrf?.value) {
        show('ready', 'This page is missing capture details. Reload it.', true);
        return;
      }
      busy = true;
      sync(true);
      try {
        const target = assertSameOriginUrl(captureUrl, origin);
        const result = await uploadCapture({
          url: target.toString(),
          csrfToken: csrf.value,
          versionId,
          sourceSha256,
          blob: pending.blob,
          type: pending.type,
          fetchImpl: dependencies.fetchImpl,
        });
        busy = false;
        if (result.ok) {
          clearPending();
          show('ready', `${result.message} Reload the version page to review it.`, false);
        } else {
          show('ready', result.message, true);
        }
      } catch (error) {
        busy = false;
        show(
          'ready',
          error instanceof CaptureError ? error.message : 'The capture could not be saved.',
          true,
        );
      }
    }
  }

  const handlers = buttons.map((button) => {
    const handler = (event: Event) => void onAction(event);
    button.addEventListener('click', handler);
    return { button, handler };
  });
  const onTransparent = () => capture?.setTransparent(Boolean(transparentBox?.checked));
  transparentBox?.addEventListener('change', onTransparent);

  async function load(): Promise<CaptureState> {
    show('loading', 'Loading the model...');
    const { modelUrl, format, maxBytes, tokenHeader, token } = root.dataset;
    const limit = Number(maxBytes);
    if (!stage || !modelUrl || !tokenHeader || !token || !(limit > 0)) {
      return show('error', new PreviewError('missing').message);
    }
    if (format !== 'glb' || !isPreviewFormat(format)) {
      return show('error', 'Only GLB models can be captured.');
    }
    try {
      const target = assertSameOriginUrl(modelUrl, origin); // refuse any other host
      const data = await fetchPreviewModel({
        url: target.toString(),
        tokenHeader,
        token,
        maxBytes: limit,
        fetchImpl: dependencies.fetchImpl,
        signal: abort.signal,
      });
      if (disposed) return 'loading';
      const { scene } = await parsePreviewModel(data, 'glb'); // embedded GLB only, no fetches
      if (disposed) return 'loading';
      capture = (dependencies.createCapture ?? createThumbnailCapture)(stage, dependencies.capture);
      capture.showModel(scene);
      return show('ready', 'Model loaded. Orbit and zoom, then capture.', false);
    } catch (error) {
      if (disposed) return 'loading';
      capture?.dispose();
      capture = null;
      const message =
        error instanceof CaptureError
          ? error.message
          : toPreviewError(error, 'invalid_model').message;
      return show('error', message);
    }
  }

  const loaded = load();

  return {
    loaded,
    dispose() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      for (const { button, handler } of handlers) button.removeEventListener('click', handler);
      transparentBox?.removeEventListener('change', onTransparent);
      clearPending();
      capture?.dispose();
      capture = null;
    },
  };
}
