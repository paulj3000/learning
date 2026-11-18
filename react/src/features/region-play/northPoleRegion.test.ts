import { afterEach, describe, expect, it } from 'vitest';
import { read } from '../../api/parse';
import * as parse from '../../api/play/parse';
import { publishRegionCheckpoints, unpublishRegionCheckpoints } from '../discovery/checkpoints';
import {
  gateOpen,
  openCheckpoints,
  resumeCheckpoint,
} from '../island-map/three/extensions/regionPlay/areaEffectsScene';
import { validatePlatforming } from '../island-map/three/platforms/platformSpec';
import { SOURCE_MANIFEST_REGISTRIES } from '../island-map/three/runtime/sourceManifestRegistries';
import { validateLocationManifest } from '../island-map/three/runtime/validateLocationManifest';
import {
  NORTH_POLE,
  NORTH_POLE_PUZZLE_SNAPSHOT,
  NORTH_POLE_SCENE_SNAPSHOT,
  northPoleBootstrapJson,
  type NorthPoleBand,
} from '../../test/northPoleFixtures';
import { NORTH_POLE_KEYS } from '../content-export/northPoleContent';
import { currentPuzzle, placeStone, puzzleForEntity, fittingSlots, solvedPlacements } from './areaPuzzleUi';
import {
  chooseAnswerCorrect,
  firstVariantIndex,
  nextVariantIndex,
  orderSequenceCorrect,
  parsePuzzleParams,
  type ChooseAnswerParams,
  type OrderSequenceParams,
  type PlatformParams,
} from './areaPuzzles';
import { NORTH_POLE_ZONE_AMBIENCE, zoneAmbienceFor } from './audio/regionAudio';
import { buildRegionManifest } from './regionManifest';
import { withServerCatalog } from './regionManifestRepository';
import { STAND_IN_SHAPES, tryParseRegionPlayConfig } from './regionPlayConfig';
import { toRegionSceneModel } from './sceneModel';
import { servedPlaces } from './useServedPlaces';

/** North Pole Village on the client (NP-037, NP-044, NP-053): manifest, scene data, puzzles, audio. */

const BANDS: NorthPoleBand[] = ['SPROUT', 'PATHFINDER', 'EXPLORER'];
const K = NORTH_POLE_KEYS;
const SCENE = NORTH_POLE_SCENE_SNAPSHOT.scene as {
  bounds: { halfExtentX: number; halfExtentZ: number };
  environment: { lighting: Record<string, number> };
  atmosphere: {
    fog: { color: number; near: number; far: number };
    precipitation: { kind: string; density: number };
    skyRibbons: { id: string }[];
  };
  colliders: { id: string }[];
  effects: {
    standIns: { entityId: string; shape: string }[];
    lights: { id: string; shownWhenChangeKey?: string }[];
    openings: { colliderId: string }[];
    checkpoints: { id: string; whenChangeKey?: string }[];
  };
  platforming: { zones: { rect: { id: string } }[] };
};

function bootstrap(options: Parameters<typeof northPoleBootstrapJson>[0] = {}) {
  return read(northPoleBootstrapJson(options), parse.regionBootstrap);
}

function built(options: Parameters<typeof northPoleBootstrapJson>[0] = {}) {
  const data = bootstrap(options);
  return {
    data,
    ...buildRegionManifest(toRegionSceneModel(data), { worldSlug: 'learning-adventure-island' }),
  };
}

function configOf(options: Parameters<typeof northPoleBootstrapJson>[0] = {}) {
  const result = built(options);
  return { ...result, config: tryParseRegionPlayConfig(result.manifest.extensions[0].config)! };
}

afterEach(() => unpublishRegionCheckpoints(NORTH_POLE));

describe('the North Pole manifest', () => {
  it('builds and validates with the catalog Django declares', () => {
    const { data, manifest, checkpoints } = built();
    publishRegionCheckpoints(NORTH_POLE, checkpoints);
    expect(
      validateLocationManifest(manifest, withServerCatalog(SOURCE_MANIFEST_REGISTRIES, data)),
    ).toEqual([]);
  });

  it('is rejected without the server catalog, so nothing undeclared is accepted', () => {
    const { manifest, checkpoints } = built();
    publishRegionCheckpoints(NORTH_POLE, checkpoints);
    const kinds = validateLocationManifest(manifest, SOURCE_MANIFEST_REGISTRIES).map((i) => i.kind);
    expect(kinds).toContain('UNKNOWN_LOCATION');
  });

  it('keeps the seeded bounds, fog, snow, aurora and lighting', () => {
    const { manifest } = built();
    expect(manifest.bounds).toMatchObject({
      halfExtentX: SCENE.bounds.halfExtentX,
      halfExtentZ: SCENE.bounds.halfExtentZ,
    });
    expect(manifest.atmosphere?.fog).toMatchObject(SCENE.atmosphere.fog);
    expect(manifest.atmosphere?.precipitation).toMatchObject(SCENE.atmosphere.precipitation);
    expect(manifest.atmosphere?.skyRibbons?.map((r) => r.id)).toEqual(
      SCENE.atmosphere.skyRibbons.map((r) => r.id),
    );
    expect(manifest.environment.lighting).toEqual(SCENE.environment.lighting);
  });

  it('draws every stand-in with a known shape, and BOX only for the listed work props', () => {
    const { config } = configOf();
    const known = new Set<string>(STAND_IN_SHAPES);
    const shapes = SCENE.effects.standIns.map((s) => s.shape);
    expect(shapes.every((shape) => known.has(shape))).toBe(true);
    // The parsed config keeps the authored shape: nothing fell back to BOX unintentionally.
    const authoredBox = new Set(
      SCENE.effects.standIns.filter((s) => s.shape === 'BOX').map((s) => s.entityId),
    );
    const parsedBox = config.drawn.filter((d) => d.shape === 'BOX').map((d) => d.entityId);
    expect(parsedBox.every((id) => authoredBox.has(id))).toBe(true);
    // Pickups (golden bells, star fragments) are drawn by `pickupLook`, not as stand-ins.
    const pickups = new Set((config.pickups ?? []).map((p) => p.entityId));
    expect(pickups.size).toBeGreaterThan(0);
    for (const stand of SCENE.effects.standIns.filter((s) => s.shape !== 'BOX')) {
      if (pickups.has(stand.entityId)) continue;
      expect(config.drawn.find((d) => d.entityId === stand.entityId)?.shape, stand.entityId).toBe(
        stand.shape,
      );
    }
  });

  it('gives every gate collider an opening that a world change key unlocks', () => {
    const { manifest, config } = configOf();
    const gates = manifest.colliders.map((c) => c.rect.id).filter((id) => id.startsWith('np-gate-'));
    expect(gates.length).toBeGreaterThan(0);
    const opened = new Set(config.effects.openings.map((o) => o.colliderId));
    for (const gate of gates) expect(opened.has(gate), gate).toBe(true);
    expect(SCENE.colliders.map((c) => c.id)).toEqual(expect.arrayContaining(gates));
  });

  it('resumes at the furthest zone the world change keys open', () => {
    const { config } = configOf();
    const keySet = (...keys: string[]) => new Set(keys);
    expect(resumeCheckpoint(config.effects.checkpoints, keySet())).toBeNull();
    expect(resumeCheckpoint(config.effects.checkpoints, keySet(K.welcomeLooked))?.id).toBe(
      'np-cp-workshop',
    );
    const lake = keySet(K.welcomeLooked, K.workshopRestored, K.forestDone, K.lakeDone);
    expect(resumeCheckpoint(config.effects.checkpoints, lake)?.id).toBe('np-cp-stables');
    expect(openCheckpoints(config.effects.checkpoints, keySet()).map((c) => c.id)).toEqual([
      'np-cp-landing',
    ]);
  });

  it('shows the star light and stand-in only after the star is restored', () => {
    const { config } = configOf();
    const star = config.drawn.find((d) => d.entityId === 'np-christmas-star')!;
    expect(star.shownWhenChangeKey).toBe(K.starRestored);
    const light = config.effects.lightGates?.find((gate) => gate.shownWhenChangeKey === K.starRestored);
    expect(light?.id).toBe('np-light-star');
    expect(gateOpen(star, new Set())).toBe(false);
    expect(gateOpen(light!, new Set())).toBe(false);
    expect(gateOpen(star, new Set([K.starRestored]))).toBe(true);
    expect(gateOpen(light!, new Set([K.starRestored]))).toBe(true);
    // The drifts that block each zone clear when its gate opens.
    const drift = config.drawn.find((d) => d.entityId === 'np-drift-workshop')!;
    expect(gateOpen(drift, new Set([K.welcomeLooked]))).toBe(false);
  });

  it('passes the platforming course through and it validates with the client validator', () => {
    const { manifest } = built();
    expect(manifest.platforming?.platforms.length).toBeGreaterThan(0);
    const issues = validatePlatforming(manifest.platforming, {
      propIds: new Set(manifest.props.map((prop) => prop.entityId)),
      zoneIds: new Set(manifest.zones.map((zone) => zone.rect.id)),
      bounds: manifest.bounds,
      solids: manifest.colliders.filter((c) => !c.jumpable).map((c) => c.rect),
    });
    expect(issues).toEqual([]);
    expect(manifest.zones.map((z) => z.rect.id).sort()).toEqual(
      SCENE.platforming.zones.map((z) => z.rect.id).sort(),
    );
  });

  it('passes the child’s world change keys to the scene', () => {
    const { config } = configOf({ keys: [K.welcomeLooked, K.workshopToysCounted] });
    expect(config.changeKeys).toEqual([K.welcomeLooked, K.workshopToysCounted]);
  });
});

describe('North Pole puzzles', () => {
  it('has all 27 puzzles, each parsing for every age band', () => {
    expect(NORTH_POLE_PUZZLE_SNAPSHOT).toHaveLength(27);
    for (const band of BANDS) {
      const { puzzles } = bootstrap({ band });
      expect(puzzles).toHaveLength(27);
      for (const puzzle of puzzles) {
        expect(
          parsePuzzleParams(puzzle.kind, puzzle.parameters),
          `${puzzle.puzzleId} ${band}`,
        ).not.toBeNull();
      }
    }
  });

  it('finds the current puzzle from the world change keys', () => {
    expect(currentPuzzle(bootstrap().puzzles)?.puzzleId).toBe('np-welcome-look');
    const next = bootstrap({ keys: [K.welcomeLooked] });
    expect(currentPuzzle(next.puzzles)?.puzzleId).toBe('np-workshop-count');
  });

  it('finds the puzzle for station objects, floes and sockets', () => {
    const { puzzles } = bootstrap();
    expect(puzzleForEntity(puzzles, 'np-forest-signs-post')?.puzzleId).toBe('np-forest-signs');
    expect(puzzleForEntity(puzzles, 'np-lake-floe-b')?.puzzleId).toBe('np-lake-sums');
    expect(puzzleForEntity(puzzles, 'np-lake-order-floe-d')?.puzzleId).toBe('np-lake-order');
    expect(puzzleForEntity(puzzles, 'np-socket-lake')?.puzzleId).toBe('np-obs-fragments');
    expect(puzzleForEntity(puzzles, 'np-sleigh-bell')?.puzzleId).toBe('np-eve-sleigh-bell');
  });

  it('selects a choice variant and moves to a different one, in every band', () => {
    for (const band of BANDS) {
      const puzzle = bootstrap({ band }).puzzles.find((p) => p.puzzleId === 'np-lake-sums')!;
      const params = parsePuzzleParams(puzzle.kind, puzzle.parameters) as ChooseAnswerParams;
      const variants = params.variants;
      expect(variants.length).toBeGreaterThan(1);
      const first = firstVariantIndex('session-1', puzzle.puzzleId, variants.length);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThan(variants.length);
      expect(nextVariantIndex(first, variants.length)).not.toBe(first);
      const variant = variants[first];
      expect(chooseAnswerCorrect(variant, variant.answer)).toBe(true);
      const wrong = variant.options.find((o) => o.id !== variant.answer)!;
      expect(chooseAnswerCorrect(variant, wrong.id)).toBe(false);
      // Each option sits on a floe: the entity map covers the options.
      expect(Object.values(params.optionEntities).length).toBe(variant.options.length);
    }
  });

  it('grades an order variant and maps star fragments to their sockets', () => {
    const puzzle = bootstrap({ band: 'EXPLORER' }).puzzles.find((p) => p.puzzleId === 'np-obs-fragments')!;
    const params = parsePuzzleParams(puzzle.kind, puzzle.parameters) as OrderSequenceParams;
    const variant = params.variants[0];
    expect(orderSequenceCorrect(variant, variant.answer)).toBe(true);
    expect(orderSequenceCorrect(variant, [...variant.answer].reverse())).toBe(false);
    expect(Object.values(params.itemEntities).every((id) => id.startsWith('np-socket-'))).toBe(true);
  });

  it('fits the gingerbread wall stones to their gaps', () => {
    const puzzle = bootstrap().puzzles.find((p) => p.puzzleId === 'np-ginger-build')!;
    const params = parsePuzzleParams('PLACE_PLATFORMS', puzzle.parameters) as PlatformParams;
    expect(puzzle.entityIds).toHaveLength(params.stones.length + params.slots.length);
    const solved = solvedPlacements(params);
    expect(fittingSlots(params, solved)).toHaveLength(params.slots.length);
    const slot = params.slots[0];
    const wrongStone = params.stones.find((s) => s.size !== slot.gap)!;
    expect(fittingSlots(params, placeStone({}, wrongStone.id, slot.id))).toEqual([]);
  });
});

describe('North Pole audio, ambience and the Places list', () => {
  it('maps every narration zone to an ambience cue', () => {
    const zoneIds = SCENE.platforming.zones.map((z) => z.rect.id);
    expect(zoneIds).toHaveLength(10);
    for (const id of zoneIds) expect(zoneAmbienceFor(NORTH_POLE, id), id).not.toBeNull();
    expect(Object.keys(NORTH_POLE_ZONE_AMBIENCE).sort()).toEqual([...zoneIds].sort());
  });

  it('lists the Place on the harbor map once its 3D Area is available', () => {
    const place = (available: boolean) => ({
      placeId: 'north-pole-village',
      title: 'North Pole Village',
      tagline: '',
      description: '',
      skills: [],
      subjectAreas: [],
      thumbnailAssetId: null,
      adventureCount: 0,
      explored: false,
      area: {
        regionId: NORTH_POLE,
        available,
        title: 'North Pole Village',
        status: 'NOT_STARTED' as const,
        resumeSessionId: null,
      },
    });
    const view = (available: boolean) => ({
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
          places: [place(available)],
        },
      ],
    });
    expect(servedPlaces(view(true)).map((p) => p.regionId)).toEqual([NORTH_POLE]);
    expect(servedPlaces(view(false))).toEqual([]);
  });
});
