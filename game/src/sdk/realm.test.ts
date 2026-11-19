import { describe, expect, it } from 'vitest';
import { isEngineError } from '../core/errors';
import { defineRealm, validateRealm, type RealmDefinition } from './realm';
import { validRealm } from './testFixtures';

describe('realm definition', () => {
  it('accepts a valid realm', () => {
    const result = validateRealm(validRealm);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('defineRealm freezes a valid realm', () => {
    const realm = defineRealm(validRealm as RealmDefinition);
    expect(Object.isFrozen(realm)).toBe(true);
    expect(Object.isFrozen(realm.places[0])).toBe(true);
  });

  it('rejects literal copy where a localisation key is required', () => {
    const result = validateRealm({ ...validRealm, titleKey: 'Welcome to the Island!' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.path === 'titleKey')).toBe(true);
  });

  it('rejects bad ids, versions, bands, duplicate places and shared areas', () => {
    const result = validateRealm({
      ...validRealm,
      id: 'has space',
      version: '1',
      ageBands: ['SPROUT', 'TODDLER', 'SPROUT'],
      places: [
        { id: 'p1', titleKey: 'place.a.title', areaIds: ['a1'] },
        { id: 'p1', titleKey: 'place.b.title', areaIds: ['a1'] },
      ],
    });
    const paths = result.issues.map((issue) => issue.path);
    expect(paths).toEqual(expect.arrayContaining(['id', 'version', 'ageBands[1]', 'ageBands[2]', 'places[1].id']));
  });

  it('rejects an area that belongs to two places', () => {
    const result = validateRealm({
      ...validRealm,
      places: [
        { id: 'p1', titleKey: 'place.a.title', areaIds: ['a1'] },
        { id: 'p2', titleKey: 'place.b.title', areaIds: ['a1'] },
      ],
    });
    expect(result.issues.some((issue) => issue.message.includes('already belongs'))).toBe(true);
  });

  it('rejects unknown keys and non-objects without throwing', () => {
    expect(validateRealm({ ...validRealm, childName: 'x' }).ok).toBe(false);
    expect(validateRealm(null).ok).toBe(false);
    expect(validateRealm('realm').ok).toBe(false);
  });

  it('defineRealm throws a typed error listing issues', () => {
    try {
      defineRealm({ ...validRealm, places: [] } as unknown as RealmDefinition);
      expect.unreachable();
    } catch (error) {
      expect(isEngineError(error, 'VALIDATION_FAILED')).toBe(true);
    }
  });
});
