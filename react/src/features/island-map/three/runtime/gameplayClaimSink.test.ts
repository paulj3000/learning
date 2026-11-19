import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGameplayEventFactory, type AnyGameplayEvent } from '@lai/game-engine/contracts';
import {
  currentClaimsBinding,
  droppedLocationClaims,
  forwardClaim,
  resetLocationClaimsForTests,
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
