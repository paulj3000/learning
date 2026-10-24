import { describe, expect, it } from 'vitest';
import { CHILD_DASHBOARD_SECTION_IDS, listDashboardSections } from './dashboardSections';

describe('listDashboardSections', () => {
  it('gives every section a unique id and a destination scoped to the child', () => {
    const sections = listDashboardSections('child-1');

    expect(sections.length).toBeGreaterThan(0);
    expect(new Set(sections.map((section) => section.id)).size).toBe(sections.length);
    // "Play together" is the one section that is not about a single child.
    for (const section of sections.filter((entry) => entry.id !== 'play-together')) {
      expect(section.to).toContain('child-1');
    }
  });

  it('anchors each child dashboard section at the id the page renders', () => {
    const sections = listDashboardSections('child-1');

    for (const id of Object.values(CHILD_DASHBOARD_SECTION_IDS)) {
      expect(sections.find((section) => section.id === id)?.to).toBe(
        `/home/children/child-1/dashboard#${id}`,
      );
    }
  });

  it('points the sections that already have their own page straight at it', () => {
    const sections = listDashboardSections('child-1');
    const byId = new Map(sections.map((section) => [section.id, section.to]));

    expect(byId.get('story-keepsakes')).toBe('/home/children/child-1/stories');
    expect(byId.get('profile-details')).toBe('/home/children/child-1/edit');
    expect(byId.get('play-together')).toBe('/home/coop/new');
  });
});
