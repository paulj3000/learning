import { describe, expect, it } from 'vitest';
import { getAdventureTemplate } from '../../adventures/content';
import type { AdventureDefinition } from '../../adventures/engine/types';
import type { AgeBandValue } from '../../child-profile/constants';
import { findIslandDiscovery } from '../../discovery/content';
import { getQuestDefinition } from '../../quests/content';
import { THE_CASTLES_SECRET_DOOR } from '../../story/content/theCastlesSecretDoor';
import { STORYKEEPER_CASTLE_INTERACTIONS } from '../worldObjects';
import { CASTLE_CHOICE_BINDINGS } from './castleChoiceBindings';
import {
  castleTaleClaims,
  isSecretDoorStoryForBand,
  taleAdventureForBand,
} from './extensions/castleTale/castleTaleClaims';
import { castleTaleViewExtension } from './extensions/castleTale/castleTaleViewExtension';
import { CASTLE_TROPHY_INTERACTIONS } from './castleTrophies';
import { STORYKEEPER_CASTLE_MANIFEST } from './runtime/manifests/storykeeperCastle';

/**
 * The Storykeeper Castle Reboot's compatibility contracts
 * (`docs/regions/storykeeper_castle_contracts.md`, SC-R01-04). Each block
 * pins something the reboot promised not to change, or something a later
 * phase is designed against, so the promise fails loudly rather than drifting.
 */

const BANDS: readonly AgeBandValue[] = ['SPROUT', 'PATHFINDER', 'EXPLORER'];

/** C-1: interaction ids, kinds, gates and actions, exactly as the reboot inherited them. */
const FROZEN_INTERACTIONS = [
  'castle-story-hall START_ADVENTURE ABSENT:FIRST_STORY_TOLD',
  'castle-story-hall-told SHOW_MESSAGE PRESENT:FIRST_STORY_TOLD',
  'talk-to-keeper-quill TALK_TO ALWAYS',
  'castle-character-gallery SHOW_MESSAGE ALWAYS',
  'castle-setting-tower SHOW_MESSAGE ALWAYS',
  'castle-costume-room SHOW_MESSAGE ALWAYS',
  'castle-great-library SHOW_MESSAGE ALWAYS',
  'castle-illustration-studio SHOW_MESSAGE ALWAYS',
  'castle-harbor-exit NAVIGATE ALWAYS',
  'castle-tapestry-stair DISCOVER ALWAYS',
  'castle-secret-door START_STORY ABSENT:THE_CASTLES_SECRET_DOOR_COMPLETE',
  'castle-last-bookshelf NAVIGATE PRESENT:THE_CASTLES_SECRET_DOOR_COMPLETE',
];

function describeRequirement(requirement: { type: string; changeKey?: string }): string {
  if (requirement.type === 'WORLD_CHANGE_ABSENT') return `ABSENT:${requirement.changeKey}`;
  if (requirement.type === 'WORLD_CHANGE_PRESENT') return `PRESENT:${requirement.changeKey}`;
  return requirement.type;
}

/** The world changes an adventure's WORLD_CHANGE steps write, as `locationSlug/changeKey`. */
function worldChangesWrittenBy(adventure: AdventureDefinition): string[] {
  return adventure.steps.flatMap((step) => {
    const payload = (
      step.presentation as { payload?: { changeKey?: string; locationSlug?: string } }
    ).payload;
    return step.type === 'WORLD_CHANGE' && payload?.changeKey
      ? [`${payload.locationSlug}/${payload.changeKey}`]
      : [];
  });
}

/**
 * C-5: the planned Great Storybook pages (reboot roadmap section 4.1), each
 * naming the existing record that restores it. Pages are derived, never
 * stored, so each source must be something authored content already writes.
 */
const PLANNED_PAGE_SOURCES = [
  {
    page: 'page-first-story',
    worldChange: 'storykeeper-castle/FIRST_STORY_TOLD',
    // Not Explorers: no Explorer castle mission writes it (found by this test, SC-R01-04).
    bands: ['SPROUT', 'PATHFINDER'],
  },
  {
    page: 'page-three-clues',
    worldChange: 'castle-secret-passage/SECRET_DOOR_CLUES_COLLECTED',
    bands: ['EXPLORER'],
  },
  {
    page: 'page-pattern-lock',
    worldChange: 'castle-secret-passage/CASTLE_SECRET_DOOR_OPENED',
    bands: ['EXPLORER'],
  },
  {
    page: 'page-what-was-waiting',
    worldChange: 'castle-secret-passage/THE_CASTLES_SECRET_DOOR_COMPLETE',
    bands: ['EXPLORER'],
  },
] as const;

/** Every world change a band's castle content can write, from the content itself. */
function worldChangesForBand(band: AgeBandValue): Set<string> {
  const written = new Set<string>();
  const tale = taleAdventureForBand(band);
  if (tale) worldChangesWrittenBy(tale).forEach((key) => written.add(key));
  if (isSecretDoorStoryForBand(band)) {
    for (const chapter of THE_CASTLES_SECRET_DOOR.chapters) {
      for (const scene of chapter.scenes) {
        if (scene.kind !== 'ADVENTURE') continue;
        const adventure = getAdventureTemplate(scene.templateSlug);
        if (adventure) worldChangesWrittenBy(adventure).forEach((key) => written.add(key));
      }
    }
    const completion = THE_CASTLES_SECRET_DOOR.completionWorldChange;
    if (completion) written.add(`${completion.locationSlug}/${completion.changeKey}`);
  }
  return written;
}

describe('Storykeeper Castle reboot contracts', () => {
  it('C-1: keeps every castle interaction id, action and gate the reboot inherited', () => {
    const actual = STORYKEEPER_CASTLE_INTERACTIONS.map(
      (interaction) =>
        `${interaction.id} ${interaction.action.kind} ${(interaction.requirements ?? [])
          .map(describeRequirement)
          .join(',')}`,
    );
    expect(actual).toEqual(FROZEN_INTERACTIONS);
    // The inherited interactions come first and unchanged. Anything after them is a declared
    // addition (the Trophy Room's walk-up descriptions, SC-R03-03), never an edit.
    const carried = STORYKEEPER_CASTLE_MANIFEST.interactions;
    expect(carried.slice(0, STORYKEEPER_CASTLE_INTERACTIONS.length)).toEqual(
      STORYKEEPER_CASTLE_INTERACTIONS,
    );
    expect(carried.slice(STORYKEEPER_CASTLE_INTERACTIONS.length)).toEqual(
      CASTLE_TROPHY_INTERACTIONS,
    );
  });

  it('C-1: keeps the tapestry secret hidden from every list', () => {
    expect(STORYKEEPER_CASTLE_MANIFEST.hiddenInteractionIds).toContain('castle-tapestry-stair');
  });

  it('C-2: castle-tale claims the story hall and secret door only for bands it hosts (AUD-1)', () => {
    const config = {
      taleInteractionId: 'castle-story-hall',
      storyInteractionId: 'castle-secret-door',
    };
    expect(castleTaleClaims('castle-story-hall', config, 'SPROUT')).toBe(true);
    expect(castleTaleClaims('castle-story-hall', config, 'PATHFINDER')).toBe(true);
    expect(castleTaleClaims('castle-story-hall', config, 'EXPLORER')).toBe(false);
    expect(castleTaleClaims('castle-secret-door', config, 'SPROUT')).toBe(false);
    expect(castleTaleClaims('castle-secret-door', config, 'PATHFINDER')).toBe(false);
    expect(castleTaleClaims('castle-secret-door', config, 'EXPLORER')).toBe(true);
    expect(castleTaleClaims('talk-to-keeper-quill', config, 'PATHFINDER')).toBe(false);
  });

  it('C-2: the registered view extension applies the same band-aware claim', () => {
    const binding = STORYKEEPER_CASTLE_MANIFEST.extensions.find(
      (extension) => extension.extensionId === 'castle-tale',
    );
    const storyHall = STORYKEEPER_CASTLE_INTERACTIONS.find((i) => i.id === 'castle-story-hall');
    const secretDoor = STORYKEEPER_CASTLE_INTERACTIONS.find((i) => i.id === 'castle-secret-door');
    if (!binding || !storyHall || !secretDoor) throw new Error('castle fixtures missing');
    const claims = (interaction: typeof storyHall, ageBand: AgeBandValue) =>
      castleTaleViewExtension.claimsInteraction?.(interaction, { ageBand, config: binding.config });
    expect(claims(storyHall, 'PATHFINDER')).toBe(true);
    expect(claims(storyHall, 'EXPLORER')).toBe(false);
    expect(claims(secretDoor, 'EXPLORER')).toBe(true);
    expect(claims(secretDoor, 'SPROUT')).toBe(false);
  });

  it('C-3: every band has exactly one castle mission, authored for that band', () => {
    expect(taleAdventureForBand('SPROUT')?.slug).toBe('quills-picture-story');
    expect(taleAdventureForBand('PATHFINDER')?.slug).toBe('the-storykeepers-tale');
    expect(isSecretDoorStoryForBand('EXPLORER')).toBe(true);
    for (const band of BANDS) {
      const missions = [taleAdventureForBand(band), isSecretDoorStoryForBand(band) || undefined];
      expect(missions.filter(Boolean)).toHaveLength(1);
      const tale = taleAdventureForBand(band);
      if (tale) expect(tale.ageBands).toContain(band);
    }
  });

  it('C-4: every 3D binding names a step and option the authored content owns', () => {
    for (const binding of CASTLE_CHOICE_BINDINGS) {
      const adventure = getAdventureTemplate(binding.templateSlug);
      const step = adventure?.steps.find((candidate) => candidate.id === binding.stepId);
      // A choice step's options, or an ordering step's items: either way, ids the content owns.
      const presentation = step?.presentation as
        { options?: readonly { id: string }[]; items?: readonly { id: string }[] } | undefined;
      const ids = [...(presentation?.options ?? []), ...(presentation?.items ?? [])].map(
        (option) => option.id,
      );
      expect(ids, binding.entityId).toContain(binding.optionId);
    }
    expect(STORYKEEPER_CASTLE_MANIFEST.adventureBindings).toBe(CASTLE_CHOICE_BINDINGS);
  });

  it.each(PLANNED_PAGE_SOURCES)(
    'C-5: $page is restorable from a world change its bands already write',
    ({ worldChange, bands }) => {
      for (const band of bands) {
        expect(worldChangesForBand(band), `${band}`).toContain(worldChange);
      }
    },
  );

  it('C-5: the hidden page comes from a discovery that exists and a hidden interaction', () => {
    expect(findIslandDiscovery('castle-tapestry-stair')).not.toBeNull();
    const tapestry = STORYKEEPER_CASTLE_INTERACTIONS.find(
      (interaction) => interaction.id === 'castle-tapestry-stair',
    );
    expect(tapestry?.action).toEqual({ kind: 'DISCOVER', discoveryId: 'castle-tapestry-stair' });
  });

  it('C-5: every band can restore at least one page, so no band sees an empty Storybook', () => {
    for (const band of BANDS) {
      const restorable = PLANNED_PAGE_SOURCES.filter((page) =>
        (page.bands as readonly AgeBandValue[]).includes(band),
      );
      expect(restorable.length, band).toBeGreaterThan(0);
    }
  });

  it('C-6: the island quest the Storybook quest will be modelled on still names castle content', () => {
    const quest = getQuestDefinition('tell-a-story-together');
    expect(quest?.giverNpcId).toBe('keeper-quill');
    const objectives = quest?.stages.flatMap((stage) => stage.objectives) ?? [];
    expect(objectives).toContainEqual(
      expect.objectContaining({ kind: 'SOLVE', adventureSlug: 'the-storykeepers-tale' }),
    );
  });
});
