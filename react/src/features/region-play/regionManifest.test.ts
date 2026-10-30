import { read } from '../../api/parse';
import * as parse from '../../api/play/parse';
import { publishRegionCheckpoints, unpublishRegionCheckpoints } from '../discovery/checkpoints';
import { SOURCE_MANIFEST_REGISTRIES } from '../island-map/three/runtime/sourceManifestRegistries';
import { validateLocationManifest } from '../island-map/three/runtime/validateLocationManifest';
import { bootstrapJson } from '../../test/playFixtures';
import {
  buildRegionManifest,
  checkpointId,
  DEFAULT_REGION_COPY,
  RegionBuildError,
  REGION_PLAY_EXTENSION_ID,
} from './regionManifest';
import { tryParseRegionPlayConfig } from './regionPlayConfig';
import { toRegionSceneModel } from './sceneModel';

const REGION = 'treasure-rush-cove';
const PIP_WITH_MODEL = {
  entityId: 'cove-pip',
  label: 'Pirate Pip',
  x: 3,
  z: 6,
  elevation: 0,
  rotationY: 0.4,
  scale: 1,
  assetId: 'npc-pip',
  placeholder: { width: 1, height: 1.6, depth: 1 },
  npcId: 'pirate-pip',
  displayName: 'Pirate Pip',
  interactionId: 'meet-pirate-pip',
};

function build(overrides: Record<string, unknown> = {}, chest: Record<string, unknown> = {}) {
  const model = toRegionSceneModel(read(bootstrapJson(overrides, chest), parse.regionBootstrap));
  const clips = (id: string) =>
    SOURCE_MANIFEST_REGISTRIES.assets.find((a) => a.id === id)?.clips ?? [];
  return buildRegionManifest(model, { worldSlug: 'learning-adventure-island', assetClips: clips });
}

function issues(built: ReturnType<typeof build>) {
  publishRegionCheckpoints(REGION, built.checkpoints);
  return validateLocationManifest(built.manifest, SOURCE_MANIFEST_REGISTRIES);
}

afterEach(() => unpublishRegionCheckpoints(REGION));

describe('buildRegionManifest', () => {
  it('builds a manifest the engine’s own validator accepts', () => {
    expect(issues(build())).toEqual([]);
    expect(issues(build({ npcs: [PIP_WITH_MODEL] }))).toEqual([]);
  });

  it('survives a JSON round trip, as every shipped manifest must', () => {
    const { manifest } = build();
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });

  it('spawns at the server’s spawn point, namespaced into the checkpoint catalogue', () => {
    const { manifest, checkpoints } = build();
    expect(checkpoints).toEqual([
      {
        id: checkpointId(REGION, 'cove-landing'),
        regionId: REGION,
        label: 'the landing',
        x: 0,
        z: 10,
        yaw: 0,
      },
    ]);
    expect(manifest.checkpoints.ids).toEqual(['treasure-rush-cove:cove-landing']);
  });

  it('refuses a region without a spawn point', () => {
    expect(() => build({ spawn: null })).toThrow(RegionBuildError);
  });

  it('places an NPC with a model as a real NPC that talks through the extension', () => {
    const { manifest } = build({ npcs: [PIP_WITH_MODEL] });
    expect(manifest.npcs).toEqual([
      {
        entityId: 'cove-pip',
        npcId: 'pirate-pip',
        assetId: 'npc-pip',
        position: { x: 3, z: 6 },
        yaw: 0.4,
        label: 'Pirate Pip',
        idleClip: 'Idle',
        placeholderColor: expect.any(Number),
        placeholderSize: { width: 1, height: 1.6, depth: 1 },
        interactionId: 'treasure-rush-cove:talk:cove-pip',
      },
    ]);
    const talk = manifest.interactions.find((i) => i.targetId === 'cove-pip');
    expect(talk?.action).toEqual({ kind: 'TALK_TO', npcId: 'pirate-pip' });
  });

  it('sizes the stand-in for a model that fails to load from the admin’s placeholder (TR-7a)', () => {
    const bigPip = { ...PIP_WITH_MODEL, scale: 2 };
    expect(build({ npcs: [bigPip] }).manifest.npcs[0]?.placeholderSize).toEqual({
      width: 2,
      height: 3.2,
      depth: 2,
    });
    // Scenery applies its own scale to the stand-in, so the size stays unscaled.
    const rock = build().manifest.scenery.find((s) => s.id === 'cove-rock');
    expect(rock).toMatchObject({
      kind: 'MODEL',
      placeholderSize: { width: 1, height: 1, depth: 1 },
    });
    // A size an admin left at zero falls back to the runtime default instead of failing validation.
    const flatPip = { ...PIP_WITH_MODEL, placeholder: { width: 1, height: 0, depth: 1 } };
    expect(build({ npcs: [flatPip] }).manifest.npcs[0]).not.toHaveProperty('placeholderSize');
  });

  it('draws an NPC without a model as a placeholder figure that still talks', () => {
    const { manifest } = build();
    expect(manifest.npcs).toEqual([]);
    const figure = manifest.props.find((p) => p.entityId === 'cove-pip');
    expect(figure?.assetId).toBeUndefined();
    expect(figure?.interactionId).toBe('treasure-rush-cove:talk:cove-pip');
    const config = tryParseRegionPlayConfig(manifest.extensions[0].config);
    expect(config?.figures).toEqual([{ entityId: 'cove-pip', height: 1.6 }]);
  });

  it('leaves every chest to the extension, with the child’s open state from the server', () => {
    const closed = build();
    const chest = closed.manifest.props.find((p) => p.entityId === 'cove-chest');
    expect(chest).toMatchObject({ position: { x: 0, z: -6 }, label: 'Treasure chest' });
    expect(chest?.assetId).toBeUndefined();
    expect(chest?.interactClip).toBeUndefined(); // interacting never opens it
    const config = tryParseRegionPlayConfig(closed.manifest.extensions[0].config);
    expect(config?.chests).toEqual([
      {
        entityId: 'cove-chest',
        assetId: 'treasure-chest',
        openClip: 'Open',
        isOpen: false,
        scale: 1,
        placeholder: { width: 1.2, height: 0.9, depth: 0.8 },
      },
    ]);
    const open = tryParseRegionPlayConfig(
      build({}, { isOpen: true }).manifest.extensions[0].config,
    );
    expect(open?.chests[0].isOpen).toBe(true);
  });

  it('binds every NPC and chest interaction to the region-play extension', () => {
    const { manifest } = build();
    expect(manifest.extensions.map((e) => e.extensionId)).toEqual([REGION_PLAY_EXTENSION_ID]);
    const config = tryParseRegionPlayConfig(manifest.extensions[0].config);
    expect(config?.interactions.map((i) => [i.kind, i.entityId])).toEqual([
      ['npc', 'cove-pip'],
      ['chest', 'cove-chest'],
    ]);
    expect(manifest.interactions.map((i) => i.id).sort()).toEqual(
      config?.interactions.map((i) => i.interactionId).sort(),
    );
  });

  it('places objects as scenery: a model when there is one, a box of the admin’s size when not', () => {
    const withModel = build().manifest.scenery.find((s) => s.id === 'cove-rock');
    expect(withModel).toMatchObject({
      kind: 'MODEL',
      assetId: 'rock',
      position: { x: -4, y: 0, z: 2 },
      scale: { x: 2, y: 2, z: 2 },
    });
    const noModel = {
      ...bootstrapJson().objects[0],
      assetId: '',
      placeholder: { width: 2, height: 1, depth: 4 },
      scale: 1,
    };
    const box = build({ objects: [noModel] }).manifest.scenery.find((s) => s.id === 'cove-rock');
    expect(box).toMatchObject({
      kind: 'BOX',
      area: { minX: -5, maxX: -3, minZ: 0, maxZ: 4 },
      minY: 0,
      maxY: 1,
    });
    expect(issues(build({ objects: [noModel] }))).toEqual([]);
  });

  it('takes bounds, background, and copy from the admin’s scene, with safe defaults', () => {
    const { manifest } = build();
    expect(manifest.bounds).toEqual({ halfExtentX: 18, halfExtentZ: 18, wallThickness: 1 });
    expect(manifest.copy.loading).toBe(DEFAULT_REGION_COPY.loading);
    const authored = build({
      region: {
        ...bootstrapJson().region,
        scene: {
          bounds: { halfExtentX: 10, halfExtentZ: 12, wallThickness: 1 },
          environment: { backgroundColor: 0x123456 },
          copy: {
            loading: 'Sailing to Treasure Cove.',
            instructions: 'Find the chest.',
            calmStop: 'Time to rest.',
          },
        },
      },
    }).manifest;
    expect(authored.bounds.halfExtentX).toBe(10);
    expect(authored.environment.backgroundColor).toBe(0x123456);
    expect(authored.copy).toMatchObject({
      loading: 'Sailing to Treasure Cove.',
      calmStop: 'Time to rest.',
    });
  });

  it('is reported by the validator when the server names an asset the catalogue lacks', () => {
    const found = issues(build({}, { assetId: 'no-such-chest' }));
    expect(found.map((issue) => issue.kind)).toContain('UNKNOWN_ASSET');
  });
});
