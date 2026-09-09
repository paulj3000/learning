import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DragonsSanctuaryWorldView } from './DragonsSanctuaryWorldView';
import type { WorldEngineEventBus } from './worldEngineEvents';
import {
  DRAGON_SCALE_SPOTS,
  FIRE_RUNE_SPOTS,
  FORGE_HEARTH,
  SEALED_GATES,
} from './dragonsSanctuaryRegion';
import { fireRuneChangeKey } from '../../dragons-sanctuary/types';

/**
 * The scene needs a real WebGL context, so it is stubbed - but the stub keeps
 * the bus it is handed, because every event this view reacts to (a rune
 * touched, a gate tried, an area entered) is only ever emitted by the engine.
 * Holding the bus is what lets these tests drive those paths without a
 * renderer.
 */
const disposeSpy = vi.fn();
const interactSpy = vi.fn();
let capturedBus: WorldEngineEventBus | null = null;
let capturedOptions: Record<string, unknown> | null = null;

vi.mock('./dragonsSanctuaryScene', () => ({
  createDragonsSanctuaryEngine: vi.fn(
    (_parent: HTMLDivElement, bus: WorldEngineEventBus, options: Record<string, unknown>) => {
      capturedBus = bus;
      capturedOptions = options;
      return { dispose: disposeSpy, interact: interactSpy };
    },
  ),
}));

vi.mock('../NpcConversation', () => ({
  NpcConversation: ({ npcId }: { npcId: string }) => <div>conversation with {npcId}</div>,
}));

const recordWorldChangeOnceSpy = vi.fn().mockResolvedValue(undefined);
let worldChangeKeys: string[] = [];

vi.mock('../../adventures/api', () => ({
  listAllWorldChanges: vi.fn(async () => worldChangeKeys.map((changeKey) => ({ changeKey }))),
  recordWorldChangeOnce: vi.fn((...args: unknown[]) => recordWorldChangeOnceSpy(...args)),
}));

const saveCheckpointSpy = vi.fn().mockResolvedValue(undefined);
const recordCharacterMetSpy = vi.fn().mockResolvedValue(undefined);

vi.mock('../../discovery/api', () => ({
  getWorldState: vi.fn(async () => ({ lastCheckpointId: undefined })),
  saveCheckpoint: vi.fn((...args: unknown[]) => saveCheckpointSpy(...args)),
  recordCharacterMet: vi.fn((...args: unknown[]) => recordCharacterMetSpy(...args)),
}));

vi.mock('../../rewards/api', () => ({ getInventory: vi.fn(async () => ({ ownedItemIds: [] })) }));
vi.mock('../../quests/api', () => ({ listQuestStates: vi.fn(async () => []) }));
vi.mock('../../island/api', () => ({ getCompanionProfile: vi.fn(async () => null) }));

function renderView() {
  return render(
    <MemoryRouter>
      <DragonsSanctuaryWorldView childId="child-1" ageBand="PATHFINDER" />
    </MemoryRouter>,
  );
}

async function renderReady() {
  renderView();
  await waitFor(() => expect(capturedBus).not.toBeNull());
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedBus = null;
  capturedOptions = null;
  worldChangeKeys = [];
});

describe('loading and world state', () => {
  it('shows the cold sanctuary to a child with no history', async () => {
    await renderReady();
    expect(await screen.findByText(/The forge is cold and dark/)).toBeInTheDocument();
    expect(capturedOptions?.forgeLit).toBe(false);
  });

  it('shows the lit sanctuary to a child who already rekindled the forge', async () => {
    worldChangeKeys = ['DRAGONS_SANCTUARY_FORGE_LIT'];
    await renderReady();
    expect(await screen.findByText(/The forge is burning/)).toBeInTheDocument();
    expect(capturedOptions?.forgeLit).toBe(true);
  });

  it('hands the scene the runes the child has already found', async () => {
    worldChangeKeys = [fireRuneChangeKey(FIRE_RUNE_SPOTS[0].id)];
    await renderReady();
    await waitFor(() => expect(capturedOptions?.foundRuneIds).toEqual([FIRE_RUNE_SPOTS[0].id]));
  });

  it('falls back to the forgotten sanctuary when the read fails', async () => {
    const { listAllWorldChanges } = await import('../../adventures/api');
    vi.mocked(listAllWorldChanges).mockRejectedValueOnce(new Error('offline'));
    await renderReady();
    // Shows less than the child has earned, never more.
    expect(await screen.findByText(/The forge is cold and dark/)).toBeInTheDocument();
  });
});

describe('finding things', () => {
  it('records a rune once, by its own change key', async () => {
    await renderReady();
    const rune = FIRE_RUNE_SPOTS[1];
    act(() => {
      capturedBus!.emit('ObjectInteracted', {
        entityId: rune.id,
        interactionId: `${rune.id}:take`,
      });
    });
    await waitFor(() =>
      expect(recordWorldChangeOnceSpy).toHaveBeenCalledWith(
        'child-1',
        'dragons-sanctuary',
        'RUNE_FOUND',
        fireRuneChangeKey(rune.id),
        `exploration:${rune.id}`,
      ),
    );
  });

  it('counts down the runes still out in the valley as they are found', async () => {
    await renderReady();
    expect(await screen.findByText(/There are 3 fire runes still out/)).toBeInTheDocument();
    act(() => {
      capturedBus!.emit('ObjectInteracted', {
        entityId: FIRE_RUNE_SPOTS[0].id,
        interactionId: 'take',
      });
    });
    expect(await screen.findByText(/There are 2 fire runes still out/)).toBeInTheDocument();
  });

  it('records a dragon scale as a collectible, not as quest progress', async () => {
    await renderReady();
    const scale = DRAGON_SCALE_SPOTS[0];
    act(() => {
      capturedBus!.emit('ObjectInteracted', { entityId: scale.id, interactionId: 'collect' });
    });
    await waitFor(() =>
      expect(recordWorldChangeOnceSpy).toHaveBeenCalledWith(
        'child-1',
        'dragons-sanctuary',
        'COLLECTIBLE_FOUND',
        expect.stringContaining('SCALE'),
        `exploration:${scale.id}`,
      ),
    );
    // Collecting must not move the quest on.
    expect(screen.getByText(/There are 3 fire runes still out/)).toBeInTheDocument();
  });
});

describe('sealed gates', () => {
  it('shows the authored line, and never a refusal', async () => {
    await renderReady();
    const gate = SEALED_GATES[0];
    act(() => {
      capturedBus!.emit('ObjectInteracted', { entityId: gate.id, interactionId: 'try' });
    });
    expect(await screen.findByText(gate.lockedMessage)).toBeInTheDocument();
    expect(recordWorldChangeOnceSpy).not.toHaveBeenCalled();
  });
});

describe('the cold hearth', () => {
  it('points the child at Ember rather than starting anything', async () => {
    await renderReady();
    act(() => {
      capturedBus!.emit('ObjectInteracted', {
        entityId: FORGE_HEARTH.id,
        interactionId: 'use',
      });
    });
    expect(await screen.findByText(/rune sockets are empty/)).toBeInTheDocument();
    expect(recordWorldChangeOnceSpy).not.toHaveBeenCalled();
  });
});

describe('walking around', () => {
  it('saves a checkpoint when the child crosses one', async () => {
    await renderReady();
    act(() => {
      capturedBus!.emit('PlayerEnteredZone', { zoneId: 'dragons-sanctuary:roost' });
    });
    await waitFor(() =>
      expect(saveCheckpointSpy).toHaveBeenCalledWith('child-1', 'dragons-sanctuary:roost'),
    );
  });

  it('names an area the child walks into, and saves nothing for it', async () => {
    await renderReady();
    act(() => {
      capturedBus!.emit('PlayerEnteredZone', { zoneId: 'dragons-sanctuary:zone:forge' });
    });
    expect(await screen.findByText(/You're at the forge\./)).toBeInTheDocument();
    expect(saveCheckpointSpy).not.toHaveBeenCalled();
  });

  it('remembers meeting Ember when the child walks up to her', async () => {
    await renderReady();
    act(() => {
      capturedBus!.emit('NpcApproached', { entityId: 'ember-dragon' });
    });
    await waitFor(() =>
      expect(recordCharacterMetSpy).toHaveBeenCalledWith('child-1', 'ember-dragon'),
    );
  });
});

describe('reaching everything without walking', () => {
  /*
    ADR-021 removes the 2D view, which was one of the two non-first-person
    routes ADR-008 relied on while the Sprouts playtest is unrun. These
    assertions are what is left holding that requirement up.
  */
  it('offers a way to talk to Ember without walking to her', async () => {
    await renderReady();
    await userEvent.click(screen.getByText('Things to do here'));
    await userEvent.click(screen.getByRole('button', { name: 'Talk to Ember' }));
    expect(await screen.findByText('conversation with ember-dragon')).toBeInTheDocument();
  });

  it('offers a way to interact without a mouse look', async () => {
    await renderReady();
    await userEvent.click(screen.getByText('Things to do here'));
    await userEvent.click(
      screen.getByRole('button', { name: /Interact with what you're looking at/ }),
    );
    expect(interactSpy).toHaveBeenCalled();
  });

  it('always offers the way back to the island map', async () => {
    await renderReady();
    expect(screen.getByRole('link', { name: /Go back to the island map/ })).toHaveAttribute(
      'href',
      '/island/child-1',
    );
  });

  it('tells the child where the runes are, so exploring is never guesswork', async () => {
    await renderReady();
    await userEvent.click(screen.getByText('Things to do here'));
    expect(screen.getByText(/Look behind the Keeper Lodge/)).toBeInTheDocument();
  });
});
