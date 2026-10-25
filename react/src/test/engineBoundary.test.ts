import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkEngineBoundary,
  formatViolation,
  isEngineFile,
  KNOWN_VIOLATIONS,
  type KnownViolation,
} from './engineBoundary';

/**
 * LAI-0203. The fixtures are small `src/` trees, so each rule is shown failing on its own;
 * the last block runs the same check over the real tree, which is the guard itself.
 */

const ENGINE = 'features/island-map/three/engine.ts';
const roots: string[] = [];

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'engine-boundary-'));
  roots.push(root);
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** The violations for an engine file with this source, as readable lines. */
function violationsFor(
  engineSource: string,
  extra: Record<string, string> = {},
  known: KnownViolation[] = [],
) {
  const report = checkEngineBoundary(tree({ [ENGINE]: engineSource, ...extra }), known);
  return report.violations.map(formatViolation);
}

describe('engine boundary: what is an engine file', () => {
  it('covers three/ and scenes/ .ts modules and the 2D geometry modules only', () => {
    expect(isEngineFile('features/island-map/three/sceneKit.ts')).toBe(true);
    expect(isEngineFile('features/island-map/three/runtime/createLocationEngine.ts')).toBe(true);
    expect(isEngineFile('features/island-map/scenes/LocationScene.ts')).toBe(true);
    expect(isEngineFile('features/island-map/tilemap.ts')).toBe(true);
    expect(isEngineFile('features/island-map/pirateBuilderBayZones.ts')).toBe(true);
    expect(isEngineFile('features/island-map/storykeeperCastleDecor.ts')).toBe(true);
  });

  it('leaves React hosts, tests and the rest of the app alone', () => {
    expect(isEngineFile('features/island-map/three/runtime/ThreeLocationWorldView.tsx')).toBe(
      false,
    );
    expect(isEngineFile('features/island-map/three/sceneKit.test.ts')).toBe(false);
    expect(isEngineFile('features/island-map/IslandWorldView.tsx')).toBe(false);
    expect(isEngineFile('features/island-map/useExplorableWorld.ts')).toBe(false);
    expect(isEngineFile('features/adventures/api.ts')).toBe(false);
  });

  it('does not check React host code that imports React', () => {
    const root = tree({
      [ENGINE]: "import { Group } from 'three';",
      'features/island-map/three/HostView.tsx': "import { useState } from 'react';",
      'features/island-map/useExplorableWorld.ts':
        "import { client } from '../../lib/data-client';",
      'lib/data-client.ts': 'export const client = {};',
    });
    expect(checkEngineBoundary(root, []).violations).toEqual([]);
  });
});

describe('engine boundary: allowed imports', () => {
  it('permits Three.js, its examples, sibling engine modules and plain content', () => {
    expect(
      violationsFor(
        [
          "import { Group, type Object3D } from 'three';",
          "import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';",
          "import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';",
          "import { helper } from './helper';",
          "import { CHECKPOINTS } from '../../discovery/checkpoints';",
        ].join('\n'),
        {
          'features/island-map/three/helper.ts': "export { Vector3 as helper } from 'three';",
          'features/discovery/checkpoints.ts': 'export const CHECKPOINTS = [];',
        },
      ),
    ).toEqual([]);
  });

  it('permits Phaser in the legacy scenes only', () => {
    const root = tree({
      'features/island-map/scenes/OldScene.ts': "import Phaser from 'phaser';",
      [ENGINE]: "import Phaser from 'phaser';",
    });
    const lines = checkEngineBoundary(root, []).violations.map(formatViolation);
    expect(lines).toEqual([expect.stringContaining(`${ENGINE} -> 'phaser'`)]);
  });

  it('permits the test runner only in the named test-support files', () => {
    const root = tree({
      'features/island-map/three/runtime/testing/engineHarness.ts': "import { vi } from 'vitest';",
      [ENGINE]: "import { vi } from 'vitest';",
    });
    const lines = checkEngineBoundary(root, []).violations.map(formatViolation);
    expect(lines).toEqual([expect.stringContaining(`${ENGINE} -> 'vitest'`)]);
  });
});

describe('engine boundary: rejected imports', () => {
  it.each([
    ["import { useEffect } from 'react';", 'react'],
    ["import type { ComponentType } from 'react';", 'react'],
    ["import { jsx } from 'react/jsx-runtime';", 'react/jsx-runtime'],
    ["import { createRoot } from 'react-dom/client';", 'react-dom/client'],
    ["import { useNavigate } from 'react-router-dom';", 'react-router-dom'],
    ["export { useState } from 'react';", 'react'],
    ["const react = await import('react');", 'react'],
  ])('rejects React and routing: %s', (source, specifier) => {
    expect(violationsFor(source)).toEqual([
      expect.stringMatching(new RegExp(`'${specifier}': React, React DOM and React Router`)),
    ]);
  });

  it.each([
    ["import { generateClient } from 'aws-amplify/data';"],
    ["import { Amplify } from 'aws-amplify';"],
    ["import 'aws-amplify';"],
    ["import { Authenticator } from '@aws-amplify/ui-react';"],
    ["import { S3Client } from '@aws-sdk/client-s3';"],
  ])('rejects Amplify and AWS SDKs: %s', (source) => {
    expect(violationsFor(source)).toEqual([expect.stringContaining('Amplify and AWS SDKs')]);
  });

  it('rejects the Amplify data client and the generated Amplify schema', () => {
    const lines = violationsFor(
      [
        "import { client } from '../../../lib/data-client';",
        "import type { Schema } from '../../../../../amplify/data/resource';",
      ].join('\n'),
      { 'lib/data-client.ts': 'export const client = {};' },
    );
    expect(lines).toEqual([
      expect.stringContaining('the Amplify data client'),
      expect.stringContaining('outside the React app'),
    ]);
  });

  it('rejects backend and AI clients: feature api modules, the future Django api/, lib/ai', () => {
    const lines = violationsFor(
      [
        "import { saveProgress } from '../../adventures/api';",
        "import { fetchIslands } from '../../../api/catalog';",
        "import { generate } from '../../../lib/ai/generate';",
      ].join('\n'),
      {
        'features/adventures/api.ts': 'export const saveProgress = 1;',
        'api/catalog.ts': 'export const fetchIslands = 1;',
        'lib/ai/generate.ts': 'export const generate = 1;',
      },
    );
    expect(lines).toEqual([
      expect.stringContaining('a feature API module'),
      expect.stringContaining('a backend API client'),
      expect.stringContaining('the AI layer'),
    ]);
  });

  it('rejects routing, app shell, auth, session, UI components and React modules', () => {
    const lines = violationsFor(
      [
        "import { AppRoutes } from '../../../app/AppRoutes';",
        "import { Home } from '../../../routes/Home';",
        "import { useAuth } from '../../auth/AuthContext';",
        "import { limits } from '../../session/limits';",
        "import { Button } from '../../../components/ui/button';",
        "import { Hud } from './WorldHud';",
      ].join('\n'),
      {
        'app/AppRoutes.tsx': 'export const AppRoutes = 1;',
        'routes/Home.tsx': 'export const Home = 1;',
        'features/auth/AuthContext.tsx': 'export const useAuth = 1;',
        'features/session/limits.ts': 'export const limits = 1;',
        'components/ui/button.tsx': 'export const Button = 1;',
        'features/island-map/three/WorldHud.tsx': 'export const Hud = 1;',
      },
    );
    expect(lines).toEqual([
      expect.stringContaining('routing and the app shell'),
      expect.stringContaining('routing and the app shell'),
      expect.stringContaining('application authentication or session state'),
      expect.stringContaining('application authentication or session state'),
      expect.stringContaining('application UI components'),
      expect.stringContaining('a React module'),
    ]);
  });
});

describe('engine boundary: no bypasses', () => {
  const dataClient = { 'lib/data-client.ts': 'export const client = {};' };

  it.each([
    ['a redundant relative path', "import { client } from '../../../lib/../lib/data-client';"],
    ['a .js extension', "import { client } from '../../../lib/data-client.js';"],
    ['a .ts extension', "import { client } from '../../../lib/data-client.ts';"],
    ['a dynamic import', "const m = await import('../../../lib/data-client');"],
    ['a type-position import', "type C = import('../../../lib/data-client').Client;"],
    ['a re-export', "export * from '../../../lib/data-client';"],
  ])('resolves relative imports: %s', (_label, source) => {
    expect(violationsFor(source, dataClient)).toEqual([
      expect.stringContaining('the Amplify data client'),
    ]);
  });

  it('resolves a directory import to its index file', () => {
    expect(
      violationsFor("import { x } from '../../../api';", { 'api/index.ts': 'export const x = 1;' }),
    ).toEqual([expect.stringContaining('a backend API client')]);
  });

  it.each([
    ["import { client } from '@/lib/data-client';", '@/lib/data-client'],
    ["import { client } from '~/lib/data-client';", '~/lib/data-client'],
    ["import { client } from 'src/lib/data-client';", 'src/lib/data-client'],
  ])('rejects aliased and bare-path imports, failing closed: %s', (source, specifier) => {
    expect(violationsFor(source, dataClient)).toEqual([
      expect.stringContaining(`'${specifier}': package is not on the engine allowlist`),
    ]);
  });

  it('follows non-engine modules transitively, so a re-exporting module cannot launder a client', () => {
    const lines = violationsFor("import { WORLDS } from '../../worlds/worlds';", {
      'features/worlds/worlds.ts': "export { WORLDS } from './registry';",
      'features/worlds/registry.ts': "export { client as WORLDS } from '../../lib/data-client';",
      ...dataClient,
    });
    expect(lines).toEqual([
      `${ENGINE} -> '../../worlds/worlds' => features/worlds/worlds.ts -> './registry' => ` +
        "features/worlds/registry.ts -> '../../lib/data-client': the Amplify data client",
    ]);
  });

  it('catches React reached through a content module', () => {
    expect(
      violationsFor("import { copy } from '../../story/content';", {
        'features/story/content.ts': "import { memo } from 'react'; export const copy = memo;",
      }),
    ).toEqual([expect.stringContaining("features/story/content.ts -> 'react'")]);
  });

  it('survives an import cycle', () => {
    expect(
      violationsFor("import { a } from './a';", {
        'features/island-map/three/a.ts': "import { b } from './b'; export const a = 1;",
        'features/island-map/three/b.ts': "import { a } from './a'; export const b = 1;",
      }),
    ).toEqual([]);
  });
});

describe('engine boundary: known violations', () => {
  const entry: KnownViolation = {
    file: ENGINE,
    specifier: 'react',
    reason: 'fixture',
    removedBy: 'LAI-2102',
  };

  it('accepts exactly the recorded file and specifier, and nothing else in that file', () => {
    const lines = violationsFor(
      ["import { useEffect } from 'react';", "import { Amplify } from 'aws-amplify';"].join('\n'),
      {},
      [entry],
    );
    expect(lines).toEqual([expect.stringContaining("'aws-amplify'")]);
  });

  it('reports an entry that is no longer needed, so the list can only shrink', () => {
    const report = checkEngineBoundary(tree({ [ENGINE]: "import { Group } from 'three';" }), [
      entry,
    ]);
    expect(report.violations).toEqual([]);
    expect(report.staleKnownViolations).toEqual([entry]);
  });

  it('has no known violations left: React host code is .tsx, outside the engine', () => {
    expect(KNOWN_VIOLATIONS).toEqual([]);
  });
});

describe('engine boundary: the real tree', () => {
  const report = checkEngineBoundary(resolve(process.cwd(), 'src'));

  it('finds the engine files it is meant to guard', () => {
    expect(report.engineFiles).toContain('features/island-map/three/assets/assetLoader.ts');
    expect(report.engineFiles).toContain(
      'features/island-map/three/runtime/createLocationEngine.ts',
    );
    expect(report.engineFiles).toContain('features/island-map/scenes/LocationScene.ts');
    expect(report.engineFiles).toContain('features/island-map/gridGeometry.ts');
    expect(report.engineFiles.length).toBeGreaterThan(50);
  });

  it('has no engine import that reaches React, Amplify, a backend client, routing, auth or UI', () => {
    expect(report.violations.map(formatViolation)).toEqual([]);
  });

  it('has no stale known violation', () => {
    expect(report.staleKnownViolations).toEqual([]);
  });
});
