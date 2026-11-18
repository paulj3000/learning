import type { Mesh, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { describe, expect, it, vi } from 'vitest';
import {
  BASIS_TRANSCODER_PATH,
  BASIS_TRANSCODER_URLS,
  CompressedModelError,
  configureGltfLoader,
  createKtx2Loader,
  ktx2UrlModifier,
  type Ktx2Renderer,
  describeGltfLoadError,
  meshoptSupported,
  registerMeshoptDecoder,
  type MeshoptDecoderLike,
} from './gltfDecoders';
import { createGltfFetcher, enableKtx2Textures } from './assetLoader';
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

/** The parts of a WebGL renderer `KTX2Loader.detectSupport` reads: an ASTC-capable tablet GPU. */
function fakeAstcRenderer(): Ktx2Renderer {
  const supported = new Set(['WEBGL_compressed_texture_astc', 'WEBGL_compressed_texture_etc']);
  return {
    extensions: {
      has: (name: string) => supported.has(name),
      get: () => ({ getSupportedProfiles: () => ['ldr'] }),
    },
  } as unknown as Ktx2Renderer;
}

describe('KTX2 loader configuration', () => {
  it('bundles the Basis transcoder from the installed three, never a CDN', () => {
    const urls = Object.values(BASIS_TRANSCODER_URLS);
    expect(Object.keys(BASIS_TRANSCODER_URLS).sort()).toEqual([
      'basis_transcoder.js',
      'basis_transcoder.wasm',
    ]);
    for (const url of urls) {
      expect(url).toMatch(/basis_transcoder\.(js|wasm)/);
      expect(url).not.toMatch(/^https?:/);
    }
  });

  it('maps the transcoder files, passes embedded texture data, refuses anything else', () => {
    expect(ktx2UrlModifier(`${BASIS_TRANSCODER_PATH}basis_transcoder.js`)).toBe(
      BASIS_TRANSCODER_URLS['basis_transcoder.js'],
    );
    expect(ktx2UrlModifier(`${BASIS_TRANSCODER_PATH}basis_transcoder.wasm`)).toBe(
      BASIS_TRANSCODER_URLS['basis_transcoder.wasm'],
    );
    expect(ktx2UrlModifier('blob:http://localhost/1234')).toBe('blob:http://localhost/1234');
    expect(ktx2UrlModifier('data:image/ktx2;base64,AA==')).toBe('data:image/ktx2;base64,AA==');
    expect(ktx2UrlModifier('https://cdn.example.com/basis_transcoder.js')).toBe(
      'data:application/octet-stream;base64,',
    );
    expect(ktx2UrlModifier(`${BASIS_TRANSCODER_PATH}other.js`)).toBe(
      'data:application/octet-stream;base64,',
    );
  });

  it('creates a KTX2 loader with the bundled path, a worker limit and renderer detection', () => {
    const loader = createKtx2Loader(fakeAstcRenderer());
    const internals = loader as unknown as {
      transcoderPath: string;
      workerPool: { pool: number };
      workerConfig: { astcSupported: boolean; etc2Supported: boolean; dxtSupported: boolean };
      manager: { resolveURL(url: string): string };
    };
    expect(internals.transcoderPath).toBe(BASIS_TRANSCODER_PATH);
    expect(internals.workerPool.pool).toBe(2);
    expect(internals.workerConfig.astcSupported).toBe(true);
    expect(internals.workerConfig.etc2Supported).toBe(true);
    expect(internals.workerConfig.dxtSupported).toBe(false);
    expect(internals.manager.resolveURL(`${BASIS_TRANSCODER_PATH}basis_transcoder.wasm`)).toBe(
      BASIS_TRANSCODER_URLS['basis_transcoder.wasm'],
    );
    loader.dispose();
  });

  it('honours a smaller worker limit and an injected loader class', () => {
    const fake = {
      setTranscoderPath: vi.fn().mockReturnThis(),
      setWorkerLimit: vi.fn().mockReturnThis(),
      detectSupport: vi.fn().mockReturnThis(),
    };
    const renderer = fakeAstcRenderer();
    const created = createKtx2Loader(renderer, {
      workerLimit: 1,
      create: () => fake as unknown as KTX2Loader,
    });
    expect(created).toBe(fake);
    expect(fake.setWorkerLimit).toHaveBeenCalledWith(1);
    expect(fake.detectSupport).toHaveBeenCalledWith(renderer);
  });

  it('configureGltfLoader sets the KTX2 loader only when one is given', () => {
    const loader = new GLTFLoader();
    const spy = vi.spyOn(loader, 'setKTX2Loader');
    configureGltfLoader(loader);
    expect(spy).not.toHaveBeenCalled();
    const ktx2 = createKtx2Loader(fakeAstcRenderer());
    configureGltfLoader(loader, { ktx2 });
    expect(spy).toHaveBeenCalledWith(ktx2);
    ktx2.dispose();
  });

  it('maps a missing KTX2 loader to a typed, readable error', () => {
    const described = describeGltfLoadError(
      new Error('THREE.GLTFLoader: setKTX2Loader must be called before loading KTX2 textures'),
    );
    expect(described).toBeInstanceOf(CompressedModelError);
    expect((described as CompressedModelError).code).toBe('ktx2_unavailable');
    expect(described.message).not.toMatch(/—/);
  });
});

describe('enableKtx2Textures', () => {
  it('attaches a KTX2 loader to the GLTF loader and detaches and disposes it', () => {
    const gltf = new GLTFLoader();
    const set = vi.spyOn(gltf, 'setKTX2Loader');
    const dispose = vi.spyOn(KTX2Loader.prototype, 'dispose');
    const detach = enableKtx2Textures(fakeAstcRenderer() as unknown as WebGLRenderer, {}, gltf);
    const attached = set.mock.calls[0]?.[0];
    expect(attached).toBeInstanceOf(KTX2Loader);
    detach();
    expect(set).toHaveBeenLastCalledWith(null);
    expect(dispose).toHaveBeenCalledOnce();
    detach();
    expect(dispose).toHaveBeenCalledOnce();
    dispose.mockRestore();
  });

  it('detaching an older attachment leaves the newer one active', () => {
    const gltf = new GLTFLoader();
    const first = enableKtx2Textures(fakeAstcRenderer() as unknown as WebGLRenderer, {}, gltf);
    const second = enableKtx2Textures(fakeAstcRenderer() as unknown as WebGLRenderer, {}, gltf);
    const active = (gltf as unknown as { ktx2Loader: unknown }).ktx2Loader;
    first();
    expect((gltf as unknown as { ktx2Loader: unknown }).ktx2Loader).toBe(active);
    second();
    expect((gltf as unknown as { ktx2Loader: unknown }).ktx2Loader).toBeNull();
  });
});
