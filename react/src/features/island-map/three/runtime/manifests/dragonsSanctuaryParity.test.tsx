import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgeBandValue } from '../../../../child-profile/constants';
import {
  SANCTUARY_CHANGE_KEYS,
  dragonScaleChangeKey,
  fireRuneChangeKey,
} from '../../../../dragons-sanctuary/types';
import { FIRE_RUNE_SPOTS, SEALED_GATES } from '../../dragonsSanctuaryRegion';
import type { WorldEngineEventBus } from '../../worldEngineEvents';
import type { WorldInteractionContext } from '../../../worldObjects';
import { ThreeLocationWorldView } from '../ThreeLocationWorldView';

/**
 * Engine Phase 9 parity: every behaviour `DragonsSanctuaryWorldView.test.tsx`
 * asserts of the old sanctuary view, run against the generic view and the
 * real manifest. The two construction-time flags the old view passed its
 * scene (`forgeLit`, `foundRuneIds`) have no generic equivalent and need
 * none - they are now `requirements` on the things they changed, and the
 * engine receives the child's whole world state instead.
 */
const engine = vi.hoisted(() => ({
  bus: null as WorldEngineEventBus | null,
  options: null as { startCheckpointId?: string; worldState?: WorldInteractionContext } | null,
  interact: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('../createLocationEngine', () => ({
  DEFAULT_LOCATION_ENGINE_DEPS: {},
  createLocationEngine: vi.fn(
    (_parent: HTMLElement, bus: WorldEngineEventBus, _manifest: unknown, options: object) => {
      engine.bus = bus;
      engine.options = options;
      return {
        dispose: engine.dispose,
        interact: engine.interact,
        extensionApi: () => undefined,
        ready: Promise.resolve(),
      };
    },
  ),
}));

vi.mock('../../../NpcConversation', () => ({
  NpcConversation: ({ npcId }: { npcId: string }) => <div>conversation with {npcId}</div>,
}));

vi.mock('../../../../adventures/api', () => ({
  listAllWorldChanges: vi.fn(),
  resumeOrStartSession: vi.fn(),
  recordWorldChangeOnce: vi.fn(),
}));
vi.mock('../../../../discovery/api', () => ({
  getWorldState: vi.fn(),
  recordCharacterMet: vi.fn(),
  saveCheckpoint: vi.fn(),
  recordDiscovery: vi.fn(),
  getDiscoveryDefinition: vi.fn(),
}));
vi.mock('../../../../rewards/api', () => ({ getInventory: vi.fn() }));
vi.mock('../../../../quests/api', () => ({ listQuestStates: vi.fn() }));
vi.mock('../../../../island/api', () => ({ getCompanionProfile: vi.fn() }));

import { listAllWorldChanges, recordWorldChangeOnce } from '../../../../adventures/api';
import { getWorldState, recordCharacterMet, saveCheckpoint } from '../../../../discovery/api';
import { getInventory } from '../../../../rewards/api';
import { listQuestStates } from '../../../../quests/api';
import { getCompanionProfile } from '../../../../island/api';

const STONE_RUNE = FIRE_RUNE_SPOTS[0]!;

function renderSanctuary(ageBand: AgeBandValue = 'PATHFINDER') {
  return render(
    <MemoryRouter initialEntries={['/island/child-1/explore/dragons-sanctuary']}>
      <Routes>
        <Route
          path="/island/:childId/explore/:regionId"
          element={
            <ThreeLocationWorldView
              childId="child-1"
              regionId="dragons-sanctuary"
              ageBand={ageBand}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function emit(run: (bus: WorldEngineEventBus) => void) {
  await waitFor(() => expect(engine.bus).not.toBeNull());
  act(() => {
    run(engine.bus!);
  });
}

async function renderAndWait() {
  const utils = renderSanctuary();
  await screen.findByText(/move: wasd or the arrow keys/i);
  await waitFor(() => expect(engine.bus).not.toBeNull());
  return utils;
}

describe("The Dragon's Sanctuary on the generic view: parity with DragonsSanctuaryWorldView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    engine.bus = null;
    engine.options = null;
    vi.mocked(getWorldState).mockResolvedValue({ discoveredIds: [], metCharacterIds: [] } as never);
    vi.mocked(saveCheckpoint).mockResolvedValue(undefined);
    vi.mocked(recordCharacterMet).mockResolvedValue(undefined);
    vi.mocked(recordWorldChangeOnce).mockResolvedValue(undefined);
    vi.mocked(listAllWorldChanges).mockResolvedValue([]);
    vi.mocked(getInventory).mockResolvedValue({ ownedItemIds: [], grantedRuleIds: [] });
    vi.mocked(listQuestStates).mockResolvedValue([]);
    vi.mocked(getCompanionProfile).mockResolvedValue(null);
  });

  it('shows the cold sanctuary to a child with no history', async () => {
    await renderAndWait();
    expect(
      screen.getByText('The forge is cold and dark. Ember is waiting up at her roost.'),
    ).toBeInTheDocument();
  });

  it('shows the lit sanctuary to a child who already rekindled the forge', async () => {
    vi.mocked(listAllWorldChanges).mockResolvedValue([
      { changeKey: SANCTUARY_CHANGE_KEYS.FORGE_LIT },
    ] as never);
    await renderAndWait();
    expect(
      screen.getByText('The forge is burning, and the whole valley is warm again.'),
    ).toBeInTheDocument();
  });

  it('hands the scene the runes the child has already found', async () => {
    vi.mocked(listAllWorldChanges).mockResolvedValue([
      { changeKey: fireRuneChangeKey(STONE_RUNE.id) },
    ] as never);
    await renderAndWait();
    await waitFor(() =>
      expect(engine.options?.worldState?.worldChangeKeys).toContain(
        fireRuneChangeKey(STONE_RUNE.id),
      ),
    );
  });

  it('falls back to the forgotten sanctuary when the read fails', async () => {
    vi.mocked(listAllWorldChanges).mockRejectedValue(new Error('offline'));
    await renderAndWait();
    expect(
      screen.getByText('The forge is cold and dark. Ember is waiting up at her roost.'),
    ).toBeInTheDocument();
  });

  it('records a rune once, by its own change key', async () => {
    await renderAndWait();
    await emit((bus) => bus.emit('CollectiblePickedUp', { entityId: STONE_RUNE.id }));
    expect(
      await screen.findByText(`You found ${STONE_RUNE.label}. It is warm to hold.`),
    ).toBeInTheDocument();
    expect(recordWorldChangeOnce).toHaveBeenCalledWith(
      'child-1',
      'dragons-sanctuary',
      'RUNE_FOUND',
      fireRuneChangeKey(STONE_RUNE.id),
      `exploration:${STONE_RUNE.id}`,
    );
  });

  it('drops a rune’s hint as that rune is found', async () => {
    vi.mocked(listAllWorldChanges).mockResolvedValue([
      { changeKey: fireRuneChangeKey(STONE_RUNE.id) },
    ] as never);
    await renderAndWait();
    expect(
      screen.queryByText('A fire rune is hidden behind the Keeper Lodge.'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('A fire rune is hidden down among the valley boulders.'),
    ).toBeInTheDocument();
  });

  it('records a dragon scale as a collectible, not as quest progress', async () => {
    await renderAndWait();
    await emit((bus) => bus.emit('CollectiblePickedUp', { entityId: 'dragon-scale-02' }));
    expect(await screen.findByText('You found a dragon scale.')).toBeInTheDocument();
    expect(recordWorldChangeOnce).toHaveBeenCalledWith(
      'child-1',
      'dragons-sanctuary',
      'COLLECTIBLE_FOUND',
      dragonScaleChangeKey('dragon-scale-02'),
      'exploration:dragon-scale-02',
    );
  });

  it('shows a sealed gate’s authored line, and never a refusal', async () => {
    const gate = SEALED_GATES[0]!;
    await renderAndWait();
    await emit((bus) =>
      bus.emit('ObjectInteracted', { entityId: gate.id, interactionId: `${gate.id}:interact` }),
    );
    expect(await screen.findByText(gate.lockedMessage)).toBeInTheDocument();
  });

  it('points the child at Ember rather than starting anything at the hearth', async () => {
    await renderAndWait();
    await emit((bus) =>
      bus.emit('ObjectInteracted', {
        entityId: 'dragons-sanctuary:prop:forge-hearth',
        interactionId: 'dragons-sanctuary:prop:forge-hearth:interact',
      }),
    );
    expect(
      await screen.findByText(
        'The hearth is cold, and its three rune sockets are empty. Ember is up at her roost.',
      ),
    ).toBeInTheDocument();
  });

  it('saves a checkpoint when the child crosses one', async () => {
    await renderAndWait();
    await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'dragons-sanctuary:roost' }));
    await waitFor(() =>
      expect(saveCheckpoint).toHaveBeenCalledWith('child-1', 'dragons-sanctuary:roost'),
    );
  });

  it('names an area the child walks into, and saves nothing for it', async () => {
    await renderAndWait();
    await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'dragons-sanctuary:zone:forge' }));
    expect(await screen.findByText("You're at the forge.")).toBeInTheDocument();
    expect(saveCheckpoint).not.toHaveBeenCalled();
  });

  it('remembers meeting Ember when the child walks up to her', async () => {
    await renderAndWait();
    await emit((bus) => bus.emit('NpcApproached', { entityId: 'ember-dragon' }));
    expect(recordCharacterMet).toHaveBeenCalledWith('child-1', 'ember-dragon');
  });

  it('offers a way to talk to Ember without walking to her', async () => {
    const user = userEvent.setup();
    await renderAndWait();
    await user.click(screen.getByRole('button', { name: 'Talk to Ember' }));
    expect(await screen.findByText('conversation with ember-dragon')).toBeInTheDocument();
  });

  it('offers a way to interact without a mouse look', async () => {
    const user = userEvent.setup();
    await renderAndWait();
    await user.click(screen.getByRole('button', { name: "Interact with what you're looking at" }));
    expect(engine.interact).toHaveBeenCalledTimes(1);
  });

  it('always offers the way back to the island map', async () => {
    await renderAndWait();
    expect(
      screen.getByRole('link', { name: 'Prefer not to walk in 3D? Go back to the island map' }),
    ).toHaveAttribute('href', '/island/child-1');
  });

  it('tells the child where the runes and scales are, so exploring is never guesswork', async () => {
    await renderAndWait();
    expect(
      screen.getByText('A fire rune is hidden out on the sky cliff ledge.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('There are 3 dragon scales hidden around the sanctuary.'),
    ).toBeInTheDocument();
  });
});
