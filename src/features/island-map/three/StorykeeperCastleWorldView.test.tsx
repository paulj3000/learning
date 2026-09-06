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
import type { Correctness } from '../../adventures/engine/types';
import { STORY_PLATE_ENTITY_IDS } from './castleBindingLectern';

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
const resetBindingPlatesSpy = vi.fn();
const showEaselPaintingSpy = vi.fn();
const showStoryToldSpy = vi.fn();
let capturedBus: WorldEngineEventBus | null = null;

vi.mock('./storykeeperCastleScene', () => ({
  createStorykeeperCastleEngine: vi.fn((_parent: HTMLDivElement, bus: WorldEngineEventBus) => {
    capturedBus = bus;
    return {
      dispose: disposeSpy,
      interact: interactSpy,
      playQuillClip: playQuillClipSpy,
      resetBindingPlates: resetBindingPlatesSpy,
      showChosenHero: showChosenHeroSpy,
      showChosenSetting: showChosenSettingSpy,
      showEaselPainting: showEaselPaintingSpy,
      showStoryTold: showStoryToldSpy,
    };
  }),
}));

/**
 * The session is mocked so a test can put the tale on an exact step and
 * watch what reaches `submitAnswer`. `useAdventureSession` is tested on its
 * own; what SC-4 has to prove is that a room and a card both arrive at that
 * one function with the same argument.
 */
const submitAnswerSpy = vi.fn<(answer: StepAnswer) => Promise<Correctness | null>>();
let currentStep: AdventureStep | null = null;
let sessionStatus: string | null = null;
/** The rung the mocked session is on, so beat 5's gesture can be driven up the ladder. */
let hintLevel = 0;

vi.mock('../../adventures/useAdventureSession', () => ({
  useAdventureSession: vi.fn(() => ({
    loadState: 'ready',
    session: sessionStatus ? { id: 'session-1', status: sessionStatus } : null,
    currentStep,
    hintLevel,
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

/**
 * The Story Engine is mocked at its own boundary, not replaced. What these
 * tests need to see is that the castle *asks* it - one `useStoryProgress`
 * for one child and one story, whatever route they arrived by - and that it
 * never reaches past it to decide anything itself.
 */
const useStoryProgressSpy = vi.fn();
let storyChapterId: string | null = 'three-clues';
let storyProgressId = 'story-progress-1';

vi.mock('../../story/useStoryProgress', () => ({
  useStoryProgress: (childProfileId: string, story: { slug: string }) => {
    useStoryProgressSpy(childProfileId, story.slug);
    return {
      loadState: 'ready',
      progress: { id: storyProgressId, currentChapterId: storyChapterId },
      chapter: storyChapterId ? { id: storyChapterId, title: 'Three Clues', scenes: [] } : null,
      flags: {},
      setFlag: vi.fn(),
      completeChapter: vi.fn(),
    };
  },
}));

vi.mock('../../story/StoryChapterRunner', () => ({
  StoryChapterRunner: ({
    storyProgressId: id,
    chapter,
  }: {
    storyProgressId: string;
    chapter: { id: string };
  }) => (
    <div data-testid="story-chapter-runner">
      {id}:{chapter.id}
    </div>
  ),
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
  recordDiscovery: vi.fn(),
  getDiscoveryDefinition: vi.fn(),
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
import {
  getDiscoveryDefinition,
  getWorldState,
  recordCharacterMet,
  recordDiscovery,
  saveCheckpoint,
} from '../../discovery/api';
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
const recordDiscoveryMock = vi.mocked(recordDiscovery);
const getDiscoveryDefinitionMock = vi.mocked(getDiscoveryDefinition);
const getInventoryMock = vi.mocked(getInventory);
const listQuestStatesMock = vi.mocked(listQuestStates);
const getCompanionProfileMock = vi.mocked(getCompanionProfile);

/** Puts the mocked session on a real authored step of the real tale. */
function setStep(stepId: string | null): void {
  currentStep = stepId
    ? (THE_STORYKEEPERS_TALE.steps.find((step) => step.id === stepId) ?? null)
    : null;
}

function viewTree(ageBand: AgeBandValue = 'PATHFINDER') {
  return (
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
    </MemoryRouter>
  );
}

function renderView(ageBand: AgeBandValue = 'PATHFINDER') {
  return render(viewTree(ageBand));
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
    resetBindingPlatesSpy.mockReset();
    showEaselPaintingSpy.mockReset();
    showStoryToldSpy.mockReset();
    submitAnswerSpy.mockReset();
    submitAnswerSpy.mockResolvedValue('correct');
    capturedBus = null;
    currentStep = null;
    sessionStatus = 'ACTIVE';
    hintLevel = 0;
    useStoryProgressSpy.mockClear();
    storyChapterId = 'three-clues';
    storyProgressId = 'story-progress-1';
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
    recordDiscoveryMock.mockReset();
    getDiscoveryDefinitionMock.mockReset();
    getDiscoveryDefinitionMock.mockReturnValue({
      id: 'castle-tapestry-stair',
      locationSlug: 'storykeeper-castle',
      foundMessage: 'A cushioned nook, just big enough to sit in.',
    } as never);
    recordDiscoveryMock.mockResolvedValue({
      outcome: { status: 'FOUND_NOW', message: 'A cushioned nook, just big enough to sit in.' },
      rewardMessages: [],
    } as never);
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

  // --- SC-5: hearth, lectern, and easel (beats 5-7) -------------------------

  /**
   * Beat 5. The comprehension check stays a HUD card on purpose - hiding its
   * answer in the room would turn a reading-comprehension check into a
   * spatial search - so the room's contribution is a *gesture*, and the
   * gesture follows the authored ladder rather than replacing a rung of it.
   */
  it('has Quill point at the mantel from hint rung 3, and not before', async () => {
    hintLevel = 2;
    const { rerender } = await renderMidTale('comprehension-check');
    expect(playQuillClipSpy).not.toHaveBeenCalledWith('Point', 'hearth');

    /*
      The same tree, re-rendered: the child asked for another hint on the
      step they are already on. Handing `rerender` a *different* tree would
      remount the view and quietly turn this into a test of a fresh mount at
      rung 3, which is not the thing that has to work.
    */
    hintLevel = 3;
    rerender(viewTree());

    await waitFor(() => {
      expect(playQuillClipSpy).toHaveBeenCalledWith('Point', 'hearth');
    });
  });

  it('does not point at the mantel on a step the mantel says nothing about', async () => {
    hintLevel = 5;

    await renderMidTale('order-the-story');

    expect(playQuillClipSpy).not.toHaveBeenCalledWith('Point', 'hearth');
  });

  /** Beat 6. Three plates seated become the same answer the HUD list submits. */
  it('answers order-the-story by seating three plates in the lectern', async () => {
    await renderMidTale('order-the-story');

    act(() =>
      capturedBus?.emit('BuildActionRequested', {
        entityId: 'binding-lectern',
        order: ['story-plate-problem', 'story-plate-choice', 'story-plate-ending'],
      }),
    );

    await waitFor(() => {
      expect(submitAnswerSpy).toHaveBeenCalledWith({
        kind: 'ordering',
        order: ['beat-problem', 'beat-choice', 'beat-ending'],
      });
    });
  });

  /**
   * SC-5's headline exit criterion, the same shape as SC-4's. The plates
   * start on the table in the step's own authored item order and the HUD
   * list starts in that order too, so seating them untouched and submitting
   * the list untouched must produce the identical payload.
   */
  it('produces an identical order whether the child uses the plates or the list', async () => {
    const user = userEvent.setup();

    await renderMidTale('order-the-story');
    act(() =>
      capturedBus?.emit('BuildActionRequested', {
        entityId: 'binding-lectern',
        order: STORY_PLATE_ENTITY_IDS,
      }),
    );
    await waitFor(() => {
      expect(submitAnswerSpy).toHaveBeenCalledTimes(1);
    });
    const fromTheRoom = submitAnswerSpy.mock.calls[0];

    submitAnswerSpy.mockClear();
    await user.click(screen.getByRole('button', { name: /check my order/i }));
    await waitFor(() => {
      expect(submitAnswerSpy).toHaveBeenCalledTimes(1);
    });

    expect(fromTheRoom).toEqual(submitAnswerSpy.mock.calls[0]);
  });

  /**
   * Beat 6's promise on a wrong order: nothing is destroyed, nothing is
   * lost, the plates come back to the table and Quill looks concerned. The
   * verdict comes from the engine, never from a comparison made here.
   */
  it('lifts the plates back onto the table when the engine grades the order wrong', async () => {
    submitAnswerSpy.mockResolvedValue('incorrect');

    await renderMidTale('order-the-story');
    resetBindingPlatesSpy.mockClear();

    act(() =>
      capturedBus?.emit('BuildActionRequested', {
        entityId: 'binding-lectern',
        order: ['story-plate-ending', 'story-plate-choice', 'story-plate-problem'],
      }),
    );

    await waitFor(() => {
      expect(resetBindingPlatesSpy).toHaveBeenCalled();
    });
    expect(playQuillClipSpy).toHaveBeenCalledWith('ReactConcerned');
  });

  it('leaves the plates where the child put them when the order is right', async () => {
    await renderMidTale('order-the-story');
    resetBindingPlatesSpy.mockClear();

    act(() =>
      capturedBus?.emit('BuildActionRequested', {
        entityId: 'binding-lectern',
        order: ['story-plate-problem', 'story-plate-choice', 'story-plate-ending'],
      }),
    );

    await waitFor(() => {
      expect(submitAnswerSpy).toHaveBeenCalled();
    });
    expect(resetBindingPlatesSpy).not.toHaveBeenCalled();
    expect(playQuillClipSpy).not.toHaveBeenCalledWith('ReactConcerned');
  });

  /** The lectern is furniture the whole time, so the step starts from a clean table. */
  it('clears the lectern when the ordering step opens', async () => {
    await renderMidTale('order-the-story');

    await waitFor(() => {
      expect(resetBindingPlatesSpy).toHaveBeenCalled();
    });
  });

  it('ignores an arrangement built while a different step is open', async () => {
    await renderMidTale('comprehension-check');

    act(() =>
      capturedBus?.emit('BuildActionRequested', {
        entityId: 'binding-lectern',
        order: ['story-plate-problem', 'story-plate-choice', 'story-plate-ending'],
      }),
    );

    expect(submitAnswerSpy).not.toHaveBeenCalled();
  });

  it('ignores an incomplete arrangement rather than submitting a partial answer', async () => {
    await renderMidTale('order-the-story');

    act(() =>
      capturedBus?.emit('BuildActionRequested', {
        entityId: 'binding-lectern',
        order: ['story-plate-problem'],
      }),
    );

    expect(submitAnswerSpy).not.toHaveBeenCalled();
  });

  it("names a plate on the reticle in the ordering card's own words", async () => {
    await renderMidTale('order-the-story');

    act(() => capturedBus?.emit('InteractableFocused', { entityId: 'story-plate-problem' }));

    expect(
      await screen.findByText(/the hero finds a problem: press e to talk/i),
    ).toBeInTheDocument();
  });

  it('says what the child just picked up, since the reticle cannot', async () => {
    await renderMidTale('order-the-story');

    act(() => capturedBus?.emit('CollectiblePickedUp', { entityId: 'story-plate-ending' }));

    expect(
      await screen.findByText(/you picked up: the story reaches a happy ending/i),
    ).toBeInTheDocument();
  });

  /** Beat 7. The easel fills with the picture for this child's own two choices. */
  it('paints the easel when the child reflects on their story', async () => {
    const user = userEvent.setup();
    getActiveSessionMock.mockResolvedValue({ id: 'session-7', status: 'ACTIVE' } as never);
    listActionsForSessionsMock.mockResolvedValue([
      {
        sessionId: 'session-7',
        stepId: 'choose-hero',
        correctness: 'NOT_APPLICABLE',
        normalizedAnswer: 'hero-fox',
      },
      {
        sessionId: 'session-7',
        stepId: 'choose-setting',
        correctness: 'NOT_APPLICABLE',
        normalizedAnswer: 'setting-cave',
      },
    ] as never);
    setStep('story-reflection');

    await renderAndWaitForEngine();
    await user.click(await screen.findByRole('button', { name: /i pictured it|continue|next/i }));

    await waitFor(() => {
      expect(showEaselPaintingSpy).toHaveBeenCalledWith('hero-fox', 'setting-cave');
    });
  });

  /**
   * A creative choice is graded `not_applicable`, never `correct` - which is
   * exactly what SC-4's resume filter used to look for, so none of this was
   * reaching the room at all. Both halves are asserted: the portraits SC-4
   * lights, and the painted easel SC-5 adds.
   */
  it('restores a session whose choices the engine graded not-applicable', async () => {
    setStep('complete');
    getActiveSessionMock.mockResolvedValue({ id: 'session-9', status: 'ACTIVE' } as never);
    listActionsForSessionsMock.mockResolvedValue([
      {
        sessionId: 'session-9',
        stepId: 'choose-hero',
        correctness: 'NOT_APPLICABLE',
        normalizedAnswer: 'hero-puppy',
      },
      {
        sessionId: 'session-9',
        stepId: 'choose-setting',
        correctness: 'NOT_APPLICABLE',
        normalizedAnswer: 'setting-island',
      },
      {
        sessionId: 'session-9',
        stepId: 'story-reflection',
        correctness: 'NOT_APPLICABLE',
        normalizedAnswer: undefined,
      },
    ] as never);

    await renderAndWaitForEngine();

    await waitFor(() => {
      expect(createEngineMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          chosenHeroEntityId: 'gallery-portrait-puppy',
          chosenSettingEntityId: 'tower-window-island',
          paintedHeroOptionId: 'hero-puppy',
          paintedSettingOptionId: 'setting-island',
        }),
      );
    });
  });

  it('leaves the easel blank for a session that has not reached the studio yet', async () => {
    setStep('order-the-story');
    getActiveSessionMock.mockResolvedValue({ id: 'session-8', status: 'ACTIVE' } as never);
    listActionsForSessionsMock.mockResolvedValue([
      {
        sessionId: 'session-8',
        stepId: 'choose-hero',
        correctness: 'NOT_APPLICABLE',
        normalizedAnswer: 'hero-puppy',
      },
    ] as never);

    await renderAndWaitForEngine();

    await waitFor(() => {
      expect(createEngineMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ paintedHeroOptionId: null, paintedSettingOptionId: null }),
      );
    });
  });

  // --- SC-6: the book on the shelf (beat 8) --------------------------------

  /**
   * A `WORLD_CHANGE` step has no answer to submit - `useAdventureSession`
   * writes the `WorldChange` and advances past it itself - so the castle
   * has to change on the child *reaching* the step. Driving it off a submit
   * would simply never fire.
   */
  it('puts the book on the shelf when the child reaches the world change', async () => {
    await renderMidTale('story-written');

    await waitFor(() => {
      expect(showStoryToldSpy).toHaveBeenCalledWith(true);
    });
    expect(playQuillClipSpy).toHaveBeenCalledWith('Celebrate');
  });

  it('does not change the castle on any earlier step of the tale', async () => {
    await renderMidTale('story-reflection');

    expect(showStoryToldSpy).not.toHaveBeenCalled();
    expect(playQuillClipSpy).not.toHaveBeenCalledWith('Celebrate');
  });

  /**
   * SC-6's exit criterion: a child who completes the tale, leaves, and
   * returns finds the book on the shelf and the hearth lit. Built at
   * construction from their recorded world change, not replayed.
   */
  it('builds the castle already changed for a child who told a story before', async () => {
    listAllWorldChangesMock.mockResolvedValue([{ changeKey: 'FIRST_STORY_TOLD' } as never]);

    await renderAndWaitForEngine();

    await waitFor(() => {
      expect(createEngineMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ storyTold: true }),
      );
    });
    // Built that way, rather than animated into place on arrival.
    expect(showStoryToldSpy).not.toHaveBeenCalled();
  });

  it('builds the castle unchanged for a child who has not told one', async () => {
    await renderAndWaitForEngine();

    expect(createEngineMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ storyTold: false }),
    );
  });

  // --- SC-7: the tapestry nook (beat 12) -----------------------------------

  /**
   * Walking into the corner *is* the interaction. There is no button to
   * press and nothing to aim at, which is what makes it a secret rather
   * than a feature.
   */
  it('finds the nook when the child wanders into the corner', async () => {
    await renderAndWaitForEngine();

    act(() => capturedBus?.emit('PlayerEnteredZone', { zoneId: 'castle-tapestry-stair' }));

    expect(
      await screen.findByRole('dialog', { name: /a tapestry that moves/i }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(recordDiscoveryMock).toHaveBeenCalledWith('child-1', expect.anything());
    });
    expect(await screen.findByText(/a cushioned nook/i)).toBeInTheDocument();
  });

  /**
   * SC-7's headline exit criterion: the tapestry stays **unmarked**. No HUD
   * cue, no map pin, no reward beyond being found. Every route by which
   * this castle tells a child that something is worth their attention is
   * checked here, because the beat is worth nothing if any one of them
   * leaks.
   */
  it('never advertises the nook anywhere in the HUD', async () => {
    await renderAndWaitForEngine();

    /*
      Not in the accessible "Things to do here" list. jsdom renders a
      collapsed <details>' contents, so this queries them without opening it
      - the same way the existing "asks the engine to interact from the
      accessible list" test reaches that button.
    */
    expect(screen.queryByRole('button', { name: /tapestry/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/tapestry/i)).not.toBeInTheDocument();

    // Not on the reticle: it is an approach trigger and not a raycast target,
    // so the scene never focuses it - but if it ever did, it would have no
    // label to show.
    act(() => capturedBus?.emit('InteractableFocused', { entityId: 'castle-tapestry-stair' }));
    await waitFor(() => {
      expect(screen.queryByText(/press e to talk/i)).not.toBeInTheDocument();
    });

    // And no toast fires on the way in, the way a checkpoint does.
    act(() => capturedBus?.emit('PlayerEnteredZone', { zoneId: 'castle-tapestry-stair' }));
    await screen.findByRole('dialog');
    expect(screen.queryByText(/you found the/i)).not.toBeInTheDocument();
    expect(saveCheckpointMock).not.toHaveBeenCalled();
  });

  it('lets the child leave the nook without taking anything from it', async () => {
    const user = userEvent.setup();

    await renderAndWaitForEngine();
    act(() => capturedBus?.emit('PlayerEnteredZone', { zoneId: 'castle-tapestry-stair' }));
    await screen.findByRole('dialog');

    await user.click(screen.getByRole('button', { name: /not now/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/move: wasd or the arrow keys/i)).toBeInTheDocument();
  });

  // --- ADR-019: the castle as a second entry point into the Explorer arc ---

  /** Walks the child up to the door and takes the authored entry point. */
  async function enterTheSecretDoor(): Promise<void> {
    const user = userEvent.setup();
    act(() => capturedBus?.emit('PlayerEnteredZone', { zoneId: 'castle-last-bookshelf' }));
    await screen.findByRole('dialog', { name: /a door with no handle/i });
    await user.click(screen.getByRole('button', { name: /look at the door/i }));
  }

  it('offers the arc at the door, and opens it in the room', async () => {
    await renderAndWaitForEngine('EXPLORER');

    await enterTheSecretDoor();

    expect(await screen.findByTestId('story-chapter-runner')).toBeInTheDocument();
    // Still in the castle: the arc is played here, not navigated away to.
    expect(screen.getByText(/move: wasd or the arrow keys/i)).toBeInTheDocument();
  });

  /**
   * ADR-019: "reaching a Three.js object must never bypass Story Engine
   * eligibility". The gate is the story's own `supportedAgeBands`, asked
   * through `isStoryForAgeBand`, and this arc is Explorer-only.
   */
  it('refuses the arc to a band the Story Engine does not allow', async () => {
    await renderAndWaitForEngine('PATHFINDER');

    act(() => capturedBus?.emit('PlayerEnteredZone', { zoneId: 'castle-last-bookshelf' }));

    expect(await screen.findByText(/not available for your age yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /look at the door/i })).not.toBeInTheDocument();
    expect(useStoryProgressSpy).not.toHaveBeenCalled();
  });

  /**
   * The canonical-progress rule, at the point it would be easiest to break.
   * `useStoryProgress` starts or resumes a row on mount, so hosting it
   * unconditionally would create story progress for every child who walked
   * into the castle - including the bands this arc is not authored for.
   */
  it('creates no story progress for a child who only walks through', async () => {
    await renderAndWaitForEngine('EXPLORER');

    act(() => capturedBus?.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));
    await screen.findByRole('dialog');

    expect(useStoryProgressSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('story-chapter-runner')).not.toBeInTheDocument();
  });

  /**
   * ADR-019's required cross-entry resume test, castle direction: the arc
   * entered from the castle asks the Story Engine for the same child and the
   * same story `StoryPage` would, so there is one `ChildStoryProgress` and
   * the room resumes whatever chapter it is on rather than restarting.
   */
  it('resumes the same story progress a library visit would', async () => {
    storyProgressId = 'progress-started-in-the-library';
    storyChapterId = 'the-pattern-lock';

    await renderAndWaitForEngine('EXPLORER');
    await enterTheSecretDoor();

    expect(useStoryProgressSpy).toHaveBeenCalledWith('child-1', 'the-castles-secret-door');
    // Not keyed or namespaced by the route the child arrived through.
    expect(useStoryProgressSpy).toHaveBeenCalledTimes(1);
    // And it opens on the chapter that progress is actually on.
    expect(await screen.findByTestId('story-chapter-runner')).toHaveTextContent(
      'progress-started-in-the-library:the-pattern-lock',
    );
  });

  it('shows the way through once the arc is already finished', async () => {
    listAllWorldChangesMock.mockResolvedValue([
      { changeKey: 'THE_CASTLES_SECRET_DOOR_COMPLETE' } as never,
    ]);

    await renderAndWaitForEngine('EXPLORER');
    act(() => capturedBus?.emit('PlayerEnteredZone', { zoneId: 'castle-last-bookshelf' }));

    expect(
      await screen.findByRole('dialog', { name: /the last bookshelf, standing ajar/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /look at the door/i })).not.toBeInTheDocument();
  });

  it('offers a link back to the non-3D location page', async () => {
    renderView();

    expect(await screen.findByRole('link', { name: /prefer not to walk in 3d/i })).toHaveAttribute(
      'href',
      '/island/child-1/locations/storykeeper-castle',
    );
  });
});
