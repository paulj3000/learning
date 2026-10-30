import {
  ALL_CHECKPOINTS,
  CheckpointPublishError,
  KNOWN_CHECKPOINT_IDS,
  findCheckpoint,
  publishRegionCheckpoints,
  resolveSpawnCheckpoint,
  unpublishRegionCheckpoints,
  type RegionCheckpoint,
} from './checkpoints';

const REGION = 'published-test-region';
const landing: RegionCheckpoint = {
  id: `${REGION}:landing`,
  regionId: REGION,
  label: 'the landing',
  x: 1,
  z: 9,
  yaw: 0.5,
};
const rocks: RegionCheckpoint = {
  id: `${REGION}:rocks`,
  regionId: REGION,
  label: 'the rocks',
  x: -3,
  z: 2,
  yaw: 0,
};

afterEach(() => unpublishRegionCheckpoints(REGION));

describe('published region checkpoints (TR-7)', () => {
  it('lets a server-published region spawn at its own checkpoint', () => {
    expect(() => resolveSpawnCheckpoint(REGION, undefined)).toThrow();
    publishRegionCheckpoints(REGION, [landing]);
    expect(resolveSpawnCheckpoint(REGION, undefined)).toEqual(landing);
    expect(findCheckpoint(landing.id)).toEqual(landing);
    expect(ALL_CHECKPOINTS.filter((c) => c.regionId === REGION)).toEqual([landing]);
  });

  it('replaces a region’s checkpoints when published again', () => {
    publishRegionCheckpoints(REGION, [landing]);
    publishRegionCheckpoints(REGION, [rocks]);
    expect(ALL_CHECKPOINTS.filter((c) => c.regionId === REGION)).toEqual([rocks]);
  });

  it('resumes at a saved published checkpoint and ignores another region’s', () => {
    publishRegionCheckpoints(REGION, [landing, rocks]);
    expect(resolveSpawnCheckpoint(REGION, rocks.id)).toEqual(rocks);
    expect(resolveSpawnCheckpoint(REGION, KNOWN_CHECKPOINT_IDS[0])).toEqual(landing);
  });

  it('never saves published checkpoints to Amplify', () => {
    publishRegionCheckpoints(REGION, [landing]);
    expect(KNOWN_CHECKPOINT_IDS).not.toContain(landing.id);
  });

  it('refuses to move a source-authored region', () => {
    const source = ALL_CHECKPOINTS[0];
    expect(() => publishRegionCheckpoints(source.regionId, [{ ...source, x: 99 }])).toThrow(
      CheckpointPublishError,
    );
    expect(ALL_CHECKPOINTS[0]).toEqual(source);
  });

  it('refuses a source checkpoint id, a duplicate, another region’s checkpoint, or nothing', () => {
    const taken = { ...landing, id: ALL_CHECKPOINTS[0].id };
    expect(() => publishRegionCheckpoints(REGION, [taken])).toThrow(CheckpointPublishError);
    expect(() => publishRegionCheckpoints(REGION, [landing, landing])).toThrow(
      CheckpointPublishError,
    );
    expect(() => publishRegionCheckpoints(REGION, [{ ...landing, regionId: 'elsewhere' }])).toThrow(
      CheckpointPublishError,
    );
    expect(() => publishRegionCheckpoints(REGION, [])).toThrow(CheckpointPublishError);
    expect(ALL_CHECKPOINTS.some((c) => c.regionId === REGION)).toBe(false);
  });

  it('removes only the published region on unpublish', () => {
    const before = ALL_CHECKPOINTS.length;
    publishRegionCheckpoints(REGION, [landing]);
    unpublishRegionCheckpoints(REGION);
    unpublishRegionCheckpoints(ALL_CHECKPOINTS[0].regionId);
    expect(ALL_CHECKPOINTS.length).toBe(before);
  });
});
