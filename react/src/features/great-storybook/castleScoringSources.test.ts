import { describe, expect, it } from 'vitest';
import { AGE_BAND_LABELS, type AgeBandValue } from '../child-profile/constants';
import { decideSubmission } from '../adventures/engine/submission';
import type { AdventureDefinition, AdventureStep } from '../adventures/engine/types';
import { CASTLE_ROOM_IDS } from '../island-map/three/castleLayout';
import { CASTLE_VIEW_ZONES } from '../island-map/three/runtime/manifests/castleRooms/castlePlatforms';
import { CASTLE_KEEPSAKE_IDS } from '../rewards/content/islandItems';
import {
  CASTLE_FRAGMENT_IDS,
  CASTLE_HIDDEN_FIND_IDS,
  CASTLE_MOVEMENT_VIEW_IDS,
  castleAdventures,
  castleCompletionSources,
  castleLearningEvent,
  castleMovementEvent,
  castleRoomChangeKey,
  castleScoringEventsFrom,
  type CastleRecords,
} from './castleScoringSources';
import { GREAT_STORYBOOK_RESTORED_V2_KEY, STORYBOOK_PAGES, pagesForBand } from './pages';

const BANDS = Object.keys(AGE_BAND_LABELS) as AgeBandValue[];
const NOTHING: CastleRecords = { worldChangeKeys: [], discoveryIds: [], ownedItemIds: [] };

function everything(): CastleRecords {
  return {
    worldChangeKeys: [
      ...castleCompletionSources().map((source) => source.changeKey),
      ...STORYBOOK_PAGES.flatMap((page) =>
        page.source.kind === 'WORLD_CHANGE' ? [page.source.changeKey] : [],
      ),
      GREAT_STORYBOOK_RESTORED_V2_KEY,
      ...CASTLE_ROOM_IDS.map(castleRoomChangeKey),
    ],
    discoveryIds: [...CASTLE_HIDDEN_FIND_IDS],
    ownedItemIds: [...CASTLE_KEEPSAKE_IDS],
  };
}

describe('castle scoring sources: the catalog (GE-100 coordination)', () => {
  it('finds the castle adventures and stories in the authored content, each with a completion record', () => {
    const adventures = castleAdventures().map((adventure) => adventure.slug);
    for (const slug of [
      'the-storykeepers-tale',
      'quills-picture-story',
      'the-painted-words',
      'secret-door-chapter-1-three-clues',
      'secret-door-chapter-2-pattern-lock',
    ]) {
      expect(adventures, slug).toContain(slug);
    }
    const sources = castleCompletionSources();
    expect(sources.length).toBeGreaterThanOrEqual(adventures.length);
    for (const source of sources) expect(source.changeKey, source.id).toMatch(/^[A-Z0-9_]+$/);
    expect(sources.some((source) => source.kind === 'STORY')).toBe(true);
  });

  it('keeps the page (fragment) ids stable', () => {
    expect(CASTLE_FRAGMENT_IDS).toEqual([
      'page-first-story',
      'page-painted-words',
      'page-three-clues',
      'page-pattern-lock',
      'page-what-was-waiting',
      'page-tapestry',
    ]);
  });

  it('names only movement views the castle actually has', () => {
    const viewZones = CASTLE_VIEW_ZONES.map((zone) => zone.rect.id);
    for (const id of CASTLE_MOVEMENT_VIEW_IDS) expect(viewZones).toContain(id);
  });
});

describe('castle scoring sources: projecting a child’s records', () => {
  it('produces nothing for a child with no records', () => {
    for (const band of BANDS) expect(castleScoringEventsFrom(NOTHING, band)).toEqual([]);
  });

  it.each(BANDS)(
    '%s: one event per record, every kind present, keys unique and server-backed',
    (band) => {
      const events = castleScoringEventsFrom(everything(), band);
      const keys = events.map((event) => event.idempotencyKey);
      expect(new Set(keys).size).toBe(keys.length);
      for (const kind of [
        'STORY_COMPLETED',
        'STORY_FRAGMENT_RECOVERED',
        'READING_MILESTONE',
        'PLACE_EXPLORED',
        'HIDDEN_FIND',
        'ACHIEVEMENT_EARNED',
      ] as const) {
        expect(
          events.some((event) => event.kind === kind),
          kind,
        ).toBe(true);
      }
      expect(events.every((event) => event.authority === 'server')).toBe(true);
      expect(events.every((event) => event.realmId === 'storykeeper-castle')).toBe(true);
      const fragments = events
        .filter((event) => event.kind === 'STORY_FRAGMENT_RECOVERED')
        .map((event) => event.sourceId);
      expect(fragments).toEqual(pagesForBand(band).map((page) => page.id));
    },
  );

  it('is idempotent: duplicated records and a second projection give the same events', () => {
    const once = castleScoringEventsFrom(everything(), 'EXPLORER');
    const doubled: CastleRecords = {
      worldChangeKeys: [...everything().worldChangeKeys, ...everything().worldChangeKeys],
      discoveryIds: [...everything().discoveryIds, ...everything().discoveryIds],
      ownedItemIds: [...everything().ownedItemIds, ...everything().ownedItemIds],
    };
    expect(castleScoringEventsFrom(doubled, 'EXPLORER')).toEqual(once);
    expect(castleScoringEventsFrom(everything(), 'EXPLORER')).toEqual(once);
  });

  it('carries no points, values, levels or timestamps', () => {
    for (const event of castleScoringEventsFrom(everything(), 'PATHFINDER')) {
      expect(Object.keys(event).sort()).toEqual(
        ['authority', 'idempotencyKey', 'kind', 'realmId', 'record', 'sourceId'].sort(),
      );
    }
  });

  it('gives one completion per record and only the band’s own: a replay or sibling variant never doubles it', () => {
    const records: CastleRecords = {
      ...NOTHING,
      worldChangeKeys: ['FIRST_STORY_TOLD', 'STUDIO_PAGE_MENDED'],
    };
    const completions = (band: AgeBandValue) =>
      castleScoringEventsFrom(records, band)
        .filter((event) => event.kind === 'STORY_COMPLETED')
        .map((event) => event.sourceId);
    expect(completions('PATHFINDER')).toEqual(['the-storykeepers-tale', 'the-painted-words']);
    expect(completions('SPROUT')).toEqual(['quills-picture-story']);
    expect(completions('EXPLORER')).toEqual([]);
  });

  it('counts the hidden bonus page as a fragment and a hidden find, never as a completion', () => {
    const records: CastleRecords = { ...NOTHING, discoveryIds: ['castle-tapestry-stair'] };
    const events = castleScoringEventsFrom(records, 'SPROUT');
    expect(events.map((event) => [event.kind, event.sourceId])).toEqual([
      ['STORY_FRAGMENT_RECOVERED', 'page-tapestry'],
      ['HIDDEN_FIND', 'castle-tapestry-stair'],
    ]);
  });

  it('ignores records that are not the castle’s', () => {
    const records: CastleRecords = {
      worldChangeKeys: ['BRIDGE_REPAIRED', 'castle-room:not-a-room'],
      discoveryIds: ['harbor-shell-1'],
      ownedItemIds: ['harbor-shell'],
    };
    expect(castleScoringEventsFrom(records, 'EXPLORER')).toEqual([]);
  });
});

describe('castle scoring sources: learning steps', () => {
  const adventure = castleAdventures().find((candidate) =>
    candidate.steps.some((step) => step.hintPolicy && step.presentation.kind === 'choice'),
  ) as AdventureDefinition;
  const step = adventure.steps.find(
    (candidate) => candidate.hintPolicy && candidate.presentation.kind === 'choice',
  ) as AdventureStep & {
    presentation: { kind: 'choice'; correctOptionId: string; options: { id: string }[] };
  };
  const right = { kind: 'choice' as const, optionId: step.presentation.correctOptionId };
  const wrongId = step.presentation.options.find(
    (option) => option.id !== step.presentation.correctOptionId,
  )!.id;
  const wrong = { kind: 'choice' as const, optionId: wrongId };

  it('names an independent success, with the step’s objectives', () => {
    const event = castleLearningEvent(adventure, step.id, decideSubmission(step, right, 0));
    expect(event).toMatchObject({
      kind: 'LEARNING_STEP_COMPLETED',
      support: 'INDEPENDENT',
      record: 'SKILL_EVIDENCE',
      sourceId: `${adventure.slug}/${step.id}`,
      objectiveIds: step.objectiveIds,
    });
  });

  it('keeps supported and guided success apart from independent', () => {
    expect(castleLearningEvent(adventure, step.id, decideSubmission(step, right, 1))?.support).toBe(
      'SUPPORTED',
    );
    let hint = 0;
    let decision = decideSubmission(step, wrong, hint);
    while (decision.action === 'RETRY') {
      hint = decision.supportLevel;
      decision = decideSubmission(step, wrong, hint);
    }
    expect(castleLearningEvent(adventure, step.id, decision)?.support).toBe('GUIDED');
  });

  it('produces nothing for a retry: a wrong answer is never an event', () => {
    expect(castleLearningEvent(adventure, step.id, decideSubmission(step, wrong, 0))).toBeNull();
  });

  it('keys a replayed step the same, so a ledger can tell it is a replay', () => {
    const first = castleLearningEvent(adventure, step.id, decideSubmission(step, right, 0));
    const again = castleLearningEvent(adventure, step.id, decideSubmission(step, right, 0));
    expect(again?.idempotencyKey).toBe(first?.idempotencyKey);
  });

  it('refuses another location’s adventure and an unknown step', () => {
    expect(
      castleLearningEvent(
        { ...adventure, locationSlug: 'pirate-builder-bay' },
        step.id,
        decideSubmission(step, right, 0),
      ),
    ).toBeNull();
    expect(
      castleLearningEvent(adventure, 'no-such-step', decideSubmission(step, right, 0)),
    ).toBeNull();
  });
});

describe('castle scoring sources: movement', () => {
  it('reports the chamber ledge as a client signal only, and nothing for a pad or any other zone', () => {
    expect(castleMovementEvent('view:chamber:ledge')).toMatchObject({
      kind: 'MOVEMENT_EXPLORATION',
      authority: 'client-signal',
      record: 'ENGINE_EVENT',
    });
    expect(castleMovementEvent('pad:studio:red')).toBeNull();
    expect(castleMovementEvent('castle-story-hall')).toBeNull();
  });
});
