import { describe, expect, it } from 'vitest';
import { areRequirementsMet, type WorldInteractionContext } from '../worldObjects';
import { CASTLE_CHAMBER_INTERACTIONS } from './castleChamber';
import { SECRET_PASSAGE_DISCOVERY_ID, castleRoomAt } from './castleLayout';
import { STORYKEEPER_CASTLE_MANIFEST as MANIFEST } from './runtime/manifests/storykeeperCastle';
import { ZONES } from './storykeeperCastleRegion';

/**
 * Everything in the Secret Chamber is flavour behind a secret. What must
 * hold: a child who has not found the nook can neither trigger nor see any
 * of it, none of it can grade, grant or record anything, and each line
 * belongs to a zone inside the chamber.
 */

const NOTHING: WorldInteractionContext = {
  worldChangeKeys: [],
  ownedItemIds: [],
  discoveryIds: [],
};
const FOUND: WorldInteractionContext = { ...NOTHING, discoveryIds: [SECRET_PASSAGE_DISCOVERY_ID] };
const zone = (id: string) => ZONES.find((candidate) => candidate.id === id)!;

describe('the Secret Chamber interactions', () => {
  it('are four: three crystals that hum and a sealed round door', () => {
    expect(CASTLE_CHAMBER_INTERACTIONS.map((i) => i.id)).toEqual([
      'chamber-glow-1',
      'chamber-glow-2',
      'chamber-glow-3',
      'chamber-door',
    ]);
  });

  it('exist for nobody until the nook is found: unavailable before, available after', () => {
    for (const interaction of CASTLE_CHAMBER_INTERACTIONS) {
      expect(areRequirementsMet(interaction.requirements, NOTHING), interaction.id).toBe(false);
      expect(areRequirementsMet(interaction.requirements, FOUND), interaction.id).toBe(true);
    }
  });

  it('are never listed in "Things to do here", found or not: a secret that lists itself is signage', () => {
    for (const interaction of CASTLE_CHAMBER_INTERACTIONS) {
      expect(MANIFEST.hiddenInteractionIds, interaction.id).toContain(interaction.id);
    }
  });

  it('only describe: nothing grades, grants, records, starts or opens', () => {
    for (const interaction of CASTLE_CHAMBER_INTERACTIONS) {
      expect(interaction.action.kind, interaction.id).toBe('SHOW_MESSAGE');
      expect(interaction.trigger).toBe('APPROACH');
    }
  });

  it('keep the sealed door a promise, not a puzzle: it never opens anything and holds no lock logic', () => {
    const door = CASTLE_CHAMBER_INTERACTIONS.find((i) => i.id === 'chamber-door')!;
    expect(door.action).toMatchObject({ kind: 'SHOW_MESSAGE' });
    expect(door.action.kind === 'SHOW_MESSAGE' && door.action.message).toMatch(/sealed for now/i);
  });

  it('stand in zones inside the chamber, and name the crystal they describe', () => {
    for (const interaction of CASTLE_CHAMBER_INTERACTIONS) {
      const area = zone(interaction.zoneId!);
      expect(area, interaction.id).toBeDefined();
      const centre = { x: (area.minX + area.maxX) / 2, z: (area.minZ + area.maxZ) / 2 };
      expect(castleRoomAt(centre.x, centre.z)?.id).toBe('secret-chamber');
    }
  });

  it('read aloud without an em dash and in short, plain sentences', () => {
    for (const interaction of CASTLE_CHAMBER_INTERACTIONS) {
      const text = `${interaction.title} ${interaction.action.kind === 'SHOW_MESSAGE' ? interaction.action.message : ''}`;
      expect(text).not.toMatch(/—|–/);
      if (interaction.action.kind !== 'SHOW_MESSAGE') continue;
      for (const sentence of interaction.action.message.split(/(?<=[.?!])\s+/)) {
        expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(22);
      }
    }
  });
});
