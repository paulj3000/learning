import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GOLDEN_DIR, GOLDEN_SCHEMA_VERSION, renderGoldenFiles, type GoldenSuite } from './buildGoldenVectors';

/**
 * LAI-0303: the committed golden vectors are exactly what the TypeScript rules produce today,
 * so they cannot go stale, and they are shaped so a Python port can consume them
 * (`tests/golden/test_golden_vectors.py` checks the same shape from the Python side).
 */

const REPO = resolve(process.cwd(), '..');
const rendered = renderGoldenFiles();
const suites = Object.values(rendered).map((text) => JSON.parse(text) as GoldenSuite);

describe('golden vectors', () => {
  it('match the committed files (run `npm run golden:generate` after a rule or content change)', () => {
    for (const [path, text] of Object.entries(rendered)) {
      const target = resolve(REPO, path);
      expect(existsSync(target), `${path} is missing`).toBe(true);
      expect(readFileSync(target, 'utf8'), `${path} is stale`).toBe(text);
    }
  });

  it('leave no committed vector file the generator no longer produces', () => {
    const committed = readdirSync(resolve(REPO, GOLDEN_DIR))
      .filter((name) => name.endsWith('.json'))
      .map((name) => `${GOLDEN_DIR}/${name}`)
      .sort();
    expect(committed).toEqual(Object.keys(rendered).sort());
  });

  it('cover every rule the roadmap names for the Python port', () => {
    const covered = new Set(suites.flatMap((suite) => Object.keys(suite.functions)));
    for (const name of [
      'validateStepAnswer',
      'getNextStepId',
      'nextHintLevel',
      'decideSubmission',
      'isStepAnswer',
      'resolveRewards',
      'isObjectiveComplete',
      'evaluateQuestCondition',
      'advanceQuest',
      'nextSkillProgressCounts',
      'computeSkillStatus',
      'computeErrorPattern',
      'applyReviewDecay',
      'rankAdventures',
      'reachableAdventures',
    ]) {
      expect(covered.has(name), `${name} has no vectors`).toBe(true);
    }
  });

  it('are well formed: versioned, named inputs, exactly one outcome per case', () => {
    for (const suite of suites) {
      expect(suite.schemaVersion).toBe(GOLDEN_SCHEMA_VERSION);
      expect(suite.sources.length).toBeGreaterThan(0);
      for (const [name, fn] of Object.entries(suite.functions)) {
        expect(fn.python, name).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(fn.cases.length, name).toBeGreaterThan(0);
        for (const testCase of fn.cases) {
          const label = `${suite.suite}.${name}: ${testCase.name}`;
          for (const key of Object.keys(testCase.input as object)) {
            expect(fn.args, label).toContain(key);
          }
          expect('expected' in testCase !== ('throws' in testCase), label).toBe(true);
        }
      }
    }
  });

  it('include rejected inputs, so a port has to reject them too', () => {
    const throwing = suites.flatMap((suite) =>
      Object.entries(suite.functions).flatMap(([name, fn]) =>
        fn.cases.filter((testCase) => testCase.throws).map(() => name),
      ),
    );
    expect(new Set(throwing)).toEqual(
      new Set(['validateStepAnswer', 'getNextStepId', 'decideSubmission']),
    );
  });

  it('bind the content-dependent suite to the current content export', () => {
    const contentSuite = suites.find((suite) => suite.suite === 'director-content');
    const manifest = JSON.parse(
      readFileSync(resolve(REPO, 'content/exported/manifest.json'), 'utf8'),
    ) as { contentDigest: string };
    expect(contentSuite?.contentDigest).toBe(manifest.contentDigest);
  });
});
