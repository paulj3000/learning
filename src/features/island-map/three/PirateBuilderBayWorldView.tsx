import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import styles from '../IslandWorldView.module.css';
import { ThreeGameContainer } from './ThreeGameContainer';
import { WorldStage } from './WorldStage';
import { createPirateBuilderBayEngine, type PirateBuilderBayEngine } from './pirateBuilderBayScene';
import { WorldEngineEventBus } from './worldEngineEvents';
import { useNpcApproachBridge } from './npcApproachBridge';
import { WorldHud, type WorldHudBackpackItem } from './WorldHud';
import { NPC_ID } from './pirateBuilderBayRegion';
import { TideTrialPanel } from './TideTrialPanel';
import {
  findInteraction,
  isInteractionAvailable,
  PIRATE_BUILDER_BAY_INTERACTIONS,
  type WorldAction,
  type WorldInteractionContext,
} from '../worldObjects';
import { DiscoveryAction } from '../DiscoveryAction';
import { NpcConversation } from '../NpcConversation';
import {
  resumeOrStartSession,
  listAllWorldChanges,
  recordWorldChangeOnce,
} from '../../adventures/api';
import { adventureStartErrorMessage } from '../../catalog/availabilityApi';
import { resolveAdventureForAgeBand } from '../../adventures/content';
import { getWorldState, recordCharacterMet, saveCheckpoint } from '../../discovery/api';
import { KNOWN_CHECKPOINT_IDS } from '../../discovery/checkpoints';
import { getInventory } from '../../rewards/api';
import { ALL_ITEMS } from '../../rewards/content';
import { listQuestStates } from '../../quests/api';
import { getQuestDefinition } from '../../quests/content';
import { getCompanionProfile } from '../../island/api';
import type { AgeBandValue } from '../../child-profile/constants';

interface PirateBuilderBayWorldViewProps {
  childId: string;
  /** The child's own `ChildProfile.ageBand`, resolved by the caller. Gates what may be started here. */
  ageBand: AgeBandValue;
}

const BRIDGE_REPAIRED_CHANGE_KEY = 'BRIDGE_REPAIRED';
const BROKEN_BRIDGE_INTERACTION_ID = 'bay-broken-bridge';

/**
 * Explorers mend the bridge in the scene ("Beat the Tide", `../tideTrial.ts`)
 * instead of through the card adventure. The card route resolved an Explorer
 * to "The Tide Gate Calculation", which opens "The bridge stands" in front
 * of a broken bridge and records `TIDE_GATE_SET`, not `BRIDGE_REPAIRED`, so
 * an Explorer could never cross to the cove.
 */
function usesTideTrial(ageBand: AgeBandValue): boolean {
  return ageBand === 'EXPLORER';
}

/**
 * Pirate Builder Bay's Phase 33 first-person view (`docs/ROADMAP.md` Phase
 * 33, "First-Person Broken Bridge / Pirate Builder Bay Migration").
 * Deliberately combines two already-shipped patterns rather than inventing
 * a third: `WelcomeHarborWorldView.tsx`'s up-front checkpoint/companion/
 * quest/backpack load plus HUD, and the 2D `PirateBuilderBayWorldView.tsx`'s
 * `WorldInteraction`/`InteractionPanelAction` handling.
 *
 * The two-dimensional and three-dimensional views of this bay deliberately
 * share the exact same authored content
 * (`PIRATE_BUILDER_BAY_INTERACTIONS`, `worldObjects.ts`) rather than each
 * authoring their own: this scene's job is to translate spatial events
 * (a raycast hit, a zone the child walked into) into the same interaction
 * ids the Phaser scene already resolves from a walk-in zone or a tapped
 * sprite, so starting the adventure, meeting Pip, and finding the two
 * Phase 26 secrets behave identically in both renderers. Only the
 * presentation - first-person walking versus top-down walking - differs.
 *
 * Starting the adventure still navigates to the existing, unchanged
 * adventure route rather than rendering the challenge inside this scene,
 * the same boundary the Phase 11 Phaser version already drew (see that
 * view's own `handleStart`) - "the existing measurement challenge" per
 * `docs/ROADMAP.md` Phase 33 stays exactly as authored either way.
 */
export function PirateBuilderBayWorldView({ childId, ageBand }: PirateBuilderBayWorldViewProps) {
  const [ready, setReady] = useState(false);
  const [startCheckpointId, setStartCheckpointId] = useState<string | undefined>(undefined);
  const [companionName, setCompanionName] = useState<string | null>(null);
  const [questCue, setQuestCue] = useState<string | null>(null);
  const [backpackItems, setBackpackItems] = useState<readonly WorldHudBackpackItem[]>([]);
  const [interactionContext, setInteractionContext] = useState<WorldInteractionContext>({
    worldChangeKeys: [],
  });
  const [focusedLabel, setFocusedLabel] = useState<string | null>(null);
  const [triggeredInteractionId, setTriggeredInteractionIdRaw] = useState<string | null>(null);
  const [tideTrialOpen, setTideTrialOpen] = useState(false);

  const bus = useMemo(() => new WorldEngineEventBus(), []);
  const engineRef = useRef<PirateBuilderBayEngine | null>(null);

  const bridgeRepaired = interactionContext.worldChangeKeys.includes(BRIDGE_REPAIRED_CHANGE_KEY);

  /** Every way into an interaction goes through here, so the Explorer bridge detour cannot be skipped by one entry point. */
  const setTriggeredInteractionId = useCallback(
    (id: string | null) => {
      if (id === BROKEN_BRIDGE_INTERACTION_ID && usesTideTrial(ageBand)) {
        // Free the mouse for the panel's buttons.
        if (document.pointerLockElement) document.exitPointerLock();
        setTriggeredInteractionIdRaw(null);
        setTideTrialOpen(true);
        return;
      }
      setTriggeredInteractionIdRaw(id);
    },
    [ageBand],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [worldState, companion, inventory, questStates, changes] = await Promise.all([
          getWorldState(childId),
          getCompanionProfile(childId),
          getInventory(childId),
          listQuestStates(childId),
          listAllWorldChanges(childId),
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
        setInteractionContext({
          worldChangeKeys: changes.map((change) => change.changeKey),
          ownedItemIds: inventory.ownedItemIds,
          discoveryIds: worldState.discoveredIds,
        });
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [childId]);

  /**
   * Re-reads world changes and the backpack after a discovery, so a newly
   * found item (e.g. the tide tunnel's moon shell) shows up in the HUD and
   * a newly opened secret stops being locked - the same full re-read
   * `useExplorableWorld.refresh` gives the 2D view, kept inline here since
   * this view already owns a richer load than that hook covers (checkpoint,
   * companion, quest).
   */
  function refresh() {
    void Promise.all([
      listAllWorldChanges(childId),
      getInventory(childId),
      getWorldState(childId),
    ]).then(([changes, inventory, worldState]) => {
      setBackpackItems(
        inventory.ownedItemIds.flatMap((id) => {
          const item = ALL_ITEMS.find((candidate) => candidate.id === id);
          return item ? [{ id: item.id, displayName: item.displayName }] : [];
        }),
      );
      setInteractionContext({
        worldChangeKeys: changes.map((change) => change.changeKey),
        ownedItemIds: inventory.ownedItemIds,
        discoveryIds: worldState.discoveredIds,
      });
    });
  }

  const noteCharacterMet = useMemo(
    () => (npcId: string) => {
      void recordCharacterMet(childId, npcId).catch(() => undefined);
    },
    [childId],
  );
  useNpcApproachBridge(bus, NPC_ID, noteCharacterMet);

  /*
    Read through refs rather than listed as dependencies: this effect's
    cleanup calls `bus.removeAllListeners()`, which also drops the listener
    `useNpcApproachBridge` registered, so re-running it mid-visit (the bridge
    becoming repaired, the tide panel opening) would silently stop Pip's
    approach being recorded.
  */
  const bridgeRepairedRef = useRef(bridgeRepaired);
  bridgeRepairedRef.current = bridgeRepaired;
  const tideTrialOpenRef = useRef(tideTrialOpen);
  tideTrialOpenRef.current = tideTrialOpen;

  useEffect(() => {
    const offInteracted = bus.on('ObjectInteracted', ({ entityId }) => {
      setTriggeredInteractionId(entityId === NPC_ID ? 'meet-pirate-pip' : entityId);
    });
    const offFocus = bus.on('InteractableFocused', ({ entityId }) => {
      const interaction = entityId
        ? findInteraction(
            PIRATE_BUILDER_BAY_INTERACTIONS,
            entityId === NPC_ID ? 'meet-pirate-pip' : entityId,
          )
        : undefined;
      setFocusedLabel(interaction?.title ?? null);
    });
    const offZone = bus.on('PlayerEnteredZone', ({ zoneId }) => {
      if (KNOWN_CHECKPOINT_IDS.includes(zoneId)) {
        void saveCheckpoint(childId, zoneId).catch(() => undefined);
        return;
      }
      if (zoneId === 'bay-bridge-approach') {
        if (tideTrialOpenRef.current) return;
        setTriggeredInteractionId(
          bridgeRepairedRef.current ? 'bay-bridge-repaired' : BROKEN_BRIDGE_INTERACTION_ID,
        );
        return;
      }
      if (zoneId === 'bay-tide-tunnel' || zoneId === 'bay-harbor-exit') {
        setTriggeredInteractionId(zoneId);
      }
    });
    return () => {
      offInteracted();
      offFocus();
      offZone();
      bus.removeAllListeners();
    };
  }, [bus, childId, setTriggeredInteractionId]);

  const triggeredInteraction = triggeredInteractionId
    ? findInteraction(PIRATE_BUILDER_BAY_INTERACTIONS, triggeredInteractionId)
    : undefined;

  const availableInteractions = useMemo(
    () =>
      PIRATE_BUILDER_BAY_INTERACTIONS.filter((interaction) =>
        isInteractionAvailable(interaction, interactionContext),
      ),
    [interactionContext],
  );

  if (!ready) {
    return (
      <div className={styles.wrapper}>
        <p className={styles.status}>Loading Pirate Builder Bay...</p>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <p className={styles.instructions}>
        Move: WASD or the arrow keys. Look: click the screen, then move your mouse (or drag with two
        fingers on a touch screen: left side to move, right side to look). Walk up to something and
        press E, or use the button below, to interact with it.
      </p>
      <WorldStage>
        <ThreeGameContainer
          instanceKey={childId}
          createEngine={(parent) =>
            createPirateBuilderBayEngine(parent, bus, { startCheckpointId, bridgeRepaired })
          }
          onEngineReady={(engine) => {
            engineRef.current = engine;
          }}
        />
        <WorldHud
          questCue={questCue}
          companionName={companionName}
          focusedLabel={focusedLabel}
          toastMessage={null}
          backpackItems={backpackItems}
        />
        {tideTrialOpen ? (
          <TideTrialPanel
            scene={engineRef.current?.tideTrial ?? null}
            onWon={async () => {
              // Provenance follows `DragonsSanctuaryWorldView`'s `exploration:<id>`: no adventure session is involved.
              await recordWorldChangeOnce(
                childId,
                'pirate-builder-bay',
                'REPAIR',
                BRIDGE_REPAIRED_CHANGE_KEY,
                'exploration:beat-the-tide',
              );
              refresh();
            }}
            onClose={() => setTideTrialOpen(false)}
          />
        ) : null}
      </WorldStage>
      {triggeredInteraction ? (
        <InteractionPanel
          childId={childId}
          ageBand={ageBand}
          interaction={triggeredInteraction}
          onDismiss={() => setTriggeredInteractionId(null)}
          onDiscovered={refresh}
        />
      ) : null}
      <details className={styles.thingsToDo}>
        <summary>Things to do here</summary>
        <ul className={styles.thingsToDoList}>
          {availableInteractions.map((interaction) => (
            <li key={interaction.id}>
              <button
                type="button"
                className={styles.thingsToDoButton}
                onClick={() => setTriggeredInteractionId(interaction.id)}
              >
                {interaction.title}
              </button>
            </li>
          ))}
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
      <Link className={styles.altNavLink} to={`/island/${childId}/locations/pirate-builder-bay`}>
        Prefer not to walk in 3D? Use the location page instead
      </Link>
    </div>
  );
}

interface InteractionPanelProps {
  childId: string;
  ageBand: AgeBandValue;
  interaction: (typeof PIRATE_BUILDER_BAY_INTERACTIONS)[number];
  onDismiss: () => void;
  onDiscovered: () => void;
}

function InteractionPanel({
  childId,
  ageBand,
  interaction,
  onDismiss,
  onDiscovered,
}: InteractionPanelProps) {
  return (
    <div className={styles.panel} role="dialog" aria-label={interaction.title}>
      <h2 className={styles.panelTitle}>{interaction.title}</h2>
      <div className={styles.panelActions}>
        <InteractionPanelAction
          childId={childId}
          ageBand={ageBand}
          action={interaction.action}
          onDiscovered={onDiscovered}
          onDismiss={onDismiss}
        />
        <button type="button" className={styles.dismissButton} onClick={onDismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}

interface InteractionPanelActionProps {
  childId: string;
  ageBand: AgeBandValue;
  action: WorldAction;
  onDiscovered: () => void;
  onDismiss: () => void;
}

/** Resolves one `WorldAction` into UI, identically to the 2D view's own `InteractionPanelAction`. */
function InteractionPanelAction({
  childId,
  ageBand,
  action,
  onDiscovered,
  onDismiss,
}: InteractionPanelActionProps) {
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (action.kind === 'NAVIGATE') {
    return (
      <Link className={styles.goLink} to={`/island/${childId}/${action.to}`}>
        Go there
      </Link>
    );
  }

  if (action.kind === 'SHOW_MESSAGE') {
    return <p>{action.message}</p>;
  }

  if (action.kind === 'DISCOVER') {
    return (
      <DiscoveryAction
        childId={childId}
        discoveryId={action.discoveryId}
        onDiscovered={onDiscovered}
      />
    );
  }

  if (action.kind === 'TALK_TO') {
    return (
      <NpcConversation childId={childId} npcId={action.npcId} ageBand={ageBand} onEnd={onDismiss} />
    );
  }

  /*
    ADR-019's `START_STORY` opens a Story Engine arc in the region that
    authored it. No interaction here authors one, and a 3D story entry point
    is authored rather than automatic, so there is nothing to render.
  */
  if (action.kind === 'START_STORY') {
    return null;
  }

  const startAdventureAction = action;

  const startTemplate = resolveAdventureForAgeBand(
    startAdventureAction.locationSlug,
    startAdventureAction.templateSlug,
    ageBand,
  );

  if (!startTemplate) {
    return <p>This adventure is not available for your age yet.</p>;
  }

  async function handleStart() {
    const definition = startTemplate;
    if (!definition) {
      setError('This adventure is not available right now.');
      return;
    }
    setStarting(true);
    setError(null);
    try {
      await resumeOrStartSession(childId, definition);
      navigate(
        `/island/${childId}/locations/${startAdventureAction.locationSlug}/adventures/${definition.slug}`,
      );
    } catch (startError) {
      setError(adventureStartErrorMessage(startError));
      setStarting(false);
    }
  }

  return (
    <>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className={styles.goLink}
        onClick={() => void handleStart()}
        disabled={starting}
      >
        {starting ? 'Starting...' : 'Start the adventure'}
      </button>
    </>
  );
}
