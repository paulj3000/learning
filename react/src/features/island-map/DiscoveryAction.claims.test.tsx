import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateGameplayEvent, type AnyGameplayEvent } from '@lai/game-engine/contracts';
import { setLocationClaimSink, setLocationClaimsBinding } from './three/runtime/gameplayClaimSink';

const recordDiscovery = vi.fn();
vi.mock('../discovery/api', () => ({
  getDiscoveryDefinition: (id: string) => ({ id, title: 'Tide pool', revealMessage: 'You found it!' }),
  recordDiscovery: (...args: unknown[]) => recordDiscovery(...args),
}));

const { DiscoveryAction } = await import('./DiscoveryAction');

/** GE-067: a discovery the server records as new is claimed through the visit's claim router. */
describe('DiscoveryAction claims (GE-067)', () => {
  const stops: (() => void)[] = [];
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    recordDiscovery.mockReset();
  });

  function listen(): AnyGameplayEvent[] {
    const claims: AnyGameplayEvent[] = [];
    stops.push(setLocationClaimSink((event) => claims.push(event)));
    stops.push(setLocationClaimsBinding({ realmId: 'storykeeper', adventureId: 'castle-tour', areaId: 'castle', sessionRef: null }));
    return claims;
  }

  it('claims exploration.discovery.found when the server says FOUND_NOW', async () => {
    const claims = listen();
    const onDiscovered = vi.fn();
    recordDiscovery.mockResolvedValue({ outcome: { status: 'FOUND_NOW', discoveryId: 'harbor-tide-pool', title: 'Tide pool', message: 'x' }, rewardMessages: [] });
    render(<DiscoveryAction childId="child-1" discoveryId="harbor-tide-pool" onDiscovered={onDiscovered} />);
    await waitFor(() => expect(onDiscovered).toHaveBeenCalled());
    expect(claims.map((c) => [c.type, c.payload])).toEqual([['exploration.discovery.found', { discoveryId: 'harbor-tide-pool' }]]);
    expect(validateGameplayEvent(claims[0]).ok).toBe(true);
  });

  it('claims nothing for a discovery already found', async () => {
    const claims = listen();
    recordDiscovery.mockResolvedValue({ outcome: { status: 'ALREADY_FOUND', discoveryId: 'harbor-tide-pool', title: 'Tide pool', message: 'x' }, rewardMessages: [] });
    render(<DiscoveryAction childId="child-1" discoveryId="harbor-tide-pool" onDiscovered={() => undefined} />);
    await waitFor(() => expect(recordDiscovery).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(claims).toEqual([]);
  });
});
