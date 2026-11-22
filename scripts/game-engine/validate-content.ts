/**
 * Runs the engine content compatibility checks over JSON files.
 *
 *   tsx scripts/game-engine/validate-content.ts [files...] [--registry <module>] [--kind AREA_SCENE|ADVENTURE]
 *
 * With no files, scans content/exported/*.json. A file may hold one object or an array of
 * objects; only objects that look like Area scenes or adventures are checked (they declare
 * `scene`, `platforming`, `movement`, `capabilities`, `jumpChallenges`, `colliders`, `gates`,
 * `engineApi` or `realmId`). Catalog exports without those are reported as skipped.
 *
 * `--registry <module>` imports a module whose default or `registry` export is a
 * CapabilityRegistry, so capabilities are resolved exactly as the runtime does. Without it,
 * capability ids and configs are not resolved (every other check still runs).
 *
 * Exits 1 when any issue is found. Logic lives in game/src/sdk/contentCompatibility.ts.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CapabilityRegistry } from '../../game/src/core/capabilities';
import { checkContentCompatibility } from '../../game/src/sdk/contentCompatibility';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APPLICABLE = [
  'scene',
  'platforming',
  'movement',
  'capabilities',
  'jumpChallenges',
  'colliders',
  'gates',
  'engineApi',
  'realmId',
];

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function isApplicable(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    APPLICABLE.some((key) => key in value)
  );
}

async function loadRegistry(modulePath: string | undefined): Promise<CapabilityRegistry | null> {
  if (!modulePath) {
    return null;
  }
  const loaded = (await import(pathToFileURL(resolve(process.cwd(), modulePath)).href)) as Record<
    string,
    unknown
  >;
  const candidate = (loaded.default ?? loaded.registry) as CapabilityRegistry | undefined;
  if (!candidate || typeof candidate.resolve !== 'function') {
    throw new Error(`${modulePath} must export a CapabilityRegistry as default or "registry"`);
  }
  return candidate;
}

async function main(args: string[]): Promise<number> {
  const valueFlags = new Set(['--registry', '--kind']);
  const files: string[] = [];
  args.forEach((arg, index) => {
    if (!arg.startsWith('--') && !valueFlags.has(args[index - 1] ?? '')) {
      files.push(arg);
    }
  });
  if (files.length === 0) {
    const dir = join(root, 'content/exported');
    try {
      files.push(
        ...readdirSync(dir)
          .filter((f) => f.endsWith('.json') && f !== 'manifest.json')
          .sort()
          .map((f) => join(dir, f)),
      );
    } catch {
      console.error(`error: no files given and ${dir} not found`);
      return 2;
    }
  }
  const kindArg = argValue(args, '--kind');
  const kind = kindArg === 'AREA_SCENE' || kindArg === 'ADVENTURE' ? kindArg : undefined;
  const registry = await loadRegistry(argValue(args, '--registry'));
  if (!registry) {
    console.log('note: no --registry given; capability ids and configs are not resolved');
  }

  let checked = 0;
  let skipped = 0;
  let problems = 0;
  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      console.error(`error: ${file}: not readable JSON (${(error as Error).message})`);
      problems += 1;
      continue;
    }
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    const applicable = entries.filter(isApplicable);
    skipped += entries.length - applicable.length;
    applicable.forEach((entry, index) => {
      checked += 1;
      const report = checkContentCompatibility(entry, registry, { kind });
      for (const issue of report.issues) {
        problems += 1;
        console.error(`${file}[${index}] ${issue.code} ${issue.path}: ${issue.message}`);
      }
    });
  }
  console.log(
    `Checked ${checked} item(s), skipped ${skipped} not applicable, ${problems} issue(s).`,
  );
  return problems > 0 ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`error: ${(error as Error).message}`);
    process.exitCode = 2;
  },
);
