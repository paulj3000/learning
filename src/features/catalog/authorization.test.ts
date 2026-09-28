import { describe, expect, it } from 'vitest';
// Read as text, like `src/features/assets/authorization.test.ts`: the mocked
// data client in every other test cannot see the backend's rules.
import schemaSource from '../../../amplify/data/resource.ts?raw';
import authSource from '../../../amplify/auth/resource.ts?raw';

/**
 * docs/ISLAND_ADVENTURE_MANAGEMENT.md sections 3-4: every catalog write is
 * enforced by the backend, not by hiding admin routes. A live-backend check
 * of the same rules is listed in docs/AUTHORIZATION_REVIEW.md section 5.
 */

function modelBlock(model: string): string {
  const match = new RegExp(
    `^  ${model}: a\\n\\s*\\.model\\(\\{[\\s\\S]*?\\n    \\]\\),?$`,
    'm',
  ).exec(schemaSource);
  const simple = new RegExp(
    `^  ${model}: a\\n\\s*\\.model\\(\\{[\\s\\S]*?\\.authorization\\(\\(allow\\) => \\[[^\\]]*\\]\\)`,
    'm',
  ).exec(schemaSource);
  const block = match?.[0] ?? simple?.[0];
  if (!block) throw new Error(`No model block found for ${model}`);
  return block;
}

function modelRules(model: string): string {
  const block = modelBlock(model);
  const start = block.lastIndexOf('.authorization((allow) => [');
  return block.slice(start);
}

describe('Islands & Adventures authorization rules', () => {
  it('defines a Superusers Cognito group next to Admins', () => {
    expect(authSource).toContain("groups: ['Admins', 'Superusers']");
  });

  it('lets only Admins create and update islands, lets signed-in parents read, and lets no one delete', () => {
    const rules = modelRules('Island');
    expect(rules).toContain("allow.group('Admins').to(['create', 'read', 'update'])");
    expect(rules).toContain("allow.authenticated().to(['read'])");
    expect(rules).not.toContain('delete');
    for (const forbidden of ['owner', 'guest', 'publicApiKey']) {
      expect(rules).not.toContain(forbidden);
    }
  });

  it('lets only Superusers delete adventures', () => {
    const rules = modelRules('Adventure');
    expect(rules).toContain("allow.group('Admins').to(['create', 'read', 'update'])");
    expect(rules).toContain("allow.group('Superusers').to(['delete'])");
    expect(rules).toContain("allow.authenticated().to(['read'])");
    // Admins' own rule must not include delete: an Admin who is not a Superuser is refused.
    expect(rules).not.toMatch(/allow\.group\('Admins'\)\.to\(\[[^\]]*delete/);
    expect(rules).not.toMatch(/allow\.authenticated\(\)\.to\(\[[^\]]*(create|update|delete)/);
  });

  it('keeps adventure model assignments Admins-only', () => {
    expect(modelRules('AdventureModel')).toBe(".authorization((allow) => [allow.group('Admins')])");
  });

  it.each(['Island', 'Adventure'])(
    'hides %s createdBy/updatedBy from non-admin readers',
    (model) => {
      const block = modelBlock(model);
      for (const field of ['createdBy', 'updatedBy']) {
        expect(block).toContain(
          `${field}: a.string().authorization((allow) => [allow.group('Admins')])`,
        );
      }
    },
  );
});
