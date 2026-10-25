import { read } from '../../api/parse';
import * as parse from '../../api/play/parse';
import { bootstrapJson, questJson } from '../../test/playFixtures';
import { findEntity, toRegionSceneModel } from './sceneModel';

const model = (overrides = {}, chest = {}) =>
  toRegionSceneModel(read(bootstrapJson(overrides, chest), parse.regionBootstrap));

describe('toRegionSceneModel', () => {
  it('gives TR-7 every entity by id, with role and position', () => {
    const scene = model();
    expect(scene.entities.map((e) => [e.entityId, e.role])).toEqual([
      ['cove-pip', 'npc'],
      ['cove-rock', 'object'],
      ['cove-chest', 'chest'],
    ]);
    expect(findEntity(scene, 'cove-chest')?.position).toEqual({ x: 0, z: -6, elevation: 0 });
    expect(scene.spawn).toEqual({
      checkpointId: 'cove-landing',
      label: 'the landing',
      x: 0,
      z: 10,
      yaw: 0,
    });
    expect(scene.regionId).toBe('treasure-rush-cove');
  });

  it('turns an empty asset id into a placeholder request', () => {
    const scene = model();
    expect(findEntity(scene, 'cove-pip')?.assetId).toBeNull();
    expect(findEntity(scene, 'cove-pip')?.placeholder).toEqual({ width: 1, height: 1.6, depth: 1 });
    expect(findEntity(scene, 'cove-chest')?.assetId).toBe('treasure-chest');
  });

  it('carries the chest state the server reported', () => {
    expect(findEntity(model(), 'cove-chest')).toMatchObject({
      isOpen: false,
      interactive: true,
      openClip: 'Open',
    });
    expect(findEntity(model({}, { isOpen: true }), 'cove-chest')).toMatchObject({
      isOpen: true,
      interactive: false,
    });
    expect(findEntity(model({}, { challengeAvailable: false }), 'cove-chest')?.interactive).toBe(
      false,
    );
  });

  it('collects this location’s world change keys only', () => {
    const scene = model({
      worldChanges: [
        {
          locationSlug: 'pirate-builder-bay',
          changeType: 'UNLOCK',
          changeKey: 'OPENED',
          payload: {},
          createdAt: 't',
        },
        {
          locationSlug: 'elsewhere',
          changeType: 'UNLOCK',
          changeKey: 'OTHER',
          payload: {},
          createdAt: 't',
        },
      ],
    });
    expect([...scene.worldChangeKeys]).toEqual(['OPENED']);
  });

  it('groups quests by the NPC who gives them', () => {
    const scene = model({
      quests: [questJson(), questJson({ questId: 'no-giver', giverNpcId: null })],
    });
    expect(scene.questsByGiver.get('pirate-pip')?.map((q) => q.questId)).toEqual([
      'treasure-rush-cove',
    ]);
    expect(scene.questsByGiver.size).toBe(1);
  });

  it('never imports Three.js', async () => {
    const source = await import('./sceneModel?raw');
    expect(source.default).not.toMatch(/from 'three'/);
  });
});
