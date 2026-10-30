import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Texture,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  createModelPreviewViewer,
  disposeObject,
  frameSphere,
  gridSizeFor,
  type PreviewControls,
  type PreviewRenderer,
} from './modelPreviewViewer';
import { PreviewError } from './previewModelSource';

function fakeRenderer(): PreviewRenderer & { render: Mock<PreviewRenderer['render']> } {
  return {
    domElement: document.createElement('canvas'),
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    setClearColor: vi.fn(),
    render: vi.fn<PreviewRenderer['render']>(),
    dispose: vi.fn(),
  };
}

function fakeControls(): PreviewControls & { listeners: Set<() => void> } {
  const listeners = new Set<() => void>();
  return {
    listeners,
    target: new Vector3(),
    enableDamping: true,
    enablePan: false,
    enableZoom: false,
    enableRotate: false,
    screenSpacePanning: false,
    minDistance: 0,
    maxDistance: Infinity,
    update: vi.fn(() => true),
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    dispose: vi.fn(),
  };
}

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.push(element);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
}

function setup() {
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(host, 'clientHeight', { value: 600, configurable: true });
  document.body.appendChild(host);
  const renderer = fakeRenderer();
  const controls = fakeControls();
  let camera: PerspectiveCamera | null = null;
  const frames: Array<() => void> = [];
  const cancelFrame = vi.fn();
  const viewer = createModelPreviewViewer(host, {
    createRenderer: () => renderer,
    createControls: (cam) => {
      camera = cam;
      return controls;
    },
    requestFrame: (callback) => frames.push(callback),
    cancelFrame,
    ResizeObserverImpl: FakeResizeObserver as unknown as typeof ResizeObserver,
    pixelRatio: 3,
  });
  const flush = () => frames.splice(0).forEach((frame) => frame());
  return { host, renderer, controls, viewer, flush, cancelFrame, camera: () => camera! };
}

function box(size: number, offset = new Vector3()): Mesh {
  const mesh = new Mesh(new BoxGeometry(size, size, size), new MeshStandardMaterial());
  mesh.position.copy(offset);
  return mesh;
}

afterEach(() => {
  document.body.innerHTML = '';
  FakeResizeObserver.instances = [];
});

describe('frameSphere', () => {
  it.each([0.001, 1, 5000])('fits a sphere of radius %f and scales the clip planes to it', (r) => {
    const center = new Vector3(1, 2, 3);
    const framing = frameSphere(center, r, 4 / 3);
    const distance = framing.position.distanceTo(center);
    expect(distance).toBeGreaterThan(r * 2);
    expect(distance).toBeLessThan(r * 5);
    expect(framing.target.equals(center)).toBe(true);
    expect(framing.near).toBeLessThan(distance - r);
    expect(framing.far).toBeGreaterThan(distance + r);
    expect(framing.minDistance).toBeLessThan(distance);
    expect(framing.maxDistance).toBeGreaterThan(distance);
  });

  it('backs off further for a narrow viewport', () => {
    const wide = frameSphere(new Vector3(), 1, 2).position.length();
    const narrow = frameSphere(new Vector3(), 1, 0.5).position.length();
    expect(narrow).toBeGreaterThan(wide);
  });

  it('keeps the given viewing direction', () => {
    const framing = frameSphere(new Vector3(), 1, 1, new Vector3(0, 0, 5));
    expect(framing.position.x).toBeCloseTo(0);
    expect(framing.position.y).toBeCloseTo(0);
    expect(framing.position.z).toBeGreaterThan(0);
  });
});

describe('gridSizeFor', () => {
  it.each([0.002, 1, 37, 12000])('gives a sensible grid for a model %f m across', (extent) => {
    const { size, divisions } = gridSizeFor(extent);
    expect(size).toBeGreaterThanOrEqual(extent * 4);
    expect(divisions).toBeGreaterThanOrEqual(2);
    expect(divisions).toBeLessThanOrEqual(21);
  });
});

describe('createModelPreviewViewer', () => {
  it('mounts a canvas, enables orbit, pan and zoom, and sizes to its host', () => {
    const { host, renderer, controls } = setup();
    expect(host.contains(renderer.domElement)).toBe(true);
    expect(controls.enableRotate && controls.enablePan && controls.enableZoom).toBe(true);
    expect(controls.enableDamping).toBe(false);
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(2); // capped
    expect(renderer.setSize).toHaveBeenCalledWith(800, 600, false);
    expect(FakeResizeObserver.instances[0].observed).toEqual([host]);
  });

  it('resizes when its host changes size', () => {
    const { host, renderer, camera } = setup();
    Object.defineProperty(host, 'clientWidth', { value: 400, configurable: true });
    FakeResizeObserver.instances[0].callback([], {} as ResizeObserver);
    expect(renderer.setSize).toHaveBeenLastCalledWith(400, 600, false);
    expect(camera().aspect).toBeCloseTo(400 / 600);
  });

  it('centres a model on the grid and points the camera at it', () => {
    const { viewer, controls, camera, renderer, flush } = setup();
    const model = box(2, new Vector3(10, 5, -4));
    viewer.showModel(model);
    flush();
    const holder = model.parent!;
    expect(holder.position.x).toBeCloseTo(-10);
    expect(holder.position.y).toBeCloseTo(-4); // the bottom (5 - 1) stands on y = 0
    expect(holder.position.z).toBeCloseTo(4);
    expect(model.position.toArray()).toEqual([10, 5, -4]); // the model itself is untouched
    expect(controls.target.y).toBeCloseTo(1);
    expect(camera().position.distanceTo(controls.target)).toBeGreaterThan(2);
    expect(renderer.render).toHaveBeenCalled();
  });

  it.each([0.0005, 8000])('frames a model %f m across', (size) => {
    const { viewer, camera, controls } = setup();
    viewer.showModel(box(size));
    const distance = camera().position.distanceTo(controls.target);
    expect(distance).toBeGreaterThan(size);
    expect(distance).toBeLessThan(size * 10);
    expect(camera().near).toBeLessThan(distance - size);
    expect(camera().far).toBeGreaterThan(distance + size);
  });

  it('refuses a model with nothing to show', () => {
    const { viewer } = setup();
    expect(() => viewer.showModel(new Group())).toThrow(PreviewError);
    try {
      viewer.showModel(new Group());
    } catch (error) {
      expect((error as PreviewError).code).toBe('empty_model');
    }
  });

  it('resets the camera to the first framing and fits again from the current direction', () => {
    const { viewer, camera, controls } = setup();
    viewer.showModel(box(1));
    const home = camera().position.clone();
    camera().position.set(0, 50, 0.001);
    controls.target.set(3, 3, 3);
    viewer.resetCamera();
    expect(camera().position.distanceTo(home)).toBeCloseTo(0);
    expect(controls.target.y).toBeCloseTo(0.5);

    camera().position.set(0, 0, 100);
    viewer.fitModel();
    expect(camera().position.x).toBeCloseTo(0);
    expect(camera().position.distanceTo(controls.target)).toBeCloseTo(
      home.distanceTo(controls.target),
    );
  });

  it('zooms in and out within the limits', () => {
    const { viewer, camera, controls } = setup();
    viewer.showModel(box(1));
    const start = camera().position.distanceTo(controls.target);
    viewer.zoom(0.5);
    expect(camera().position.distanceTo(controls.target)).toBeCloseTo(start * 0.5);
    for (let i = 0; i < 100; i += 1) viewer.zoom(0.1);
    expect(camera().position.distanceTo(controls.target)).toBeCloseTo(controls.minDistance);
    for (let i = 0; i < 100; i += 1) viewer.zoom(10);
    expect(camera().position.distanceTo(controls.target)).toBeCloseTo(controls.maxDistance);
  });

  it('renders on demand when the controls move the camera', () => {
    const { controls, renderer, flush } = setup();
    flush();
    renderer.render.mockClear();
    controls.listeners.forEach((listener) => listener());
    controls.listeners.forEach((listener) => listener());
    flush();
    expect(renderer.render).toHaveBeenCalledTimes(1); // coalesced into one frame
  });

  it('frees everything on dispose, once', () => {
    const { viewer, renderer, controls, host, cancelFrame } = setup();
    const model = box(1);
    const texture = new Texture();
    (model.material as MeshStandardMaterial).map = texture;
    const geometryDispose = vi.spyOn(model.geometry, 'dispose');
    const materialDispose = vi.spyOn(model.material as MeshStandardMaterial, 'dispose');
    const textureDispose = vi.spyOn(texture, 'dispose');
    viewer.showModel(model); // schedules a frame that is still pending
    viewer.dispose();
    viewer.dispose();
    expect(cancelFrame).toHaveBeenCalledTimes(1);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
    expect(controls.dispose).toHaveBeenCalledTimes(1);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(controls.listeners.size).toBe(0);
    expect(FakeResizeObserver.instances[0].disconnected).toBe(true);
    expect(host.contains(renderer.domElement)).toBe(false);
    viewer.showModel(box(1)); // ignored after dispose
    viewer.resetCamera();
    expect(renderer.render).not.toHaveBeenCalled();
  });

  it('frees the previous model when another is shown', () => {
    const { viewer } = setup();
    const first = box(1);
    const dispose = vi.spyOn(first.geometry, 'dispose');
    viewer.showModel(first);
    viewer.showModel(box(2));
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(first.parent).toBeNull();
  });

  it('reports WebGL being unavailable as a preview error', () => {
    const host = document.createElement('div');
    let caught: unknown;
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      createModelPreviewViewer(host);
    } catch (error) {
      caught = error;
    } finally {
      quiet.mockRestore();
    }
    expect(caught).toBeInstanceOf(PreviewError);
    expect((caught as PreviewError).code).toBe('webgl_unavailable');
    expect(host.children).toHaveLength(0);
  });
});

describe('disposeObject', () => {
  it('disposes every geometry, material and texture under a node', () => {
    const root = new Group();
    const child = box(1);
    const materials = [new MeshStandardMaterial(), new MeshStandardMaterial()];
    const multi = new Mesh(new BoxGeometry(), materials);
    root.add(child, multi);
    const spies = [
      vi.spyOn(child.geometry, 'dispose'),
      vi.spyOn(multi.geometry, 'dispose'),
      ...materials.map((material) => vi.spyOn(material, 'dispose')),
    ];
    disposeObject(root);
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });
});
