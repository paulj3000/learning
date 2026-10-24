/**
 * Upload limits for the Model Asset Manager (docs/android/ASSET_MANAGEMENT.md
 * section 25). Both can be overridden per environment with a Vite env var;
 * the defaults are documented in docs/THREE_WORLD_ASSET_CONVENTIONS.md
 * ("Uploaded models").
 *
 * - `MODEL_MAX_UPLOAD_MB` (50) is a hard stop. The largest single character
 *   pack GLB in `assets/` is well under 10 MB, so 50 leaves room for a
 *   detailed environment without letting a mistaken export (an uncompressed
 *   4K texture set, a scene with the Blender camera rig) reach S3.
 * - `MODEL_WARN_UPLOAD_MB` (10) is advisory. Every GLB a child's device
 *   downloads costs loading time and memory, and today's whole bundled
 *   world is about 3 MB, so anything over 10 MB deserves a second look.
 *
 * These are enforced in the browser only. That is acceptable because only
 * `Admins`-group members can write to `assets/*` at all
 * (amplify/storage/resource.ts), so the limit guards against mistakes, not
 * against an attacker.
 */

const BYTES_PER_MB = 1024 * 1024;

function readPositiveNumber(raw: unknown, fallback: number): number {
  const value = typeof raw === 'string' ? Number(raw) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const MODEL_MAX_UPLOAD_MB = readPositiveNumber(import.meta.env.VITE_MODEL_MAX_UPLOAD_MB, 50);
export const MODEL_WARN_UPLOAD_MB = readPositiveNumber(
  import.meta.env.VITE_MODEL_WARN_UPLOAD_MB,
  10,
);

export const MODEL_MAX_UPLOAD_BYTES = MODEL_MAX_UPLOAD_MB * BYTES_PER_MB;
export const MODEL_WARN_UPLOAD_BYTES = MODEL_WARN_UPLOAD_MB * BYTES_PER_MB;

/** The one production model format (ASSET_MANAGEMENT.md section 7). */
export const MODEL_FILE_EXTENSION = '.glb';
export const MODEL_MIME_TYPE = 'model/gltf-binary';

/** Formats a byte count for admin display, e.g. "14.8 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < BYTES_PER_MB) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / BYTES_PER_MB).toFixed(1)} MB`;
}
