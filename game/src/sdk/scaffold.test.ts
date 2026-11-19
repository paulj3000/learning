import { describe, expect, it } from 'vitest';
import { scaffoldAdventure, toCamelCase } from './scaffold';

const byPath = (result: ReturnType<typeof scaffoldAdventure>, suffix: string) =>
  result.files.find((file) => file.path.endsWith(suffix))!.content;

describe('adventure scaffold', () => {
  it('generates a definition, a spec stub and a test', () => {
    const result = scaffoldAdventure({ realmId: 'demo-realm', adventureId: 'demo-adventure', today: '2026-11-18' });
    expect(result.ok).toBe(true);
    expect(result.files.map((f) => f.path)).toEqual([
      'demo-adventure.definition.ts',
      'demo-adventure.spec.md',
      'demo-adventure.definition.test.ts',
    ]);
    expect(result.defaultOutDir).toBe('react/src/features/adventures/definitions/demo-realm/demo-adventure');
    const definition = byPath(result, '.definition.ts');
    expect(definition).toContain("id: 'demo-adventure'");
    expect(definition).toContain("realmId: 'demo-realm'");
    expect(definition).toContain('demoAdventureAdventure');
    expect(definition).toContain('worldConsequenceId');
    expect(definition).not.toContain('movement.jump');
    expect(byPath(result, '.definition.test.ts')).toContain('validateAdventure');
  });

  it('with --jump adds the jump capability and an accessible route', () => {
    const definition = byPath(scaffoldAdventure({ realmId: 'r', adventureId: 'a', jump: true }), '.definition.ts');
    expect(definition).toContain("id: 'movement.jump'");
    expect(definition).toContain('accessibleRouteId');
    expect(definition).toContain('optional: true');
    expect(definition).toContain("checkpoints: [{ id: 'a-checkpoint-1'");
  });

  it('fills the specification template when given', () => {
    const template = '# Adventure Specification: `<adventure name>`\n\n- **Last reviewed:** `<YYYY-MM-DD>`\n- **Status:** `<Draft | In review | Owner approved>`\n';
    const spec = byPath(scaffoldAdventure({ realmId: 'r', adventureId: 'sunny-bridge', today: '2026-11-18', specTemplate: template }), '.spec.md');
    expect(spec).toContain('Adventure Specification: `Sunny Bridge`');
    expect(spec).toContain('2026-11-18');
    expect(spec).toContain('Draft');
    expect(spec).not.toContain('<adventure name>');
  });

  it('validates ids and produces no files for bad ones', () => {
    for (const bad of ['Has Space', 'UPPER', '-lead', 'trail-', 'a--b', '../escape', '', '1abc']) {
      const result = scaffoldAdventure({ realmId: 'ok', adventureId: bad });
      expect(result.ok).toBe(false);
      expect(result.files).toEqual([]);
      expect(result.issues[0]!.path).toBe('adventureId');
    }
    expect(scaffoldAdventure({ realmId: 'Bad Realm', adventureId: 'ok' }).issues[0]!.path).toBe('realmId');
  });

  it('camel-cases ids', () => {
    expect(toCamelCase('pirate-builder-bay')).toBe('pirateBuilderBay');
  });
});
