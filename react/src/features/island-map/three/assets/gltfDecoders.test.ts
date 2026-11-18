import type { Mesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { describe, expect, it, vi } from 'vitest';
import {
  CompressedModelError,
  configureGltfLoader,
  describeGltfLoadError,
  meshoptSupported,
  registerMeshoptDecoder,
  type MeshoptDecoderLike,
} from './gltfDecoders';
import { createGltfFetcher } from './assetLoader';
import { meshoptTriangleGlb } from '../../../../test/compressedGltfFixtures';

describe('Meshopt decoder registration', () => {
  it('registers the bundled three MeshoptDecoder by default', () => {
    const loader = new GLTFLoader();
    const spy = vi.spyOn(loader, 'setMeshoptDecoder');
    expect(configureGltfLoader(loader)).toBe(loader);
    expect(spy).toHaveBeenCalledWith(MeshoptDecoder);
  });

  it('accepts an injected decoder', () => {
    const fake = { supported: true } as unknown as MeshoptDecoderLike;
    const loader = new GLTFLoader();
    const spy = vi.spyOn(loader, 'setMeshoptDecoder');
    registerMeshoptDecoder(loader, fake);
    expect(spy).toHaveBeenCalledWith(fake);
  });

  it('reports support from the decoder (WebAssembly is available under Node)', () => {
    expect(meshoptSupported()).toBe(true);
    expect(meshoptSupported({ supported: false } as unknown as MeshoptDecoderLike)).toBe(false);
  });
});

describe('Meshopt decoding through GLTFLoader', () => {
  it('decodes an EXT_meshopt_compression vertex stream with the configured loader', async () => {
    const loader = configureGltfLoader(new GLTFLoader());
    const gltf = await loader.parseAsync(meshoptTriangleGlb(), '');
    const mesh = gltf.scene.getObjectByName('Compressed') as Mesh;
    expect(mesh).toBeDefined();
    const position = mesh.geometry.getAttribute('position');
    expect(position.count).toBe(3);
    expect(Array.from(position.array as Float32Array)).toEqual([1, 2, 3, 1, 2, 3, 1, 2, 3]);
  });

  it('refuses a model that requires Meshopt when no decoder is configured', async () => {
    const loader = new GLTFLoader();
    await expect(loader.parseAsync(meshoptTriangleGlb(), '')).rejects.toThrow(
      /setMeshoptDecoder must be called/,
    );
  });

  it('refuses with a typed error when the browser cannot run the decoder', async () => {
    const unsupported = { supported: false } as unknown as MeshoptDecoderLike;
    const loader = registerMeshoptDecoder(new GLTFLoader(), unsupported);
    const error = await loader.parseAsync(meshoptTriangleGlb(), '').catch((e: unknown) => e);
    const described = describeGltfLoadError(error as Error);
    expect(described).toBeInstanceOf(CompressedModelError);
    expect((described as CompressedModelError).code).toBe('meshopt_unsupported');
    expect(described.message).not.toMatch(/—/);
  });

  it('leaves other errors unchanged', () => {
    const error = new Error('something else');
    expect(describeGltfLoadError(error)).toBe(error);
  });
});

describe('createGltfFetcher', () => {
  it('builds its loader with the decoders, and maps decoder failures to typed errors', async () => {
    const unsupported = { supported: false } as unknown as MeshoptDecoderLike;
    const loader = registerMeshoptDecoder(new GLTFLoader(), unsupported);
    const url = URL.createObjectURL(new Blob([meshoptTriangleGlb()]));
    const load = vi
      .spyOn(loader, 'load')
      .mockImplementation((_url, _onLoad, _onProgress, onError) => {
        onError?.(
          new Error(
            'THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files',
          ),
        );
      });
    const fetchGltf = createGltfFetcher(loader);
    await expect(fetchGltf(url)).rejects.toBeInstanceOf(CompressedModelError);
    expect(load).toHaveBeenCalledOnce();
    URL.revokeObjectURL(url);
  });
});
