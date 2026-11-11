import { afterEach, describe, expect, it } from 'vitest';
import { read } from '../../api/parse';
import * as parse from '../../api/play/parse';
import { unpublishRegionCheckpoints, publishRegionCheckpoints } from '../discovery/checkpoints';
import { SOURCE_MANIFEST_REGISTRIES } from '../island-map/three/runtime/sourceManifestRegistries';
import { validateLocationManifest } from '../island-map/three/runtime/validateLocationManifest';
import { FIREPEAK, FIREPEAK_KEYS, firepeakBootstrapJson } from '../../test/firepeakFixtures';
import {
  currentPuzzle,
  fittingSlots,
  journalEntries,
  placeStone,
  puzzleForEntity,
  removeStone,
  solvedPlacements,
} from './areaPuzzleUi';
import { dueHint, parsePuzzleParams, type PlatformParams, type ValveParams } from './areaPuzzles';
import { buildRegionManifest, REGION_PLAY_EXTENSION_ID } from './regionManifest';
import { withServerCatalog } from './regionManifestRepository';
import { parseEffects, tryParseRegionPlayConfig } from './regionPlayConfig';
import { resolveRegionPlayInteraction } from './regionPlayInteractions';
import { toRegionSceneModel } from './sceneModel';
import { servedPlaces } from './useServedPlaces';

/** Firepeak Volcano on the client (ADR-047, FP-3 to FP-12): manifest, config, rules, copy. */

function bootstrap(options: Parameters<typeof firepeakBootstrapJson>[0] = {}) {
  return read(firepeakBootstrapJson(options), parse.regionBootstrap);
}

function built(options: Parameters<typeof firepeakBootstrapJson>[0] = {}) {
  const data = bootstrap(options);
  return {
    data,
    ...buildRegionManifest(toRegionSceneModel(data), { worldSlug: 'learning-adventure-island' }),
  };
}

afterEach(() => unpublishRegionCheckpoints(FIREPEAK));

describe('the Firepeak manifest', () => {
  it('validates against the bundled registries plus what Django declares', () => {
    const { data, manifest, checkpoints } = built();
    publishRegionCheckpoints(FIREPEAK, checkpoints);
    expect(
      validateLocationManifest(manifest, withServerCatalog(SOURCE_MANIFEST_REGISTRIES, data)),
    ).toEqual([]);
  });

  it('is rejected without the server catalog, so nothing undeclared is accepted', () => {
    const { manifest, checkpoints } = built();
    publishRegionCheckpoints(FIREPEAK, checkpoints);
    const kinds = validateLocationManifest(manifest, SOURCE_MANIFEST_REGISTRIES).map((i) => i.kind);
    expect(kinds).toContain('UNKNOWN_LOCATION');
  });

  it('carries the seed-authored colliders and lights', () => {
    const { manifest } = built();
    expect(manifest.colliders.map((c) => c.rect.id)).toEqual(['firepeak-sealed-passage']);
    expect(manifest.lights?.map((light) => light.id)).toEqual(['glow']);
  });

  it('draws models that are not published yet as stand-ins, never as missing boxes', () => {
    const { manifest } = built();
    const config = tryParseRegionPlayConfig(manifest.extensions[0].config)!;
    const tent = config.drawn.find((d) => d.entityId === 'firepeak-tent');
    expect(tent).toMatchObject({ shape: 'TENT', assetId: null });
    // Ember has no delivered model: a figure, not an NPC spec with a missing model.
    expect(manifest.npcs).toEqual([]);
    expect(config.figures.map((f) => f.entityId)).toEqual(['firepeak-ember']);
    // A delivered model (the rock) is ordinary scenery.
    expect(manifest.scenery.some((s) => s.id === 'firepeak-rock-1' && s.kind === 'MODEL')).toBe(
      true,
    );
    expect(config.effects.backdrop?.assetId).toBeNull();
  });

  it('loads a published model in place of its stand-in with no code change', () => {
    const { manifest } = built({
      deliverable: ['rock', 'ground-tile-stone', 'firepeak-telescope', 'firepeak-professor-ember'],
    });
    const config = tryParseRegionPlayConfig(manifest.extensions[0].config)!;
    expect(config.drawn.find((d) => d.entityId === 'firepeak-telescope')?.assetId).toBe(
      'firepeak-telescope',
    );
    expect(manifest.npcs.map((npc) => npc.assetId)).toEqual(['firepeak-professor-ember']);
  });

  it('binds every puzzle object and the way back to the region-play extension', () => {
    const { manifest } = built();
    const config = tryParseRegionPlayConfig(manifest.extensions[0].config)!;
    const kinds = Object.fromEntries(config.interactions.map((i) => [i.entityId, i.kind]));
    expect(kinds['firepeak-telescope']).toBe('puzzle');
    expect(kinds['firepeak-gap-near']).toBe('puzzle');
    expect(kinds['firepeak-valve-red']).toBe('puzzle');
    expect(kinds['firepeak-return-lift']).toBe('return');
    expect(kinds['firepeak-ember']).toBe('npc');
    expect(manifest.extensions.map((e) => e.extensionId)).toEqual([REGION_PLAY_EXTENSION_ID]);
  });

  it('passes the child’s world change keys to the scene', () => {
    const { manifest } = built({ solved: ['firepeak-telescope', 'firepeak-crossing'] });
    const config = tryParseRegionPlayConfig(manifest.extensions[0].config)!;
    expect(config.changeKeys).toEqual([FIREPEAK_KEYS.observed, FIREPEAK_KEYS.crossing]);
  });
});

describe('region-play config parsing', () => {
  it('reads an older config with no Firepeak fields as before', () => {
    const config = tryParseRegionPlayConfig({ chests: [], figures: [], interactions: [] });
    expect(config).toMatchObject({ drawn: [], puzzles: [], changeKeys: [] });
    expect(config?.effects.lava).toEqual([]);
  });

  it('drops unreadable effects instead of failing the region', () => {
    const effects = parseEffects({
      lava: [
        { id: 'bad', minX: 3, maxX: 1, minZ: 0, maxZ: 1 },
        { id: 'ok', minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
      ],
      checkpoints: [{ id: 'c' }],
    });
    expect(effects.lava.map((band) => band.id)).toEqual(['ok']);
    expect(effects.checkpoints).toEqual([]);
  });
});

describe('interactions', () => {
  it('resolves a puzzle object, the way back, and Ember with her return stage', () => {
    const data = bootstrap({
      solved: [
        'firepeak-telescope',
        'firepeak-crossing',
        'firepeak-steam',
        'firepeak-heart-crystal',
      ],
    });
    const { manifest } = buildRegionManifest(toRegionSceneModel(data), {
      worldSlug: 'learning-adventure-island',
    });
    const config = tryParseRegionPlayConfig(manifest.extensions[0].config)!;
    const id = (entity: string) =>
      config.interactions.find((i) => i.entityId === entity)!.interactionId;

    expect(
      resolveRegionPlayInteraction(config, data, id('firepeak-valve-red'), true),
    ).toMatchObject({
      kind: 'puzzle',
      puzzle: { puzzleId: 'firepeak-steam' },
    });
    expect(resolveRegionPlayInteraction(config, data, id('firepeak-return-lift'), true)?.kind).toBe(
      'return',
    );
    const ember = resolveRegionPlayInteraction(config, data, id('firepeak-ember'), true);
    expect(ember).toMatchObject({
      kind: 'npc',
      returnPuzzle: { puzzleId: 'firepeak-return', locked: false },
    });
    expect(ember?.kind === 'npc' && ember.dialogue[0].nodeId).toBe('ember-greeting');
  });
});

describe('puzzle parameters and helpers', () => {
  const data = bootstrap();
  const crossing = data.puzzles.find((p) => p.kind === 'PLACE_PLATFORMS')!;
  const platforms = parsePuzzleParams('PLACE_PLATFORMS', crossing.parameters) as PlatformParams;

  it('parses every Firepeak puzzle for its band', () => {
    for (const puzzle of data.puzzles) {
      expect(parsePuzzleParams(puzzle.kind, puzzle.parameters), puzzle.puzzleId).not.toBeNull();
    }
    const valves = parsePuzzleParams('VALVE_SEQUENCE', data.puzzles[2].parameters) as ValveParams;
    expect(valves.showSteamPath).toBe(true);
  });

  it('refuses unusable parameters', () => {
    expect(parsePuzzleParams('OBSERVE_FEATURES', { intro: 'Look', features: [] })).toBeNull();
    expect(
      parsePuzzleParams('PLACE_PLATFORMS', { intro: 'Fill', stones: [{ id: 's' }], slots: [] }),
    ).toBeNull();
    expect(parsePuzzleParams('VALVE_SEQUENCE', { intro: '', valves: [] })).toBeNull();
    expect(
      parsePuzzleParams('OBSERVE_FEATURES', { intro: 'Look', hints: [3], features: [] }),
    ).toBeNull();
  });

  it('offers a hint only after the authored number of wrong tries', () => {
    expect(dueHint(platforms, 1)).toBeNull();
    expect(dueHint(platforms, 2)).toBe(platforms.hints[0]);
    expect(dueHint(platforms, 9)).toBe(platforms.hints[0]);
  });

  it('places, swaps and removes stones, and knows which ones fit', () => {
    let placements = placeStone({}, 'firepeak-stone-small', 'firepeak-gap-near');
    placements = placeStone(placements, 'firepeak-stone-small', 'firepeak-gap-middle');
    expect(placements).toEqual({ 'firepeak-gap-middle': 'firepeak-stone-small' });
    placements = placeStone(placements, 'firepeak-stone-middle', 'firepeak-gap-middle');
    expect(placements).toEqual({ 'firepeak-gap-middle': 'firepeak-stone-middle' });
    expect(fittingSlots(platforms, placements)).toEqual(['firepeak-gap-middle']);
    expect(removeStone(placements, 'firepeak-stone-middle')).toEqual({});
  });

  it('rebuilds a solved crossing from its parameters', () => {
    const placements = solvedPlacements(platforms);
    expect(fittingSlots(platforms, placements)).toHaveLength(3);
  });

  it('finds the current stage and a puzzle by its object', () => {
    const solved = bootstrap({ solved: ['firepeak-telescope'] });
    expect(currentPuzzle(solved.puzzles)?.puzzleId).toBe('firepeak-crossing');
    expect(puzzleForEntity(solved.puzzles, 'firepeak-gap-far')?.puzzleId).toBe('firepeak-crossing');
  });

  it('lists journal entries oldest first, from server inventory only', () => {
    const item = (itemId: string, journal: boolean) => ({
      itemId,
      displayName: itemId,
      description: 'd',
      category: 'COLLECTIBLE' as const,
      assetId: '',
      setId: journal ? 'firepeak-discovery-journal' : null,
      journal: journal
        ? {
            subject: 'EARTH_SCIENCE' as const,
            questId: 'the-volcano-awakens',
            illustrationAssetId: null,
          }
        : null,
    });
    const entries = journalEntries([
      { item: item('journal-lava', true), grantedAt: '2026-11-01T10:02:00Z' },
      { item: item('badge', false), grantedAt: '2026-11-01T10:00:00Z' },
      { item: item('journal-volcano-crater', true), grantedAt: '2026-11-01T10:01:00Z' },
    ]);
    expect(entries.map((e) => e.itemId)).toEqual(['journal-volcano-crater', 'journal-lava']);
    expect(entries[0].subject).toBe('Earth science');
  });
});

describe('Places served by Django on the harbor map', () => {
  const place = (placeId: string, area: { regionId: string; available: boolean } | null) => ({
    placeId,
    title: placeId,
    tagline: '',
    description: '',
    skills: [],
    subjectAreas: [],
    thumbnailAssetId: null,
    adventureCount: 0,
    explored: false,
    area: area
      ? { ...area, title: placeId, status: 'NOT_STARTED' as const, resumeSessionId: null }
      : null,
  });

  it('lists only Django-only Places with an available 3D Area on the home Island', () => {
    const places = servedPlaces({
      autoSelectIslandId: null,
      islands: [
        {
          islandId: 'learning-adventure-island',
          title: 'Home',
          tagline: '',
          isHome: true,
          description: '',
          ageBands: [],
          subjects: [],
          subjectAreas: [],
          thumbnailAssetId: null,
          unlocked: true,
          lockedHint: null,
          progress: null,
          places: [
            place('firepeak-volcano', { regionId: 'firepeak-volcano', available: true }),
            place('pirate-builder-bay', { regionId: 'treasure-rush-cove', available: true }),
            place('quiet-place', null),
          ],
        },
        {
          islandId: 'creature-care-cove',
          title: 'Cove',
          tagline: '',
          isHome: false,
          description: '',
          ageBands: [],
          subjects: [],
          subjectAreas: [],
          thumbnailAssetId: null,
          unlocked: true,
          lockedHint: null,
          progress: null,
          places: [place('elsewhere', { regionId: 'elsewhere', available: true })],
        },
      ],
    });
    expect(places.map((p) => p.regionId)).toEqual(['firepeak-volcano']);
  });
});
