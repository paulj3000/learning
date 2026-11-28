import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnyGameplayEvent } from '@lai/game-engine/contracts';
import type { DiscoveryDefinition } from '../../../discovery/types';
import { interactionForEntity, walkInInteractionForZone } from './manifestBindings';
import { setLocationClaimSink, setLocationClaimsBinding } from './gameplayClaimSink';
import { WELCOME_HARBOR_MANIFEST } from './manifests/welcomeHarbor';

const recordDiscovery = vi.fn();
vi.mock('../../../discovery/api', async (importActual) => {
  const actual = await importActual<typeof import('../../../discovery/api')>();
  return {
    ...actual,
    recordDiscovery: (...args: unknown[]) => recordDiscovery(...args),
  };
});

const { WorldActionPanel } = await import('./WorldActionPanel');

/**
 * LAI-2201: harbor-door and harbor-tide-pool are the only placements of two discoveries
 * (`harbor-keepers-door`, `harbor-tide-pool`). Claiming them in 3D goes through the same
 * `DiscoveryAction` the Phaser harbor uses, so the server write and the claim are the same ones
 * LAI 06 (scoring) already relies on.
 */
describe('claiming the harbor discoveries in 3D (LAI-2201)', () => {
  const stops: (() => void)[] = [];
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    recordDiscovery.mockReset();
  });

  function listen(): AnyGameplayEvent[] {
    const claims: AnyGameplayEvent[] = [];
    stops.push(setLocationClaimSink((event) => claims.push(event)));
    stops.push(
      setLocationClaimsBinding({
        realmId: 'welcome-harbor',
        adventureId: 'explore:welcome-harbor',
        areaId: 'welcome-harbor',
        sessionRef: null,
      }),
    );
    return claims;
  }

  function foundNow(definition: DiscoveryDefinition) {
    return {
      outcome: {
        status: 'FOUND_NOW',
        discoveryId: definition.id,
        title: definition.title,
        message: 'You found it!',
      },
      rewardMessages: [],
    };
  }

  const cases = [
    {
      name: 'harbor-door (tap the door)',
      discoveryId: 'harbor-keepers-door',
      open: () =>
        interactionForEntity(WELCOME_HARBOR_MANIFEST, 'harbor-door', { worldChangeKeys: [] }),
    },
    {
      name: 'harbor-tide-pool (walk into the zone)',
      discoveryId: 'harbor-tide-pool',
      open: () =>
        walkInInteractionForZone(WELCOME_HARBOR_MANIFEST, 'harbor-tide-pool', {
          worldChangeKeys: [],
        }),
    },
  ];

  for (const { name, discoveryId, open } of cases) {
    it(`${name} records ${discoveryId} and claims it once`, async () => {
      const claims = listen();
      recordDiscovery.mockImplementation(async (_childId: string, def: DiscoveryDefinition) =>
        foundNow(def),
      );
      const interaction = open();
      expect(interaction?.action).toEqual({ kind: 'DISCOVER', discoveryId });
      const onDiscovered = vi.fn();
      render(
        <MemoryRouter>
          <WorldActionPanel
            childId="child-1"
            ageBand="PATHFINDER"
            interaction={interaction!}
            onDismiss={vi.fn()}
            onDiscovered={onDiscovered}
            regionId="welcome-harbor"
          />
        </MemoryRouter>,
      );
      await waitFor(() => expect(onDiscovered).toHaveBeenCalled());
      expect(await screen.findByText('You found it!')).toBeTruthy();
      expect(recordDiscovery).toHaveBeenCalledTimes(1);
      expect(recordDiscovery.mock.calls[0][0]).toBe('child-1');
      expect((recordDiscovery.mock.calls[0][1] as DiscoveryDefinition).id).toBe(discoveryId);
      expect(claims.map((c) => [c.type, c.payload])).toEqual([
        ['exploration.discovery.found', { discoveryId }],
      ]);
    });
  }
});
