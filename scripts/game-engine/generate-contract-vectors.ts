/**
 * Writes (or checks) the engine's contract vectors (GE-004).
 *
 *   npm run engine:vectors         writes tests/contracts/gameplay-events-v1.json
 *   npm run engine:vectors:check   fails if the committed file differs from the module
 *
 * The source of truth is `game/src/contracts/gameplayEventVectors.ts`. These are contract
 * vectors shared with the Django scoring intake, not LAI-0303 rule suites, so they live in
 * `tests/contracts/` rather than `tests/golden/` (whose files must all be rule suites).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GAMEPLAY_EVENT_GOLDEN_FILE,
  renderGameplayEventVectors,
} from '../../game/src/contracts/gameplayEventVectors';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const target = resolve(root, 'tests', 'contracts', GAMEPLAY_EVENT_GOLDEN_FILE);
const text = renderGameplayEventVectors();

if (process.argv.includes('--check')) {
  if (!existsSync(target) || readFileSync(target, 'utf-8') !== text) {
    console.error(`tests/contracts/${GAMEPLAY_EVENT_GOLDEN_FILE} is missing or out of date. Run \`npm run engine:vectors\`.`);
    process.exit(1);
  }
  console.log('Engine contract vectors up to date.');
} else {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  console.log(`Wrote tests/contracts/${GAMEPLAY_EVENT_GOLDEN_FILE}.`);
}
