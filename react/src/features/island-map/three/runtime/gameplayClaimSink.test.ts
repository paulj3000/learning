import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGameplayEventFactory, validateGameplayEvent, type AnyGameplayEvent } from '@lai/game-engine/contracts';
import {
  currentClaimsBinding,
  droppedLocationClaims,
  emitLocationClaim,
  forwardClaim,
  resetLocationClaimsForTests,
  setDefaultLocationClaimsBinding,
  setLocationClaimSink,
  setLocationClaimsBinding,
} from './gameplayClaimSink';

const CONTEXT = {
  realmId: 'pirate-builder-bay',
  adventureId: 'treasure-rush-cove',
  areaId: 'treasure-rush-cove',
  sessionRef: '0b5f8c4e-6d0a-4c43-9b6c-2f2b1b3f9a10',
};

function claim(): AnyGameplayEvent {
  return createGameplayEventFactory(CONTEXT).create('collectible.collected', {
    collectibleId: 'cove-brass-key',
    setId: null,
    pickupKey: 'TREASURE_COVE_KEY_FOUND',
  });
}

afterEach(() => resetLocationClaimsForTests());

describe('location claim sink (GE-070, decision E15)', () => {
  it('forwards a valid claim to the visit’s sink, and nothing without one', () => {
    forwardClaim(claim()); // nobody listening: a no-op, not an error
    expect(droppedLocationClaims()).toBe(0);
    const sink = vi.fn();
    setLocationClaimSink(sink);
    const event = claim();
    forwardClaim(event);
    expect(sink).toHaveBeenCalledWith(event);
  });

  it('drops and counts an invalid claim or a throwing sink, never throwing into play', () => {
    const sink = vi.fn();
    setLocationClaimSink(sink);
    const invalid = { ...claim(), payload: { collectibleId: 'has spaces', setId: null } };
    expect(() => forwardClaim(invalid as AnyGameplayEvent)).not.toThrow();
    expect(sink).not.toHaveBeenCalled();
    setLocationClaimSink(() => {
      throw new Error('scoring is down');
    });
    expect(() => forwardClaim(claim())).not.toThrow();
    expect(droppedLocationClaims()).toBe(2);
  });

  it('releases only its own sink, so a later visit is never cleared by an earlier one', () => {
    const first = vi.fn();
    const second = vi.fn();
    const releaseFirst = setLocationClaimSink(first);
    setLocationClaimSink(second);
    releaseFirst();
    forwardClaim(claim());
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('keeps one binding object per visit for the bridge, and none before the session exists', () => {
    expect(currentClaimsBinding()).toBeNull();
    const release = setLocationClaimsBinding(CONTEXT);
    const binding = currentClaimsBinding();
    expect(binding?.context).toEqual(CONTEXT);
    expect(currentClaimsBinding()).toBe(binding); // same object: one factory per visit
    release();
    expect(currentClaimsBinding()).toBeNull();
  });
});

describe('default location-visit binding (GE-L11)', () => {
  const explore = { realmId: 'pirate-builder-bay', adventureId: 'explore:pirate-builder-bay', areaId: 'pirate-builder-bay', sessionRef: null };
  const adventure = { realmId: 'treasure-rush', adventureId: 'treasure-cove', areaId: 'cove', sessionRef: null };

  it('claims under the default when no companion binds, and the companion binding wins when it does', () => {
    const claims: AnyGameplayEvent[] = [];
    const stopSink = setLocationClaimSink((event) => claims.push(event));
    const stopDefault = setDefaultLocationClaimsBinding(explore);
    emitLocationClaim('exploration.discovery.found', { discoveryId: 'harbor-tide-pool' });
    const stopCompanion = setLocationClaimsBinding(adventure);
    emitLocationClaim('exploration.discovery.found', { discoveryId: 'hidden-cave' });
    stopCompanion();
    emitLocationClaim('exploration.discovery.found', { discoveryId: 'lookout' });
    stopDefault();
    emitLocationClaim('exploration.discovery.found', { discoveryId: 'nobody-listening' });
    stopSink();
    expect(claims.map((c) => [c.adventureId, (c.payload as { discoveryId: string }).discoveryId])).toEqual([
      ['explore:pirate-builder-bay', 'harbor-tide-pool'],
      ['treasure-cove', 'hidden-cave'],
      ['explore:pirate-builder-bay', 'lookout'],
    ]);
    expect(claims.every((c) => validateGameplayEvent(c).ok)).toBe(true);
  });

  it('never claims an adventure start or completion under the free-exploration default', () => {
    const claims: AnyGameplayEvent[] = [];
    const stopSink = setLocationClaimSink((event) => claims.push(event));
    const stopDefault = setDefaultLocationClaimsBinding(explore);
    emitLocationClaim('adventure.started', {});
    emitLocationClaim('adventure.completed', {});
    expect(claims).toEqual([]);
    const stopCompanion = setLocationClaimsBinding(adventure);
    emitLocationClaim('adventure.completed', {});
    expect(claims.map((c) => c.type)).toEqual(['adventure.completed']);
    stopCompanion();
    stopDefault();
    stopSink();
  });

  it('the bridge reads the default through currentClaimsBinding', () => {
    const stopDefault = setDefaultLocationClaimsBinding(explore);
    expect(currentClaimsBinding()?.context.adventureId).toBe('explore:pirate-builder-bay');
    stopDefault();
    expect(currentClaimsBinding()).toBeNull();
  });
});
