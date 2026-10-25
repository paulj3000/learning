import { readFileSync, readdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';

/**
 * The Amplify Hosting SPA rewrite (amplify-hosting/custom-rules.json,
 * docs/platform/AMPLIFY_HOSTING.md). Amplify writes a regex source as
 * `</.../>`; it is evaluated here as a JavaScript RegExp.
 */

interface CustomRule {
  source: string;
  target: string;
  status: string;
}

const repoRoot = resolve(__dirname, '../../..');
const rules = JSON.parse(
  readFileSync(resolve(repoRoot, 'amplify-hosting/custom-rules.json'), 'utf8'),
) as CustomRule[];

function toRegExp(source: string): RegExp {
  const match = /^<\/(.*)\/>$/.exec(source);
  if (!match) throw new Error(`not an Amplify regex source: ${source}`);
  return new RegExp(match[1]);
}

const spaRule = rules[0];
const spaFallback = toRegExp(spaRule.source);

function publicExtensions(dir: string): Set<string> {
  const found = new Set<string>();
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) found.add(extname(entry.name).slice(1).toLowerCase());
  }
  return found;
}

describe('Amplify Hosting SPA rewrite', () => {
  it('is a single 200 rewrite to index.html', () => {
    expect(rules).toHaveLength(1);
    expect(spaRule).toMatchObject({ target: '/index.html', status: '200' });
  });

  it.each([
    '/',
    '/sign-in',
    '/confirm',
    '/forgot-password',
    '/home/children/new',
    '/home/children/3f2a9c1e-0b7d-4c55-9a51-2d8e6f0b1c44/dashboard',
    '/island/3f2a9c1e-0b7d-4c55-9a51-2d8e6f0b1c44/world/storykeeper-castle-3d',
    '/island/abc/locations/pirate-builder-bay/adventures/repair-the-moonlight-bridge',
    '/island/abc/stories/the.dragon',
    '/admin/assets/models/new',
  ])('serves the app for the client route %s', (path) => {
    expect(spaFallback.test(path)).toBe(true);
  });

  it.each(['/assets/index-B1x2c3.js', '/assets/index-B1x2c3.css', '/assets/index-B1x2c3.js.map'])(
    'serves the Vite build file %s as itself',
    (path) => {
      expect(spaFallback.test(path)).toBe(false);
    },
  );

  it('serves every file type in react/public as itself', () => {
    const extensions = publicExtensions(resolve(repoRoot, 'react/public'));
    expect(extensions.size).toBeGreaterThan(0);
    for (const ext of extensions) {
      expect(spaFallback.test(`/models/some/file.${ext}`), ext).toBe(false);
    }
  });

  it('never answers an /api/ request with the app', () => {
    expect(spaFallback.test('/api/v1/children')).toBe(false);
    expect(spaFallback.test('/api/v1/children/abc/play/answers')).toBe(false);
  });
});
