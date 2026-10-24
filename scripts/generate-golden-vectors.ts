/**
 * Writes (or checks) the golden vectors (LAI-0303).
 *
 *   npm run golden:generate   writes tests/golden/*.json from the TypeScript rules
 *   npm run golden:check      fails if the committed files differ from what the rules produce
 *
 * Runs the existing pure rule functions at build time (see
 * react/src/test/golden/buildGoldenVectors.ts); needs no network, AWS, browser, or credentials.
 * Regenerate after changing a rule (and then update the Python port) or after a content change,
 * which alters the `director-content` suite.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GOLDEN_DIR, renderGoldenFiles } from '../react/src/test/golden/buildGoldenVectors';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const files = renderGoldenFiles();
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

const expected = new Set(Object.keys(files));
const dir = resolve(root, GOLDEN_DIR);
for (const name of existsSync(dir) ? readdirSync(dir) : []) {
  if (name.endsWith('.json') && !expected.has(`${GOLDEN_DIR}/${name}`)) {
    problems.push(`${GOLDEN_DIR}/${name} is not produced by the generator; delete it`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error(check ? 'Run `npm run golden:generate`.' : 'Golden vectors written with problems.');
  process.exit(1);
}
console.log(
  check
    ? `Golden vectors up to date (${expected.size} files).`
    : `Wrote ${expected.size} golden vector files.`,
);
