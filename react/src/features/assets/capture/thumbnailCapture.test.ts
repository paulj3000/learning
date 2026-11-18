import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Texture,
  Vector3,
  type Color,
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import { PreviewError } from '../preview/previewModelSource';
import type { ToBlob } from './captureOutput';
import {
  createThumbnailCapture,
  type CaptureControls,
  type CaptureRenderer,
} from './thumbnailCapture';

function fakeRenderer() {
  const clears: Array<[number, number | undefined]> = [];
  const renderer: CaptureRenderer & { sizes: number[][] } = {
    domElement: document.createElement('canvas'),
    sizes: [],
    setPixelRatio: vi.fn(),
    setSize: vi.fn((w: number, h: number) => void renderer.sizes.push([w, h])),
    setClearColor: vi.fn((c: Color, a?: number) => void clears.push([c.getHex(), a])),
    render: vi.fn(),
    dispose: vi.fn(),
    forceContextLoss: vi.fn(),
  };
  return { renderer, clears };
}

function fakeControls(): CaptureControls {
  return {
    target: new Vector3(),
    enableDamping: true,
    minDistance: 0,
    maxDistance: Infinity,
    update: vi.fn(() => true),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispose: vi.fn(),
  };
}

function model() {
  const geometry = new BoxGeometry(1, 2, 1);
  const texture = new Texture();
  const material = new MeshStandardMaterial({ map: texture });
  const spies = {
    geometry: vi.spyOn(geometry, 'dispose'),
    material: vi.spyOn(material, 'dispose'),
    texture: vi.spyOn(texture, 'dispose'),
  };
  const group = new Group();
  group.add(new Mesh(geometry, material));
  return { group, spies };
}

function setup() {
  const host = document.createElement('div');
  const { renderer, clears } = fakeRenderer();
  const controls = fakeControls();
  const toBlob = vi.fn<ToBlob>(async (type) => new Blob([new Uint8Array(10)], { type }));
  const capture = createThumbnailCapture(host, {
    createRenderer: () => renderer,
    createControls: () => controls,
    toBlob: () => toBlob,
    requestFrame: () => 1,
    cancelFrame: vi.fn(),
  });
  return { host, renderer, clears, controls, toBlob, capture };
}

describe('thumbnail capture component', () => {
  it('frames by the spec and clears to the neutral background, opaque by default', () => {
    const { capture, controls, clears } = setup();
    const { group } = model();
    capture.showModel(group);
    expect(capture.hasModel).toBe(true);
    expect(controls.target.toArray()).toEqual([0, 0, 0]);
    expect(clears[0]).toEqual([0xeef1f4, 1]);
    capture.setTransparent(true);
    expect(clears.at(-1)).toEqual([0xeef1f4, 0]);
  });

  it('captures at the requested bounded size and restores the view', async () => {
    const { capture, renderer, toBlob } = setup();
    capture.showModel(model().group);
    const out = await capture.capture(5000);
    expect(out.type).toBe('image/webp');
    expect(renderer.sizes).toContainEqual([1024, 1024]);
    expect(renderer.render).toHaveBeenCalled();
    expect(toBlob).toHaveBeenCalledWith('image/webp', 0.85);
    capture.setTransparent(true);
    expect((await capture.capture(256)).type).toBe('image/png');
  });

  it('refuses to capture before a model is shown, and an empty model', async () => {
    const { capture } = setup();
    await expect(capture.capture(512)).rejects.toBeInstanceOf(PreviewError);
    expect(() => capture.showModel(new Group())).toThrow(PreviewError);
  });

  it('disposes geometry, materials, textures, controls and renderer on dispose', () => {
    const { capture, controls, renderer, host } = setup();
    const { group, spies } = model();
    capture.showModel(group);
    expect(host.contains(renderer.domElement)).toBe(true);
    capture.dispose();
    expect(spies.geometry).toHaveBeenCalled();
    expect(spies.material).toHaveBeenCalled();
    expect(spies.texture).toHaveBeenCalled();
    expect(controls.dispose).toHaveBeenCalled();
    expect(renderer.dispose).toHaveBeenCalled();
    expect(renderer.forceContextLoss).toHaveBeenCalled();
    expect(host.contains(renderer.domElement)).toBe(false);
    capture.dispose(); // idempotent
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes the previous model when another is shown', () => {
    const { capture } = setup();
    const first = model();
    capture.showModel(first.group);
    capture.showModel(model().group);
    expect(first.spies.geometry).toHaveBeenCalled();
  });
});
