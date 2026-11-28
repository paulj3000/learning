import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { SOURCE_LOCATION_MANIFESTS } from '../features/island-map/three/runtime/manifests';

/**
 * Phaser retirement ratchet (ADR-020, ADR-029; Trello #18 and #27; audit in
 * `docs/engineering/game-engine/phaser-retirement-audit.md`).
 *
 * Phaser stays until every world has verified parity, the Sprouts gate (LAI-2303) and the owner's
 * authorization (LAI-2304). Until then this test keeps the Phaser footprint from growing and keeps
 * the audit honest:
 * - the set of files importing `phaser` is exactly the audited inventory (a new importer fails; a
 *   removed one fails until the inventory and the audit are updated in the same change);
 * - Three.js code never imports a Phaser-only module, so deleting Phaser cannot break it;
 * - the routes that still mount a Phaser world are exactly the audited ones;
 * - each world's Three.js replacement, where the audit says one exists, is a registered manifest.
 *
 * It removes nothing and changes no behaviour.
 */

const repo = resolve(__dirname, '../../..');
const CODE = new Set(['.ts', '.tsx', '.mts', '.mjs', '.js']);
const SKIP = new Set(['node_modules', 'dist', 'test-results', 'playwright-report', '.git']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (CODE.has(extname(entry.name))) out.push(path);
  }
  return out;
}

/** Module specifiers in import, export-from, require and dynamic import forms. */
function specifiers(text: string): string[] {
  const found: string[] = [];
  const pattern =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)(['"])([^'"\n]+)\1/gm;
  for (const match of text.matchAll(pattern)) found.push(match[2]);
  return found;
}

const isPhaser = (specifier: string) => specifier === 'phaser' || specifier.startsWith('phaser/');
const relative = (file: string) => file.slice(repo.length + 1);

/** Guard tests that quote Phaser imports as data. */
const QUOTES_PHASER_AS_DATA = /(engineBoundary|phaserRetirement)\.test\.ts$/;

/**
 * Every file that imports `phaser` (audit 2026-11-27, `main` 41ee7320). The eight world views,
 * the shared container and the shared scene base. The eight `scenes/*Scene.ts` subclasses only
 * extend `LocationScene` and need no import of their own.
 */
const PHASER_IMPORTERS = [
  'react/src/features/island-map/BoltsWorkshopWorldView.tsx',
  'react/src/features/island-map/CastleWritingRoomWorldView.tsx',
  'react/src/features/island-map/DragonsSanctuaryWorldView.tsx',
  'react/src/features/island-map/FossilRidgeCampWorldView.tsx',
  'react/src/features/island-map/IslandWorldView.tsx',
  'react/src/features/island-map/PhaserGameContainer.tsx',
  'react/src/features/island-map/PirateBuilderBayWorldView.tsx',
  'react/src/features/island-map/StorykeeperCastleWorldView.tsx',
  'react/src/features/island-map/WonderwildForestWorldView.tsx',
  'react/src/features/island-map/scenes/LocationScene.ts',
];

/** Directories whose code is the Three.js engine or a Three.js host, never Phaser. */
const THREE_DIRS = [
  'game/src',
  'react/src/features/game-engine',
  'react/src/features/island-map/three',
  'react/src/features/region-play',
];

/**
 * Modules that exist only for the Phaser worlds (`docs/THREEJS_ENGINE_CONVERSION.md` section 2.4).
 * Matched against the last path segment of a relative import.
 */
const PHASER_ONLY_DATA_MODULE =
  /^(?:PhaserGameContainer|tilemap|[a-z][A-Za-z]*Tilemap|zones|[a-z][A-Za-z]*Zones|decor|[a-z][A-Za-z]*Decor|gridGeometry|worldEvents|npcs)$/;

function isPhaserOnlyModule(specifier: string): boolean {
  if (!specifier.startsWith('.')) return false;
  if (/(^|\/)scenes\//.test(specifier)) return true;
  // A stylesheet named after a Phaser view (`IslandWorldView.module.css`) goes with that view.
  const last = (specifier.split('/').pop() ?? '').replace(/\.(tsx?|js|module\.css)$/, '');
  return PHASER_VIEW_MODULES.has(last) || PHASER_ONLY_DATA_MODULE.test(last);
}

interface LegacyWorld {
  world: string;
  phaserView: string;
  /** Route path under `/island/:childId/world`; '' is the island overview (Welcome Harbor). */
  phaserRoute: string;
  /** What the Phaser route does today. */
  route: 'mounts-phaser' | 'redirects-to-3d';
  /** The Three.js manifest's region id, or null when no Three.js replacement exists. */
  replacementRegionId: string | null;
}

/** The eight historical Phaser worlds (audit section 3). */
const LEGACY_WORLDS: readonly LegacyWorld[] = [
  {
    world: 'Welcome Harbor',
    phaserView: 'IslandWorldView.tsx',
    phaserRoute: '',
    route: 'mounts-phaser',
    replacementRegionId: 'welcome-harbor',
  },
  {
    world: 'Pirate Builder Bay',
    phaserView: 'PirateBuilderBayWorldView.tsx',
    phaserRoute: '/pirate-builder-bay',
    route: 'mounts-phaser',
    replacementRegionId: 'pirate-builder-bay',
  },
  {
    world: 'Wonderwild Forest',
    phaserView: 'WonderwildForestWorldView.tsx',
    phaserRoute: '/wonderwild-forest',
    route: 'mounts-phaser',
    replacementRegionId: 'wonderwild-forest',
  },
  {
    world: 'Storykeeper Castle',
    phaserView: 'StorykeeperCastleWorldView.tsx',
    phaserRoute: '/storykeeper-castle',
    route: 'mounts-phaser',
    replacementRegionId: 'storykeeper-castle',
  },
  {
    world: "Dragon's Sanctuary",
    phaserView: 'DragonsSanctuaryWorldView.tsx',
    phaserRoute: '/dragons-sanctuary',
    route: 'redirects-to-3d',
    replacementRegionId: 'dragons-sanctuary',
  },
  {
    world: 'Fossil Ridge Camp',
    phaserView: 'FossilRidgeCampWorldView.tsx',
    phaserRoute: '/fossil-ridge-camp',
    route: 'mounts-phaser',
    replacementRegionId: null,
  },
  {
    world: 'Castle Writing Room',
    phaserView: 'CastleWritingRoomWorldView.tsx',
    phaserRoute: '/castle-writing-room',
    route: 'mounts-phaser',
    replacementRegionId: 'castle-writing-room',
  },
  {
    world: "Bolt's Workshop",
    phaserView: 'BoltsWorkshopWorldView.tsx',
    phaserRoute: '/bolts-workshop',
    route: 'mounts-phaser',
    replacementRegionId: null,
  },
];

/** The Phaser world views, as module names (`IslandWorldView`, ...). */
const PHASER_VIEW_MODULES = new Set(
  LEGACY_WORLDS.map((legacy) => legacy.phaserView.replace(/\.tsx$/, '')),
);

/** Each `/island/:childId/world...` route in AppRoutes and the element source that follows it. */
function worldRoutes(): Map<string, string> {
  const text = readFileSync(join(repo, 'react/src/app/AppRoutes.tsx'), 'utf8');
  const routes = new Map<string, string>();
  const pattern = /path="\/island\/:childId\/world([^"]*)"([\s\S]*?)(?=<Route\b|$)/g;
  for (const match of text.matchAll(pattern)) routes.set(match[1], match[2]);
  return routes;
}

describe('Phaser retirement ratchet (ADR-020)', () => {
  it('declares phaser only in the root and react manifests, never in the engine package', () => {
    const declares = (manifest: string) => {
      const json = JSON.parse(readFileSync(join(repo, manifest), 'utf8')) as Record<
        string,
        Record<string, string> | undefined
      >;
      return ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].some(
        (key) => Object.keys(json[key] ?? {}).some(isPhaser),
      );
    };
    expect(declares('game/package.json')).toBe(false);
    // Removal is LAI-2304 (owner approval). Until then both manifests keep it.
    expect(declares('package.json')).toBe(true);
    expect(declares('react/package.json')).toBe(true);
  });

  it('imports phaser only from the audited inventory', () => {
    const importers: string[] = [];
    for (const dir of ['react/src', 'react/e2e', 'game/src', 'server', 'scripts']) {
      for (const file of sourceFiles(join(repo, dir))) {
        if (QUOTES_PHASER_AS_DATA.test(file)) continue;
        if (specifiers(readFileSync(file, 'utf8')).some(isPhaser)) importers.push(relative(file));
      }
    }
    // A new importer is a new Phaser feature, which ADR-020 forbids. A removed importer means a
    // world was retired: update PHASER_IMPORTERS and the audit in the same change.
    expect(importers.sort()).toEqual([...PHASER_IMPORTERS].sort());
  });

  it('keeps every Phaser-only module out of Three.js code', () => {
    const offenders: string[] = [];
    for (const dir of THREE_DIRS) {
      for (const file of sourceFiles(join(repo, dir))) {
        for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
          if (isPhaserOnlyModule(specifier)) offenders.push(`${relative(file)} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('records each legacy world view, route and Three.js replacement as audited', () => {
    const routes = worldRoutes();
    const manifestIds = new Set(SOURCE_LOCATION_MANIFESTS.map((manifest) => manifest.regionId));
    for (const legacy of LEGACY_WORLDS) {
      const view = `react/src/features/island-map/${legacy.phaserView}`;
      expect(existsSync(join(repo, view)), `${legacy.world}: ${view}`).toBe(true);
      expect(PHASER_IMPORTERS, `${legacy.world}: ${view} imports phaser`).toContain(view);

      const element = routes.get(legacy.phaserRoute);
      expect(element, `${legacy.world}: route /world${legacy.phaserRoute}`).toBeDefined();
      const redirects = /<LegacyLocationWorldRedirect\b/.test(element ?? '');
      expect(redirects ? 'redirects-to-3d' : 'mounts-phaser', legacy.world).toBe(legacy.route);

      if (legacy.replacementRegionId === null) {
        expect(
          [...manifestIds].some((id) => legacy.phaserRoute.endsWith(`/${id}`)),
          `${legacy.world} now has a Three.js manifest: record it in LEGACY_WORLDS and the audit`,
        ).toBe(false);
      } else {
        expect(manifestIds.has(legacy.replacementRegionId), legacy.world).toBe(true);
      }
    }
  });

  it('mounts Phaser on exactly the audited world routes', () => {
    const phaserPages = new Set([
      'IslandWorldPage',
      'PirateBuilderBayWorldPage',
      'WonderwildForestWorldPage',
      'StorykeeperCastleWorldPage',
      'FossilRidgeCampWorldPage',
      'CastleWritingRoomWorldPage',
      'BoltsWorkshopWorldPage',
    ]);
    const mounting = [...worldRoutes()]
      .filter(([, element]) => [...phaserPages].some((page) => element.includes(`<${page}`)))
      .map(([path]) => path)
      .sort();
    const expected = LEGACY_WORLDS.filter((legacy) => legacy.route === 'mounts-phaser')
      .map((legacy) => legacy.phaserRoute)
      .sort();
    expect(mounting).toEqual(expected);
  });

  it('tells Phaser-only modules from the Three.js modules that share their names', () => {
    for (const phaserOnly of [
      '../scenes/LocationScene',
      '../../IslandWorldView',
      './PhaserGameContainer',
      '../tilemap',
      '../storykeeperCastleZones',
      '../../wonderwildForestDecor.ts',
      '../worldEvents',
      '../npcs',
      '../IslandWorldView.module.css',
    ]) {
      expect(isPhaserOnlyModule(phaserOnly), phaserOnly).toBe(true);
    }
    for (const shared of [
      './runtime/ThreeLocationWorldView',
      '../ThreeSandboxWorldView',
      './sandboxScene',
      './regionPlayScene',
      '../../worldObjects',
      '../../DiscoveryAction',
      '../WorldView.module.css',
      'phaser',
    ]) {
      expect(isPhaserOnlyModule(shared), shared).toBe(false);
    }
  });

  it('reads specifiers in every import form', () => {
    expect(
      specifiers(
        [
          "import Phaser from 'phaser';",
          "import 'phaser';",
          "export * from 'phaser';",
          "const m = await import('phaser');",
          "require('phaser/src/core');",
        ].join('\n'),
      ).filter(isPhaser),
    ).toHaveLength(5);
  });
});
