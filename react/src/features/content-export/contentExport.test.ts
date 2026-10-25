// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ADVENTURE_TEMPLATES } from '../adventures/content/index';
import { LEARNING_OBJECTIVES } from '../adventures/content/learningObjectives';
import { SKILLS } from '../curriculum/content/index';
import { ALL_CHECKPOINTS } from '../discovery/checkpoints';
import { DISCOVERY_DEFINITIONS } from '../discovery/content/index';
import { ASSET_MANIFEST } from '../island-map/three/assets/manifest';
import { ISLAND_LOCATIONS } from '../island/locations';
import { ALL_NPCS } from '../npc/content/index';
import { QUEST_DEFINITIONS } from '../quests/content/index';
import { ALL_ITEMS, ALL_REWARD_RULES } from '../rewards/content/index';
import { STORY_DEFINITIONS } from '../story/content/index';
import { WORLD_DEFINITIONS } from '../worlds/worlds';
import { buildContentPackage } from './build';
import {
  TREASURE_RUSH_ITEMS,
  TREASURE_RUSH_QUESTS,
  TREASURE_RUSH_REWARD_RULES,
} from './treasureRushContent';
import { canonicalJson, toJsonValue, UnsupportedContentError } from './canonical';
import { ContentExportError, renderExport } from './files';
import { checkIntegrity } from './integrity';
import { CONTENT_SCHEMA, schemaForFile, validate } from './schema';
import { FILE_LAYOUT, SCHEMA_VERSION, type ContentPackage } from './types';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const read = (path: string) => readFileSync(resolve(repoRoot, path), 'utf-8');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

async function freshPackage(): Promise<ContentPackage> {
  return clone(await buildContentPackage());
}

describe('determinism and drift', () => {
  it('two exports are byte-for-byte identical', async () => {
    const first = renderExport(await buildContentPackage());
    const second = renderExport(await buildContentPackage());
    expect(second.files).toEqual(first.files);
  });

  it('the committed files are exactly what the sources produce (run `npm run content:export`)', async () => {
    const { files } = renderExport(await buildContentPackage());
    for (const [path, text] of Object.entries(files)) {
      expect(existsSync(resolve(repoRoot, path)), `${path} exists`).toBe(true);
      expect(read(path), `${path} is up to date`).toBe(text);
    }
  });

  it('the committed JSON Schema is the one the validator uses', () => {
    expect(read('content/schema/content.schema.json')).toBe(
      canonicalJson(toJsonValue(CONTENT_SCHEMA)),
    );
  });

  it('contains no timestamps or machine-specific paths', async () => {
    const { files } = renderExport(await buildContentPackage());
    for (const [path, text] of Object.entries(files)) {
      expect(text, path).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
      expect(text, path).not.toMatch(/\/home\/|\/Coding\/|[A-Z]:\\\\/);
    }
  });
});

describe('preservation of the existing content', () => {
  it('every exported collection equals its TypeScript source, in authored order', async () => {
    const pkg = await buildContentPackage();
    expect(pkg.adventures).toEqual(clone(ADVENTURE_TEMPLATES));
    expect(pkg.quests).toEqual(clone([...QUEST_DEFINITIONS, ...TREASURE_RUSH_QUESTS]));
    expect(pkg.items).toEqual(clone([...ALL_ITEMS, ...TREASURE_RUSH_ITEMS]));
    expect(pkg.rewardRules).toEqual(clone([...ALL_REWARD_RULES, ...TREASURE_RUSH_REWARD_RULES]));
    expect(pkg.npcs).toEqual(clone(ALL_NPCS));
    expect(pkg.discoveries).toEqual(clone(DISCOVERY_DEFINITIONS));
    expect(pkg.checkpoints).toEqual(clone(ALL_CHECKPOINTS));
    expect(pkg.locations).toEqual(clone(ISLAND_LOCATIONS));
    expect(pkg.stories).toEqual(clone(STORY_DEFINITIONS));
    expect(pkg.skills).toEqual(clone(SKILLS));
    expect(pkg.assets).toEqual(clone(ASSET_MANIFEST));
    expect(pkg.learningObjectives).toEqual(clone(LEARNING_OBJECTIVES));
  });

  it('adds Treasure Rush content to the export only, never to the app registries', () => {
    expect(QUEST_DEFINITIONS.some((quest) => quest.id === 'treasure-rush-cove')).toBe(false);
    expect(ALL_ITEMS.some((item) => item.id === 'golden-doubloon')).toBe(false);
    expect(ALL_REWARD_RULES.some((rule) => rule.id === 'reward-treasure-rush-cove-chest')).toBe(false);
  });

  it('exports the expected number of records', async () => {
    const pkg = await buildContentPackage();
    expect(
      Object.fromEntries(Object.keys(pkg).map((k) => [k, pkg[k as keyof ContentPackage].length])),
    ).toEqual({
      islands: 2,
      locations: 10,
      adventures: 24,
      learningObjectives: 18,
      wonderWallQuestions: 4,
      stories: 5,
      quests: 7,
      items: 20,
      collectibleSets: 1,
      rewardRules: 15,
      npcs: 6,
      discoveries: 6,
      checkpoints: 30,
      interactions: 8,
      subjects: 2,
      grades: 3,
      domains: 6,
      skills: 10,
      assets: 114,
      locationAssets: 6,
    });
  });

  it('keeps stable identifiers and does not rename anything', async () => {
    const pkg = await buildContentPackage();
    expect(pkg.adventures.map((a) => a.slug)).toEqual(ADVENTURE_TEMPLATES.map((a) => a.slug));
    expect(pkg.adventures.map((a) => a.slug)).toContain('repair-the-moonlight-bridge');
    expect(pkg.islands.map((i) => i.slug)).toEqual(WORLD_DEFINITIONS.map((w) => w.slug));
  });

  it('keeps representative gameplay rules exactly', async () => {
    const pkg = await buildContentPackage();
    const bridge = pkg.adventures.find((a) => a.slug === 'repair-the-moonlight-bridge');
    const source = ADVENTURE_TEMPLATES.find((a) => a.slug === 'repair-the-moonlight-bridge');
    expect(bridge?.ageBands).toEqual(source?.ageBands);
    expect(bridge?.steps).toEqual(clone(source?.steps));
    expect(bridge?.steps.filter((s) => s.hintPolicy).map((s) => s.hintPolicy?.ladder)).toEqual(
      source?.steps.filter((s) => s.hintPolicy).map((s) => s.hintPolicy?.ladder),
    );
    const cove = pkg.islands.find((i) => i.slug === 'creature-care-cove');
    expect(cove?.travelRequirement?.anyOfChangeKeys).toEqual(['BRIDGE_REPAIRED', 'TIDE_GATE_SET']);
    expect(pkg.locations.find((l) => l.slug === 'dragons-sanctuary')?.unlockRequirement).toEqual({
      changeKey: 'DRAGON_OF_EMBER_MOUNTAIN_COMPLETE',
    });
  });

  it('leaves 2D and 3D spatial data in its original coordinate system', async () => {
    const pkg = await buildContentPackage();
    expect(pkg.checkpoints).toEqual(clone(ALL_CHECKPOINTS)); // meters and radians, untouched
    expect(Object.keys(pkg)).not.toContain('zones'); // pixel zones are not exported (documented gap)
  });
});

describe('START_STORY interaction action', () => {
  const schema = schemaForFile('interactions.json');
  const fileWith = async (action: unknown) => {
    const pkg = await freshPackage();
    const region = clone(pkg.interactions[0]!);
    (region.interactions[0] as unknown as { action: unknown }).action = action;
    return { schemaVersion: SCHEMA_VERSION, interactions: [region] };
  };

  it('is exported with its story slug, exactly as authored', async () => {
    const pkg = await freshPackage();
    const found = pkg.interactions
      .flatMap((r) => r.interactions)
      .filter((i) => i.action.kind === 'START_STORY');
    expect(found.map((i) => i.action)).toEqual([
      { kind: 'START_STORY', storySlug: 'the-castles-secret-door' },
    ]);
  });

  it('validates a well-formed action', async () => {
    expect(validate(await fileWith({ kind: 'START_STORY', storySlug: 'x' }), schema)).toEqual([]);
  });

  it.each([
    ['a missing storySlug', { kind: 'START_STORY' }],
    ['an empty storySlug', { kind: 'START_STORY', storySlug: '' }],
    ['a non-string storySlug', { kind: 'START_STORY', storySlug: 4 }],
    ['an extra property', { kind: 'START_STORY', storySlug: 'x', chapterId: 'c' }],
    ['a wrong-case kind', { kind: 'start_story', storySlug: 'x' }],
  ])('rejects %s', async (_name, action) => {
    expect(validate(await fileWith(action), schema).length).toBeGreaterThan(0);
  });

  it('still validates every pre-existing action variant', async () => {
    for (const action of [
      { kind: 'NAVIGATE', to: 'world' },
      { kind: 'SHOW_MESSAGE', message: 'hi' },
      { kind: 'START_ADVENTURE', locationSlug: 'a', templateSlug: 'b' },
      { kind: 'DISCOVER', discoveryId: 'd' },
      { kind: 'TALK_TO', npcId: 'n' },
    ]) {
      expect(validate(await fileWith(action), schema), JSON.stringify(action)).toEqual([]);
    }
  });
});

describe('merged Clockwork Harbor and Wonderwild content', () => {
  it('registers the harbor master and Professor Ticktock with stable ids', async () => {
    const pkg = await freshPackage();
    const ids = pkg.npcs.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(['harbor-master', 'professor-ticktock']));
    expect(pkg.quests.find((q) => q.id === 'light-the-harbor')?.giverNpcId).toBe('harbor-master');
  });

  it('exports wonderwild-hive checkpoints and records it as a passage region, not a location', async () => {
    const pkg = await freshPackage();
    expect(pkg.checkpoints.filter((c) => c.regionId === 'wonderwild-hive')).toHaveLength(2);
    expect(pkg.locations.some((l) => l.slug === 'wonderwild-hive')).toBe(false);
  });
});

describe('integrity checks on the real content', () => {
  it('finds no errors and records the known ambiguities', async () => {
    const report = checkIntegrity(await freshPackage());
    expect(report.errors).toEqual([]);
    expect(report.ambiguities.map((a) => a.kind)).toEqual([
      'adventure-location-without-record',
      'adventure-passage-region',
      'npc-interaction-without-record',
      'region-without-location-record',
      'story-location-without-record',
    ]);
    const byKind = (kind: string) => report.ambiguities.find((a) => a.kind === kind)?.ids;
    expect(byKind('region-without-location-record')).toEqual(['welcome-harbor']);
    expect(byKind('adventure-passage-region')).toEqual(['wonderwild-hive']);
    expect(byKind('npc-interaction-without-record')).toEqual([
      'harbor-master',
      'professor-ticktock',
    ]);
  });
});

describe('integrity checks catch problems (mutated copies)', () => {
  const cases: Array<[string, (pkg: ContentPackage) => void, RegExp]> = [
    [
      'a duplicate adventure id',
      (p) => void p.adventures.push(clone(p.adventures[0]!)),
      /duplicate id/,
    ],
    [
      'a missing entry step',
      (p) => void (p.adventures[0]!.entryStepId = 'nope'),
      /unknown entry step/,
    ],
    [
      'a dangling transition',
      (p) => void (p.adventures[0]!.steps[0]!.transitions[0]!.nextStepId = 'ghost'),
      /unknown next step "ghost"/,
    ],
    [
      'an unknown learning objective',
      (p) => void (p.adventures[0]!.steps[0]!.objectiveIds = ['zz']),
      /unknown learning objective/,
    ],
    [
      'an unknown reward item',
      (p) => void (p.rewardRules[0]!.itemIds = ['ghost-item']),
      /unknown item "ghost-item"/,
    ],
    [
      'an unknown quest giver',
      (p) => void (p.quests[0]!.giverNpcId = 'ghost-npc'),
      /unknown giver npc/,
    ],
    [
      'an unknown NPC interaction',
      (p) => void (p.npcs[0]!.interactionId = 'ghost'),
      /unknown interaction/,
    ],
    [
      'a location asset that is not in the asset manifest',
      (p) => void p.locationAssets[0]!.assetIds.push('ghost-asset'),
      /location assets ".+": unknown asset "ghost-asset"/,
    ],
    [
      'location assets for a region that does not exist',
      (p) => void (p.locationAssets[0]!.regionSlug = 'ghost-region'),
      /location assets "ghost-region": unknown region "ghost-region"/,
    ],
    [
      'the same asset listed twice for one location',
      (p) => void p.locationAssets[0]!.assetIds.push(p.locationAssets[0]!.assetIds[0]!),
      /duplicate asset/,
    ],
    [
      'an unknown region id (only listed passage regions are accepted)',
      (p) => void (p.checkpoints[0]!.regionId = 'wonderwild-hives'),
      /unknown region "wonderwild-hives"/,
    ],
    [
      'an NPC interaction that does not resolve outside Clockwork Harbor',
      (p) => void (p.npcs.find((n) => n.id === 'pirate-pip')!.interactionId = 'ghost'),
      /unknown interaction "ghost"/,
    ],
    [
      'a START_STORY action naming an unknown story',
      (p) =>
        void (p.interactions
          .flatMap((r) => r.interactions)
          .find((i) => i.action.kind === 'START_STORY')!.action = {
          kind: 'START_STORY',
          storySlug: 'ghost-story',
        }),
      /unknown story "ghost-story"/,
    ],
    [
      'an unknown island for a location',
      (p) => void (p.locations[0]!.worldSlug = 'ghost-island'),
      /unknown island/,
    ],
    [
      'an unknown skill prerequisite',
      (p) => void (p.skills[0]!.prerequisiteSkillIds = ['ghost']),
      /unknown prerequisite/,
    ],
    [
      'an unknown navigation target',
      (p) =>
        void (p.interactions[0]!.interactions.find((i) => i.action.kind === 'NAVIGATE')!.action = {
          kind: 'NAVIGATE',
          to: 'locations/ghost',
        }),
      /unknown location "ghost"/,
    ],
  ];
  for (const [name, mutate, expected] of cases) {
    it(`reports ${name}`, async () => {
      const pkg = await freshPackage();
      mutate(pkg);
      expect(checkIntegrity(pkg).errors.join('\n')).toMatch(expected);
    });
  }

  it('fails the whole export, listing every problem, instead of dropping records', async () => {
    const pkg = await freshPackage();
    pkg.quests[0]!.giverNpcId = 'ghost-npc';
    pkg.rewardRules[0]!.itemIds = ['ghost-item'];
    expect(() => renderExport(pkg)).toThrow(ContentExportError);
    try {
      renderExport(pkg);
    } catch (error) {
      expect((error as ContentExportError).problems.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('strict conversion', () => {
  it.each([
    ['a function', () => () => 1, /function/],
    ['a Date', () => new Date(0), /plain objects/],
    ['a Map', () => new Map(), /plain objects/],
    ['NaN', () => Number.NaN, /non-finite/],
    ['undefined in an array', () => [1, undefined], /undefined/],
    ['a symbol', () => Symbol('x'), /symbol/],
    ['a class instance', () => new (class Thing {})(), /plain objects/],
  ])('rejects %s and names where it was', (_name, make, message) => {
    expect(() => toJsonValue({ a: { b: make() } })).toThrow(UnsupportedContentError);
    expect(() => toJsonValue({ a: { b: make() } })).toThrow(message);
    expect(() => toJsonValue({ a: { b: make() } })).toThrow(/\$\.a\.b/);
  });

  it('omits optional (undefined) properties and sorts keys', () => {
    expect(canonicalJson(toJsonValue({ b: 1, a: undefined, c: [2] }))).toBe(
      '{\n  "b": 1,\n  "c": [\n    2\n  ]\n}\n',
    );
  });

  it('refuses unsupported content when building a file', async () => {
    const pkg = await freshPackage();
    (pkg.items[0] as unknown as Record<string, unknown>).onCollect = () => undefined;
    expect(() => renderExport(pkg)).toThrow(UnsupportedContentError);
  });
});

describe('schema validation', () => {
  const adventuresFile = async () => {
    const pkg = await freshPackage();
    return {
      schemaVersion: SCHEMA_VERSION,
      adventures: pkg.adventures,
      learningObjectives: pkg.learningObjectives,
      wonderWallQuestions: pkg.wonderWallQuestions,
    };
  };
  const schema = schemaForFile('adventures.json');

  it('accepts the real file', async () => {
    expect(validate(await adventuresFile(), schema)).toEqual([]);
  });

  it('rejects an unexpected property (closed objects)', async () => {
    const file = await adventuresFile();
    (file.adventures[0] as unknown as Record<string, unknown>).newField = 1;
    expect(validate(file, schema).join('\n')).toMatch(/unexpected property "newField"/);
  });

  it('rejects a missing required field, a wrong type, and a bad enum', async () => {
    const file = await adventuresFile();
    delete (file.adventures[0] as unknown as Record<string, unknown>).title;
    (file.adventures[1] as unknown as Record<string, unknown>).version = '2';
    file.adventures[2]!.ageBands = ['TEEN' as never];
    const errors = validate(file, schema).join('\n');
    expect(errors).toMatch(/missing required "title"/);
    expect(errors).toMatch(/version: expected integer/);
    expect(errors).toMatch(/ageBands\[0\]: not one of/);
  });

  it('rejects a presentation that matches no variant, and a wrong schemaVersion', async () => {
    const file = await adventuresFile();
    file.adventures[0]!.steps[0]!.presentation = { kind: 'hologram' } as never;
    expect(validate(file, schema).join('\n')).toMatch(/matches 0 variants/);
    expect(validate({ ...(await adventuresFile()), schemaVersion: 1 }, schema).join('\n')).toMatch(
      new RegExp(`expected ${SCHEMA_VERSION}`),
    );
  });

  it('keeps skillDomain and skillLevel on the incoming adventures and accepts adventures without them', async () => {
    const file = await adventuresFile();
    const levelled = file.adventures.filter((a) => a.skillLevel !== undefined);
    expect(levelled.length).toBeGreaterThanOrEqual(3);
    expect(levelled.every((a) => a.skillDomain === 'math')).toBe(true);
    expect(file.adventures.some((a) => a.skillLevel === undefined)).toBe(true);
    expect(validate(file, schema)).toEqual([]);
  });

  it('rejects an unknown skillDomain, an out-of-range or fractional skillLevel', async () => {
    const file = await adventuresFile();
    const target = file.adventures[0] as unknown as Record<string, unknown>;
    for (const [domain, level, expected] of [
      ['cooking', 1, /skillDomain: not one of/],
      ['math', 0, /skillLevel: below 1/],
      ['math', 7, /skillLevel: above 6/],
      ['math', 2.5, /skillLevel: expected integer/],
    ] as const) {
      target.skillDomain = domain;
      target.skillLevel = level;
      expect(validate(file, schema).join('\n')).toMatch(expected);
    }
  });

  it('every file in the layout has a schema and validates', async () => {
    const { files } = renderExport(await buildContentPackage());
    for (const name of Object.keys(FILE_LAYOUT)) {
      const json = JSON.parse(files[`content/exported/${name}`] as string);
      expect(validate(json, schemaForFile(name as keyof typeof FILE_LAYOUT)), name).toEqual([]);
    }
  });

  it('the manifest lists every file with a digest and counts, and has no timestamp', async () => {
    const { files } = renderExport(await buildContentPackage());
    const manifest = JSON.parse(files['content/exported/manifest.json'] as string);
    expect(manifest.files.map((f: { path: string }) => f.path)).toEqual(Object.keys(FILE_LAYOUT));
    expect(manifest.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(manifest)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(validate(manifest, schemaForFile('manifest.json'))).toEqual([]);
  });
});

describe('trusted build-time boundary', () => {
  const forbidden =
    /^(react|react-dom|react-router-dom|aws-amplify|aws-amplify\/.*|three|three\/.*|phaser|@aws-sdk\/.*|@aws-amplify\/.*)$/;
  const specifiers = (source: string) =>
    [...source.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1] as string);

  function reachable(entry: string): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (graph.has(file)) continue;
      const specs = specifiers(readFileSync(file, 'utf-8'));
      graph.set(file, specs);
      for (const spec of specs) {
        if (!spec.startsWith('.')) continue;
        const base = resolve(dirname(file), spec);
        const next = [`${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')].find(existsSync);
        if (next) queue.push(next);
      }
    }
    return graph;
  }

  it('the content modules never reach React, Amplify, Three.js, Phaser, or an api module', () => {
    const graph = reachable(resolve(here, 'build.ts'));
    expect(graph.size).toBeGreaterThan(30);
    for (const [file, specs] of graph) {
      for (const spec of specs) {
        expect(forbidden.test(spec), `${file} imports ${spec}`).toBe(false);
        expect(/(^|\/)(api|data-client)$/.test(spec), `${file} imports ${spec}`).toBe(false);
      }
    }
  });

  it('runs in plain Node with no AWS credentials, no browser, and no network need', () => {
    const tsx = resolve(repoRoot, 'node_modules/.bin/tsx');
    const output = execFileSync(tsx, [resolve(repoRoot, 'scripts/export-content.ts'), '--check'], {
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    expect(output).toMatch(/up to date/);
  }, 60_000);
});
