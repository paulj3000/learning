import { describe, expect, it } from 'vitest';
import { Reader } from '../parse';
import { islandsView } from './islandsApi';

const place = { placeId: 'p', title: 'P', tagline: '', adventureCount: 0, area: null };

describe('islandsView quest fields', () => {
  const read = (p: object) =>
    islandsView(
      new Reader({
        islands: [
          { islandId: 'i', title: 'I', tagline: '', isHome: true, description: '', places: [p] },
        ],
        autoSelectIslandId: null,
      }),
    ).islands[0]!.places[0]!;
  it('tolerates their absence', () => {
    expect(read(place)).toMatchObject({
      questCount: 0,
      questsCompleted: 0,
      questsInProgress: 0,
      completed: false,
    });
  });
  it('reads them when present', () => {
    expect(
      read({ ...place, questCount: 1, questsCompleted: 1, questsInProgress: 0, completed: true }),
    ).toMatchObject({ questCount: 1, completed: true });
  });
});

describe('islandsView (ADR-041, AP-03)', () => {
  it('reads the AP-03 discovery details', () => {
    const view = islandsView(
      new Reader({
        islands: [
          {
            islandId: 'creature-care-cove',
            title: 'Creature Care Cove',
            tagline: 'A small island',
            isHome: false,
            ageBands: ['PATHFINDER'],
            subjects: ['Counting'],
            thumbnailAssetId: null,
            unlocked: false,
            lockedHint: 'Help Pip first.',
            progress: { placesExplored: 1, placesTotal: 2 },
            places: [{ ...place, explored: true }],
          },
        ],
        autoSelectIslandId: null,
      }),
    );
    expect(view.islands[0]).toMatchObject({
      ageBands: ['PATHFINDER'],
      subjects: ['Counting'],
      unlocked: false,
      lockedHint: 'Help Pip first.',
      progress: { placesExplored: 1, placesTotal: 2 },
    });
    expect(view.islands[0].places[0].explored).toBe(true);
  });

  it('defaults the AP-03 details when an older server leaves them out', () => {
    const view = islandsView(
      new Reader({
        islands: [{ islandId: 'i', title: 'I', tagline: '', isHome: true, places: [place] }],
        autoSelectIslandId: 'i',
      }),
    );
    expect(view.islands[0]).toMatchObject({
      ageBands: [],
      subjects: [],
      thumbnailAssetId: null,
      unlocked: true,
      lockedHint: null,
      progress: null,
    });
    expect(view.islands[0].places[0].explored).toBe(false);
  });

  it('rejects a malformed AP-03 field rather than guessing', () => {
    expect(() =>
      islandsView(
        new Reader({
          islands: [
            { islandId: 'i', title: 'I', tagline: '', isHome: true, unlocked: 'yes', places: [] },
          ],
          autoSelectIslandId: null,
        }),
      ),
    ).toThrow();
  });

  it('reads the Realm Explorer fields: subject areas, pictures, descriptions and resume', () => {
    const view = islandsView(
      new Reader({
        islands: [
          {
            islandId: 'learning-adventure-island',
            title: 'Learning Adventure Island',
            tagline: 'Home',
            description: 'The island where you started.',
            isHome: true,
            subjectAreas: ['SCIENCE', 'MATH', 'HISTORY'],
            thumbnailAssetId: 'realm-home-art',
            places: [
              {
                ...place,
                description: 'Build with Pip.',
                skills: ['Counting'],
                subjectAreas: ['MATH'],
                thumbnailAssetId: 'place-bay-art',
                area: {
                  regionId: 'treasure-rush-cove',
                  title: 'Treasure Cove',
                  available: true,
                  status: 'IN_PROGRESS',
                  resume: { sessionId: 's-1', status: 'ACTIVE', lastActivityAt: null },
                },
              },
            ],
          },
        ],
        autoSelectIslandId: null,
      }),
    );
    const [island] = view.islands;
    // Display order, and a value this client does not know is ignored.
    expect(island.subjectAreas).toEqual(['MATH', 'SCIENCE']);
    expect(island).toMatchObject({
      description: 'The island where you started.',
      thumbnailAssetId: 'realm-home-art',
    });
    expect(island.places[0]).toMatchObject({
      description: 'Build with Pip.',
      skills: ['Counting'],
      subjectAreas: ['MATH'],
      thumbnailAssetId: 'place-bay-art',
      area: { status: 'IN_PROGRESS', resumeSessionId: 's-1' },
    });
  });

  it('defaults the Realm Explorer fields for an older server', () => {
    const view = islandsView(
      new Reader({
        islands: [
          {
            islandId: 'i',
            title: 'I',
            tagline: '',
            isHome: true,
            places: [
              { ...place, area: { regionId: 'r', title: 'R', available: true, status: 'ODD' } },
            ],
          },
        ],
        autoSelectIslandId: null,
      }),
    );
    const [island] = view.islands;
    expect(island).toMatchObject({ description: '', subjectAreas: [] });
    expect(island.places[0]).toMatchObject({
      description: '',
      skills: [],
      subjectAreas: [],
      thumbnailAssetId: null,
      area: { status: 'NOT_STARTED', resumeSessionId: null },
    });
  });

  it('reads the NP-023 seasonal info, defaulting to null for an older server or null', () => {
    const info = { slug: 'christmas', theme: 'CHRISTMAS', featured: true, inWindow: true };
    const view = islandsView(
      new Reader({
        islands: [
          {
            islandId: 'north-pole',
            title: 'N',
            tagline: '',
            isHome: false,
            seasonal: info,
            places: [{ ...place, seasonal: info }, { ...place, seasonal: null }, place],
          },
          { islandId: 'i', title: 'I', tagline: '', isHome: true, places: [place] },
        ],
        autoSelectIslandId: null,
      }),
    );
    expect(view.islands[0].seasonal).toEqual(info);
    expect(view.islands[0].places.map((p) => p.seasonal)).toEqual([info, null, null]);
    expect(view.islands[1].seasonal).toBeNull();
  });

  it('rejects a malformed seasonal field', () => {
    expect(() =>
      islandsView(
        new Reader({
          islands: [
            {
              islandId: 'i',
              title: 'I',
              tagline: '',
              isHome: true,
              seasonal: { slug: 1 },
              places: [],
            },
          ],
          autoSelectIslandId: null,
        }),
      ),
    ).toThrow();
  });
});
