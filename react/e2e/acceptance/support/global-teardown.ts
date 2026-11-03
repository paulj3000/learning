import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Removes the synthetic amplify_outputs.json that start-vite.mjs wrote, even when the web server
 * was killed before its own clean-up ran; a later build or dev server must never pick it up.
 * A real file (no `_laiE2E` marker) is left alone.
 */
export default function globalTeardown(): void {
  const path = resolve(process.cwd(), '../amplify_outputs.json');
  if (!existsSync(path)) return;
  try {
    if ((JSON.parse(readFileSync(path, 'utf8')) as { _laiE2E?: boolean })._laiE2E) rmSync(path);
  } catch {
    // Not JSON, so not ours.
  }
}
