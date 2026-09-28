import { describe, expect, it } from 'vitest';
import { ADVENTURE_TEMPLATES } from '../adventures/content';
import { ISLAND_LOCATIONS, getIslandLocation } from '../island/locations';
import { deleteBlockReason } from './deleteGuard';
import { planCatalogImport } from './importPlan';
import { STORY_ARC_ISLANDS, islandSlugForTemplate } from './islandForTemplate';
import {
  parseSortOrder,
  slugify,
  validateAdventureForm,
  validateCatalogForm,
  type AdventureFormValues,
} from './validation';
import { filterAdventures } from '../admin/catalog/filterAdventures';

const VALID: AdventureFormValues = {
  islandId: 'island-1',
  name: 'Pirate Bay',
  slug: 'pirate-bay',
  shortDescription: '',
  description: '',
  active: true,
  sortOrder: '10',
};

describe('islandSlugForTemplate', () => {
  it('files every authored adventure under a real island location', () => {
    for (const template of ADVENTURE_TEMPLATES) {
      const slug = islandSlugForTemplate(template);
      expect(slug, template.slug).toBeDefined();
      expect(getIslandLocation(slug!), template.slug).toBeDefined();
    }
  });

  it('maps story-arc pseudo-locations only onto real locations', () => {
    for (const island of Object.values(STORY_ARC_ISLANDS)) {
      expect(getIslandLocation(island)).toBeDefined();
    }
  });
});

describe('validateCatalogForm', () => {
  it('accepts a complete form', () => {
    expect(validateCatalogForm(VALID, [])).toEqual({});
  });

  it('requires a name and a slug', () => {
    const errors = validateCatalogForm({ ...VALID, name: ' ', slug: '' }, []);
    expect(errors.name).toBeDefined();
    expect(errors.slug).toBeDefined();
  });

  it.each(['Pirate Bay', 'pirate--bay', '-pirate', 'pirate_bay'])('rejects slug %j', (slug) => {
    expect(validateCatalogForm({ ...VALID, slug }, []).slug).toBeDefined();
  });

  it('rejects a duplicate slug', () => {
    expect(validateCatalogForm(VALID, ['pirate-bay']).slug).toMatch(/already in use/);
  });

  it('requires a whole-number sort order', () => {
    expect(validateCatalogForm({ ...VALID, sortOrder: '1.5' }, []).sortOrder).toBeDefined();
    expect(validateCatalogForm({ ...VALID, sortOrder: '' }, []).sortOrder).toBeDefined();
    expect(parseSortOrder(' -20 ')).toBe(-20);
  });
});

describe('validateAdventureForm', () => {
  it('requires an island that exists', () => {
    expect(validateAdventureForm(VALID, [], ['island-1'])).toEqual({});
    expect(validateAdventureForm({ ...VALID, islandId: '' }, [], ['island-1']).islandId).toBe(
      'Choose an island.',
    );
    expect(validateAdventureForm(VALID, [], ['island-2']).islandId).toMatch(/no longer exists/);
  });
});

describe('slugify', () => {
  it("turns a display name into a slug: Dragon's Sanctuary", () => {
    expect(slugify("Dragon's Sanctuary")).toBe('dragons-sanctuary');
    expect(slugify('  The Lost  Dragon Egg! ')).toBe('the-lost-dragon-egg');
  });
});

describe('planCatalogImport', () => {
  it('plans every location and adventure on an empty catalog', () => {
    const plan = planCatalogImport(
      { islandSlugs: [], adventureSlugs: [] },
      ISLAND_LOCATIONS,
      ADVENTURE_TEMPLATES,
    );
    expect(plan.islands).toHaveLength(ISLAND_LOCATIONS.length);
    expect(plan.adventures).toHaveLength(ADVENTURE_TEMPLATES.length);
    expect(plan.skipped).toEqual([]);
    expect(plan.islands[0]).toMatchObject({
      slug: ISLAND_LOCATIONS[0]!.slug,
      name: ISLAND_LOCATIONS[0]!.title,
    });
  });

  it('never re-plans a row that already exists', () => {
    const plan = planCatalogImport(
      { islandSlugs: ['pirate-builder-bay'], adventureSlugs: ['repair-the-moonlight-bridge'] },
      ISLAND_LOCATIONS,
      ADVENTURE_TEMPLATES,
    );
    expect(plan.islands.map((island) => island.slug)).not.toContain('pirate-builder-bay');
    expect(plan.adventures.map((adventure) => adventure.slug)).not.toContain(
      'repair-the-moonlight-bridge',
    );
  });

  it('reports a template with no island rather than guessing one', () => {
    const plan = planCatalogImport({ islandSlugs: [], adventureSlugs: [] }, ISLAND_LOCATIONS, [
      { slug: 'orphan', title: 'Orphan', locationSlug: 'nowhere' },
    ]);
    expect(plan.adventures).toEqual([]);
    expect(plan.skipped).toEqual(['orphan']);
  });
});

describe('deleteBlockReason', () => {
  it('allows deleting an unplayed catalog entry with no game content', () => {
    expect(deleteBlockReason({ hasGameContent: false, sessionCount: 0 })).toBeNull();
  });

  it('refuses an adventure with game content, which would otherwise become available again', () => {
    expect(deleteBlockReason({ hasGameContent: true, sessionCount: 0 })).toMatch(/Deactivate/);
  });

  it('refuses an adventure children have played, protecting their history', () => {
    expect(deleteBlockReason({ hasGameContent: false, sessionCount: 3 })).toMatch(/3 sessions/);
  });
});

describe('filterAdventures', () => {
  const adventures = [
    { name: 'The Lost Dragon Egg', slug: 'lost-egg', islandId: 'a', active: true },
    { name: 'Cavern of Numbers', slug: 'cavern', islandId: 'a', active: false },
    { name: 'Flight School', slug: 'flight', islandId: 'b', active: true },
  ];

  it('searches by name or slug, and filters by island and status', () => {
    const names = (filters: Parameters<typeof filterAdventures>[1]) =>
      filterAdventures(adventures, filters).map((adventure) => adventure.name);
    expect(names({ search: 'dragon', islandId: '', status: 'all' })).toEqual([
      'The Lost Dragon Egg',
    ]);
    expect(names({ search: 'flight', islandId: '', status: 'all' })).toEqual(['Flight School']);
    expect(names({ search: '', islandId: 'a', status: 'all' })).toHaveLength(2);
    expect(names({ search: '', islandId: '', status: 'inactive' })).toEqual(['Cavern of Numbers']);
  });
});
