import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorykeeperCastleWorldView } from './StorykeeperCastleWorldView';
import type { WorldEngineEventBus } from './worldEngineEvents';
import type { AgeBandValue } from '../../child-profile/constants';
import { THE_STORYKEEPERS_TALE } from '../../adventures/content/theStorykeepersTale';
import type { AdventureStep } from '../../adventures/engine/types';
import type { StepAnswer } from '../../adventures/engine/validators';

/**
 * The scene needs a real WebGL context, so it is stubbed - but the stub
 * keeps the bus it is handed, because every event this view reacts to
 * (checkpoint crossings, the harbor exit, a portrait looked at, a window
 * stood in front of) is only ever emitted by the engine. Holding the bus is
 * what lets these tests drive those paths without a renderer.
 */
const disposeSpy = vi.fn();
const interactSpy = vi.fn();
const playQuillClipSpy = vi.fn();
const showChosenHeroSpy = vi.fn();
const showChosenSettingSpy = vi.fn();
let capturedBus: WorldEngineEventBus | null = null;

vi.mock('./storykeeperCastleScene', () => ({
  createStorykeeperCastleEngine: vi.fn((_parent: HTMLDivElement, bus: WorldEngineEventBus) => {
    capturedBus = bus;
    return {
      dispose: disposeSpy,
      interact: interactSpy,
      playQuillClip: playQuillClipSpy,
      showChosenHero: showChosenHeroSpy,
      showChosenSetting: showChosenSettingSpy,
    };
  }),
}));

/**
 * The session is mocked so a test can put the tale on an exact step and
 * watch what reaches `submitAnswer`. `useAdventureSession` is tested on its
 * own; what SC-4 has to prove is that a room and a card both arrive at that
 * one function with the same argument.
 */
const submitAnswerSpy = vi.fn<(answer: StepAnswer) => Promise<void>>();
let currentStep: AdventureStep | null = null;
let sessionStatus: string | null = null;

vi.mock('../../adventures/useAdventureSession', () => ({
  useAdventureSession: vi.fn(() => ({
    loadState: 'ready',
    session: sessionStatus ? { id: 'session-1', status: sessionStatus } : null,
    currentStep,
    hintLevel: 0,
    hintText: undefined,
    submitting: false,
    error: null,
    submitAnswer: submitAnswerSpy,
    requestHint: vi.fn(),
    companionTurn: { status: 'idle' },
    representationAid: undefined,
    storyScenes: [],
    coopSharedState: { presence: [], slots: {} },
  })),
}));

vi.mock('../NpcConversation', () => ({
  NpcConversation: ({ npcId, onEnd }: { npcId: string; onEnd: () => void }) => (
    <div data-testid="npc-conversation">
      {npcId}
      <button type="button" onClick={onEnd}>
        Goodbye for now
      </button>
    </div>
  ),
}));

vi.mock('../../adventures/api', () => ({
  listAllWorldChanges: vi.fn(),
  getActiveSession: vi.fn(),
  listActionsForSessions: vi.fn(),
}));

vi.mock('../../discovery/api', () => ({
  getWorldState: vi.fn(),
  saveCheckpoint: vi.fn(),
  recordCharacterMet: vi.fn(),
}));

vi.mock('../../rewards/api', () => ({
  getInventory: vi.fn(),
}));

vi.mock('../../quests/api', () => ({
  listQuestStates: vi.fn(),
}));

vi.mock('../../island/api', () => ({
  getCompanionProfile: vi.fn(),
}));

import { createStorykeeperCastleEngine } from './storykeeperCastleScene';
import {
  getActiveSession,
  listActionsForSessions,
  listAllWorldChanges,
} from '../../adventures/api';
import { getWorldState, recordCharacterMet, saveCheckpoint } from '../../discovery/api';
import { getInventory } from '../../rewards/api';
import { listQuestStates } from '../../quests/api';
import { getCompanionProfile } from '../../island/api';

const createEngineMock = vi.mocked(createStorykeeperCastleEngine);
const listAllWorldChangesMock = vi.mocked(listAllWorldChanges);
const getActiveSessionMock = vi.mocked(getActiveSession);
const listActionsForSessionsMock = vi.mocked(listActionsForSessions);
const getWorldStateMock = vi.mocked(getWorldState);
const recordCharacterMetMock = vi.mocked(recordCharacterMet);
const saveCheckpointMock = vi.mocked(saveCheckpoint);
const getInventoryMock = vi.mocked(getInventory);
const listQuestStatesMock = vi.mocked(listQuestStates);
const getCompanionProfileMock = vi.mocked(getCompanionProfile);

/** Puts the mocked session on a real authored step of the real tale. */
function setStep(stepId: string | null): void {
  currentStep = stepId
    ? (THE_STORYKEEPERS_TALE.steps.find((step) => step.id === stepId) ?? null)
    : null;
}

function renderView(ageBand: AgeBandValue = 'PATHFINDER') {
  return render(
    <MemoryRouter initialEntries={['/island/child-1/world/storykeeper-castle-3d']}>
      <Routes>
        <Route
          path="/island/:childId/world/storykeeper-castle-3d"
          element={
            <StorykeeperCastleWorldView childId="child-1" ageBand={ageBand} aiEnabled={false} />
          }
        />
        <Route path="/island/:childId/world" element={<p>Island map</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * Renders, then waits for the engine to actually exist.
 *
 * Waiting on the instructions text alone is not enough and was genuinely
 * flaky: `findBy*` resolves from a MutationObserver callback that can run
 * after React has committed the DOM but before it has flushed passive
 * effects, and `ThreeGameContainer` builds the engine in a `useEffect`. A
 * test that emitted a bus event at that moment emitted it into a `null`
 * bus, silently did nothing, and then failed on the assertion after it.
 */
async function renderAndWaitForEngine(ageBand: AgeBandValue = 'PATHFINDER') {
  const utils = renderView(ageBand);
  await screen.findByText(/move: wasd or the arrow keys/i);
  await waitFor(() => {
    expect(createEngineMock).toHaveBeenCalled();
  });
  return utils;
}

/** Renders with the tale already open on `stepId`, as a returning child would find it. */
async function renderMidTale(stepId: string, ageBand: AgeBandValue = 'PATHFINDER') {
  setStep(stepId);
  getActiveSessionMock.mockResolvedValue({ id: 'session-1', status: 'ACTIVE' } as never);
  return renderAndWaitForEngine(ageBand);
}

describe('StorykeeperCastleWorldView', () => {
  beforeEach(() => {
    disposeSpy.mockReset();
    interactSpy.mockReset();
    playQuillClipSpy.mockReset();
    showChosenHeroSpy.mockReset();
    showChosenSettingSpy.mockReset();
    submitAnswerSpy.mockReset();
    submitAnswerSpy.mockResolvedValue(undefined);
    capturedBus = null;
    currentStep = null;
    sessionStatus = 'ACTIVE';
    createEngineMock.mockClear();
    listAllWorldChangesMock.mockReset();
    getActiveSessionMock.mockReset();
    listActionsForSessionsMock.mockReset();
    getWorldStateMock.mockReset();
    recordCharacterMetMock.mockReset();
    saveCheckpointMock.mockReset();
    getInventoryMock.mockReset();
    listQuestStatesMock.mockReset();
    getCompanionProfileMock.mockReset();

    listAllWorldChangesMock.mockResolvedValue([]);
    getActiveSessionMock.mockResolvedValue(null);
    listActionsForSessionsMock.mockResolvedValue([]);
    getWorldStateMock.mockResolvedValue({ discoveredIds: [], metCharacterIds: [] });
    recordCharacterMetMock.mockResolvedValue(undefined);
    saveCheckpointMock.mockResolvedValue(undefined);
    getInventoryMock.mockResolvedValue({ ownedItemIds: [], grantedRuleIds: [] });
    listQuestStatesMock.mockResolvedValue([]);
    getCompanionProfileMock.mockResolvedValue(null);
  });

  it('shows a loading state before its reads resolve', () => {
    getWorldStateMock.mockReturnValue(new Promise(() => {}));

    renderView();

    expect(screen.getByText(/loading storykeeper castle/i)).toBeInTheDocument();
  });

  it('mounts the scene and the HUD once ready', async () => {
    await renderAndWaitForEngine();

    expect(createEngineMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /backpack \(0\)/i })).toBeInTheDocument();
  });

  it('spawns from the stored checkpoint id rather than a coordinate', async () => {
    getWorldStateMock.mockResolvedValue({
      discoveredIds: [],
      metCharacterIds: [],
      lastCheckpointId: 'storykeeper-castle:library',
    } as never);

    await renderAndWaitForEngine();

    expect(createEngineMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ startCheckpointId: 'storykeeper-castle:library' }),
    );
    expect(await screen.findByText(/you are back at the great library/i)).toBeInTheDocument();
  });

  it('saves a checkpoint by id when the child crosses one, and names the spot', async () => {
    await renderAndWaitForEngine();

    act(() => capturedBus?.emit('PlayerEnteredZone', { zoneId: 'storykeeper-castle:gallery' }));

    await waitFor(() => {
      expect(saveCheckpointMock).toHaveBeenCalledWith('child-1', 'storykeeper-castle:gallery');
    });
    expect(await screen.findByText(/you found the character gallery/i)).toBeInTheDocument();
  });

  it('offers the way back to the island map on reaching the harbor exit', async () => {
    const user = userEvent.setup();

    await renderAndWaitForEngine();

    act(() => capturedBus?.emit('PlayerEnteredZone', { zoneId: 'castle-harbor-exit' }));

    expect(
      await screen.findByRole('dialog', { name: /the path back to welcome harbor/i }),
    ).toBeInTheDocument();
    expect(saveCheckpointMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('link', { name: /go there/i }));
    expect(await screen.findByText('Island map')).toBeInTheDocument();
  });

  it('dismisses the exit panel without leaving', async () => {
    const user = userEvent.setup();

    await renderAndWaitForEngine();
    act(() => capturedBus?.emit('PlayerEnteredZone', { zoneId: 'castle-harbor-exit' }));
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: /not now/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/move: wasd or the arrow keys/i)).toBeInTheDocument();
  });

  it('still lets the child explore when the progress reads fail', async () => {
    getInventoryMock.mockRejectedValue(new Error('offline'));

    renderView();

    expect(await screen.findByText(/could not load your backpack/i)).toBeInTheDocument();
    expect(screen.getByText(/move: wasd or the arrow keys/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(createEngineMock).toHaveBeenCalledTimes(1);
    });
  });

  it('disposes the engine and drops its listeners on unmount', async () => {
    const { unmount } = await renderAndWaitForEngine();
    const bus = capturedBus;

    unmount();

    expect(disposeSpy).toHaveBeenCalledTimes(1);
    bus?.emit('PlayerEnteredZone', { zoneId: 'storykeeper-castle:gallery' });
    expect(saveCheckpointMock).not.toHaveBeenCalled();
  });

  it("shows the companion's name in the HUD once its profile loads", async () => {
    getCompanionProfileMock.mockResolvedValue({
      id: 'c1',
      childProfileId: 'child-1',
      companionType: 'CHATTY_PARROT',
      displayName: 'Chatty',
    } as never);

    renderView();

    expect(await screen.findByText('Chatty')).toBeInTheDocument();
  });

  // --- SC-3: Keeper Quill (beats 1-2) ---------------------------------------

  it('names Keeper Quill on the reticle when the child looks at him', async () => {
    await renderAndWaitForEngine();

    act(() => capturedBus?.emit('InteractableFocused', { entityId: 'keeper-quill' }));
    expect(await screen.findByText(/keeper quill: press e to talk/i)).toBeInTheDocument();

    act(() => capturedBus?.emit('InteractableFocused', { entityId: null }));
    await waitFor(() => {
      expect(screen.queryByText(/press e to talk/i)).not.toBeInTheDocument();
    });
  });

  it('records having met Quill when the child walks up to him', async () => {
    await renderAndWaitForEngine();

    act(() => capturedBus?.emit('NpcApproached', { entityId: 'keeper-quill' }));

    await waitFor(() => {
      expect(recordCharacterMetMock).toHaveBeenCalledWith('child-1', 'keeper-quill');
    });
  });

  it("opens Quill's existing conversation on interacting with him", async () => {
    await renderAndWaitForEngine();

    act(() =>
      capturedBus?.emit('ObjectInteracted', {
        entityId: 'keeper-quill',
        interactionId: 'keeper-quill:interact',
      }),
    );

    expect(await screen.findByTestId('npc-conversation')).toHaveTextContent('keeper-quill');
  });

  it('plays Talk while Quill is speaking and Point once the conversation ends', async () => {
    const user = userEvent.setup();

    await renderAndWaitForEngine();
    expect(playQuillClipSpy).not.toHaveBeenCalledWith('Point');

    act(() =>
      capturedBus?.emit('ObjectInteracted', {
        entityId: 'keeper-quill',
        interactionId: 'keeper-quill:interact',
      }),
    );
    await screen.findByTestId('npc-conversation');
    expect(playQuillClipSpy).toHaveBeenCalledWith('Talk');

    await user.click(screen.getByRole('button', { name: /goodbye for now/i }));

    await waitFor(() => {
      expect(playQuillClipSpy).toHaveBeenCalledWith('Point');
    });
  });

  it('does not point at anything before the child has talked to Quill', async () => {
    await renderAndWaitForEngine();

    act(() => capturedBus?.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));
    await screen.findByRole('dialog');

    expect(playQuillClipSpy).not.toHaveBeenCalledWith('Point');
  });

  it('declines to start the tale for a band it was not authored for', async () => {
    await renderAndWaitForEngine('SPROUT');

    act(() => capturedBus?.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));

    expect(await screen.findByText(/not available for your age yet/i)).toBeInTheDocument();
  });

  it('offers the already-told narration once a story is on the shelf', async () => {
    listAllWorldChangesMock.mockResolvedValue([{ changeKey: 'FIRST_STORY_TOLD' } as never]);

    await renderAndWaitForEngine();

    act(() => capturedBus?.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));

    expect(await screen.findByRole('dialog', { name: /^the story hall$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start the adventure/i })).not.toBeInTheDocument();
  });

  // --- SC-4: choices become places (beats 3-4) ------------------------------

  /**
   * SC-4 changed how the tale starts: it opens *in this room* rather than
   * navigating to the card route, because two of its steps are answered by
   * going somewhere. Walking out of the castle to answer them would defeat
   * the phase.
   */
  it('opens the tale in the room instead of navigating away', async () => {
    const user = userEvent.setup();
    setStep('meet-keeper-quill');

    await renderAndWaitForEngine();

    act(() => capturedBus?.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));
    await screen.findByRole('dialog', { name: /keeper quill's story hall/i });
    await user.click(screen.getByRole('button', { name: /start the adventure/i }));

    // The tale's own entry step is on screen, still inside the castle.
    expect(await screen.findByText(/i keep all the island stories here/i)).toBeInTheDocument();
    expect(screen.getByText(/move: wasd or the arrow keys/i)).toBeInTheDocument();
    expect(THE_STORYKEEPERS_TALE.entryStepId).toBe('meet-keeper-quill');
  });

  it('answers choose-hero by looking at a portrait', async () => {
    await renderMidTale('choose-hero');

    act(() =>
      capturedBus?.emit('ObjectInteracted', {
        entityId: 'gallery-portrait-fox',
        interactionId: 'gallery-portrait-fox:interact',
      }),
    );

    await waitFor(() => {
      expect(submitAnswerSpy).toHaveBeenCalledWith({
        kind: 'creative-choice',
        optionId: 'hero-fox',
      });
    });
  });

  /**
   * Beat 4 is an approach rather than a raycast on purpose: a window is a
   * place you stand at, and that keeps the step reachable for a band that
   * cannot aim.
   */
  it('answers choose-setting by standing at a window', async () => {
    await renderMidTale('choose-setting');

    act(() => capturedBus?.emit('PlayerEnteredZone', { zoneId: 'tower-window-cave' }));

    await waitFor(() => {
      expect(submitAnswerSpy).toHaveBeenCalledWith({
        kind: 'creative-choice',
        optionId: 'setting-cave',
      });
    });
  });

  /**
   * SC-4's headline exit criterion. Both routes reach the same session with
   * the same payload - by being the same function, not by two
   * implementations agreeing.
   */
  it('produces an identical answer whether the child uses the room or the card', async () => {
    const user = userEvent.setup();

    await renderMidTale('choose-hero');
    act(() =>
      capturedBus?.emit('ObjectInteracted', {
        entityId: 'gallery-portrait-fox',
        interactionId: 'gallery-portrait-fox:interact',
      }),
    );
    await waitFor(() => {
      expect(submitAnswerSpy).toHaveBeenCalledTimes(1);
    });
    const fromTheRoom = submitAnswerSpy.mock.calls[0];

    submitAnswerSpy.mockClear();
    await user.click(screen.getByRole('button', { name: /a clever fox/i }));
    await waitFor(() => {
      expect(submitAnswerSpy).toHaveBeenCalledTimes(1);
    });
    const fromTheCard = submitAnswerSpy.mock.calls[0];

    expect(fromTheRoom).toEqual(fromTheCard);
  });

  it('lights the chosen portrait whichever way it was chosen', async () => {
    const user = userEvent.setup();

    await renderMidTale('choose-hero');

    act(() =>
      capturedBus?.emit('ObjectInteracted', {
        entityId: 'gallery-portrait-dragon',
        interactionId: 'gallery-portrait-dragon:interact',
      }),
    );
    await waitFor(() => {
      expect(showChosenHeroSpy).toHaveBeenCalledWith('gallery-portrait-dragon');
    });

    showChosenHeroSpy.mockClear();
    await user.click(screen.getByRole('button', { name: /a clever fox/i }));
    await waitFor(() => {
      expect(showChosenHeroSpy).toHaveBeenCalledWith('gallery-portrait-fox');
    });
  });

  /**
   * A world event must never skip the child ahead. The binding has to name
   * the step that is open right now, or it is ignored.
   */
  it('ignores a window walked past while the hero step is open', async () => {
    await renderMidTale('choose-hero');

    act(() => capturedBus?.emit('PlayerEnteredZone', { zoneId: 'tower-window-cave' }));

    expect(submitAnswerSpy).not.toHaveBeenCalled();
  });

  /**
   * The guard that matters most, and the one easiest to lose. `choose-hero`
   * and `choose-setting` are not the only *bound* steps - SC-0 also binds
   * the three story plates to `order-the-story`, which is an ORDERING step
   * whose answer is a whole sequence, not one option id. When SC-5 places
   * those plates in the room, this handler must not see them and fire a
   * `creative-choice` answer at a step that grades an order.
   *
   * Written against `order-the-story` rather than a step with no bindings
   * at all, because a step with no bindings is already covered by the
   * binding lookup itself: only this case actually exercises the
   * spatial-step gate.
   */
  it('ignores a bound entity whose step is not one of the two SC-4 makes into places', async () => {
    await renderMidTale('order-the-story');

    act(() =>
      capturedBus?.emit('ObjectInteracted', {
        entityId: 'story-plate-problem',
        interactionId: 'story-plate-problem:interact',
      }),
    );

    expect(submitAnswerSpy).not.toHaveBeenCalled();
  });

  it('ignores a portrait looked at while an unbound step is open', async () => {
    await renderMidTale('comprehension-check');

    act(() =>
      capturedBus?.emit('ObjectInteracted', {
        entityId: 'gallery-portrait-fox',
        interactionId: 'gallery-portrait-fox:interact',
      }),
    );

    expect(submitAnswerSpy).not.toHaveBeenCalled();
  });

  it("names the option a portrait stands for on the reticle, in the card's own words", async () => {
    await renderMidTale('choose-hero');

    act(() => capturedBus?.emit('InteractableFocused', { entityId: 'gallery-portrait-fox' }));

    expect(await screen.findByText(/a clever fox: press e to talk/i)).toBeInTheDocument();
  });

  /** Re-entering after a choice shows the chosen portrait still lit. */
  it('restores an open session and its choices when the child walks back in', async () => {
    setStep('order-the-story');
    getActiveSessionMock.mockResolvedValue({ id: 'session-9', status: 'ACTIVE' } as never);
    listActionsForSessionsMock.mockResolvedValue([
      {
        sessionId: 'session-9',
        stepId: 'choose-hero',
        correctness: 'CORRECT',
        normalizedAnswer: 'hero-dragon',
      },
      {
        sessionId: 'session-9',
        stepId: 'choose-setting',
        correctness: 'CORRECT',
        normalizedAnswer: 'setting-mountain',
      },
    ] as never);

    await renderAndWaitForEngine();

    await waitFor(() => {
      expect(createEngineMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          chosenHeroEntityId: 'gallery-portrait-dragon',
          chosenSettingEntityId: 'tower-window-mountain',
        }),
      );
    });
    expect(listActionsForSessionsMock).toHaveBeenCalledWith(['session-9']);
  });

  it('does not start a session for a child who only walks through', async () => {
    await renderAndWaitForEngine();

    expect(getActiveSessionMock).toHaveBeenCalledWith('child-1', 'the-storykeepers-tale');
    expect(createEngineMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ chosenHeroEntityId: null, chosenSettingEntityId: null }),
    );
    expect(screen.queryByText(/i keep all the island stories here/i)).not.toBeInTheDocument();
  });

  it('asks the engine to interact from the accessible list', async () => {
    const user = userEvent.setup();

    await renderAndWaitForEngine();

    await user.click(screen.getByRole('button', { name: /interact with what you're looking at/i }));

    expect(interactSpy).toHaveBeenCalledTimes(1);
  });

  it('offers a link back to the non-3D location page', async () => {
    renderView();

    expect(await screen.findByRole('link', { name: /prefer not to walk in 3d/i })).toHaveAttribute(
      'href',
      '/island/child-1/locations/storykeeper-castle',
    );
  });
});
