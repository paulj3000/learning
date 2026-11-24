import {
  Box3,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { disposeObject } from '../preview/modelPreviewViewer';
import { PreviewError } from '../preview/previewModelSource';
import {
  type CaptureType,
  type EncodedCapture,
  canvasToBlob,
  clampOutputSize,
  encodeCapture,
  type ToBlob,
} from './captureOutput';
import { BACKGROUND, FOV_DEGREES, clipPlanes, frame } from './thumbnailFraming';

/**
 * The isolated Three.js component behind the staff thumbnail capture (ADR-069). It shows one
 * model with the spec version 1 rig (hemisphere and sun light, sRGB, no tone mapping, no grid or
 * helpers), lets staff orbit and zoom, frames the model by the spec, and encodes the current view
 * as WebP or PNG. Admin tooling: it knows nothing about the game, makes no request, and frees
 * every GPU resource on `dispose`.
 */

export interface CaptureRenderer {
  readonly domElement: HTMLCanvasElement;
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setClearColor(color: Color, alpha?: number): void;
  render(scene: Scene, camera: PerspectiveCamera): void;
  dispose(): void;
  forceContextLoss?(): void;
}

export interface CaptureControls {
  target: Vector3;
  enableDamping: boolean;
  minDistance: number;
  maxDistance: number;
  update(): boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
  dispose(): void;
}

export interface CaptureDependencies {
  createRenderer?: () => CaptureRenderer;
  createControls?: (camera: PerspectiveCamera, element: HTMLElement) => CaptureControls;
  /** Replaces the canvas encoder (tests). */
  toBlob?: (canvas: HTMLCanvasElement) => ToBlob;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
}

export interface ThumbnailCapture {
  showModel(model: Object3D): void;
  resetView(): void;
  setTransparent(transparent: boolean): void;
  zoom(factor: number): void;
  /** Renders the current view at `size` pixels square and encodes it. */
  capture(size: number): Promise<EncodedCapture>;
  readonly hasModel: boolean;
  dispose(): void;
}

function defaultRenderer(): CaptureRenderer {
  try {
    // preserveDrawingBuffer: the canvas must still hold the image when `toBlob` reads it.
    return new WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });
  } catch {
    throw new PreviewError('webgl_unavailable');
  }
}

export function createThumbnailCapture(
  host: HTMLElement,
  dependencies: CaptureDependencies = {},
): ThumbnailCapture {
  const requestFrame = dependencies.requestFrame ?? ((cb) => window.requestAnimationFrame(cb));
  const cancelFrame = dependencies.cancelFrame ?? ((h) => window.cancelAnimationFrame(h));
  const renderer = (dependencies.createRenderer ?? defaultRenderer)();
  renderer.setPixelRatio(1);
  let transparent = false;
  const applyBackground = () => renderer.setClearColor(new Color(BACKGROUND), transparent ? 0 : 1);
  applyBackground();
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV_DEGREES, 1, 0.01, 1000);
  const sky = new HemisphereLight(0xffffff, 0x6b7280, 1.6);
  const sun = new DirectionalLight(0xffffff, 1.8);
  sun.position.set(3, 5, 4);
  scene.add(sky, sun);

  const controls = (
    dependencies.createControls ?? ((cam, el) => new OrbitControls(cam, el) as CaptureControls)
  )(camera, renderer.domElement);
  controls.enableDamping = false; // render on demand

  const holder = new Group();
  scene.add(holder);
  let model: Object3D | null = null;
  let sphereCentre = new Vector3();
  let sphereRadius = 1;
  let pending: number | null = null;
  let disposed = false;

  function viewSize(): number {
    return Math.max(Math.round(Math.min(host.clientWidth, host.clientHeight)) || 512, 1);
  }

  /** Spec near and far for the camera's current distance, so orbiting and zooming never clip. */
  function updateClip(): void {
    const distance = camera.position.distanceTo(sphereCentre);
    const planes = clipPlanes(Math.max(distance, 1e-6), sphereRadius);
    camera.near = planes.near;
    camera.far = planes.far;
    camera.updateProjectionMatrix();
  }

  function draw(): void {
    pending = null;
    if (disposed) return;
    updateClip();
    renderer.render(scene, camera);
  }

  function schedule(): void {
    if (pending === null && !disposed) pending = requestFrame(draw);
  }

  function resize(): void {
    const size = viewSize();
    renderer.setSize(size, size, false);
    camera.aspect = 1; // always square: what staff see is what is captured
  }

  function clearModel(): void {
    if (model) {
      holder.remove(model);
      disposeObject(model);
      model = null;
    }
  }

  controls.addEventListener('change', schedule);
  resize();

  const api: ThumbnailCapture = {
    get hasModel() {
      return model !== null;
    },
    showModel(next) {
      if (disposed) return;
      clearModel();
      holder.add(next);
      holder.updateMatrixWorld(true);
      const box = new Box3().setFromObject(next, true);
      const size = box.getSize(new Vector3());
      if (box.isEmpty() || !Number.isFinite(size.length()) || size.length() === 0) {
        holder.remove(next);
        disposeObject(next);
        throw new PreviewError('empty_model');
      }
      model = next;
      api.resetView();
    },
    resetView() {
      if (!model || disposed) return;
      const box = new Box3().setFromObject(model, true);
      const spec = frame([box.min.x, box.min.y, box.min.z], [box.max.x, box.max.y, box.max.z]);
      sphereCentre = new Vector3(...spec.target);
      sphereRadius = spec.radius;
      camera.position.set(...spec.position);
      controls.target.copy(sphereCentre);
      controls.minDistance = spec.radius * 0.05;
      controls.maxDistance = spec.distance * 20;
      camera.aspect = 1;
      controls.update();
      updateClip();
      schedule();
    },
    setTransparent(value) {
      transparent = value;
      applyBackground();
      schedule();
    },
    zoom(factor) {
      if (!model || disposed || !(factor > 0)) return;
      const offset = camera.position.clone().sub(controls.target);
      const distance = Math.min(
        Math.max(offset.length() * factor, controls.minDistance),
        controls.maxDistance,
      );
      camera.position.copy(controls.target).addScaledVector(offset.normalize(), distance);
      controls.update();
      schedule();
    },
    async capture(requested) {
      if (!model || disposed) {
        throw new PreviewError('empty_model');
      }
      const size = clampOutputSize(requested);
      const viewport = viewSize();
      renderer.setSize(size, size, false);
      camera.aspect = 1;
      updateClip();
      renderer.render(scene, camera);
      const toBlob = (dependencies.toBlob ?? canvasToBlob)(renderer.domElement);
      try {
        return await encodeCapture(toBlob, { transparent });
      } finally {
        if (!disposed) {
          renderer.setSize(viewport, viewport, false);
          schedule();
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (pending !== null) cancelFrame(pending);
      pending = null;
      controls.removeEventListener('change', schedule);
      controls.dispose();
      clearModel();
      renderer.dispose();
      renderer.forceContextLoss?.();
      renderer.domElement.remove();
    },
  };
  return api;
}

export type { CaptureType };
