import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import styles from '../IslandWorldView.module.css';
import { ThreeGameContainer } from './ThreeGameContainer';
import { createWelcomeHarborEngine, type WelcomeHarborEngine } from './welcomeHarborScene';
import { WorldEngineEventBus } from './worldEngineEvents';
import { useNpcApproachBridge } from './npcApproachBridge';
import { WorldHud, type WorldHudBackpackItem } from './WorldHud';
import { findBuildingByInteriorZoneId, NPC_ID } from './welcomeHarborRegion';
import { NpcConversation } from '../NpcConversation';
import { getWorldState, recordCharacterMet, saveCheckpoint } from '../../discovery/api';
import { KNOWN_CHECKPOINT_IDS } from '../../discovery/checkpoints';
import { getInventory } from '../../rewards/api';
import { ALL_ITEMS } from '../../rewards/content';
import { listQuestStates } from '../../quests/api';
import { getQuestDefinition } from '../../quests/content';
import { getCompanionProfile } from '../../island/api';
import type { AgeBandValue } from '../../child-profile/constants';

interface WelcomeHarborWorldViewProps {
  childId: string;
  /** The child's own `ChildProfile.ageBand`, resolved by `WelcomeHarborWorldPage`. Gates the NPC conversation. */
  ageBand: AgeBandValue;
}

const TOAST_DURATION_MS = 4000;

/**
 * Welcome Harbor's Phase 32 first-person view (`docs/ROADMAP.md` Phase 32,
 * "First-Person Island Village / Welcome Harbor"). Deliberately parallel to
 * `PirateBuilderBayWorldView.tsx` and `ThreeSandboxWorldView.tsx`: its own
 * `WorldEngineEventBus`, a real domain wiring for the one placed NPC, and a
 * "Things to do here" list offering everything the graphical scene can do,
 * so walking around is never the only way to use this screen (roadmap
 * section 42).
 *
 * Everything the scene needs before it can even mount - the child's last
 * saved checkpoint (`ChildWorldState.lastCheckpointId`), their companion's
 * name, their active quest, and their backpack - is read once up front, so
 * `createWelcomeHarborEngine` always spawns at the right checkpoint on the
 * very first frame rather than starting at the origin and correcting later.
 */
export function WelcomeHarborWorldView({ childId, ageBand }: WelcomeHarborWorldViewProps) {
  const [ready, setReady] = useState(false);
  const [startCheckpointId, setStartCheckpointId] = useState<string | undefined>(undefined);
  const [companionName, setCompanionName] = useState<string | null>(null);
  const [questCue, setQuestCue] = useState<string | null>(null);
  const [backpackItems, setBackpackItems] = useState<readonly WorldHudBackpackItem[]>([]);
  const [focusedLabel, setFocusedLabel] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [conversationOpen, setConversationOpen] = useState(false);

  const bus = useMemo(() => new WorldEngineEventBus(), []);
  const engineRef = useRef<WelcomeHarborEngine | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [worldState, companion, inventory, questStates] = await Promise.all([
          getWorldState(childId),
          getCompanionProfile(childId),
          getInventory(childId),
          listQuestStates(childId),
        ]);
        if (cancelled) return;
        setStartCheckpointId(worldState.lastCheckpointId);
        setCompanionName(companion?.displayName ?? null);
        setBackpackItems(
          inventory.ownedItemIds.flatMap((id) => {
            const item = ALL_ITEMS.find((candidate) => candidate.id === id);
            return item ? [{ id: item.id, displayName: item.displayName }] : [];
          }),
        );
        const activeQuest = questStates.find((state) => state.status === 'ACTIVE');
        setQuestCue(activeQuest ? (getQuestDefinition(activeQuest.questId)?.title ?? null) : null);
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [childId]);

  const noteCharacterMet = useCallback(
    (npcId: string) => {
      void recordCharacterMet(childId, npcId).catch(() => undefined);
    },
    [childId],
  );
  useNpcApproachBridge(bus, NPC_ID, noteCharacterMet);

  useEffect(() => {
    const offInteracted = bus.on('ObjectInteracted', ({ entityId }) => {
      if (entityId === NPC_ID) setConversationOpen(true);
    });
    const offFocus = bus.on('InteractableFocused', ({ entityId }) => {
      setFocusedLabel(entityId === NPC_ID ? 'Pip' : null);
    });
    const offZone = bus.on('PlayerEnteredZone', ({ zoneId }) => {
      if (KNOWN_CHECKPOINT_IDS.includes(zoneId)) {
        void saveCheckpoint(childId, zoneId).catch(() => undefined);
        return;
      }
      const building = findBuildingByInteriorZoneId(zoneId);
      if (building) {
        setToast(`You're inside ${building.label}.`);
      }
    });
    return () => {
      offInteracted();
      offFocus();
      offZone();
      bus.removeAllListeners();
    };
  }, [bus, childId]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  if (!ready) {
    return (
      <div className={styles.wrapper}>
        <p className={styles.status}>Loading Welcome Harbor...</p>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <p className={styles.instructions}>
        Move: WASD or the arrow keys. Look: click the screen, then move your mouse (or drag with two
        fingers on a touch screen: left side to move, right side to look). Walk up to Pip and press
        E, or use the button below, to say hello.
      </p>
      <div style={{ position: 'relative' }}>
        <ThreeGameContainer
          instanceKey={childId}
          createEngine={(parent) => createWelcomeHarborEngine(parent, bus, { startCheckpointId })}
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
      {conversationOpen ? (
        <div className={styles.panel} role="dialog" aria-label="Pip">
          <NpcConversation
            childId={childId}
            npcId={NPC_ID}
            ageBand={ageBand}
            onEnd={() => setConversationOpen(false)}
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
              onClick={() => setConversationOpen(true)}
            >
              Say hello to Pip
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
      </details>
      <Link className={styles.altNavLink} to={`/island/${childId}`}>
        Prefer not to walk in 3D? Go back to the harbor
      </Link>
    </div>
  );
}
