import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgeBandValue } from '../../../../child-profile/constants';
import { BUZZ_AND_THE_WAGGLE_DANCE } from '../../../../adventures/content/buzzAndTheWaggleDance';
import type { WorldEngineEventBus } from '../../worldEngineEvents';
import type { WorldInteractionContext } from '../../../worldObjects';
import { ThreeLocationWorldView } from '../ThreeLocationWorldView';

/**
 * Engine Phase 9 parity: every behaviour `WonderwildForestWorldView.test.tsx`
 * asserts of the old forest view, run against the generic view and the real
 * Wonderwild manifest. Plus the wiring the old view had but never tested -
 * the glow-moss walk-in, the reticle on a gated prop, and the world state
 * the scene is built from.
 *
 * The four construction-time flags the old view passed its scene
 * (`waggleDanceDiscovered`, `butterflyGardenComplete`, `hasGlowingMossJar`,
 * `startCheckpointId`) have no generic equivalent and need none: the first
 * three are now `requirements` on the scenery and props they changed, and
 * what the engine receives instead is the child's whole world state. These
 * tests assert that, which is the same fact one level up.
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
  NpcConversation: ({ npcId }: { npcId: string }) => (
    <div data-testid="npc-conversation">{npcId}</div>
  ),
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

import { listAllWorldChanges, resumeOrStartSession } from '../../../../adventures/api';
import { getWorldState, saveCheckpoint } from '../../../../discovery/api';
import { getInventory } from '../../../../rewards/api';
import { listQuestStates } from '../../../../quests/api';
import { getCompanionProfile } from '../../../../island/api';

function renderForest(ageBand: AgeBandValue = 'PATHFINDER') {
  return render(
    <MemoryRouter initialEntries={['/island/child-1/explore/wonderwild-forest']}>
      <Routes>
        <Route
          path="/island/:childId/explore/:regionId"
          element={
            <ThreeLocationWorldView
              childId="child-1"
              regionId="wonderwild-forest"
              ageBand={ageBand}
            />
          }
        />
        <Route
          path="/island/:childId/locations/:locationSlug/adventures/:templateSlug"
          element={<p>Adventure route</p>}
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

async function renderAndWait(ageBand: AgeBandValue = 'PATHFINDER') {
  const utils = renderForest(ageBand);
  await screen.findByText(/move: wasd or the arrow keys/i);
  await waitFor(() => expect(engine.bus).not.toBeNull());
  return utils;
}

describe('Wonderwild Forest on the generic view: parity with WonderwildForestWorldView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    engine.bus = null;
    engine.options = null;
    vi.mocked(getWorldState).mockResolvedValue({ discoveredIds: [], metCharacterIds: [] } as never);
    vi.mocked(saveCheckpoint).mockResolvedValue(undefined);
    vi.mocked(listAllWorldChanges).mockResolvedValue([]);
    vi.mocked(getInventory).mockResolvedValue({ ownedItemIds: [], grantedRuleIds: [] });
    vi.mocked(listQuestStates).mockResolvedValue([]);
    vi.mocked(getCompanionProfile).mockResolvedValue(null);
  });

  it('shows a loading state before its reads resolve', async () => {
    vi.mocked(listAllWorldChanges).mockReturnValue(new Promise(() => {}) as never);
    renderForest();
    expect(await screen.findByText(/loading wonderwild forest/i)).toBeInTheDocument();
  });

  it('still renders the world when every read fails, rather than stranding the child', async () => {
    vi.mocked(listAllWorldChanges).mockRejectedValue(new Error('offline'));
    vi.mocked(getWorldState).mockRejectedValue(new Error('offline'));
    renderForest();
    expect(await screen.findByText(/move: wasd or the arrow keys/i)).toBeInTheDocument();
  });

  it('renders the scene and HUD, and lists the available interactions once ready', async () => {
    await renderAndWait();
    expect(screen.getByText('The buzzing bee hive')).toBeInTheDocument();
    expect(screen.getByText('Peek at the hive')).toBeInTheDocument();
    expect(screen.getByText('A quiet pond')).toBeInTheDocument();
    expect(screen.getByText('A pile of leaves')).toBeInTheDocument();
    expect(screen.getByText('A shadowy cave')).toBeInTheDocument();
    expect(screen.getByText('The path back to Welcome Harbor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /backpack \(0\)/i })).toBeInTheDocument();
  });

  it('disposes the engine on unmount without leaking it', async () => {
    const { unmount } = await renderAndWait();
    unmount();
    await waitFor(() => expect(engine.dispose).toHaveBeenCalled());
  });

  it('saves a checkpoint when the child crosses one, by its authored id', async () => {
    await renderAndWait();
    await emit((bus) =>
      bus.emit('PlayerEnteredZone', { zoneId: 'wonderwild-forest:hive-clearing' }),
    );
    await waitFor(() =>
      expect(saveCheckpoint).toHaveBeenCalledWith('child-1', 'wonderwild-forest:hive-clearing'),
    );
  });

  it('saves only this forest’s checkpoints', async () => {
    await renderAndWait();
    await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'welcome-harbor:dock' }));
    expect(saveCheckpoint).not.toHaveBeenCalled();
  });

  it('names what the reticle is on, in the authored interaction title', async () => {
    await renderAndWait();
    await emit((bus) => bus.emit('InteractableFocused', { entityId: 'wonderwild-pond-frog' }));
    expect(await screen.findByText('A quiet pond: press E to talk')).toBeInTheDocument();
    await emit((bus) => bus.emit('InteractableFocused', { entityId: null }));
  });

  it('opens the authored flavour line when the child aims at a prop and presses E', async () => {
    await renderAndWait();
    await emit((bus) =>
      bus.emit('ObjectInteracted', {
        entityId: 'wonderwild-leaf-pile',
        interactionId: 'wonderwild-leaf-pile:interact',
      }),
    );
    expect(
      await screen.findByText(/Red, gold, and brown leaves rustle in a soft pile/),
    ).toBeInTheDocument();
  });

  it('offers the way out to Welcome Harbor when the child reaches it', async () => {
    await renderAndWait();
    await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'wonderwild-harbor-exit' }));
    expect(
      await screen.findByRole('dialog', { name: 'The path back to Welcome Harbor' }),
    ).toBeInTheDocument();
  });

  describe('the hive clearing carries the same before/after pair the Phaser forest does', () => {
    it('offers the tale while the waggle dance is undiscovered', async () => {
      await renderAndWait();
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'wonderwild-beehive' }));
      expect(
        await screen.findByRole('dialog', { name: 'The buzzing bee hive' }),
      ).toBeInTheDocument();
    });

    it('narrates the payoff instead once it is discovered', async () => {
      vi.mocked(listAllWorldChanges).mockResolvedValue([
        { changeKey: 'WAGGLE_DANCE_DISCOVERED' },
      ] as never);
      await renderAndWait();
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'wonderwild-beehive' }));
      expect(
        await screen.findByRole('dialog', { name: 'The hive you already discovered' }),
      ).toBeInTheDocument();
    });
  });

  it('starts the real, unchanged adventure and navigates to the existing route', async () => {
    const user = userEvent.setup();
    vi.mocked(resumeOrStartSession).mockResolvedValue({
      id: 'session-1',
      currentStepId: BUZZ_AND_THE_WAGGLE_DANCE.entryStepId,
    } as never);
    await renderAndWait();

    await user.click(screen.getByRole('button', { name: 'The buzzing bee hive' }));
    await user.click(await screen.findByRole('button', { name: /start the adventure/i }));

    await waitFor(() => expect(resumeOrStartSession).toHaveBeenCalled());
    // The engine is untouched: the same authored definition the card route runs.
    expect(vi.mocked(resumeOrStartSession).mock.calls[0]![1]).toBe(BUZZ_AND_THE_WAGGLE_DANCE);
    expect(await screen.findByText('Adventure route')).toBeInTheDocument();
  });

  it('tells a Sprout the tale is not for their band rather than starting it', async () => {
    const user = userEvent.setup();
    await renderAndWait('SPROUT');
    await user.click(screen.getByRole('button', { name: 'The buzzing bee hive' }));
    expect(await screen.findByText(/not available for your age yet/i)).toBeInTheDocument();
    expect(resumeOrStartSession).not.toHaveBeenCalled();
  });

  it('runs the reticle’s "interact" button through the engine', async () => {
    const user = userEvent.setup();
    await renderAndWait();
    await user.click(screen.getByText('Things to do here'));
    await user.click(screen.getByRole('button', { name: "Interact with what you're looking at" }));
    expect(engine.interact).toHaveBeenCalledTimes(1);
  });

  it('offers the way back on the location page for a child who would rather not walk', async () => {
    await renderAndWait();
    expect(
      screen.getByRole('link', { name: 'Prefer not to walk in 3D? Use the location page instead' }),
    ).toHaveAttribute('href', '/island/child-1/locations/wonderwild-forest');
  });

  describe('world state reaches the scene instead of four hand-passed flags', () => {
    it('hands the scene the saved checkpoint, never a raw coordinate', async () => {
      vi.mocked(getWorldState).mockResolvedValue({
        discoveredIds: [],
        metCharacterIds: [],
        lastCheckpointId: 'wonderwild-forest:pond',
      } as never);
      await renderAndWait();
      await waitFor(() => expect(engine.options?.startCheckpointId).toBe('wonderwild-forest:pond'));
    });

    it('hands the scene the change key that blooms the flowers and lights the stone', async () => {
      vi.mocked(listAllWorldChanges).mockResolvedValue([
        { changeKey: 'WAGGLE_DANCE_DISCOVERED' },
      ] as never);
      await renderAndWait();
      await waitFor(() =>
        expect(engine.options?.worldState?.worldChangeKeys).toContain('WAGGLE_DANCE_DISCOVERED'),
      );
    });

    it('carries the cross-location butterfly flag through unchanged', async () => {
      vi.mocked(listAllWorldChanges).mockResolvedValue([
        { changeKey: 'SAVE_THE_BUTTERFLY_GARDEN_COMPLETE' },
      ] as never);
      await renderAndWait();
      await waitFor(() =>
        expect(engine.options?.worldState?.worldChangeKeys).toContain(
          'SAVE_THE_BUTTERFLY_GARDEN_COMPLETE',
        ),
      );
      // ...and the butterfly is what that key makes real, as a requirement.
      expect(screen.getByText('A visiting butterfly')).toBeInTheDocument();
    });

    it('lights the cave only for a child carrying the jar', async () => {
      vi.mocked(getInventory).mockResolvedValue({
        ownedItemIds: ['glowing-moss-jar'],
        grantedRuleIds: [],
      });
      await renderAndWait();
      await waitFor(() =>
        expect(engine.options?.worldState?.ownedItemIds).toContain('glowing-moss-jar'),
      );
    });

    it('hides the butterfly from a child whose garden is still bare', async () => {
      await renderAndWait();
      expect(screen.queryByText('A visiting butterfly')).not.toBeInTheDocument();
    });
  });

  it('opens the green light under the ferns when the child wanders into it', async () => {
    // Beat 11's unmarked secret, which the old view wired and never tested.
    await renderAndWait();
    await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'wonderwild-glow-moss' }));
    expect(
      await screen.findByRole('dialog', { name: 'A green light under the ferns' }),
    ).toBeInTheDocument();
  });

  it('does nothing for the zones authored for a phase that has not come yet', async () => {
    await renderAndWait();
    await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'wonder-stone-bee' }));
    await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'wonderwild-leaf-pile:approach' }));
    await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'wonderwild-wonder-wall' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
