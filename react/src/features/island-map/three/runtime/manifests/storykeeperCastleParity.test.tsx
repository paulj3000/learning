import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgeBandValue } from '../../../../child-profile/constants';
import type { AdventureStep } from '../../../../adventures/engine/types';
import type { Correctness } from '../../../../adventures/engine/types';
import type { StepAnswer } from '../../../../adventures/engine/validators';
import { THE_STORYKEEPERS_TALE } from '../../../../adventures/content/theStorykeepersTale';
import { QUILLS_PICTURE_STORY } from '../../../../adventures/content/quillsPictureStory';
import { SECRET_DOOR_CHAPTER_2_PATTERN_LOCK } from '../../../../adventures/content/castlesSecretDoorAdventures';
import type { WorldEngineEventBus } from '../../worldEngineEvents';
import type { WorldInteractionContext } from '../../../worldObjects';
import { ThreeLocationWorldView } from '../ThreeLocationWorldView';

/**
 * Engine Phase 9 parity for Storykeeper Castle: every behaviour family
 * `StorykeeperCastleWorldView.test.tsx` asserts of the old castle view, run
 * against the generic view, the real manifest and the real `castle-tale`
 * React half.
 *
 * The scene half is faked here exactly as the old test faked the castle
 * engine - these are the view's own claims, and the scene's are held by
 * `storykeeperCastle.engine.test.ts` against the real extension. The
 * Adventure Engine and the Story Engine are mocked at their own boundaries,
 * never replaced: what matters is that the room *asks* them and never
 * reaches past them to decide anything itself.
 */
const submitAnswerSpy = vi.fn<(answer: StepAnswer) => Promise<Correctness | null>>();
const sceneSpies = vi.hoisted(() => ({
  showChosenHero: vi.fn(),
  showChosenSetting: vi.fn(),
  playQuillClip: vi.fn(),
  resetBindingPlates: vi.fn(),
  resetLibraryClues: vi.fn(),
  resetPatternLockRods: vi.fn(),
  showSecretDoorOpened: vi.fn(),
  showEaselPainting: vi.fn(),
  showStoryTold: vi.fn(),
}));
const engine = vi.hoisted(() => ({
  bus: null as WorldEngineEventBus | null,
  options: null as { startCheckpointId?: string; worldState?: WorldInteractionContext } | null,
  interact: vi.fn(),
  dispose: vi.fn(),
}));

let currentStep: AdventureStep | null = null;
let sessionStatus: string | null = null;
let hintLevel = 0;
let storyChapterId: string | null = 'three-clues';
let sessionLimitReached = false;

vi.mock('../createLocationEngine', () => ({
  DEFAULT_LOCATION_ENGINE_DEPS: {},
  createLocationEngine: vi.fn(
    (_parent: HTMLElement, bus: WorldEngineEventBus, _manifest: unknown, options: object) => {
      engine.bus = bus;
      engine.options = options;
      return {
        dispose: engine.dispose,
        interact: engine.interact,
        extensionApi: (id: string) =>
          id === 'castle-tale' ? { ready: Promise.resolve(), ...sceneSpies } : undefined,
        ready: Promise.resolve(),
      };
    },
  ),
}));

vi.mock('../../../../adventures/useAdventureSession', () => ({
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

const useStoryProgressSpy = vi.hoisted(() => vi.fn());
vi.mock('../../../../story/useStoryProgress', () => ({
  useStoryProgress: (childProfileId: string, story: { slug: string }) => {
    useStoryProgressSpy(childProfileId, story.slug);
    return {
      loadState: 'ready',
      progress: { id: 'story-progress-1', currentChapterId: storyChapterId },
      chapter: storyChapterId ? { id: storyChapterId, title: 'Three Clues', scenes: [] } : null,
      flags: {},
      setFlag: vi.fn(),
      completeChapter: vi.fn(),
    };
  },
}));

vi.mock('../../../../story/StoryChapterRunner', () => ({
  StoryChapterRunner: ({
    storyProgressId,
    chapter,
    renderAdventure,
  }: {
    storyProgressId: string;
    chapter: { id: string };
    renderAdventure?: (props: Record<string, unknown>) => React.ReactNode;
  }) => (
    <div data-testid="story-chapter-runner">
      {storyProgressId}:{chapter.id}
      {renderAdventure?.({
        childProfileId: 'child-1',
        definition: SECRET_DOOR_CHAPTER_2_PATTERN_LOCK,
        ageBand: 'EXPLORER',
        aiEnabled: false,
        backToMapHref: '/island/child-1/locations/storykeeper-castle',
        onComplete: () => {},
      })}
    </div>
  ),
}));

vi.mock('../../../../session/useSessionClock', () => ({
  useSessionClock: () => ({
    elapsedMinutes: sessionLimitReached ? 12 : 1,
    limitMinutes: 12,
    limitReached: sessionLimitReached,
  }),
}));

vi.mock('../../../NpcConversation', () => ({
  NpcConversation: ({ npcId, onEnd }: { npcId: string; onEnd: () => void }) => (
    <div data-testid="npc-conversation">
      {npcId}
      <button type="button" onClick={onEnd}>
        Goodbye for now
      </button>
    </div>
  ),
}));

vi.mock('../../../../adventures/api', () => ({
  listAllWorldChanges: vi.fn(),
  getActiveSession: vi.fn(),
  listActionsForSessions: vi.fn(),
  recordWorldChangeOnce: vi.fn(),
  resumeOrStartSession: vi.fn(),
}));
vi.mock('../../../../discovery/api', () => ({
  getWorldState: vi.fn(),
  saveCheckpoint: vi.fn(),
  recordCharacterMet: vi.fn(),
  recordDiscovery: vi.fn(),
  getDiscoveryDefinition: vi.fn(),
}));
vi.mock('../../../../rewards/api', () => ({ getInventory: vi.fn() }));
vi.mock('../../../../quests/api', () => ({ listQuestStates: vi.fn() }));
vi.mock('../../../../island/api', () => ({ getCompanionProfile: vi.fn() }));

import {
  getActiveSession,
  listActionsForSessions,
  listAllWorldChanges,
} from '../../../../adventures/api';
import {
  getDiscoveryDefinition,
  getWorldState,
  recordCharacterMet,
  recordDiscovery,
  saveCheckpoint,
} from '../../../../discovery/api';
import { getInventory } from '../../../../rewards/api';
import { listQuestStates } from '../../../../quests/api';
import { getCompanionProfile } from '../../../../island/api';

const stepOf = (slug: string, stepId: string): AdventureStep => {
  const definition = [THE_STORYKEEPERS_TALE, QUILLS_PICTURE_STORY].find(
    (candidate) => candidate.slug === slug,
  );
  const step = definition?.steps.find((candidate) => candidate.id === stepId);
  if (!step) throw new Error(`no step ${stepId} in ${slug}`);
  return step;
};

function renderCastle(ageBand: AgeBandValue = 'PATHFINDER') {
  return render(
    <MemoryRouter initialEntries={['/island/child-1/explore/storykeeper-castle']}>
      <Routes>
        <Route
          path="/island/:childId/explore/:regionId"
          element={
            <ThreeLocationWorldView
              childId="child-1"
              regionId="storykeeper-castle"
              ageBand={ageBand}
              aiEnabled={false}
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

async function renderAndWait(ageBand: AgeBandValue = 'PATHFINDER') {
  const utils = renderCastle(ageBand);
  await screen.findByText(/move: wasd or the arrow keys/i);
  await waitFor(() => expect(engine.bus).not.toBeNull());
  return utils;
}

describe('Storykeeper Castle on the generic view: parity with StorykeeperCastleWorldView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    engine.bus = null;
    engine.options = null;
    currentStep = null;
    sessionStatus = null;
    hintLevel = 0;
    storyChapterId = 'three-clues';
    sessionLimitReached = false;
    submitAnswerSpy.mockResolvedValue('correct');
    vi.mocked(getWorldState).mockResolvedValue({ discoveredIds: [], metCharacterIds: [] } as never);
    vi.mocked(saveCheckpoint).mockResolvedValue(undefined);
    vi.mocked(recordCharacterMet).mockResolvedValue(undefined);
    vi.mocked(listAllWorldChanges).mockResolvedValue([]);
    vi.mocked(getActiveSession).mockResolvedValue(null as never);
    vi.mocked(listActionsForSessions).mockResolvedValue([]);
    vi.mocked(getInventory).mockResolvedValue({ ownedItemIds: [], grantedRuleIds: [] });
    vi.mocked(listQuestStates).mockResolvedValue([]);
    vi.mocked(getCompanionProfile).mockResolvedValue(null);
    vi.mocked(getDiscoveryDefinition).mockReturnValue(undefined as never);
    vi.mocked(recordDiscovery).mockResolvedValue({ status: 'FOUND' } as never);
  });

  describe('the shell', () => {
    it('shows a loading state before its reads resolve', async () => {
      vi.mocked(listAllWorldChanges).mockReturnValue(new Promise(() => {}) as never);
      renderCastle();
      expect(await screen.findByText(/loading storykeeper castle/i)).toBeInTheDocument();
    });

    it('spawns from the stored checkpoint id rather than a coordinate', async () => {
      vi.mocked(getWorldState).mockResolvedValue({
        discoveredIds: [],
        metCharacterIds: [],
        lastCheckpointId: 'storykeeper-castle:library',
      } as never);
      await renderAndWait();
      await waitFor(() =>
        expect(engine.options?.startCheckpointId).toBe('storykeeper-castle:library'),
      );
      // ...and says where they are, in the castle's own words.
      expect(await screen.findByText('You are back at the Great Library.')).toBeInTheDocument();
    });

    it('saves a checkpoint by id when the child crosses one, and names the spot', async () => {
      await renderAndWait();
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'storykeeper-castle:gallery' }));
      await waitFor(() =>
        expect(saveCheckpoint).toHaveBeenCalledWith('child-1', 'storykeeper-castle:gallery'),
      );
      expect(await screen.findByText('You found the Character Gallery.')).toBeInTheDocument();
    });

    it('offers the way back to Welcome Harbor on reaching the exit, and dismisses it', async () => {
      const user = userEvent.setup();
      await renderAndWait();
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-harbor-exit' }));
      const dialog = await screen.findByRole('dialog', {
        name: 'The path back to Welcome Harbor',
      });
      expect(dialog).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Not now' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('still lets the child explore when the progress reads fail', async () => {
      vi.mocked(getWorldState).mockRejectedValue(new Error('offline'));
      await renderAndWait();
      expect(
        screen.getByText(
          'We could not load your backpack just now. You can still explore the castle.',
        ),
      ).toBeInTheDocument();
    });

    it('disposes the engine on unmount', async () => {
      const { unmount } = await renderAndWait();
      unmount();
      await waitFor(() => expect(engine.dispose).toHaveBeenCalled());
    });

    it('offers a link back to the non-3D location page', async () => {
      await renderAndWait();
      expect(
        screen.getByRole('link', {
          name: 'Prefer not to walk in 3D? Use the location page instead',
        }),
      ).toHaveAttribute('href', '/island/child-1/locations/storykeeper-castle');
    });
  });

  describe('Keeper Quill', () => {
    it('names him on the reticle, records meeting him, and opens his conversation', async () => {
      await renderAndWait();
      await emit((bus) => bus.emit('InteractableFocused', { entityId: 'keeper-quill' }));
      expect(await screen.findByText(/Keeper Quill: press E to talk/)).toBeInTheDocument();

      await emit((bus) => bus.emit('NpcApproached', { entityId: 'keeper-quill' }));
      expect(recordCharacterMet).toHaveBeenCalledWith('child-1', 'keeper-quill');

      await emit((bus) =>
        bus.emit('ObjectInteracted', {
          entityId: 'keeper-quill',
          interactionId: 'keeper-quill:talk',
        }),
      );
      expect(await screen.findByTestId('npc-conversation')).toHaveTextContent('keeper-quill');
    });

    it('plays Talk while he is speaking and Point once the conversation ends', async () => {
      const user = userEvent.setup();
      await renderAndWait();
      await emit((bus) =>
        bus.emit('ObjectInteracted', {
          entityId: 'keeper-quill',
          interactionId: 'keeper-quill:talk',
        }),
      );
      await waitFor(() => expect(sceneSpies.playQuillClip).toHaveBeenCalledWith('Talk'));
      await user.click(screen.getByRole('button', { name: 'Goodbye for now' }));
      await waitFor(() => expect(sceneSpies.playQuillClip).toHaveBeenCalledWith('Point'));
    });

    it('does not point at anything before the child has talked to him', async () => {
      await renderAndWait();
      expect(sceneSpies.playQuillClip).not.toHaveBeenCalledWith('Point');
    });
  });

  describe('age bands', () => {
    it('hides the reticle for Sprouts and shows it for everyone else', async () => {
      await renderAndWait('SPROUT');
      await emit((bus) => bus.emit('InteractableFocused', { entityId: 'keeper-quill' }));
      expect(screen.queryByText(/press E to talk/)).not.toBeInTheDocument();
    });

    it('answers a Sprouts choice with their own adventure’s option id', async () => {
      currentStep = stepOf(QUILLS_PICTURE_STORY.slug, 'pick-the-animal');
      await renderAndWait('SPROUT');
      // The Sprouts picture story opens in the room the same way.
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));
      await emit((bus) =>
        bus.emit('ObjectInteracted', {
          entityId: 'gallery-portrait-fox',
          interactionId: 'gallery-portrait-fox:interact',
        }),
      );
      await waitFor(() =>
        expect(submitAnswerSpy).toHaveBeenCalledWith({
          kind: 'creative-choice',
          optionId: 'picture-fox',
        }),
      );
    });

    it('ignores a portrait that is not one of the Sprouts options', async () => {
      currentStep = stepOf(QUILLS_PICTURE_STORY.slug, 'pick-the-animal');
      await renderAndWait('SPROUT');
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));
      await emit((bus) =>
        bus.emit('ObjectInteracted', {
          entityId: 'gallery-portrait-dragon',
          interactionId: 'gallery-portrait-dragon:interact',
        }),
      );
      expect(submitAnswerSpy).not.toHaveBeenCalled();
    });
  });

  describe('the tale, in the room', () => {
    it('opens in the room instead of navigating away', async () => {
      currentStep = stepOf(THE_STORYKEEPERS_TALE.slug, 'choose-hero');
      await renderAndWait();
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));
      // The step card is on screen, with the step's own options, and no
      // adventure route was navigated to.
      expect(await screen.findByRole('button', { name: 'A clever fox' })).toBeInTheDocument();
    });

    it('answers choose-hero by looking at a portrait, and lights it', async () => {
      currentStep = stepOf(THE_STORYKEEPERS_TALE.slug, 'choose-hero');
      await renderAndWait();
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));
      await emit((bus) =>
        bus.emit('ObjectInteracted', {
          entityId: 'gallery-portrait-fox',
          interactionId: 'gallery-portrait-fox:interact',
        }),
      );
      await waitFor(() =>
        expect(submitAnswerSpy).toHaveBeenCalledWith({
          kind: 'creative-choice',
          optionId: 'hero-fox',
        }),
      );
      expect(sceneSpies.showChosenHero).toHaveBeenCalledWith('gallery-portrait-fox');
    });

    it('answers choose-setting by standing at a window', async () => {
      currentStep = stepOf(THE_STORYKEEPERS_TALE.slug, 'choose-setting');
      await renderAndWait();
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'tower-window-cave' }));
      await waitFor(() =>
        expect(submitAnswerSpy).toHaveBeenCalledWith({
          kind: 'creative-choice',
          optionId: 'setting-cave',
        }),
      );
    });

    it('answers from a portrait zone the manifest had to rename', async () => {
      // SC-10 made standing at a portrait a way to choose it; the zone is
      // suffixed because entity and zone ids share one namespace now.
      currentStep = stepOf(THE_STORYKEEPERS_TALE.slug, 'choose-hero');
      await renderAndWait();
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));
      await emit((bus) =>
        bus.emit('PlayerEnteredZone', { zoneId: 'gallery-portrait-puppy:approach' }),
      );
      await waitFor(() =>
        expect(submitAnswerSpy).toHaveBeenCalledWith({
          kind: 'creative-choice',
          optionId: 'hero-puppy',
        }),
      );
    });

    it('ignores a window walked past while the hero step is open', async () => {
      currentStep = stepOf(THE_STORYKEEPERS_TALE.slug, 'choose-hero');
      await renderAndWait();
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'tower-window-cave' }));
      expect(submitAnswerSpy).not.toHaveBeenCalled();
    });

    it('ignores a portrait looked at while an unbound step is open', async () => {
      currentStep = stepOf(THE_STORYKEEPERS_TALE.slug, 'comprehension-check');
      await renderAndWait();
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));
      await emit((bus) =>
        bus.emit('ObjectInteracted', {
          entityId: 'gallery-portrait-fox',
          interactionId: 'gallery-portrait-fox:interact',
        }),
      );
      expect(submitAnswerSpy).not.toHaveBeenCalled();
    });

    it("names the option a portrait stands for on the reticle, in the card's own words", async () => {
      currentStep = stepOf(THE_STORYKEEPERS_TALE.slug, 'choose-hero');
      await renderAndWait();
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));
      await emit((bus) => bus.emit('InteractableFocused', { entityId: 'gallery-portrait-fox' }));
      const label = THE_STORYKEEPERS_TALE.steps.find((step) => step.id === 'choose-hero')!
        .presentation as { options: { id: string; label: string }[] };
      const fox = label.options.find((option) => option.id === 'hero-fox')!.label;
      expect(await screen.findByText(new RegExp(fox))).toBeInTheDocument();
    });

    it('has Quill point at the mantel from hint rung 3, and not before', async () => {
      currentStep = stepOf(THE_STORYKEEPERS_TALE.slug, 'comprehension-check');
      hintLevel = 2;
      await renderAndWait();
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));
      expect(sceneSpies.playQuillClip).not.toHaveBeenCalledWith('Point', 'hearth');

      hintLevel = 3;
      const view = renderCastle();
      await screen.findByText(/move: wasd or the arrow keys/i);
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));
      await waitFor(() => expect(sceneSpies.playQuillClip).toHaveBeenCalledWith('Point', 'hearth'));
      view.unmount();
    });

    it('paints the easel with the pair the child chose, when they reflect', async () => {
      /*
        Beat 7 is a `REFLECTION` step: nothing is graded, so painting the
        page is presentation reacting to a step rather than to an outcome.
        The pair comes from the two choices this session already recorded,
        which is why they are restored first.
      */
      vi.mocked(getActiveSession).mockResolvedValue({ id: 'session-1' } as never);
      vi.mocked(listActionsForSessions).mockResolvedValue([
        { stepId: 'choose-hero', normalizedAnswer: 'hero-fox', correctness: 'NOT_APPLICABLE' },
        {
          stepId: 'choose-setting',
          normalizedAnswer: 'setting-cave',
          correctness: 'NOT_APPLICABLE',
        },
      ] as never);
      currentStep = stepOf(THE_STORYKEEPERS_TALE.slug, 'story-reflection');
      await renderAndWait();
      await waitFor(() => expect(sceneSpies.showChosenHero).toHaveBeenCalled());
      sceneSpies.showEaselPainting.mockClear();

      const user = userEvent.setup();
      const reflect = await screen.findByRole('button', { name: 'Continue' });
      await user.click(reflect);
      await waitFor(() =>
        expect(sceneSpies.showEaselPainting).toHaveBeenCalledWith('hero-fox', 'setting-cave'),
      );
    });

    it('puts the book on the shelf when the child reaches the world change', async () => {
      currentStep = stepOf(THE_STORYKEEPERS_TALE.slug, 'story-written');
      await renderAndWait();
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));
      await waitFor(() => expect(sceneSpies.showStoryTold).toHaveBeenCalledWith(true));
      expect(sceneSpies.playQuillClip).toHaveBeenCalledWith('Celebrate');
    });

    it('does not change the castle on any earlier step of the tale', async () => {
      currentStep = stepOf(THE_STORYKEEPERS_TALE.slug, 'choose-hero');
      await renderAndWait();
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));
      expect(sceneSpies.showStoryTold).not.toHaveBeenCalled();
    });

    it('offers the already-told narration once a story is on the shelf', async () => {
      vi.mocked(listAllWorldChanges).mockResolvedValue([
        { changeKey: 'FIRST_STORY_TOLD' },
      ] as never);
      await renderAndWait();
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));
      expect(await screen.findByRole('dialog', { name: 'The story hall' })).toBeInTheDocument();
    });
  });

  describe('the binding lectern', () => {
    beforeEach(() => {
      currentStep = stepOf(THE_STORYKEEPERS_TALE.slug, 'order-the-story');
    });

    it('clears the lectern when the ordering step opens, with only this adventure’s plates', async () => {
      await renderAndWait();
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));
      await waitFor(() =>
        expect(sceneSpies.resetBindingPlates).toHaveBeenCalledWith([
          'story-plate-problem',
          'story-plate-choice',
          'story-plate-ending',
        ]),
      );
    });

    it('answers order-the-story by seating three plates in the lectern', async () => {
      await renderAndWait();
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));
      await emit((bus) =>
        bus.emit('BuildActionRequested', {
          entityId: 'binding-lectern',
          order: ['story-plate-problem', 'story-plate-choice', 'story-plate-ending'],
        }),
      );
      await waitFor(() =>
        expect(submitAnswerSpy).toHaveBeenCalledWith({
          kind: 'ordering',
          order: ['beat-problem', 'beat-choice', 'beat-ending'],
        }),
      );
    });

    it('lifts the plates back onto the table when the engine grades the order wrong', async () => {
      submitAnswerSpy.mockResolvedValue('incorrect');
      await renderAndWait();
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));
      await emit((bus) =>
        bus.emit('BuildActionRequested', {
          entityId: 'binding-lectern',
          order: ['story-plate-ending', 'story-plate-choice', 'story-plate-problem'],
        }),
      );
      await waitFor(() => expect(sceneSpies.playQuillClip).toHaveBeenCalledWith('ReactConcerned'));
    });

    it('leaves the plates where the child put them when the order is right', async () => {
      submitAnswerSpy.mockResolvedValue('correct');
      await renderAndWait();
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));
      sceneSpies.resetBindingPlates.mockClear();
      await emit((bus) =>
        bus.emit('BuildActionRequested', {
          entityId: 'binding-lectern',
          order: ['story-plate-problem', 'story-plate-choice', 'story-plate-ending'],
        }),
      );
      await waitFor(() => expect(submitAnswerSpy).toHaveBeenCalled());
      expect(sceneSpies.resetBindingPlates).not.toHaveBeenCalled();
      expect(sceneSpies.playQuillClip).not.toHaveBeenCalledWith('ReactConcerned');
    });

    it('ignores an incomplete arrangement rather than submitting a partial answer', async () => {
      await renderAndWait();
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));
      await emit((bus) =>
        bus.emit('BuildActionRequested', {
          entityId: 'binding-lectern',
          order: ['story-plate-problem'],
        }),
      );
      expect(submitAnswerSpy).not.toHaveBeenCalled();
    });

    it('says what the child just picked up, since the reticle cannot', async () => {
      await renderAndWait();
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-story-hall' }));
      await emit((bus) => bus.emit('CollectiblePickedUp', { entityId: 'story-plate-problem' }));
      expect(await screen.findByText(/You picked up:/)).toBeInTheDocument();
    });
  });

  describe('a session left open', () => {
    it('restores it and its choices when the child walks back in', async () => {
      vi.mocked(getActiveSession).mockResolvedValue({ id: 'session-1' } as never);
      vi.mocked(listActionsForSessions).mockResolvedValue([
        { stepId: 'choose-hero', normalizedAnswer: 'hero-fox', correctness: 'NOT_APPLICABLE' },
        {
          stepId: 'choose-setting',
          normalizedAnswer: 'setting-cave',
          correctness: 'NOT_APPLICABLE',
        },
        { stepId: 'story-reflection', normalizedAnswer: 'done', correctness: 'NOT_APPLICABLE' },
      ] as never);
      currentStep = stepOf(THE_STORYKEEPERS_TALE.slug, 'comprehension-check');
      await renderAndWait();
      await waitFor(() =>
        expect(sceneSpies.showChosenHero).toHaveBeenCalledWith('gallery-portrait-fox'),
      );
      expect(sceneSpies.showChosenSetting).toHaveBeenCalledWith('tower-window-cave');
      expect(sceneSpies.showEaselPainting).toHaveBeenCalledWith('hero-fox', 'setting-cave');
    });

    it('leaves the easel blank for a session that has not reached the studio yet', async () => {
      vi.mocked(getActiveSession).mockResolvedValue({ id: 'session-1' } as never);
      vi.mocked(listActionsForSessions).mockResolvedValue([
        { stepId: 'choose-hero', normalizedAnswer: 'hero-fox', correctness: 'NOT_APPLICABLE' },
      ] as never);
      currentStep = stepOf(THE_STORYKEEPERS_TALE.slug, 'choose-setting');
      await renderAndWait();
      await waitFor(() => expect(sceneSpies.showChosenHero).toHaveBeenCalled());
      expect(sceneSpies.showEaselPainting).not.toHaveBeenCalled();
    });

    it('does not start a session for a child who only walks through', async () => {
      await renderAndWait();
      expect(screen.queryByRole('button', { name: /i pictured it/i })).not.toBeInTheDocument();
    });
  });

  describe('the secret door arc', () => {
    it('offers the arc at the door, and opens it in the room', async () => {
      await renderAndWait('EXPLORER');
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-last-bookshelf' }));
      expect(await screen.findByTestId('story-chapter-runner')).toHaveTextContent(
        'story-progress-1:three-clues',
      );
      expect(useStoryProgressSpy).toHaveBeenCalledWith('child-1', 'the-castles-secret-door');
    });

    it('refuses the arc to a band the Story Engine does not allow', async () => {
      await renderAndWait('SPROUT');
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-last-bookshelf' }));
      expect(screen.queryByTestId('story-chapter-runner')).not.toBeInTheDocument();
    });

    it('creates no story progress for a child who only walks through', async () => {
      await renderAndWait('EXPLORER');
      expect(useStoryProgressSpy).not.toHaveBeenCalled();
    });

    it('answers order-the-keys by seating three rods in the lock', async () => {
      currentStep = SECRET_DOOR_CHAPTER_2_PATTERN_LOCK.steps.find(
        (step) => step.id === 'order-the-keys',
      )!;
      await renderAndWait('EXPLORER');
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-last-bookshelf' }));
      await emit((bus) =>
        bus.emit('BuildActionRequested', {
          entityId: 'secret-door',
          order: ['lock-rod-silver', 'lock-rod-iron', 'lock-rod-brass'],
        }),
      );
      await waitFor(() =>
        expect(submitAnswerSpy).toHaveBeenCalledWith({
          kind: 'ordering',
          order: ['short-rod', 'medium-rod', 'long-rod'],
        }),
      );
    });

    it('takes the rods back out when the engine grades the order wrong', async () => {
      submitAnswerSpy.mockResolvedValue('incorrect');
      currentStep = SECRET_DOOR_CHAPTER_2_PATTERN_LOCK.steps.find(
        (step) => step.id === 'order-the-keys',
      )!;
      await renderAndWait('EXPLORER');
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-last-bookshelf' }));
      await emit((bus) =>
        bus.emit('BuildActionRequested', {
          entityId: 'secret-door',
          order: ['lock-rod-brass', 'lock-rod-iron', 'lock-rod-silver'],
        }),
      );
      await waitFor(() => expect(sceneSpies.resetPatternLockRods).toHaveBeenCalled());
      expect(sceneSpies.playQuillClip).toHaveBeenCalledWith('ReactConcerned');
    });

    it('shows the way through once the arc is already finished', async () => {
      vi.mocked(listAllWorldChanges).mockResolvedValue([
        { changeKey: 'THE_CASTLES_SECRET_DOOR_COMPLETE' },
      ] as never);
      await renderAndWait('EXPLORER');
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-last-bookshelf' }));
      expect(
        await screen.findByRole('dialog', { name: 'The last bookshelf, standing ajar' }),
      ).toBeInTheDocument();
    });
  });

  describe('the nook, and the calm stop', () => {
    it('finds the nook when the child wanders into the corner', async () => {
      await renderAndWait();
      await emit((bus) => bus.emit('PlayerEnteredZone', { zoneId: 'castle-tapestry-stair' }));
      expect(
        await screen.findByRole('dialog', { name: 'A tapestry that moves' }),
      ).toBeInTheDocument();
    });

    it('never advertises the nook anywhere in the HUD', async () => {
      await renderAndWait();
      expect(screen.queryByText('A tapestry that moves')).not.toBeInTheDocument();
    });

    it('says nothing about stopping before the parent-set time has passed', async () => {
      await renderAndWait();
      expect(screen.queryByText(/good place to sit/i)).not.toBeInTheDocument();
      expect(sceneSpies.playQuillClip).not.toHaveBeenCalledWith('Point', 'nook');
    });

    it('has Quill look toward the nook once the time has passed, and takes nothing away', async () => {
      sessionLimitReached = true;
      await renderAndWait();
      await waitFor(() => expect(sceneSpies.playQuillClip).toHaveBeenCalledWith('Point', 'nook'));
      expect(await screen.findByText(/good place to sit/i)).toBeInTheDocument();
      // Nothing closes: the way out and the list are still there.
      expect(
        screen.getByRole('link', {
          name: 'Prefer not to walk in 3D? Use the location page instead',
        }),
      ).toBeInTheDocument();
    });
  });
});
