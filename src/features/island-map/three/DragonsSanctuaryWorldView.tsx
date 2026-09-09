import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import styles from '../IslandWorldView.module.css';
import { ThreeGameContainer } from './ThreeGameContainer';
import { createDragonsSanctuaryEngine, type DragonsSanctuaryEngine } from './dragonsSanctuaryScene';
import { WorldEngineEventBus } from './worldEngineEvents';
import { WorldHud, type WorldHudBackpackItem } from './WorldHud';
import {
  AREA_LABELS,
  DRAGON_SCALE_SPOTS,
  EMBER_ID,
  FIRE_RUNE_SPOTS,
  FORGE_HEARTH,
  NPC_SPOTS,
  SEALED_GATES,
} from './dragonsSanctuaryRegion';
import { NpcConversation } from '../NpcConversation';
import { getWorldState, recordCharacterMet, saveCheckpoint } from '../../discovery/api';
import { KNOWN_CHECKPOINT_IDS } from '../../discovery/checkpoints';
import { listAllWorldChanges, recordWorldChangeOnce } from '../../adventures/api';
import { getInventory } from '../../rewards/api';
import { ALL_ITEMS } from '../../rewards/content';
import { listQuestStates } from '../../quests/api';
import { getQuestDefinition } from '../../quests/content';
import { getCompanionProfile } from '../../island/api';
import { deriveDragonsSanctuaryState } from '../../dragons-sanctuary/state';
import { dragonScaleChangeKey, fireRuneChangeKey } from '../../dragons-sanctuary/types';
import type { DragonsSanctuaryState } from '../../dragons-sanctuary/types';
import type { AgeBandValue } from '../../child-profile/constants';

interface DragonsSanctuaryWorldViewProps {
  childId: string;
  /** The child's own `ChildProfile.ageBand`, resolved by the page. Gates the NPC conversation. */
  ageBand: AgeBandValue;
}

const LOCATION_SLUG = 'dragons-sanctuary';
const TOAST_DURATION_MS = 4000;

const NPC_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  NPC_SPOTS.map((npc) => [npc.id, npc.label]),
);
const RUNE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  FIRE_RUNE_SPOTS.map((rune) => [rune.id, rune.label]),
);
const GATE_MESSAGES: Readonly<Record<string, string>> = Object.fromEntries(
  SEALED_GATES.map((gate) => [gate.id, gate.lockedMessage]),
);
const GATE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  SEALED_GATES.map((gate) => [gate.id, gate.label]),
);
const SCALE_IDS = new Set(DRAGON_SCALE_SPOTS.map((scale) => scale.id));

/**
 * The Dragon's Sanctuary's first-person view
 * (`docs/regions/dragons-sanctuary-roadmap.md` Phases 1 and 2).
 *
 * Deliberately parallel to `ClockworkHarborWorldView.tsx`: its own
 * `WorldEngineEventBus`, real domain wiring for Ember, and a "Things to do
 * here" list offering everything the graphical scene can do.
 *
 * That list is not a convenience here, it is a requirement. ADR-021 phases
 * out the 2D Phaser views, which removes one of the two non-first-person
 * routes ADR-008 was relying on while the Sprouts accessibility playtest
 * remains unrun. The other route - the card-based hub, and every button below
 * - is now the only one, so walking in 3D must never be the only way to reach
 * anything in this region
 * (`docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md` section 42).
 *
 * Everything the scene needs before it can mount is read once up front - the
 * child's last checkpoint, their companion, quest, backpack, and the
 * sanctuary's own derived state - so `createDragonsSanctuaryEngine` shows the
 * right valley on its very first frame rather than starting cold and
 * correcting later. A sanctuary that flickered from ruined to restored a
 * second after loading would read as a glitch rather than as a memory.
 */
export function DragonsSanctuaryWorldView({ childId, ageBand }: DragonsSanctuaryWorldViewProps) {
  const [ready, setReady] = useState(false);
  const [startCheckpointId, setStartCheckpointId] = useState<string | undefined>(undefined);
  const [sanctuaryState, setSanctuaryState] = useState<DragonsSanctuaryState | null>(null);
  const [companionName, setCompanionName] = useState<string | null>(null);
  const [questCue, setQuestCue] = useState<string | null>(null);
  const [backpackItems, setBackpackItems] = useState<readonly WorldHudBackpackItem[]>([]);
  const [focusedLabel, setFocusedLabel] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [conversationNpcId, setConversationNpcId] = useState<string | null>(null);
  /**
   * Runes found this session, on top of the ones already in `sanctuaryState`.
   *
   * Kept locally as well as written, so picking one up updates the count in
   * front of the child immediately. The write is the durable record; this is
   * only what the HUD says while it is in flight.
   */
  const [runesFoundNow, setRunesFoundNow] = useState<readonly string[]>([]);

  const bus = useMemo(() => new WorldEngineEventBus(), []);
  const engineRef = useRef<DragonsSanctuaryEngine | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [worldState, worldChanges, companion, inventory, questStates] = await Promise.all([
          getWorldState(childId),
          listAllWorldChanges(childId),
          getCompanionProfile(childId),
          getInventory(childId),
          listQuestStates(childId),
        ]);
        if (cancelled) return;

        setStartCheckpointId(worldState.lastCheckpointId);
        setSanctuaryState(
          deriveDragonsSanctuaryState(worldChanges.map((change) => change.changeKey)),
        );
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
          A failed read must not leave a child staring at a spinner. The
          sanctuary falls back to its forgotten state, which is the honest
          default: it shows less than the child has earned, never more, and
          never claims a restoration that did not happen.
        */
        if (!cancelled) setSanctuaryState(deriveDragonsSanctuaryState([]));
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

  /**
   * Picking something up, as one durable fact.
   *
   * `recordWorldChangeOnce` is the island's existing write path and is
   * idempotent, so a double interaction records one rune. Provenance is
   * `exploration:<propId>` rather than a session id, following the convention
   * `recordDiscovery` set with `discovery:<id>`: nothing here came from an
   * adventure session, and inventing one would make the column lie.
   */
  const recordFind = useCallback(
    (changeType: string, changeKey: string, propId: string) => {
      void recordWorldChangeOnce(
        childId,
        LOCATION_SLUG,
        changeType,
        changeKey,
        `exploration:${propId}`,
      ).catch(() => undefined);
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
      if (RUNE_LABELS[entityId]) {
        recordFind('RUNE_FOUND', fireRuneChangeKey(entityId), entityId);
        setRunesFoundNow((found) => (found.includes(entityId) ? found : [...found, entityId]));
        setToast(`You found ${RUNE_LABELS[entityId]}. It is warm to hold.`);
        return;
      }
      if (SCALE_IDS.has(entityId)) {
        recordFind('COLLECTIBLE_FOUND', dragonScaleChangeKey(entityId), entityId);
        return;
      }
      if (GATE_MESSAGES[entityId]) {
        // The authored line, never a refusal (CLAUDE.md pillar 7).
        setToast(GATE_MESSAGES[entityId]);
        return;
      }
      if (entityId === FORGE_HEARTH.id) {
        setToast(
          'The hearth is cold, and its three rune sockets are empty. Ember is up at her roost.',
        );
      }
    });
    const offFocus = bus.on('InteractableFocused', ({ entityId }) => {
      if (!entityId) {
        setFocusedLabel(null);
        return;
      }
      if (NPC_LABELS[entityId]) setFocusedLabel(NPC_LABELS[entityId]);
      else if (RUNE_LABELS[entityId]) setFocusedLabel(RUNE_LABELS[entityId]);
      else if (GATE_LABELS[entityId]) setFocusedLabel(GATE_LABELS[entityId]);
      else if (entityId === FORGE_HEARTH.id) setFocusedLabel(FORGE_HEARTH.label);
      else if (SCALE_IDS.has(entityId)) setFocusedLabel('a dragon scale');
      else setFocusedLabel(null);
    });
    const offPickup = bus.on('CollectiblePickedUp', ({ entityId }) => {
      if (SCALE_IDS.has(entityId)) setToast('You found a dragon scale.');
    });
    const offZone = bus.on('PlayerEnteredZone', ({ zoneId }) => {
      if (KNOWN_CHECKPOINT_IDS.includes(zoneId)) {
        void saveCheckpoint(childId, zoneId).catch(() => undefined);
        return;
      }
      const label = AREA_LABELS[zoneId];
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
  }, [bus, childId, noteCharacterMet, recordFind]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  if (!ready || !sanctuaryState) {
    return (
      <div className={styles.wrapper}>
        <p className={styles.status}>Loading the Dragon's Sanctuary...</p>
      </div>
    );
  }

  const runeIdsFound = Array.from(new Set([...sanctuaryState.runesFound, ...runesFoundNow]));
  const runesRemaining = FIRE_RUNE_SPOTS.length - runeIdsFound.length;

  return (
    <div className={styles.wrapper}>
      <p className={styles.instructions}>
        Move: WASD or the arrow keys. Look: click the screen, then move your mouse (or drag with two
        fingers on a touch screen: left side to move, right side to look). Walk up to someone and
        press E, or use the buttons below, to talk.
      </p>
      <p className={styles.status}>
        {sanctuaryState.forgeLit
          ? 'The forge is burning, and the whole valley is warm again.'
          : runesRemaining === 0
            ? 'You have all three fire runes. The hearth is waiting.'
            : `The forge is cold and dark. Ember is waiting up at her roost.`}
      </p>
      <div style={{ position: 'relative' }}>
        <ThreeGameContainer
          instanceKey={`${childId}:${String(sanctuaryState.forgeLit)}:${runeIdsFound.length}`}
          createEngine={(parent) =>
            createDragonsSanctuaryEngine(parent, bus, {
              startCheckpointId,
              forgeLit: sanctuaryState.forgeLit,
              foundRuneIds: runeIdsFound,
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
              onClick={() => setConversationNpcId(EMBER_ID)}
            >
              Talk to Ember
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
          {sanctuaryState.forgeLit
            ? 'All three fire runes are set in the hearth.'
            : runesRemaining === 0
              ? 'You have found all three fire runes. Take them to the hearth inside the forge.'
              : `There are ${runesRemaining} fire runes still out in the valley. Look behind the Keeper Lodge, down among the boulders, and out on the sky cliff ledge.`}
        </p>
        <p className={styles.status}>
          There are {DRAGON_SCALE_SPOTS.length} dragon scales hidden around the sanctuary.
        </p>
      </details>
      <Link className={styles.altNavLink} to={`/island/${childId}`}>
        Prefer not to walk in 3D? Go back to the island map
      </Link>
    </div>
  );
}
