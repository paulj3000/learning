import { readdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { SPA_REWRITE_FUNCTION } from './frontendStack';

/**
 * The CloudFront SPA rewrite that serves the React app (FrontendStack). It replaced the Amplify
 * Hosting rewrite (amplify-hosting/custom-rules.json, retired in AMP-08); these are the same
 * client routes that rule was tested with, plus the Realm Explorer and 3D Area routes, so a
 * direct link or a reload on any app URL gets the app, and real files are served as themselves.
 * `/api/*` never reaches this function: it is its own cache behaviour to the Django origin
 * (frontendStack.test.ts).
 */

const repoRoot = resolve(__dirname, '../..');

function rewrite(uri: string): string {
  const handler = runInNewContext(`${SPA_REWRITE_FUNCTION}; handler`) as (event: {
    request: { uri: string };
  }) => { uri: string };
  return handler({ request: { uri } }).uri;
}

function publicExtensions(dir: string): Set<string> {
  const found = new Set<string>();
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) found.add(extname(entry.name).slice(1).toLowerCase());
  }
  return found;
}

describe('CloudFront SPA rewrite', () => {
  it.each([
    '/',
    '/sign-in',
    '/confirm',
    '/forgot-password',
    '/home/children/new',
    '/home/children/3f2a9c1e-0b7d-4c55-9a51-2d8e6f0b1c44/dashboard',
    '/island/3f2a9c1e-0b7d-4c55-9a51-2d8e6f0b1c44/realms',
    '/island/3f2a9c1e-0b7d-4c55-9a51-2d8e6f0b1c44/realms/learning-adventure-island',
    '/island/3f2a9c1e-0b7d-4c55-9a51-2d8e6f0b1c44/explore/treasure-rush-cove',
    '/island/3f2a9c1e-0b7d-4c55-9a51-2d8e6f0b1c44/world/storykeeper-castle',
    '/island/abc/locations/pirate-builder-bay/adventures/repair-the-moonlight-bridge',
    '/admin/adventures/new',
  ])('serves the app for the client route %s', (path) => {
    expect(rewrite(path)).toBe('/index.html');
  });

  it.each(['/assets/index-B1x2c3.js', '/assets/index-B1x2c3.css', '/assets/index-B1x2c3.js.map'])(
    'serves the Vite build file %s as itself',
    (path) => {
      expect(rewrite(path)).toBe(path);
    },
  );

  it('serves every file type in react/public as itself', () => {
    const extensions = publicExtensions(resolve(repoRoot, 'react/public'));
    expect(extensions.size).toBeGreaterThan(0);
    for (const ext of extensions) {
      const path = `/models/some/file.${ext}`;
      expect(rewrite(path), ext).toBe(path);
    }
  });

  it("gives the game runtime's routes their own shell", () => {
    expect(rewrite('/game/play/abc')).toBe('/game/index.html');
  });
});
