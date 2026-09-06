import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import styles from '../IslandWorldView.module.css';
import { ThreeGameContainer } from './ThreeGameContainer';
import { createWonderwildForestEngine, type WonderwildForestEngine } from './wonderwildForestScene';
import { WorldEngineEventBus } from './worldEngineEvents';
import { WorldHud, type WorldHudBackpackItem } from './WorldHud';
import {
  findInteraction,
  isInteractionAvailable,
  WONDERWILD_FOREST_INTERACTIONS,
  type WorldAction,
  type WorldInteractionContext,
} from '../worldObjects';
import { DiscoveryAction } from '../DiscoveryAction';
import { NpcConversation } from '../NpcConversation';
import { resumeOrStartSession, listAllWorldChanges } from '../../adventures/api';
import { resolveAdventureForAgeBand } from '../../adventures/content';
import { getWorldState, saveCheckpoint } from '../../discovery/api';
import { KNOWN_CHECKPOINT_IDS } from '../../discovery/checkpoints';
import { getInventory } from '../../rewards/api';
import { ALL_ITEMS } from '../../rewards/content';
import { listQuestStates } from '../../quests/api';
import { getQuestDefinition } from '../../quests/content';
import { getCompanionProfile } from '../../island/api';
import type { AgeBandValue } from '../../child-profile/constants';

interface WonderwildForestWorldViewProps {
  childId: string;
  /** The child's own `ChildProfile.ageBand`, resolved by the caller. Gates what may be started here. */
  ageBand: AgeBandValue;
}

const WAGGLE_DANCE_CHANGE_KEY = 'WAGGLE_DANCE_DISCOVERED';
const BUTTERFLY_GARDEN_CHANGE_KEY = 'SAVE_THE_BUTTERFLY_GARDEN_COMPLETE';
const GLOWING_MOSS_JAR_ITEM_ID = 'glowing-moss-jar';

/**
 * Wonderwild Forest's first-person view
 * (`docs/WONDERWILD_FOREST_3D_ROADMAP.md` WF-2). Deliberately combines two
 * already-shipped patterns rather than inventing a third:
 * `PirateBuilderBayWorldView.tsx`'s up-front checkpoint/companion/quest/
 * backpack load plus HUD, and the 2D `WonderwildForestWorldView.tsx`'s
 * `WorldInteraction` handling.
 *
 * The 2D and 3D views of this forest share the exact same authored content
 * (`WONDERWILD_FOREST_INTERACTIONS`, `worldObjects.ts`) rather than each
 * authoring their own: this view's job is to translate spatial events - a
 * raycast hit, a zone the child walked into - into the same interaction ids
 * the Phaser scene already resolves from a walk-in zone or a tapped sprite.
 * Only the presentation differs.
 *
 * **This is the default route into Wonderwild Forest for Pathfinders and
 * Explorers** (WF-2), which is the reason it wires the forest's eight
 * flavour interactions from its first phase rather than shipping an empty
 * shell the way the castle's SC-2 did: promoting a route that offers less
 * than the one it replaces would be a regression dressed as progress. Sprouts
 * keep the card-based route as their default until the accessibility playtest
 * ADR-008 requires has run, and the card route stays linked for everyone.
 *
 * The Wonder Wall itself is scenery here. WF-3 owns `wonder-wall`, and
 * starting the adventure still navigates to the existing, unchanged adventure
 * route - the same boundary the Phaser version already draws.
 */
export function WonderwildForestWorldView({ childId, ageBand }: WonderwildForestWorldViewProps) {
  const [ready, setReady] = useState(false);
  const [startCheckpointId, setStartCheckpointId] = useState<string | undefined>(undefined);
  const [companionName, setCompanionName] = useState<string | null>(null);
  const [questCue, setQuestCue] = useState<string | null>(null);
  const [backpackItems, setBackpackItems] = useState<readonly WorldHudBackpackItem[]>([]);
  const [interactionContext, setInteractionContext] = useState<WorldInteractionContext>({
    worldChangeKeys: [],
  });
  const [focusedLabel, setFocusedLabel] = useState<string | null>(null);
  const [triggeredInteractionId, setTriggeredInteractionId] = useState<string | null>(null);

  const bus = useMemo(() => new WorldEngineEventBus(), []);
  const engineRef = useRef<WonderwildForestEngine | null>(null);

  const waggleDanceDiscovered =
    interactionContext.worldChangeKeys.includes(WAGGLE_DANCE_CHANGE_KEY);
  const butterflyGardenComplete = interactionContext.worldChangeKeys.includes(
    BUTTERFLY_GARDEN_CHANGE_KEY,
  );
  const hasGlowingMossJar = (interactionContext.ownedItemIds ?? []).includes(
    GLOWING_MOSS_JAR_ITEM_ID,
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
      } catch {
        /*
          Deliberately swallowed. The `finally` below already says what this
          view does when a read fails - it renders the forest anyway, because
          a child standing at the trailhead should not be stranded by a
          backpack request timing out. Without this `catch` that intent still
          held, but the rejection escaped `void load()` as an unhandled
          promise rejection; the region simply rendered with empty HUD state
          and a console error nobody owned.
        */
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
   * Re-reads world changes and the backpack after a discovery, so the jar of
   * glowing moss shows up in the HUD and the glowworm cave stops being locked
   * without leaving the forest.
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

  useEffect(() => {
    const offInteracted = bus.on('ObjectInteracted', ({ entityId }) => {
      setTriggeredInteractionId(entityId);
    });
    const offFocus = bus.on('InteractableFocused', ({ entityId }) => {
      const interaction = entityId
        ? findInteraction(WONDERWILD_FOREST_INTERACTIONS, entityId)
        : undefined;
      setFocusedLabel(interaction?.title ?? null);
    });
    const offZone = bus.on('PlayerEnteredZone', ({ zoneId }) => {
      if (KNOWN_CHECKPOINT_IDS.includes(zoneId)) {
        void saveCheckpoint(childId, zoneId).catch(() => undefined);
        return;
      }
      /*
        The hive clearing carries the same before/after pair the Phaser forest
        shares on one zone: `wonderwild-beehive` starts the tale while
        `WAGGLE_DANCE_DISCOVERED` is absent, and `wonderwild-beehive-discovered`
        narrates the payoff after. Only one is ever available, which is why the
        hive *sprite* binds to the always-on `-peek` line instead.
      */
      if (zoneId === 'wonderwild-hive-clearing') {
        setTriggeredInteractionId(
          waggleDanceDiscovered ? 'wonderwild-beehive-discovered' : 'wonderwild-beehive',
        );
        return;
      }
      if (zoneId === 'wonderwild-glow-moss' || zoneId === 'wonderwild-harbor-exit') {
        setTriggeredInteractionId(zoneId);
      }
    });
    return () => {
      // Individual unsubscribes only. `removeAllListeners()` here would drop
      // every other subscriber on a bus this view shares - the live hazard
      // SC-4 found in the castle.
      offInteracted();
      offFocus();
      offZone();
    };
  }, [bus, childId, waggleDanceDiscovered]);

  const triggeredInteraction = triggeredInteractionId
    ? findInteraction(WONDERWILD_FOREST_INTERACTIONS, triggeredInteractionId)
    : undefined;

  const availableInteractions = useMemo(
    () =>
      WONDERWILD_FOREST_INTERACTIONS.filter((interaction) =>
        isInteractionAvailable(interaction, interactionContext),
      ),
    [interactionContext],
  );

  if (!ready) {
    return (
      <div className={styles.wrapper}>
        <p className={styles.status}>Loading Wonderwild Forest...</p>
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
      <div style={{ position: 'relative' }}>
        <ThreeGameContainer
          instanceKey={childId}
          createEngine={(parent) =>
            createWonderwildForestEngine(parent, bus, {
              startCheckpointId,
              waggleDanceDiscovered,
              butterflyGardenComplete,
              hasGlowingMossJar,
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
          toastMessage={null}
          backpackItems={backpackItems}
        />
      </div>
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
      <Link className={styles.altNavLink} to={`/island/${childId}/locations/wonderwild-forest`}>
        Prefer not to walk in 3D? Use the location page instead
      </Link>
    </div>
  );
}

interface InteractionPanelProps {
  childId: string;
  ageBand: AgeBandValue;
  interaction: (typeof WONDERWILD_FOREST_INTERACTIONS)[number];
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
    } catch {
      setError('Something went wrong starting the adventure. Please try again.');
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
