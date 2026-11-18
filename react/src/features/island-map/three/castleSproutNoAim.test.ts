import { describe, expect, it } from 'vitest';
import { CASTLE_PAD_BINDINGS } from './castlePlatformAnswers';
import { CASTLE_CHOICE_BINDINGS, QUILLS_PICTURE_STORY_SLUG } from './castleChoiceBindings';
import { manifestForBand } from './runtime/manifestForBand';
import { STORYKEEPER_CASTLE_MANIFEST } from './runtime/manifests/storykeeperCastle';

/**
 * SC-R11 section 4: a Sprout never needs to aim. The picture story is their whole route, and
 * every one of its world answers is somewhere to stand (a zone) or something to step on (a pad),
 * with the reticle hidden for the band. PILOT_READINESS 5b step 2 says this; this holds it.
 */
const SPROUT_BINDINGS = CASTLE_CHOICE_BINDINGS.filter(
  (binding) => binding.templateSlug === QUILLS_PICTURE_STORY_SLUG,
);
const zoneIds = new Set(
  manifestForBand(STORYKEEPER_CASTLE_MANIFEST, 'SPROUT').zones.map((zone) => zone.rect.id),
);

describe('Sprouts need no aim in the castle', () => {
  it('hides the reticle for Sprouts only', () => {
    expect(STORYKEEPER_CASTLE_MANIFEST.noReticleBands).toEqual(['SPROUT']);
  });

  it('has world answers for the picture story to check', () => {
    expect(SPROUT_BINDINGS.length).toBeGreaterThanOrEqual(6);
  });

  it.each(SPROUT_BINDINGS.map((binding) => [binding.entityId, binding] as const))(
    '%s can be answered by standing at it or on its pad, not only by aiming',
    (entityId, binding) => {
      const standsAt = zoneIds.has(entityId) || zoneIds.has(`${entityId}:approach`);
      const hasPad = CASTLE_PAD_BINDINGS.some(
        (pad) =>
          pad.templateSlug === binding.templateSlug &&
          pad.stepId === binding.stepId &&
          pad.optionId === binding.optionId,
      );
      expect(standsAt || hasPad, `${entityId} needs aiming for a Sprout`).toBe(true);
    },
  );
});
