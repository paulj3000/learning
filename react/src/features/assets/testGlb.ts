/**
 * Test helpers for the Model Asset Manager: the 12-byte GLB header a real
 * `.glb` starts with (glTF 2.0 spec, section 4.4.2), so upload checks can be
 * tested against exact bytes without shipping a binary fixture.
 */

const GLB_MAGIC = 0x46546c67;

export function glbHeader(
  declaredLength: number,
  { magic = GLB_MAGIC, version = 2 }: { magic?: number; version?: number } = {},
): Uint8Array {
  const bytes = new Uint8Array(12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, magic, true);
  view.setUint32(4, version, true);
  view.setUint32(8, declaredLength, true);
  return bytes;
}

/** A `File` whose header is a valid GLB header for its own length, padded with zeros. */
export function glbFile(name: string, size = 64): File {
  const bytes = new Uint8Array(size);
  bytes.set(glbHeader(size), 0);
  return new File([bytes], name, { type: 'model/gltf-binary' });
}
