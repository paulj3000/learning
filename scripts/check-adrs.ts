/**
 * ADR registry check (docs/DECISIONS.md, "ADR governance").
 *
 * Fails when:
 * - an `## ADR-...` heading is malformed, or two headings share an identifier;
 * - a heading has no row in the registry table, or a registry row has no heading
 *   (unless its status says `Reserved`), or a row's title differs from its heading;
 * - a reference in any text file is malformed (one or two digits) or names an identifier that is neither a
 *   heading nor a reserved registry row.
 *
 * Reference syntax: exactly `ADR-` plus three digits. The placeholder `ADR-NNN` is ignored.
 * No network, no dependencies. `--root <dir>` points it at another tree (used by its test).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AdrReport {
  errors: string[];
  headingCount: number;
  registryCount: number;
  referenceCount: number;
}

const DECISIONS_PATH = 'docs/DECISIONS.md';
const HEADING = /^## ADR-(\d{3}): (\S.*)$/;
const LOOSE_HEADING = /^#{1,6}\s+ADR[-_\s]*\d/i;
const REGISTRY_ROW = /^\| ADR-(\d{3}) \| (.+?) \| (.+?) \| (.+?) \|(.*)\|$/;
const REFERENCE = /ADR-(\d+)/g;

const SKIPPED_DIRS = new Set([
  '.git',
  '.venv',
  'node_modules',
  'dist',
  'content',
  '.amplify',
  'playwright-report',
  'test-results',
  '__pycache__',
]);
const TEXT_EXTENSIONS = new Set(['.md', '.ts', '.tsx', '.py', '.json', '.yml', '.yaml', '.css']);
const SKIPPED_FILES = new Set(['package-lock.json', 'amplify_outputs.json']);

function listFiles(root: string, dir = root, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (SKIPPED_DIRS.has(name)) continue;
    const info = statSync(full);
    if (info.isDirectory()) listFiles(root, full, out);
    else if (TEXT_EXTENSIONS.has(name.slice(name.lastIndexOf('.'))) && !SKIPPED_FILES.has(name)) {
      out.push(full);
    }
  }
  return out;
}

export function checkAdrs(root: string): AdrReport {
  const errors: string[] = [];
  const decisions = readFileSync(join(root, DECISIONS_PATH), 'utf-8').split('\n');

  const headings = new Map<string, { title: string; line: number }>();
  decisions.forEach((text, index) => {
    const line = index + 1;
    if (!LOOSE_HEADING.test(text)) return;
    const match = HEADING.exec(text);
    if (!match) {
      errors.push(
        `${DECISIONS_PATH}:${line}: malformed ADR heading "${text}" (expected "## ADR-NNN: Title")`,
      );
      return;
    }
    const [, id, title] = match as unknown as [string, string, string];
    const earlier = headings.get(id);
    if (earlier) {
      errors.push(
        `${DECISIONS_PATH}:${line}: duplicate heading ADR-${id} (first at line ${earlier.line})`,
      );
      return;
    }
    headings.set(id, { title: title.trim(), line });
  });

  const registry = new Map<string, { title: string; status: string; line: number }>();
  decisions.forEach((text, index) => {
    const match = REGISTRY_ROW.exec(text);
    if (!match) return;
    const [, id, title, status] = match as unknown as [string, string, string, string];
    const line = index + 1;
    if (registry.has(id))
      errors.push(`${DECISIONS_PATH}:${line}: ADR-${id} appears twice in the registry`);
    registry.set(id, { title: title.trim(), status: status.trim(), line });
  });

  for (const [id, heading] of headings) {
    const row = registry.get(id);
    if (!row) errors.push(`${DECISIONS_PATH}:${heading.line}: ADR-${id} has no registry row`);
    else if (row.title !== heading.title) {
      errors.push(
        `${DECISIONS_PATH}:${row.line}: registry title for ADR-${id} differs from its heading`,
      );
    }
  }
  const reserved = new Set<string>();
  for (const [id, row] of registry) {
    if (headings.has(id)) continue;
    if (/^reserved\b/i.test(row.status)) reserved.add(id);
    else
      errors.push(
        `${DECISIONS_PATH}:${row.line}: registry row ADR-${id} has no heading and is not Reserved`,
      );
  }

  let referenceCount = 0;
  for (const file of listFiles(root)) {
    const lines = readFileSync(file, 'utf-8').split('\n');
    lines.forEach((text, index) => {
      for (const match of text.matchAll(REFERENCE)) {
        referenceCount += 1;
        const digits = match[1] as string;
        const where = `${relative(root, file)}:${index + 1}`;
        if (digits.length !== 3) {
          errors.push(`${where}: malformed reference "ADR-${digits}" (use three digits)`);
        } else if (!headings.has(digits) && !reserved.has(digits)) {
          errors.push(
            `${where}: reference to ADR-${digits}, which is neither defined nor reserved`,
          );
        }
      }
    });
  }

  return { errors, headingCount: headings.size, registryCount: registry.size, referenceCount };
}

function main(): void {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const root =
    rootIndex >= 0
      ? resolve(args[rootIndex + 1] ?? '.')
      : resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const report = checkAdrs(root);
  if (report.errors.length > 0) {
    console.error(`ADR check failed with ${report.errors.length} problem(s):`);
    for (const error of report.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(
    `ADR check passed: ${report.headingCount} decisions, ${report.registryCount} registry rows, ${report.referenceCount} references.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
