import { describe, expect, it } from 'vitest';
import { createStandardCapabilityRegistry } from '@lai/game-engine/engine';
import { checkContentCompatibility, validateLocation } from '@lai/game-engine/sdk';
import { ASSET_MANAGER } from '@lai/game-engine/services';
import { FOSSIL_RIDGE_CAMP_MANIFEST as MANIFEST } from '../manifests/fossilRidgeCamp';
import {
  FOSSIL_RIDGE_CAMP_ADAPTER_ISSUES,
  FOSSIL_RIDGE_CAMP_LOCATION as LOCATION,
} from './fossilRidgeCamp.location';

const registry = createStandardCapabilityRegistry();

describe('Fossil Ridge Camp location definition (LAI-2206)', () => {
  it('is validated engine data for the manifest region', () => {
    expect(FOSSIL_RIDGE_CAMP_ADAPTER_ISSUES).toEqual([]);
    expect(LOCATION.id).toBe(MANIFEST.regionId);
    expect(LOCATION.contentSource).toBe('MANIFEST');
    expect(validateLocation(LOCATION, registry)).toMatchObject({ ok: true, issues: [] });
    expect(Object.isFrozen(LOCATION)).toBe(true);
  });

  it('requires only the asset manager', () => {
    expect(LOCATION.requiredServices).toEqual([ASSET_MANAGER.id]);
  });

  it('accepts the next engine API minor version as well as this one', () => {
    expect(LOCATION.engineApi).toBe('>=0.1.0 <1.0.0');
  });

  it('authors no movement or player block, so the camp plays with the engine defaults', () => {
    expect(MANIFEST.movement).toBeUndefined();
    expect(MANIFEST.player).toBeUndefined();
    expect(registry.resolve(LOCATION.capabilities).issues).toEqual([]);
  });

  it('reports no content compatibility issues and carries no timers', () => {
    expect(checkContentCompatibility(MANIFEST, registry).issues).toEqual([]);
    expect(checkContentCompatibility(LOCATION, registry).issues).toEqual([]);
    expect(JSON.stringify(LOCATION)).not.toMatch(/timer|countdown|timeLimit|deadline/i);
  });
});
