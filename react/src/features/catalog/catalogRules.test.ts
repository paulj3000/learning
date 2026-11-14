import { describe, expect, it } from 'vitest';
import { ADVENTURE_TEMPLATES } from '../adventures/content';
import { getIslandLocation } from '../island/locations';
import { STORY_ARC_ISLANDS, islandSlugForTemplate } from './islandForTemplate';

// The React admin catalog forms, import plan and delete guard were retired with the React admin
// pages (AMP-03): islands, places and adventures are administered in Django Admin (ADR-043).

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
