/**
 * Writes (or checks) the versioned game-content export (LAI-0302).
 *
 *   npm run content:export   writes content/schema and content/exported
 *   npm run content:check    fails if the committed files differ from what the sources produce
 *
 * Runs the existing typed content modules at build time (trusted code in this repository, see
 * react/src/features/content-export/build.ts); needs no network, AWS, browser, or credentials.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContentPackage } from '../react/src/features/content-export/build';
import {
  ContentExportError,
  EXPORT_DIR,
  renderExport,
} from '../react/src/features/content-export/files';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

try {
  const { files } = renderExport(await buildContentPackage());
  const problems: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    const target = resolve(root, path);
    if (check) {
      if (!existsSync(target) || readFileSync(target, 'utf-8') !== text) {
        problems.push(`${path} is missing or out of date`);
      }
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, text);
    }
  }
  if (check) {
    const dir = resolve(root, EXPORT_DIR);
    const expected = new Set(Object.keys(files).map((p) => resolve(root, p)));
    for (const name of existsSync(dir) ? readdirSync(dir) : []) {
      if (!expected.has(resolve(dir, name)))
        problems.push(`${EXPORT_DIR}/${name} is not produced by the export`);
    }
    if (problems.length > 0) {
      console.error(
        `Content export drift:\n- ${problems.join('\n- ')}\nRun: npm run content:export`,
      );
      process.exit(1);
    }
    console.log(`Content export is up to date (${Object.keys(files).length} files).`);
  } else {
    console.log(`Wrote ${Object.keys(files).length} files under content/.`);
  }
} catch (error) {
  if (error instanceof ContentExportError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
