import { describe, expect, it } from 'vitest';
// Read as text, like `src/features/child-profile/deletion.test.ts`: this
// asserts the rules as written in the backend definition, which the mocked
// data client in every other test cannot see.
import schemaSource from '../../../amplify/data/resource.ts?raw';
import storageSource from '../../../amplify/storage/resource.ts?raw';

/**
 * docs/android/ASSET_MANAGEMENT.md section 24: only administrators may
 * upload, replace, publish, archive, delete, or modify assets, enforced by
 * the backend rather than by hiding admin routes. Parents (and children,
 * who act inside a parent's session) and anonymous callers get nothing.
 * A live-backend check of the same rules is listed in
 * docs/AUTHORIZATION_REVIEW.md section 5.
 */

function authorizationOf(model: string): string {
  const match = new RegExp(
    `^  ${model}: a\\n?\\s*\\.model\\(\\{[\\s\\S]*?\\n    \\}\\)\\n\\s*\\.authorization\\(\\(allow\\) => \\[([^\\]]*)\\]\\)`,
    'm',
  ).exec(schemaSource);
  if (!match?.[1]) throw new Error(`No authorization rule found for ${model}`);
  return match[1].trim();
}

describe('asset authorization rules', () => {
  it.each(['Asset', 'AssetVersion'])('%s is Admins-group only, for every operation', (model) => {
    expect(authorizationOf(model)).toBe("allow.group('Admins')");
  });

  it.each(['Asset', 'AssetVersion'])(
    '%s grants nothing to owners, signed-in parents, guests, or the public',
    (model) => {
      const rule = authorizationOf(model);
      for (const forbidden of ['owner', 'authenticated', 'guest', 'publicApiKey']) {
        expect(rule).not.toContain(forbidden);
      }
    },
  );

  it('keeps the assets/ storage prefix Admins-group only', () => {
    const line = storageSource.split('\n').find((entry) => entry.includes("'assets/*'"));
    expect(line).toBeDefined();
    expect(line).toContain("allow.groups(['Admins']).to(['read', 'write', 'delete'])");
    for (const forbidden of ['guest', 'authenticated', 'entity']) {
      expect(line).not.toContain(forbidden);
    }
  });
});
