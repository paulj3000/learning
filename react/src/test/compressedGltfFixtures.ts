/**
 * Hand-built compressed glTF fixtures for unit tests (ADR-070). Written byte
 * by byte from the Khronos bitstream specifications, so the tests need no
 * encoder dependency. Test-only: nothing in the app imports this file.
 */

/**
 * A tiny GLB whose only vertex buffer view is `EXT_meshopt_compression`
 * (ATTRIBUTES mode, version 0 bitstream, Appendix A of the Khronos spec),
 * written by hand so the test needs no encoder dependency.
 *
 * Stream: header 0xa0; one attribute block of 3 elements, so 1 group, so one
 * header byte per byte position of the 12-byte element, all zero (every
 * delta is zero, no delta bytes follow); then the tail: 20 zero bytes of
 * padding and the 12-byte baseline element. Every decoded vertex therefore
 * equals the baseline (1, 2, 3).
 */
export function meshoptTriangleGlb(options: { required?: boolean } = {}): ArrayBuffer {
  const stride = 12;
  const count = 3;
  const baseline = new Float32Array([1, 2, 3]);
  const stream = new Uint8Array(1 + stride + 32);
  stream[0] = 0xa0;
  stream.set(new Uint8Array(baseline.buffer), stream.length - stride);
  const binLength = Math.ceil(stream.length / 4) * 4;
  const required = options.required ?? true;
  const json = {
    asset: { version: '2.0' },
    extensionsUsed: ['EXT_meshopt_compression'],
    ...(required ? { extensionsRequired: ['EXT_meshopt_compression'] } : {}),
    buffers: [
      { byteLength: binLength },
      { byteLength: stride * count, extensions: { EXT_meshopt_compression: { fallback: true } } },
    ],
    bufferViews: [
      {
        buffer: 1,
        byteOffset: 0,
        byteLength: stride * count,
        byteStride: stride,
        target: 34962,
        extensions: {
          EXT_meshopt_compression: {
            buffer: 0,
            byteOffset: 0,
            byteLength: stream.length,
            byteStride: stride,
            count,
            mode: 'ATTRIBUTES',
          },
        },
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: 'VEC3', min: [1, 2, 3], max: [1, 2, 3] },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ name: 'Compressed', mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(jsonBytes.length / 4) * 4;
  const total = 12 + 8 + jsonLength + 8 + binLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(jsonBytes, 20);
  view.setUint32(20 + jsonLength, binLength, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  out.set(stream, 28 + jsonLength);
  return out.buffer;
}
