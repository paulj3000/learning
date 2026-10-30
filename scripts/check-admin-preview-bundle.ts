/**
 * Admin preview bundle freshness check (LAI-2200 AM-10, `docs/ASSET_MANAGER.md` section 17).
 *
 * The Django image has no Node step, so the Three.js preview viewer is committed as a built file,
 * `lai/apps/assets/static/assets/admin/asset-preview.js`. This rebuilds it from
 * `react/src/features/assets/preview/` with the same Vite config into a temporary directory and
 * fails unless the result is byte-for-byte the committed file. The build is deterministic for a
 * given lockfile, so a difference means the source changed without `npm run build:admin-preview`
 * (or the committed file was edited by hand).
 *
 * No network and no new dependencies: it uses the workspace's Vite. Fix a failure by running
 * `npm run build:admin-preview -w react` and committing the result.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REACT = join(ROOT, 'react');
const CONFIG = join(REACT, 'vite.admin-preview.config.ts');
const COMMITTED = join(ROOT, 'lai/apps/assets/static/assets/admin/asset-preview.js');
const BUNDLE = 'asset-preview.js';

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

async function main(): Promise<number> {
  const outDir = mkdtempSync(join(tmpdir(), 'lai-admin-preview-'));
  try {
    await build({
      configFile: CONFIG,
      root: REACT,
      logLevel: 'error',
      build: { outDir, emptyOutDir: true },
    });
    const rebuilt = readFileSync(join(outDir, BUNDLE));
    let committed: Buffer;
    try {
      committed = readFileSync(COMMITTED);
    } catch {
      console.error(`Admin preview bundle missing: ${COMMITTED}`);
      console.error('Run `npm run build:admin-preview -w react` and commit the result.');
      return 1;
    }
    if (!rebuilt.equals(committed)) {
      console.error('Admin preview bundle is stale: it does not match its source.');
      console.error(`  committed ${sha256(committed)} (${committed.length} bytes)`);
      console.error(`  rebuilt   ${sha256(rebuilt)} (${rebuilt.length} bytes)`);
      console.error('Run `npm run build:admin-preview -w react` and commit the result.');
      return 1;
    }
    console.log(`Admin preview bundle is fresh: ${sha256(rebuilt)} (${rebuilt.length} bytes).`);
    return 0;
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

process.exitCode = await main();
