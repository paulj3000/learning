/**
 * A minimal zip reader, used by the asset importers to pull single files out
 * of the CC0 packs under `assets/*.zip` without extracting them.
 *
 * Built on `node:zlib` rather than a dependency, for the same reason this
 * project writes its own glTF assembler instead of using `GLTFExporter`: the
 * job is small and well-specified, and the alternative is a package in
 * `dependencies` that ships nothing to users. It also means the zips stay the
 * single archive of record - no extracted copy of a 500 MB pack in the tree,
 * and no second thing to keep in sync.
 *
 * Supports the two compression methods zip archives actually use in practice
 * (stored and deflate) and throws on anything else rather than guessing.
 */
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const STORED = 0;
const DEFLATED = 8;

/**
 * Reads one entry out of a zip by exact name. Walks the central directory
 * rather than scanning for local headers, so a name either resolves or
 * throws - a typo in an importer's table fails loudly instead of silently
 * importing nothing.
 */
export function readZipEntry(zipPath: string, entryName: string): Buffer {
  const zip = readFileSync(zipPath);

  // The end-of-central-directory record is last, after a comment of unknown
  // length, so scan backwards for its signature.
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error(`${zipPath}: no end-of-central-directory record, not a zip`);
  }

  const entryCount = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);

  for (let i = 0; i < entryCount; i++) {
    if (zip.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error(`${zipPath}: corrupt central directory at entry ${i}`);
    }
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const uncompressedSize = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');

    if (name === entryName) {
      // The local header repeats the name and extra fields, and its extra
      // length can differ from the central one, so read it rather than
      // reusing the value above.
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const raw = zip.subarray(dataStart, dataStart + compressedSize);
      if (method === STORED) {
        return Buffer.from(raw);
      }
      if (method === DEFLATED) {
        const out = inflateRawSync(raw);
        if (out.length !== uncompressedSize) {
          throw new Error(
            `${entryName}: inflated ${out.length} bytes, expected ${uncompressedSize}`,
          );
        }
        return out;
      }
      throw new Error(`${entryName}: unsupported compression method ${method}`);
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error(`${zipPath}: no entry named "${entryName}"`);
}

/** Every entry name in a zip, for locating a file whose folder prefix varies. */
export function listZipEntries(zipPath: string): string[] {
  const zip = readFileSync(zipPath);
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error(`${zipPath}: no end-of-central-directory record, not a zip`);
  }
  const entryCount = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < entryCount; i++) {
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    names.push(zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}
