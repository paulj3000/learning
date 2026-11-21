import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tryParseTideTrialConfig } from '../extensions/tideTrial/tideTrialConfig';
import { SOURCE_LOCATION_MANIFESTS } from './manifests';
import { pickUpWorldChange } from './manifestBindings';

/**
 * The generic `POST world-changes/` refuses a protected key without proof of play
 * (`lai/apps/progression/protected_changes.py`, docs/security/WORLD_CHANGE_INTEGRITY.md). The
 * island runtime posts through that route only for a collectible pick-up and a won tide trial,
 * with no session behind it, so none of those keys may be protected, or the server would refuse
 * a change the child really made. This mirrors the Python registry's rule from the same files it
 * reads: page keys, keys only a quest, discovery or story records, and the reserved prefixes.
 */
// Vitest runs from the `react/` workspace, one level below the repository root.
const root = resolve(process.cwd(), '..');
const readJson = (path: string): unknown => JSON.parse(readFileSync(resolve(root, path), 'utf8'));

interface Change {
  changeKey: string;
  locationSlug: string;
}
type Records = Record<string, unknown>[];
const isChange = (value: unknown): value is Change =>
  typeof value === 'object' && value !== null && 'changeKey' in value;
const records = (name: string): Records =>
  (readJson(`content/exported/${name}.json`) as Record<string, Records>)[name] ?? [];

const RESERVED_PREFIXES = ['GREAT_STORYBOOK_RESTORED', 'castle-room:'];

function protectedKeys(): Set<string> {
  const pages = (readJson('lai/apps/regions/great_storybook_pages.json') as { pages: Records })
    .pages;
  const keys = new Set<string>();
  for (const page of pages) {
    const source = page.source as { kind: string; changeKey?: string };
    if (source.kind === 'WORLD_CHANGE' && source.changeKey) keys.add(source.changeKey);
  }
  const byAdventure = new Set<string>();
  for (const adventure of records('adventures')) {
    for (const step of (adventure.steps as Records | undefined) ?? []) {
      const presentation = step.presentation as { kind?: string; payload?: unknown } | undefined;
      if (presentation?.kind === 'world-change' && isChange(presentation.payload)) {
        byAdventure.add(presentation.payload.changeKey);
      }
    }
  }
  const serverOnly: Change[] = [];
  for (const quest of records('quests')) {
    for (const stage of (quest.stages as Records | undefined) ?? []) {
      serverOnly.push(...((stage.worldChanges as Change[] | undefined) ?? []));
    }
    const completion = quest.completion as { worldChanges?: Change[] } | undefined;
    serverOnly.push(...(completion?.worldChanges ?? []));
  }
  for (const discovery of records('discoveries')) {
    if (isChange(discovery.worldChange)) serverOnly.push(discovery.worldChange);
  }
  for (const story of records('stories')) {
    if (isChange(story.completionWorldChange)) serverOnly.push(story.completionWorldChange);
  }
  for (const change of serverOnly) {
    if (!byAdventure.has(change.changeKey)) keys.add(change.changeKey);
  }
  return keys;
}

function clientPostedKeys(): { where: string; key: string }[] {
  const posted: { where: string; key: string }[] = [];
  for (const manifest of SOURCE_LOCATION_MANIFESTS) {
    for (const collectible of manifest.collectibles) {
      const change = pickUpWorldChange(manifest, collectible.entityId);
      if (change)
        posted.push({
          where: `${manifest.locationSlug}:${collectible.entityId}`,
          key: change.changeKey,
        });
    }
    for (const extension of manifest.extensions) {
      const trial = tryParseTideTrialConfig(extension.config);
      if (trial)
        posted.push({
          where: `${manifest.locationSlug}:${extension.extensionId}`,
          key: trial.worldChange.changeKey,
        });
    }
  }
  return posted;
}

describe('world changes the island runtime posts', () => {
  it('finds the posted keys (the guard is not vacuous)', () => {
    expect(clientPostedKeys().length).toBeGreaterThan(0);
    expect(protectedKeys().has('FIRST_STORY_TOLD')).toBe(true);
  });

  it('never names a protected key, which the server would refuse', () => {
    const blocked = protectedKeys();
    const refused = clientPostedKeys().filter(
      ({ key }) => blocked.has(key) || RESERVED_PREFIXES.some((prefix) => key.startsWith(prefix)),
    );
    expect(refused).toEqual([]);
  });
});
