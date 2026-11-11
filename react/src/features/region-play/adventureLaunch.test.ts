import { read } from '../../api/parse';
import { areaForPlace, islandsView } from '../../api/play/islandsApi';
import * as parse from '../../api/play/parse';
import { createPlayApi } from '../../api/play/playApi';
import type { ApiClient } from '../../api/client';
import { publishRegionCheckpoints, unpublishRegionCheckpoints } from '../discovery/checkpoints';
import { SOURCE_MANIFEST_REGISTRIES } from '../island-map/three/runtime/sourceManifestRegistries';
import { validateLocationManifest } from '../island-map/three/runtime/validateLocationManifest';
import {
  CHILD_A,
  CHILD_B,
  bootstrapJson,
  launchPointJson,
  launchStartJson,
  signpostJson,
} from '../../test/playFixtures';
import { buildRegionManifest } from './regionManifest';
import { tryParseRegionPlayConfig } from './regionPlayConfig';
import { resolveRegionPlayInteraction } from './regionPlayInteractions';
import { toRegionSceneModel } from './sceneModel';
import { adventurePath, safeReturnPath } from './useAdventureLaunch';

/**
 * ADR-041 decision C on the client: an object in a 3D Area that starts one of its Place's
 * Adventures, built into the manifest the engine already runs, claimed by `region-play`, and
 * started only through the server.
 */

const REGION = 'treasure-rush-cove';
const SIGNPOST = `${REGION}:launch:cove-bridge-signpost`;

function build(overrides: Record<string, unknown> = {}) {
  const bootstrap = read(
    bootstrapJson({ objects: [signpostJson()], launchPoints: [launchPointJson()], ...overrides }),
    parse.regionBootstrap,
  );
  const built = buildRegionManifest(toRegionSceneModel(bootstrap), {
    worldSlug: 'learning-adventure-island',
  });
  const config = tryParseRegionPlayConfig(built.manifest.extensions[0].config);
  if (!config) throw new Error('config did not parse');
  return { bootstrap, built, config };
}

afterEach(() => unpublishRegionCheckpoints(REGION));

describe('launch objects in the manifest', () => {
  it('makes a launch object an interactive prop the engine’s validator accepts', () => {
    const { built, config } = build();
    const prop = built.manifest.props.find((p) => p.entityId === 'cove-bridge-signpost');
    expect(prop).toMatchObject({ assetId: 'signpost', interactionId: SIGNPOST });
    expect(config.interactions).toContainEqual({
      interactionId: SIGNPOST,
      kind: 'launch',
      entityId: 'cove-bridge-signpost',
      npcId: null,
    });
    publishRegionCheckpoints(REGION, built.checkpoints);
    expect(validateLocationManifest(built.manifest, SOURCE_MANIFEST_REGISTRIES)).toEqual([]);
  });

  it('keeps a launch object without a model as a placeholder box reached from the list', () => {
    const { built } = build({ objects: [signpostJson({ assetId: '' })] });
    expect(built.manifest.props.some((p) => p.entityId === 'cove-bridge-signpost')).toBe(false);
    expect(built.manifest.scenery.some((s) => s.id === 'cove-bridge-signpost')).toBe(true);
    expect(built.manifest.interactions.some((i) => i.id === SIGNPOST)).toBe(true);
  });

  it('leaves an object without launch points as plain scenery', () => {
    const { built, config } = build({ launchPoints: [] });
    expect(built.manifest.props.some((p) => p.entityId === 'cove-bridge-signpost')).toBe(false);
    expect(config.interactions.some((i) => i.kind === 'launch')).toBe(false);
  });

  it('never turns a Treasure Rush chest into a launch object', () => {
    const { config } = build({ launchPoints: [launchPointJson({ entityId: 'cove-chest' })] });
    expect(config.interactions.find((i) => i.entityId === 'cove-chest')?.kind).toBe('chest');
  });
});

describe('resolving a launch interaction', () => {
  it('offers the object’s adventures as the server listed them', () => {
    const { bootstrap, config } = build();
    const event = resolveRegionPlayInteraction(config, bootstrap, SIGNPOST, true);
    expect(event).toEqual({
      kind: 'launch',
      entityId: 'cove-bridge-signpost',
      label: 'Bridge signpost',
      launches: bootstrap.launchPoints,
    });
  });

  it('offers nothing when the server no longer lists a launch point there', () => {
    const { config } = build();
    const stale = read(bootstrapJson({ objects: [signpostJson()] }), parse.regionBootstrap);
    expect(resolveRegionPlayInteraction(config, stale, SIGNPOST, true)).toBeNull();
  });

  it('gives an NPC its adventures next to its quests', () => {
    const { bootstrap, config } = build({
      launchPoints: [launchPointJson({ entityId: 'cove-pip', objectKind: 'NPC' })],
    });
    const event = resolveRegionPlayInteraction(config, bootstrap, `${REGION}:talk:cove-pip`, true);
    expect(event?.kind === 'npc' && event.launches.map((l) => l.launchId)).toEqual([
      'signpost-repair-the-moonlight-bridge',
    ]);
  });
});

describe('the play API contract', () => {
  it('reads a bootstrap from a server without launch points as having none', () => {
    const json = bootstrapJson();
    expect('launchPoints' in json).toBe(false);
    expect(read(json, parse.regionBootstrap).launchPoints).toEqual([]);
  });

  it('refuses a launch point of an unknown kind', () => {
    expect(() =>
      read(
        bootstrapJson({ launchPoints: [launchPointJson({ objectKind: 'SCRIPT' })] }),
        parse.regionBootstrap,
      ),
    ).toThrow();
  });

  it('starts a launch point with an empty body on the child-scoped route', async () => {
    const request = vi.fn(async () => ({ status: 201, data: launchStartJson() }));
    const api = createPlayApi({ request } as unknown as ApiClient, CHILD_A);
    const result = await api.startLaunchPoint(REGION, 'signpost-repair-the-moonlight-bridge');
    expect(request).toHaveBeenCalledWith(
      'POST',
      `children/${CHILD_A}/regions/${REGION}/launch-points/signpost-repair-the-moonlight-bridge/start/`,
      { body: {}, signal: undefined },
    );
    expect(result).toEqual({
      created: true,
      value: {
        launchId: 'signpost-repair-the-moonlight-bridge',
        regionId: REGION,
        adventureId: 'repair-the-moonlight-bridge',
        placeSlug: 'pirate-builder-bay',
        sessionId: '6b1d2c84-1b7e-4a52-9b0e-2f5d9c3e7a10',
        returnTo: { regionId: REGION },
      },
    });
  });
});

describe('the way back to the 3D Area', () => {
  const start = read(launchStartJson(), parse.launchStart);

  it('opens the Place’s adventure with a return path to this 3D Area', () => {
    const path = adventurePath(CHILD_A, start);
    const [route, query] = path.split('?');
    expect(route).toBe(
      `/island/${CHILD_A}/locations/pirate-builder-bay/adventures/repair-the-moonlight-bridge`,
    );
    const back = new URLSearchParams(query).get('returnTo');
    expect(back).toBe(`/island/${CHILD_A}/explore/${REGION}`);
    expect(safeReturnPath(CHILD_A, back)).toBe(back);
  });

  it.each([
    ['another child', `/island/${CHILD_B}/explore/${REGION}`],
    ['an external site', 'https://example.com/island/x/explore/y'],
    ['a protocol-relative URL', '//example.com/island'],
    ['another page', `/island/${CHILD_A}/log`],
    ['a query', `/island/${CHILD_A}/explore/${REGION}?x=1`],
    ['nothing', null],
  ])('ignores %s', (_label, value) => {
    expect(safeReturnPath(CHILD_A, value)).toBeNull();
  });
});

describe('islands and places', () => {
  const view = read(
    {
      islands: [
        {
          islandId: 'learning-adventure-island',
          title: 'Learning Adventure Island',
          tagline: '',
          isHome: true,
          places: [
            {
              placeId: 'pirate-builder-bay',
              title: 'Pirate Builder Bay',
              tagline: '',
              adventureCount: 1,
              area: {
                regionId: REGION,
                title: 'Treasure Cove',
                available: true,
                status: 'NOT_STARTED',
              },
            },
            {
              placeId: 'wonderwild-forest',
              title: 'Wonderwild Forest',
              tagline: '',
              adventureCount: 2,
              area: null,
            },
          ],
        },
      ],
      autoSelectIslandId: 'learning-adventure-island',
    },
    islandsView,
  );

  it('finds a Place’s 3D Area, and none for a Place without one', () => {
    expect(areaForPlace(view, 'pirate-builder-bay')).toEqual({
      regionId: REGION,
      title: 'Treasure Cove',
      available: true,
      // AP-03 defaults when the server sends no status or resume.
      status: 'NOT_STARTED',
      resumeSessionId: null,
    });
    expect(areaForPlace(view, 'wonderwild-forest')).toBeNull();
    expect(areaForPlace(view, 'nowhere')).toBeNull();
    expect(view.autoSelectIslandId).toBe('learning-adventure-island');
  });
});
