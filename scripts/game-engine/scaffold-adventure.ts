/**
 * Scaffolds an adventure: a definition module, a spec stub (from
 * docs/adventures/templates/adventure-specification.md) and a unit test.
 *
 *   tsx scripts/game-engine/scaffold-adventure.ts --realm <id> --adventure <id> [--jump] [--dry-run] [--out <dir>]
 *
 * Refuses to overwrite any existing file. All generation logic is the pure
 * `scaffoldAdventure` in game/src/sdk/scaffold.ts; this script only does argv and the file system.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffoldAdventure } from '../../game/src/sdk/scaffold';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATE = join(root, 'docs/adventures/templates/adventure-specification.md');

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function main(args: string[]): number {
  const realmId = argValue(args, '--realm');
  const adventureId = argValue(args, '--adventure');
  if (!realmId || !adventureId) {
    console.error(
      'usage: scaffold-adventure --realm <id> --adventure <id> [--jump] [--dry-run] [--out <dir>]',
    );
    return 2;
  }
  const dryRun = args.includes('--dry-run');
  const result = scaffoldAdventure({
    realmId,
    adventureId,
    jump: args.includes('--jump'),
    specTemplate: existsSync(TEMPLATE) ? readFileSync(TEMPLATE, 'utf8') : undefined,
  });
  if (!result.ok) {
    for (const issue of result.issues) {
      console.error(`error: ${issue.path} ${issue.message}`);
    }
    return 1;
  }
  const outDir = resolve(root, argValue(args, '--out') ?? result.defaultOutDir);
  const targets = result.files.map((file) => ({ ...file, full: join(outDir, file.path) }));
  const existing = targets.filter((target) => existsSync(target.full));
  if (existing.length > 0) {
    for (const target of existing) {
      console.error(`error: refusing to overwrite ${target.full}`);
    }
    return 1;
  }
  console.log(
    `${dryRun ? 'Dry run: would write' : 'Writing'} ${targets.length} files to ${outDir}`,
  );
  for (const target of targets) {
    console.log(`  ${target.path} (${target.content.split('\n').length - 1} lines)`);
    if (!dryRun) {
      mkdirSync(dirname(target.full), { recursive: true });
      writeFileSync(target.full, target.content, { flag: 'wx' });
    }
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
