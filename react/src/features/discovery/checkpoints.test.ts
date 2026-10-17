import { describe, expect, it } from 'vitest';
import {
  ALL_CHECKPOINTS,
  KNOWN_CHECKPOINT_IDS,
  PIRATE_BUILDER_BAY_CHECKPOINTS,
  WELCOME_HARBOR_CHECKPOINTS,
  findCheckpoint,
  resolveSpawnCheckpoint,
} from './checkpoints';

describe('checkpoints content', () => {
  it('has no duplicate ids', () => {
    expect(new Set(KNOWN_CHECKPOINT_IDS).size).toBe(KNOWN_CHECKPOINT_IDS.length);
  });

  it('gives Welcome Harbor at least one checkpoint', () => {
    expect(WELCOME_HARBOR_CHECKPOINTS.length).toBeGreaterThan(0);
  });

  it('gives Pirate Builder Bay at least one checkpoint', () => {
    expect(PIRATE_BUILDER_BAY_CHECKPOINTS.length).toBeGreaterThan(0);
  });

  it('every checkpoint belongs to a region and carries finite coordinates', () => {
    for (const checkpoint of ALL_CHECKPOINTS) {
      expect(checkpoint.regionId.length).toBeGreaterThan(0);
      expect(Number.isFinite(checkpoint.x)).toBe(true);
      expect(Number.isFinite(checkpoint.z)).toBe(true);
      expect(Number.isFinite(checkpoint.yaw)).toBe(true);
    }
  });
});

describe('findCheckpoint', () => {
  it('finds an authored checkpoint by id', () => {
    expect(findCheckpoint('welcome-harbor:dock')?.label).toBe('the dock');
  });

  it('returns undefined for an unknown or missing id', () => {
    expect(findCheckpoint('not-a-real-checkpoint')).toBeUndefined();
    expect(findCheckpoint(undefined)).toBeUndefined();
  });
});

describe('resolveSpawnCheckpoint', () => {
  it('returns the stored checkpoint when it belongs to the region', () => {
    const resolved = resolveSpawnCheckpoint('welcome-harbor', 'welcome-harbor:lookout');
    expect(resolved.id).toBe('welcome-harbor:lookout');
  });

  it('falls back to the region default when no checkpoint is stored', () => {
    const resolved = resolveSpawnCheckpoint('welcome-harbor', undefined);
    expect(resolved).toEqual(WELCOME_HARBOR_CHECKPOINTS[0]);
  });

  it('falls back to the region default when the stored id is unknown', () => {
    const resolved = resolveSpawnCheckpoint('welcome-harbor', 'not-a-real-checkpoint');
    expect(resolved).toEqual(WELCOME_HARBOR_CHECKPOINTS[0]);
  });

  it('throws for a region with no authored checkpoints', () => {
    expect(() => resolveSpawnCheckpoint('nowhere', undefined)).toThrow(/no checkpoints authored/i);
  });

  it('resolves within Pirate Builder Bay independently of Welcome Harbor', () => {
    const resolved = resolveSpawnCheckpoint('pirate-builder-bay', undefined);
    expect(resolved).toEqual(PIRATE_BUILDER_BAY_CHECKPOINTS[0]);
  });
});
