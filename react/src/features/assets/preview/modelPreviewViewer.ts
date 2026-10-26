import {
  AxesHelper,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Sphere,
  Texture,
  Vector3,
  WebGLRenderer,
  type Material,
  type Mesh,
  type Object3D,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PreviewError } from './previewModelSource';

/**
 * The Three.js viewer behind the Django Admin model preview (LAI-2200 AM-10).
 * Admin tooling, not gameplay: it lives outside the engine folder and knows
 * nothing about the island. It shows one model, centred on a ground grid,
 * with orbit, pan and zoom, and renders only when something changed.
 */

/** The parts of `WebGLRenderer` the viewer uses, so tests can supply one without WebGL. */
export interface PreviewRenderer {
  readonly domElement: HTMLCanvasElement;
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setClearColor(color: Color): void;
  render(scene: Scene, camera: PerspectiveCamera): void;
  dispose(): void;
}

/** The parts of `OrbitControls` the viewer uses. */
export interface PreviewControls {
  target: Vector3;
  enableDamping: boolean;
  enablePan: boolean;
  enableZoom: boolean;
  enableRotate: boolean;
  screenSpacePanning: boolean;
  minDistance: number;
  maxDistance: number;
  update(): boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
  dispose(): void;
}

export interface ViewerDependencies {
  createRenderer?: (canvas?: HTMLCanvasElement) => PreviewRenderer;
  createControls?: (camera: PerspectiveCamera, element: HTMLElement) => PreviewControls;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  /** Absent in some environments (jsdom); the viewer then resizes on `window` resize only. */
  ResizeObserverImpl?: typeof ResizeObserver;
  pixelRatio?: number;
}

export interface ModelPreviewViewer {
  /** Shows `model` (replacing any earlier one) and frames it. Throws `empty_model` if it has no extent. */
  showModel(model: Object3D): void;
  /** Back to the framing chosen when the model was shown. */
  resetCamera(): void;
  /** Frames the model again for the current viewport size, from the current viewing direction. */
  fitModel(): void;
  /** Moves the camera toward (factor < 1) or away from (factor > 1) the target. */
  zoom(factor: number): void;
  dispose(): void;
}

export interface Framing {
  position: Vector3;
  target: Vector3;
  near: number;
  far: number;
  minDistance: number;
  maxDistance: number;
}

const FIELD_OF_VIEW = 45;
const DEFAULT_DIRECTION = new Vector3(1, 0.6, 1.4).normalize();
const PADDING = 1.25;

/**
 * Camera placement that fits a sphere of `radius` around `center` into the
 * view, from `direction`, whatever the size: a 1 mm prop and a 1 km island
 * both get near and far planes and zoom limits scaled to them.
 */
export function frameSphere(
  center: Vector3,
  radius: number,
  aspect: number,
  direction: Vector3 = DEFAULT_DIRECTION,
  fov: number = FIELD_OF_VIEW,
): Framing {
  const safeRadius = radius > 0 && Number.isFinite(radius) ? radius : 1;
  const vertical = (fov * Math.PI) / 180 / 2;
  const horizontal = Math.atan(Math.tan(vertical) * (aspect > 0 ? aspect : 1));
  const fitting = safeRadius / Math.sin(Math.min(vertical, horizontal));
  const distance = fitting * PADDING;
  const unit = direction.lengthSq() > 0 ? direction.clone().normalize() : DEFAULT_DIRECTION;
  return {
    position: center.clone().addScaledVector(unit, distance),
    target: center.clone(),
    near: Math.max(distance / 1000, safeRadius / 1000),
    far: distance * 100,
    minDistance: safeRadius * 0.05,
    maxDistance: distance * 20,
  };
}

/** A grid spacing of 1, 2 or 5 times a power of ten that suits a model of this size. */
export function gridSizeFor(extent: number): { size: number; divisions: number } {
  const span = extent > 0 && Number.isFinite(extent) ? extent * 4 : 4;
  const magnitude = 10 ** Math.floor(Math.log10(span / 10));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => span / s <= 20) ?? magnitude * 10;
  const divisions = Math.max(Math.ceil(span / step), 2);
  return { size: divisions * step, divisions };
}

function disposeMaterial(material: Material): void {
  for (const value of Object.values(material)) {
    if (value instanceof Texture) value.dispose();
  }
  material.dispose();
}

/** Frees the GPU resources of everything under `root` (geometries, materials, textures). */
export function disposeObject(root: Object3D): void {
  root.traverse((node) => {
    const mesh = node as Partial<Mesh>;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else if (material) disposeMaterial(material);
  });
}

function defaultRenderer(): PreviewRenderer {
  try {
    return new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
  } catch {
    throw new PreviewError('webgl_unavailable');
  }
}

function defaultControls(camera: PerspectiveCamera, element: HTMLElement): PreviewControls {
  return new OrbitControls(camera, element);
}

export function createModelPreviewViewer(
  host: HTMLElement,
  dependencies: ViewerDependencies = {},
): ModelPreviewViewer {
  const requestFrame = dependencies.requestFrame ?? ((cb) => window.requestAnimationFrame(cb));
  const cancelFrame = dependencies.cancelFrame ?? ((handle) => window.cancelAnimationFrame(handle));
  const renderer = (dependencies.createRenderer ?? defaultRenderer)();
  renderer.setPixelRatio(Math.min(dependencies.pixelRatio ?? window.devicePixelRatio ?? 1, 2));
  renderer.setClearColor(new Color(0xeef1f4));
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 0.01, 1000);
  scene.add(new HemisphereLight(0xffffff, 0x6b7280, 1.6));
  const sun = new DirectionalLight(0xffffff, 1.8);
  sun.position.set(3, 5, 4);
  scene.add(sun);

  const controls = (dependencies.createControls ?? defaultControls)(camera, renderer.domElement);
  controls.enableDamping = false; // render on demand: no animation loop runs while idle
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.enableRotate = true;
  controls.screenSpacePanning = true;

  // The model sits inside a wrapper that is moved to centre it; the model's own transforms are untouched.
  const holder = new Group();
  scene.add(holder);
  let model: Object3D | null = null;
  let helpers: Array<GridHelper | AxesHelper> = [];
  let bounds: Sphere | null = null;
  let homeFraming: Framing | null = null;
  let pendingFrame: number | null = null;
  let disposed = false;

  function render(): void {
    pendingFrame = null;
    if (!disposed) renderer.render(scene, camera);
  }

  function scheduleRender(): void {
    if (pendingFrame === null && !disposed) pendingFrame = requestFrame(render);
  }

  function aspect(): number {
    const width = host.clientWidth;
    const height = host.clientHeight;
    return width > 0 && height > 0 ? width / height : 4 / 3;
  }

  function resize(): void {
    if (disposed) return;
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = aspect();
    camera.updateProjectionMatrix();
    scheduleRender();
  }

  function apply(framing: Framing): void {
    camera.position.copy(framing.position);
    camera.near = framing.near;
    camera.far = framing.far;
    camera.aspect = aspect();
    camera.updateProjectionMatrix();
    controls.target.copy(framing.target);
    controls.minDistance = framing.minDistance;
    controls.maxDistance = framing.maxDistance;
    controls.update();
    scheduleRender();
  }

  function clearModel(): void {
    if (model) {
      holder.remove(model);
      disposeObject(model);
      model = null;
    }
    for (const helper of helpers) {
      scene.remove(helper);
      helper.dispose();
    }
    helpers = [];
    holder.position.set(0, 0, 0);
    bounds = null;
    homeFraming = null;
  }

  const ResizeObserverImpl = dependencies.ResizeObserverImpl ?? globalThis.ResizeObserver;
  const observer = ResizeObserverImpl ? new ResizeObserverImpl(() => resize()) : null;
  observer?.observe(host);
  const onWindowResize = () => resize();
  if (!observer) window.addEventListener('resize', onWindowResize);
  controls.addEventListener('change', scheduleRender);
  resize();

  return {
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
      // Centre on the origin horizontally and stand the model on the grid.
      const center = box.getCenter(new Vector3());
      holder.position.set(-center.x, -box.min.y, -center.z);
      holder.updateMatrixWorld(true);
      model = next;
      const extent = Math.max(size.x, size.y, size.z);
      const { size: gridSize, divisions } = gridSizeFor(extent);
      const grid = new GridHelper(gridSize, divisions, 0x9ca3af, 0xd1d5db);
      const axes = new AxesHelper(extent * 0.6);
      helpers = [grid, axes];
      scene.add(grid, axes);
      bounds = new Sphere(new Vector3(0, size.y / 2, 0), size.length() / 2);
      homeFraming = frameSphere(bounds.center, bounds.radius, aspect());
      apply(homeFraming);
    },
    resetCamera() {
      if (homeFraming && !disposed) apply(homeFraming);
    },
    fitModel() {
      if (!bounds || disposed) return;
      const direction = camera.position.clone().sub(controls.target);
      apply(frameSphere(bounds.center, bounds.radius, aspect(), direction));
    },
    zoom(factor) {
      if (!bounds || disposed || !(factor > 0)) return;
      const offset = camera.position.clone().sub(controls.target);
      const distance = Math.min(
        Math.max(offset.length() * factor, controls.minDistance),
        controls.maxDistance,
      );
      camera.position.copy(controls.target).addScaledVector(offset.normalize(), distance);
      controls.update();
      scheduleRender();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (pendingFrame !== null) cancelFrame(pendingFrame);
      pendingFrame = null;
      observer?.disconnect();
      window.removeEventListener('resize', onWindowResize);
      controls.removeEventListener('change', scheduleRender);
      controls.dispose();
      clearModel();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
