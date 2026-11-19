import { solidColliders } from '../island-map/three/runtime/sceneLayout';
import { read } from '../../api/parse';
import * as parse from '../../api/play/parse';
import { publishRegionCheckpoints, unpublishRegionCheckpoints } from '../discovery/checkpoints';
import { SOURCE_MANIFEST_REGISTRIES } from '../island-map/three/runtime/sourceManifestRegistries';
import { validateLocationManifest } from '../island-map/three/runtime/validateLocationManifest';
import { bootstrapJson, coveSceneJson } from '../../test/playFixtures';
import {
  buildRegionManifest,
  checkpointId,
  DEFAULT_REGION_COPY,
  REGION_ACTIONS,
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

  it('turns on child-friendly interaction, with a verb for each role (TR-12)', () => {
    const { manifest } = build({ npcs: [PIP_WITH_MODEL] });
    expect(manifest.interactionAssist).toBe(true);
    expect(manifest.npcs[0]?.action).toBe(REGION_ACTIONS.talk);
    expect(manifest.props.find((prop) => prop.entityId === 'cove-chest')?.action).toBe(
      REGION_ACTIONS.open,
    );
    // An NPC without a model is drawn as a prop, and still says Talk.
    const figure = build().manifest.props.find((prop) => prop.entityId === 'cove-pip');
    expect(figure?.action).toBe(REGION_ACTIONS.talk);
  });

  it('gives Treasure Cove jumping by default, with its barrels as jumpable obstacles (LAI-JMP-01)', async () => {
    const region = { ...bootstrapJson().region, scene: await coveSceneJson() };
    const built = build({ region });
    expect(issues(built)).toEqual([]);
    expect(built.manifest.movement).toBeUndefined();
    // No authored jumpable colliders: the barrels' stand-ins are jumpable derived boxes, and the
    // library barrels drawn over them carry their own jumpable colliders (layout v8).
    expect(built.manifest.colliders.filter((collider) => collider.jumpable)).toEqual([]);
    const solids = solidColliders(built.manifest);
    const landing = solids.filter((solid) => solid.id?.startsWith('derived:cove-landing-barrels#'));
    expect(landing).toHaveLength(4);
    expect(landing.every((solid) => solid.jumpable)).toBe(true);
  });

  it('carries a Django-authored camera and avatar, which the validator checks (LAI-JMP-01a)', async () => {
    const scene = { ...(await coveSceneJson()), player: { camera: { distance: 3 } } };
    const built = build({ region: { ...bootstrapJson().region, scene } });
    expect(built.manifest.player).toEqual({ camera: { distance: 3 } });
    expect(issues(built)).toEqual([]);
    const bad = build({
      region: { ...bootstrapJson().region, scene: { ...scene, player: { camera: { mode: 'x' } } } },
    });
    expect(issues(bad).map((issue) => issue.path)).toEqual(['player.camera.mode']);
    const plain = build({ region: { ...bootstrapJson().region, scene: await coveSceneJson() } });
    expect(plain.manifest.player).toBeUndefined();
  });

  it('carries Django-authored running and sprinting speeds, which the validator checks', async () => {
    const scene = {
      ...(await coveSceneJson()),
      movement: { locomotion: { sprintEnabled: false, runSpeed: 5 } },
    };
    const built = build({ region: { ...bootstrapJson().region, scene } });
    expect(built.manifest.movement).toEqual({ locomotion: { sprintEnabled: false, runSpeed: 5 } });
    expect(issues(built)).toEqual([]);
  });

  it('carries Django-authored movement tuning, which the validator checks (LAI-JMP-01)', async () => {
    const scene = { ...(await coveSceneJson()), movement: { jump: { enabled: false } } };
    const built = build({ region: { ...bootstrapJson().region, scene } });
    expect(built.manifest.movement).toEqual({ jump: { enabled: false } });
    expect(issues(built)).toEqual([]);

    const typo = { ...scene, movement: { jump: { jumpHieght: 2 } } };
    const bad = build({ region: { ...bootstrapJson().region, scene: typo } });
    expect(issues(bad).map((issue) => issue.path)).toEqual(['movement.jump.jumpHieght']);
  });

  it('builds the five-zone cove from its layout, and the engine’s validator accepts it (TR-13)', async () => {
    const region = { ...bootstrapJson().region, scene: await coveSceneJson() };
    const built = build({ region });
    expect(issues(built)).toEqual([]);
    const { manifest } = built;
    expect(manifest.bounds).toEqual({ halfExtentX: 36, halfExtentZ: 44, wallThickness: 1 });
    expect(manifest.zones).toHaveLength(5); // landing, grove, beach, ruins, lookout (SM-P7)
    expect(manifest.colliders.length).toBeGreaterThan(20);
    expect(manifest.ambient).toHaveLength(4);
    expect(manifest.lights).toHaveLength(2);
    // The grass the region always gets comes first; the layout lies on it.
    expect(manifest.scenery[0]?.kind).toBe('TILED_GROUND');
    expect(manifest.scenery.map((item) => item.id)).toContain('cove-shipwreck');
    const config = tryParseRegionPlayConfig(manifest.extensions[0]!.config);
    expect(config?.procedural?.map((item) => item.id)).toContain('cove-ruins-gate');
  });

  it('carries what the quest opens (TR-17), unlocked only for a child who earned it', async () => {
    const region = { ...bootstrapJson().region, scene: await coveSceneJson() };
    const closed = tryParseRegionPlayConfig(build({ region }).manifest.extensions[0]!.config);
    expect(closed?.unlock?.changeKey).toBe('TREASURE_COVE_QUEST_COMPLETE');
    expect(closed?.unlock?.unlocked).toBe(false);
    expect(closed?.unlock?.openColliders).toEqual([
      'cove-ruins-gate:collider',
      'cove-channel-gap:collider',
    ]);

    const earned = {
      locationSlug: 'pirate-builder-bay',
      changeType: 'UNLOCK',
      changeKey: 'TREASURE_COVE_QUEST_COMPLETE',
      payload: {},
      createdAt: '2026-11-02T18:00:00.000000Z',
    };
    const open = tryParseRegionPlayConfig(
      build({ region, worldChanges: [earned] }).manifest.extensions[0]!.config,
    );
    expect(open?.unlock?.unlocked).toBe(true);
    // A different location's change of the same name does not open it.
    const elsewhere = tryParseRegionPlayConfig(
      build({ region, worldChanges: [{ ...earned, locationSlug: 'wonderwild-forest' }] }).manifest
        .extensions[0]!.config,
    );
    expect(elsewhere?.unlock?.unlocked).toBe(false);
  });

  it('every collider the unlock opens is one the manifest really has (TR-17)', async () => {
    const region = { ...bootstrapJson().region, scene: await coveSceneJson() };
    const { manifest } = build({ region });
    const config = tryParseRegionPlayConfig(manifest.extensions[0]!.config);
    const ids = manifest.colliders.map((collider) => collider.rect.id);
    for (const id of config?.unlock?.openColliders ?? []) expect(ids).toContain(id);
  });

  it('gives a region with no unlock or ambience none (a source or older region)', () => {
    const config = tryParseRegionPlayConfig(build().manifest.extensions[0]!.config);
    expect(config?.unlock).toBeUndefined();
    expect(config?.ambience).toBeUndefined();
  });

  it('looks through a spyglass rather than opening it (TR-20)', () => {
    const built = build(
      {},
      { entityId: 'cove-lookout-spyglass', presentation: 'REPLAY', label: 'Lookout spyglass' },
    );
    const spyglass = built.manifest.props.find((prop) => prop.label === 'Lookout spyglass');
    expect(spyglass?.action).toBe(REGION_ACTIONS.look);
    const config = tryParseRegionPlayConfig(built.manifest.extensions[0]!.config);
    expect(config?.chests.find((c) => c.entityId === 'cove-lookout-spyglass')?.presentation).toBe(
      'REPLAY',
    );
  });

  it('fails a region whose layout is malformed, naming where', () => {
    const region = {
      ...bootstrapJson().region,
      scene: { layout: { scenery: [{ kind: 'VOLCANO', id: 'v' }] } },
    };
    expect(() => build({ region })).toThrow(
      new RegionBuildError('scene.layout.scenery[0].kind', 'unsupported scenery kind "VOLCANO"'),
    );
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
        action: 'Talk',
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
    expect(authored.copy).toMatchObject({ loading: 'Sailing to Treasure Cove.' });
    // Legacy content may still carry the retired play-time stop; it never reaches the child.
    expect(authored.copy).not.toHaveProperty('calmStop');
  });

  it('is reported by the validator when the server names an asset the catalogue lacks', () => {
    const found = issues(build({}, { assetId: 'no-such-chest' }));
    expect(found.map((issue) => issue.kind)).toContain('UNKNOWN_ASSET');
  });
});
