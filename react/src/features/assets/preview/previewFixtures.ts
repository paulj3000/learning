/**
 * Synthetic glTF files for the admin preview tests (LAI-2200 AM-10). A
 * triangle of `size` metres, optionally with named animation clips, built as
 * jsdom-realm `ArrayBuffer`s so `GLTFLoader.parse()` tells JSON from GLB the
 * same way it does in a browser.
 */

function localBuffer(bytes: Uint8Array): ArrayBuffer {
  const local = new Uint8Array(bytes.length);
  local.set(bytes);
  return local.buffer;
}

function triangle(size: number): { binary: Uint8Array; document: Record<string, unknown> } {
  const positions = new Float32Array([0, 0, 0, size, 0, 0, 0, size, 0]);
  return {
    binary: new Uint8Array(positions.buffer),
    document: {
      asset: { version: '2.0', generator: 'lai-preview-tests' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: 'body' }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          min: [0, 0, 0],
          max: [size, size, 0],
        },
      ],
    },
  };
}

function base64(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

export function gltfFile(
  options: { size?: number; bufferUri?: string; clips?: string[] } = {},
): ArrayBuffer {
  const { binary, document } = triangle(options.size ?? 1);
  const uri = options.bufferUri ?? `data:application/octet-stream;base64,${base64(binary)}`;
  document.buffers = [{ byteLength: binary.byteLength, uri }];
  if (options.clips?.length) {
    // A clip needs a sampler; reuse the x positions as harmless keyframe times.
    document.accessors = [
      ...(document.accessors as unknown[]),
      { bufferView: 0, componentType: 5126, count: 1, type: 'SCALAR', min: [0], max: [0] },
      { bufferView: 0, componentType: 5126, count: 1, type: 'VEC3' },
    ];
    document.animations = options.clips.map((name) => ({
      name,
      samplers: [{ input: 1, output: 2 }],
      channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }],
    }));
  }
  return localBuffer(new TextEncoder().encode(JSON.stringify(document)));
}

export function glbFile(size = 1): ArrayBuffer {
  const { binary, document } = triangle(size);
  document.buffers = [{ byteLength: binary.byteLength }];
  const pad = (length: number) => (4 - (length % 4)) % 4;
  let json = JSON.stringify(document);
  json += ' '.repeat(pad(json.length));
  const jsonBytes = new TextEncoder().encode(json);
  const binLength = binary.byteLength + pad(binary.byteLength);
  const total = 12 + 8 + jsonBytes.length + 8 + binLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  const binStart = 20 + jsonBytes.length;
  view.setUint32(binStart, binLength, true);
  view.setUint32(binStart + 4, 0x004e4942, true);
  out.set(binary, binStart + 8);
  return localBuffer(out);
}

/** A minimal `Response` stand-in; jsdom's realm and Node's `Response` disagree about bodies. */
export function fakeResponse(
  status: number,
  body: ArrayBuffer | Record<string, unknown> | null,
  headers: Record<string, string> = {},
): Response {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    json: async () => {
      if (body === null || body instanceof ArrayBuffer) throw new SyntaxError('not json');
      return body;
    },
    arrayBuffer: async () => (body instanceof ArrayBuffer ? body : new ArrayBuffer(0)),
  } as unknown as Response;
}
