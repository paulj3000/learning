import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import styles from '../IslandWorldView.module.css';
import { ThreeGameContainer } from './ThreeGameContainer';
import { createClockworkHarborEngine, type ClockworkHarborEngine } from './clockworkHarborScene';
import { WorldEngineEventBus } from './worldEngineEvents';
import { WorldHud, type WorldHudBackpackItem } from './WorldHud';
import {
  DISTRICT_LABELS,
  GOLDEN_GEAR_SPOTS,
  HARBOR_MASTER_ID,
  LIGHTHOUSE_MECHANISM,
  NPC_SPOTS,
  PROFESSOR_TICKTOCK_ID,
} from './clockworkHarborRegion';
import { NpcConversation } from '../NpcConversation';
import { getWorldState, recordCharacterMet, saveCheckpoint } from '../../discovery/api';
import { KNOWN_CHECKPOINT_IDS } from '../../discovery/checkpoints';
import { listAllWorldChanges } from '../../adventures/api';
import { getInventory } from '../../rewards/api';
import { ALL_ITEMS } from '../../rewards/content';
import { listQuestStates } from '../../quests/api';
import { getQuestDefinition } from '../../quests/content';
import { getCompanionProfile } from '../../island/api';
import { listSkillProgress } from '../../mastery/api';
import { computeLearningProfile, domainProfile } from '../../learning-profile/profile';
import { resolveAdventureForSkillLevel, selectDifficultyLevel } from '../../adaptive/selection';
import { DARK_LIGHTHOUSE_ADVENTURES } from '../../adventures/content';
import { deriveClockworkHarborState } from '../../clockwork-harbor/state';
import type { ClockworkHarborState } from '../../clockwork-harbor/types';
import type { AgeBandValue } from '../../child-profile/constants';

interface ClockworkHarborWorldViewProps {
  childId: string;
  /** The child's own `ChildProfile.ageBand`, resolved by the page. Gates the NPC conversation. */
  ageBand: AgeBandValue;
}

const TOAST_DURATION_MS = 4000;

const NPC_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  NPC_SPOTS.map((npc) => [npc.id, npc.label]),
);

/**
 * Clockwork Harbor's first-person view (`docs/regions/clockwork.md` section
 * 9). Deliberately parallel to `WelcomeHarborWorldView.tsx`: its own
 * `WorldEngineEventBus`, real domain wiring for the placed NPCs, and a
 * "Things to do here" list offering everything the graphical scene can do, so
 * walking around is never the only way to use this screen
 * (`docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md` section 42).
 *
 * Everything the scene needs before it can mount is read once up front - the
 * child's last checkpoint, their companion, quest, backpack, and the harbor's
 * own derived state - so `createClockworkHarborEngine` shows the right harbor
 * on its very first frame rather than starting dark and correcting later.
 * That matters more here than in Welcome Harbor: section 2.3 makes the lit
 * lamp and the open gate the child's proof that they fixed this place, and a
 * harbor that flickers from broken to fixed a second after loading would read
 * as a glitch rather than as a memory.
 */
export function ClockworkHarborWorldView({ childId, ageBand }: ClockworkHarborWorldViewProps) {
  const [ready, setReady] = useState(false);
  const [startCheckpointId, setStartCheckpointId] = useState<string | undefined>(undefined);
  const [harborState, setHarborState] = useState<ClockworkHarborState | null>(null);
  const [companionName, setCompanionName] = useState<string | null>(null);
  const [questCue, setQuestCue] = useState<string | null>(null);
  const [backpackItems, setBackpackItems] = useState<readonly WorldHudBackpackItem[]>([]);
  const [focusedLabel, setFocusedLabel] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [conversationNpcId, setConversationNpcId] = useState<string | null>(null);
  /**
   * Which of the three authored lighthouse variants this child gets
   * (`docs/regions/clockwork.md` section 2.2). Resolved up front from their
   * demonstrated Learning Profile rather than at the moment they touch the
   * machine, so pressing E never waits on a network read.
   */
  const [lighthouseSlug, setLighthouseSlug] = useState<string | null>(null);

  const navigate = useNavigate();
  const bus = useMemo(() => new WorldEngineEventBus(), []);

  /**
   * Using the machine, as the scene's `ObjectInteracted` listener sees it.
   *
   * Held in a ref so the bus subscription below never has to be torn down and
   * rebuilt when the chosen variant or the harbor's state resolves. Re-running
   * that effect would drop listeners mid-frame while the scene is emitting.
   */
  const startLighthouseRef = useRef<() => void>(() => {});
  startLighthouseRef.current = () => {
    if (harborState?.lighthouseFixed) {
      setToast('The machine is humming along. The lamp is already turning.');
      return;
    }
    if (!lighthouseSlug) {
      setToast('The machine is quiet. Ask the Harbor Master about it.');
      return;
    }
    navigate(`/island/${childId}/locations/clockwork-harbor/adventures/${lighthouseSlug}`);
  };
  const engineRef = useRef<ClockworkHarborEngine | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [worldState, worldChanges, companion, inventory, questStates, skillProgress] =
          await Promise.all([
            getWorldState(childId),
            listAllWorldChanges(childId),
            getCompanionProfile(childId),
            getInventory(childId),
            listQuestStates(childId),
            listSkillProgress(childId),
          ]);
        if (cancelled) return;

        /*
          The adaptive selection, in three steps and no more: aggregate the
          evidence the island already records into a Learning Profile, ask what
          difficulty this child's math domain is ready for, then pick the
          authored variant nearest that level. All three are pure functions;
          nothing here decides whether an answer is right, which stays with the
          Adventure Engine.

          Falling back to the age-band variant would be wrong here - every
          variant is authored for this location, so `resolveAdventureForSkillLevel`
          always finds one - but the null guard stays, because a content edit
          that unlevelled all three should degrade to "no puzzle offered"
          rather than to a crash at the machine.
        */
        const profile = computeLearningProfile(
          skillProgress.map((row) => ({
            skillId: row.learningObjectiveCode,
            counts: {
              exposureCount: row.exposureCount,
              independentSuccessCount: row.independentSuccessCount,
              supportedSuccessCount: row.supportedSuccessCount,
              consecutiveIndependentCorrect: row.consecutiveIndependentCorrect,
              lastPracticedAt: row.lastPracticedAt,
            },
          })),
        );
        const level = selectDifficultyLevel(domainProfile(profile, 'math'));
        const variantsForBand = DARK_LIGHTHOUSE_ADVENTURES.filter((variant) =>
          variant.ageBands.includes(ageBand),
        );
        setLighthouseSlug(resolveAdventureForSkillLevel(variantsForBand, level)?.slug ?? null);
        setStartCheckpointId(worldState.lastCheckpointId);
        setHarborState(deriveClockworkHarborState(worldChanges.map((change) => change.changeKey)));
        setCompanionName(companion?.displayName ?? null);
        setBackpackItems(
          inventory.ownedItemIds.flatMap((id) => {
            const item = ALL_ITEMS.find((candidate) => candidate.id === id);
            return item ? [{ id: item.id, displayName: item.displayName }] : [];
          }),
        );
        const activeQuest = questStates.find((state) => state.status === 'ACTIVE');
        setQuestCue(activeQuest ? (getQuestDefinition(activeQuest.questId)?.title ?? null) : null);
      } catch {
        /*
          A failed read must not leave a child staring at a spinner. The harbor
          falls back to its unrepaired state, which is the honest default: it
          shows less than the child has earned, never more, and never claims a
          repair that did not happen.
        */
        if (!cancelled) setHarborState(deriveClockworkHarborState([]));
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // `ageBand` narrows which variants are candidates, so a change to it has
    // to re-resolve the chosen one.
  }, [childId, ageBand]);

  const noteCharacterMet = useCallback(
    (npcId: string) => {
      void recordCharacterMet(childId, npcId).catch(() => undefined);
    },
    [childId],
  );

  useEffect(() => {
    const offApproached = bus.on('NpcApproached', ({ entityId }) => {
      noteCharacterMet(entityId);
    });
    const offInteracted = bus.on('ObjectInteracted', ({ entityId }) => {
      if (NPC_LABELS[entityId]) {
        setConversationNpcId(entityId);
        return;
      }
      if (entityId === LIGHTHOUSE_MECHANISM.id) {
        startLighthouseRef.current();
      }
    });
    const offFocus = bus.on('InteractableFocused', ({ entityId }) => {
      if (!entityId) {
        setFocusedLabel(null);
        return;
      }
      if (NPC_LABELS[entityId]) {
        setFocusedLabel(NPC_LABELS[entityId]);
      } else if (entityId === LIGHTHOUSE_MECHANISM.id) {
        setFocusedLabel(LIGHTHOUSE_MECHANISM.label);
      } else if (entityId.startsWith('golden-gear-')) {
        setFocusedLabel('a golden gear');
      } else {
        setFocusedLabel(null);
      }
    });
    const offPickup = bus.on('CollectiblePickedUp', () => {
      setToast('You found a golden gear.');
    });
    const offZone = bus.on('PlayerEnteredZone', ({ zoneId }) => {
      if (KNOWN_CHECKPOINT_IDS.includes(zoneId)) {
        void saveCheckpoint(childId, zoneId).catch(() => undefined);
        return;
      }
      const label = DISTRICT_LABELS[zoneId];
      if (label) setToast(`You're at ${label}.`);
    });
    return () => {
      offApproached();
      offInteracted();
      offFocus();
      offPickup();
      offZone();
      bus.removeAllListeners();
    };
  }, [bus, childId, noteCharacterMet]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  if (!ready || !harborState) {
    return (
      <div className={styles.wrapper}>
        <p className={styles.status}>Loading Clockwork Harbor...</p>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <p className={styles.instructions}>
        Move: WASD or the arrow keys. Look: click the screen, then move your mouse (or drag with two
        fingers on a touch screen: left side to move, right side to look). Walk up to someone and
        press E, or use the buttons below, to talk.
      </p>
      <p className={styles.status}>
        {harborState.lighthouseFixed
          ? 'The lighthouse is turning again, and the harbor gate is open.'
          : 'The lighthouse is dark. The Harbor Master is waiting on the dock.'}
      </p>
      <div style={{ position: 'relative' }}>
        <ThreeGameContainer
          instanceKey={`${childId}:${String(harborState.lighthouseFixed)}`}
          createEngine={(parent) =>
            createClockworkHarborEngine(parent, bus, {
              startCheckpointId,
              lighthouseFixed: harborState.lighthouseFixed,
            })
          }
          onEngineReady={(engine) => {
            engineRef.current = engine;
          }}
        />
        <WorldHud
          questCue={questCue}
          companionName={companionName}
          focusedLabel={focusedLabel}
          toastMessage={toast}
          backpackItems={backpackItems}
        />
      </div>
      {conversationNpcId ? (
        <div className={styles.panel} role="dialog" aria-label={NPC_LABELS[conversationNpcId]}>
          <NpcConversation
            childId={childId}
            npcId={conversationNpcId}
            ageBand={ageBand}
            onEnd={() => setConversationNpcId(null)}
          />
        </div>
      ) : null}
      <details className={styles.thingsToDo}>
        <summary>Things to do here</summary>
        <ul className={styles.thingsToDoList}>
          <li>
            <button
              type="button"
              className={styles.thingsToDoButton}
              onClick={() => setConversationNpcId(HARBOR_MASTER_ID)}
            >
              Talk to the Harbor Master
            </button>
          </li>
          <li>
            <button
              type="button"
              className={styles.thingsToDoButton}
              onClick={() => setConversationNpcId(PROFESSOR_TICKTOCK_ID)}
            >
              Talk to Professor Ticktock
            </button>
          </li>
          <li>
            <button
              type="button"
              className={styles.thingsToDoButton}
              onClick={() => startLighthouseRef.current()}
            >
              Look at the machine inside the lighthouse
            </button>
          </li>
          <li>
            <button
              type="button"
              className={styles.thingsToDoButton}
              onClick={() => engineRef.current?.interact()}
            >
              Interact with what you're looking at
            </button>
          </li>
        </ul>
        <p className={styles.status}>
          There are {GOLDEN_GEAR_SPOTS.length} golden gears hidden around the harbor. Look behind
          the lighthouse, along the dock, and up by the clock tower.
        </p>
      </details>
      <Link className={styles.altNavLink} to={`/island/${childId}`}>
        Prefer not to walk in 3D? Go back to the island map
      </Link>
    </div>
  );
}
