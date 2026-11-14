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
  type ViewerDependencies,
} from './modelPreviewViewer';

import { ASSET_MANIFEST } from '../../island-map/three/assets/manifest';
import { parseCollisionProfile } from '../../island-map/three/runtime/collisionProfile';
import {
  JUMPABLE_MAX_HEIGHT,
  footprintBox,
  footprintFor,
} from '../../island-map/three/runtime/derivedColliders';
import type { PreviewCollisionBox } from './modelPreviewViewer';

/** What the game will collide with for this asset: its profile, else the built-in default. */
export interface PreviewCollision {
  boxes: readonly PreviewCollisionBox[];
  kind: 'solid' | 'jumpable';
  /** Plain-language line for the staff status text. */
  summary: string;
}

const KINDS = new Map(ASSET_MANIFEST.map((entry) => [entry.id, entry.kind] as const));

export function previewCollision(rawJson: string | undefined, assetId: string | undefined): PreviewCollision {
  let raw: unknown = null;
  try {
    raw = rawJson ? JSON.parse(rawJson) : null;
  } catch {
    raw = null;
  }
  const profile = parseCollisionProfile(raw);
  if (profile) {
    const word = profile.behavior.toLowerCase();
    if (!profile.boxes.length) {
      return { boxes: [], kind: 'solid', summary: `Collision profile: ${word}, never blocks.` };
    }
    return {
      boxes: profile.boxes,
      kind: profile.behavior === 'JUMPABLE' ? 'jumpable' : 'solid',
      summary: `Collision profile: ${word}, ${profile.shape.toLowerCase()} as ${profile.boxes.length} box(es).`,
    };
  }
  const footprint = assetId ? footprintFor(assetId, KINDS) : undefined;
  if (!footprint) {
    return { boxes: [], kind: 'solid', summary: 'No collision profile and no built-in default: never blocks.' };
  }
  const box = footprintBox(footprint);
  return {
    boxes: [box],
    kind: box.maxY - box.minY <= JUMPABLE_MAX_HEIGHT ? 'jumpable' : 'solid',
    summary: 'No collision profile: the built-in default box is shown.',
  };
}

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
  const collisionStatus = root.querySelector<HTMLElement>('[data-preview-collision-status]');
  const collision = previewCollision(root.dataset.collision, root.dataset.assetId);
  let collisionShown = false;
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
    else if (action === 'collision') {
      collisionShown = !collisionShown;
      viewer.showCollision(collisionShown);
      const button = event.currentTarget as HTMLElement;
      button.setAttribute('aria-pressed', String(collisionShown));
      button.textContent = collisionShown ? 'Hide collision' : 'Show collision';
    }
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
      const { scene, clipNames } = await parsePreviewModel(data, format);
      if (disposed) return 'loading';
      const create = dependencies.createViewer ?? createModelPreviewViewer;
      viewer = create(stage, dependencies.viewer);
      viewer.showModel(scene);
      viewer.setCollision(collision.boxes, collision.kind);
      if (collisionStatus) {
        const lead = collisionStatus.firstChild;
        if (lead?.nodeType === Node.TEXT_NODE) lead.textContent = `${collision.summary} `;
        else collisionStatus.prepend(`${collision.summary} `);
      }
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
