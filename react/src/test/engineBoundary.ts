import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

/**
 * LAI-0203: the interim engine import boundary (docs/THREEJS_ENGINE_CONVERSION.md section
 * 4.1, ADR-020). The engine renders state it is given and emits typed events; it must not
 * reach the backend, the AI layer, routing, auth, or React UI. LAI-2101 replaces this with
 * the same rule applied to `game/` once the engine is extracted.
 *
 * Engine files are the `.ts` modules of `features/island-map/three/` and
 * `features/island-map/scenes/` plus the 2D geometry modules beside them. `.tsx` files in
 * those folders are the React hosts the engine is mounted by, so they are not engine files,
 * and an engine file may not import one.
 *
 * Packages are deny by default: only the allowlist below may be imported, so a new alias
 * (`@/lib/...`) or an alternative entry point (`react/jsx-runtime`, `aws-amplify/data`)
 * cannot slip through. Local imports are resolved to real files and followed transitively
 * through non-engine modules (content, shared types), so re-exporting a forbidden module
 * through an innocent-looking file is caught too. Every import form counts: static,
 * type-only, re-export, side-effect, `require`, and dynamic `import()`.
 *
 * Pure apart from reading files: `root` is the `react/src` directory, so a test can point
 * it at a fixture tree.
 */

export interface BoundaryViolation {
  /** The engine file whose import graph reaches the forbidden module, relative to `root`. */
  engineFile: string;
  /** Each file and the specifier it used, from the engine file to the offending import. */
  chain: { file: string; specifier: string }[];
  reason: string;
}

/** An import edge that is a known violation, recorded with why and which task removes it. */
export interface KnownViolation {
  file: string;
  specifier: string;
  reason: string;
  removedBy: string;
}

/**
 * Existing violations, each one file and one specifier, never a directory. All are React
 * host code that predates the boundary and is filed among engine modules; LAI-2102 moves
 * them out when it splits the pure runtime from its React hosts. The guard fails if an
 * entry stops being needed, so this list can only shrink.
 *
 * An entry tolerates exactly that one import edge wherever the graph reaches it, and the
 * edge is not followed. Everything else reachable from the same files is still checked, so
 * a backend, AI, routing or auth import added anywhere behind them still fails. Every entry
 * is a React edge: none of them reaches the backend.
 *
 * The view-extension entries matter most. `extensions/index.ts` builds both registries, so
 * `createLocationEngine.ts` reaches the extensions' React overlays through it today.
 */
export const KNOWN_VIOLATIONS: readonly KnownViolation[] = [
  {
    file: 'features/island-map/three/extensions/index.ts',
    specifier: './multiplayerPresence/multiplayerPresenceViewExtension',
    reason: 'The extensions index also builds the React view registry (`SOURCE_VIEW_EXTENSIONS`).',
    removedBy: 'LAI-2102',
  },
  {
    file: 'features/island-map/three/extensions/tideTrial/tideTrialViewExtension.ts',
    specifier: './TideTrialOverlay',
    reason: "A view extension: registers the tide trial's React overlay.",
    removedBy: 'LAI-2102',
  },
  {
    file: 'features/island-map/three/extensions/castleTale/castleTaleViewExtension.ts',
    specifier: './CastleTaleCompanion',
    reason: "A view extension: registers the castle tale's React companion.",
    removedBy: 'LAI-2102',
  },
  {
    file: 'features/island-map/three/extensions/adaptiveAdventureEntrance/adaptiveAdventureEntranceViewExtension.ts',
    specifier: './AdaptiveAdventureEntranceOverlay',
    reason: "A view extension: registers the adaptive entrance's React overlay.",
    removedBy: 'LAI-2102',
  },
  {
    file: 'features/island-map/three/npcApproachBridge.ts',
    specifier: 'react',
    reason: 'A React hook (`useEffect`) bridging engine events into a view.',
    removedBy: 'LAI-2102',
  },
  {
    file: 'features/island-map/three/runtime/viewExtensionRegistry.ts',
    specifier: 'react',
    reason: "The registry of extensions' React views (`ComponentType`), used by the React host.",
    removedBy: 'LAI-2102',
  },
];

const ISLAND_MAP = 'features/island-map';
const GEOMETRY_MODULE =
  /^features\/island-map\/(gridGeometry|tilemap|zones|decor|[a-zA-Z]+(Tilemap|Zones|Decor))\.ts$/;

/** Is `path` (relative to `root`, posix separators) an engine file? */
export function isEngineFile(path: string): boolean {
  if (!path.endsWith('.ts') || path.endsWith('.test.ts')) return false;
  return (
    path.startsWith(`${ISLAND_MAP}/three/`) ||
    path.startsWith(`${ISLAND_MAP}/scenes/`) ||
    GEOMETRY_MODULE.test(path)
  );
}

/** Explicit test-support files that may import the test runner. Files, not folders. */
const TEST_SUPPORT_FILES = new Set([
  'features/island-map/three/runtime/testing/engineHarness.ts',
  'features/island-map/three/runtime/testing/testExplorerCove.ts',
]);

function packageVerdict(specifier: string, importer: string): string | null {
  if (specifier === 'three' || specifier.startsWith('three/')) return null;
  if (specifier === 'phaser') {
    // The legacy 2D scenes only; ADR-020 allows no Phaser in the Three.js engine.
    return importer.startsWith(`${ISLAND_MAP}/scenes/`)
      ? null
      : 'Phaser is legacy 2D; only `scenes/` may import it (ADR-020)';
  }
  if (specifier === 'vitest' && TEST_SUPPORT_FILES.has(importer)) return null;
  if (/^react(-dom|-router(-dom)?)?(\/|$)/.test(specifier)) {
    return 'React, React DOM and React Router belong to the host application';
  }
  if (/^(aws-amplify|@aws-amplify\/|@aws-sdk\/)/.test(specifier)) {
    return 'Amplify and AWS SDKs belong to the platform layer';
  }
  return 'package is not on the engine allowlist (three; phaser in scenes/ only)';
}

/** Local modules the engine may never reach, matched on the path relative to `root`. */
function localVerdict(target: string): string | null {
  if (target.startsWith('../')) {
    return 'outside the React app (amplify/, server/, lai/ or generated clients)';
  }
  if (/^lib\/(data-client|amplify-config)\.ts$/.test(target)) return 'the Amplify data client';
  if (target.startsWith('lib/ai/')) return 'the AI layer; the engine never calls AI';
  if (target.startsWith('api/')) return 'a backend API client';
  if (/(^|\/)api(\.ts|\/)/.test(target) && target.startsWith('features/')) {
    return 'a feature API module (backend access)';
  }
  if (target.startsWith('app/') || target.startsWith('routes/')) return 'routing and the app shell';
  if (target.startsWith('components/')) return 'application UI components';
  if (target.startsWith('features/auth/') || target.startsWith('features/session/')) {
    return 'application authentication or session state';
  }
  if (target.endsWith('.tsx')) return 'a React module (UI, hook or context)';
  return null;
}

const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

/** Resolves a relative specifier to a file under `root` (posix, relative), or null. */
function resolveLocal(root: string, importerAbs: string, specifier: string): string | null {
  const base = resolve(dirname(importerAbs), specifier.replace(/\.js$/, ''));
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = base + suffix;
    if (existsSync(candidate) && statSync(candidate).isFile()) return toKey(root, candidate);
  }
  return toKey(root, base);
}

function toKey(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join(posix.sep);
}

function importsOf(absolute: string): string[] {
  const source = readFileSync(absolute, 'utf8');
  return ts
    .preProcessFile(source, true, true)
    .importedFiles.map((imported) => imported.fileName);
}

function listFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

export interface BoundaryReport {
  engineFiles: string[];
  violations: BoundaryViolation[];
  /** Known violations that no longer occur and should be deleted from the list. */
  staleKnownViolations: KnownViolation[];
}

export function checkEngineBoundary(
  root: string,
  known: readonly KnownViolation[] = KNOWN_VIOLATIONS,
): BoundaryReport {
  const engineFiles = listFiles(join(root, ISLAND_MAP))
    .map((path) => toKey(root, path))
    .filter(isEngineFile)
    .sort();
  const usedKnown = new Set<KnownViolation>();
  const violations: BoundaryViolation[] = [];
  // Each offending import edge is reported once, via the first engine file that reaches it.
  const reported = new Set<string>();

  for (const engineFile of engineFiles) {
    const visited = new Set<string>([engineFile]);
    const queue: { file: string; chain: BoundaryViolation['chain'] }[] = [
      { file: engineFile, chain: [] },
    ];
    while (queue.length > 0) {
      const { file, chain } = queue.shift()!;
      for (const specifier of importsOf(join(root, file))) {
        const step = [...chain, { file, specifier }];
        const local = specifier.startsWith('.');
        const target = local ? resolveLocal(root, join(root, file), specifier) : null;
        const reason = target !== null ? localVerdict(target) : packageVerdict(specifier, file);
        if (reason) {
          const knownEntry = known.find(
            (entry) => entry.file === file && entry.specifier === specifier,
          );
          const edge = `${file}\0${specifier}`;
          if (knownEntry) {
            usedKnown.add(knownEntry);
          } else if (!reported.has(edge)) {
            reported.add(edge);
            violations.push({ engineFile, chain: step, reason });
          }
          continue;
        }
        if (target && !visited.has(target) && existsSync(join(root, target))) {
          visited.add(target);
          queue.push({ file: target, chain: step });
        }
      }
    }
  }

  return {
    engineFiles,
    violations,
    staleKnownViolations: known.filter((entry) => !usedKnown.has(entry)),
  };
}

/** One line per violation, for a readable test failure. */
export function formatViolation(violation: BoundaryViolation): string {
  const path = violation.chain.map(({ file, specifier }) => `${file} -> '${specifier}'`).join(' => ');
  return `${path}: ${violation.reason}`;
}
