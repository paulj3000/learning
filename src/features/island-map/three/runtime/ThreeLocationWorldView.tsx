import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import styles from '../../IslandWorldView.module.css';
import { ThreeGameContainer } from '../ThreeGameContainer';
import { WorldStage } from '../WorldStage';
import { WorldHud, type WorldHudBackpackItem } from '../WorldHud';
import { WorldEngineEventBus } from '../worldEngineEvents';
import type { WorldInteraction, WorldInteractionContext } from '../../worldObjects';
import { getWorldState, recordCharacterMet, saveCheckpoint } from '../../../discovery/api';
import { listAllWorldChanges, recordWorldChangeOnce } from '../../../adventures/api';
import { getInventory } from '../../../rewards/api';
import { ALL_ITEMS } from '../../../rewards/content';
import { listQuestStates } from '../../../quests/api';
import { getQuestDefinition } from '../../../quests/content';
import { getCompanionProfile } from '../../../island/api';
import type { AgeBandValue } from '../../../child-profile/constants';
import {
  createLocationEngine,
  DEFAULT_LOCATION_ENGINE_DEPS,
  type LocationEngine,
} from './createLocationEngine';
import type { ThreeLocationManifest } from './locationManifest';
import { resolveStatusLine, resolveThingsToDoNotes } from './sceneLayout';
import {
  LocationManifestNotFoundError,
  type LocationManifestRepository,
} from './locationManifestRepository';
import { sourceLocationManifestRepository } from './manifests';
import {
  availableInteractions,
  focusLabel,
  findCollectibleByEntityId,
  findNpcByEntityId,
  interactionForEntity,
  pickUpWorldChange,
  walkInInteractionForZone,
  zoneEnterMessage,
} from './manifestBindings';
import { WorldActionPanel } from './WorldActionPanel';
import type { LocationViewExtensionRegistry } from './viewExtensionRegistry';
import { SOURCE_VIEW_EXTENSIONS } from '../extensions';

/**
 * The one React view for any manifest-driven 3D location
 * (`docs/engine/10_IMPLEMENTATION_PHASES.md` Phase 4,
 * `docs/engine/03_GENERIC_3D_WORLD_RUNTIME.md` Step 3). It replaces the
 * orchestration each `*WorldView.tsx` repeats: the up-front world reads,
 * spawning at the saved checkpoint, checkpoint saves, NPC "met" writes,
 * crosshair labels, toasts, the interaction dialog, the "Things to do here"
 * list, and the non-graphical way out.
 *
 * It knows nothing about any particular location. Everything it shows comes
 * from the manifest the repository returns, and every event is resolved
 * through `manifestBindings.ts`.
 */
export interface ThreeLocationWorldViewProps {
  childId: string;
  /** The manifest's stable key (`RegionCheckpoint.regionId`). */
  regionId: string;
  /** The child's own `ChildProfile.ageBand`, resolved by the route. Gates NPC talk and adventures. */
  ageBand: AgeBandValue;
  /** Where manifests come from. Defaults to the source-controlled repository. */
  repository?: LocationManifestRepository;
  /** The React halves of world extensions. Defaults to the shipped ones (`../extensions`). */
  viewExtensions?: LocationViewExtensionRegistry;
}

const TOAST_DURATION_MS = 4000;

const EMPTY_CONTEXT: WorldInteractionContext = {
  worldChangeKeys: [],
  ownedItemIds: [],
  discoveryIds: [],
};

type ManifestState =
  | { status: 'loading' }
  | { status: 'ready'; manifest: ThreeLocationManifest }
  | { status: 'not-found' }
  | { status: 'error' };

interface WorldSnapshot {
  startCheckpointId?: string;
  companionName: string | null;
  questCue: string | null;
  backpackItems: readonly WorldHudBackpackItem[];
  context: WorldInteractionContext;
}

const EMPTY_SNAPSHOT: WorldSnapshot = {
  companionName: null,
  questCue: null,
  backpackItems: [],
  context: EMPTY_CONTEXT,
};

/**
 * Everything the scene and HUD need before mounting, read once. Fails open
 * to an empty snapshot, as every region view does: a child whose backpack
 * read fails still gets to walk around, spawning at the first checkpoint.
 * The interaction context fails *closed* (no keys, items or discoveries),
 * so a failed read hides a gated spot rather than revealing one.
 */
async function loadWorldSnapshot(childId: string): Promise<WorldSnapshot> {
  try {
    const [worldState, companion, inventory, questStates, worldChanges] = await Promise.all([
      getWorldState(childId),
      getCompanionProfile(childId),
      getInventory(childId),
      listQuestStates(childId),
      listAllWorldChanges(childId),
    ]);
    const activeQuest = questStates.find((state) => state.status === 'ACTIVE');
    return {
      startCheckpointId: worldState.lastCheckpointId,
      companionName: companion?.displayName ?? null,
      questCue: activeQuest ? (getQuestDefinition(activeQuest.questId)?.title ?? null) : null,
      backpackItems: inventory.ownedItemIds.flatMap((id) => {
        const item = ALL_ITEMS.find((candidate) => candidate.id === id);
        return item ? [{ id: item.id, displayName: item.displayName }] : [];
      }),
      context: {
        worldChangeKeys: worldChanges.map((change) => change.changeKey),
        ownedItemIds: inventory.ownedItemIds,
        discoveryIds: worldState.discoveredIds,
      },
    };
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

export function ThreeLocationWorldView({
  childId,
  regionId,
  ageBand,
  repository = sourceLocationManifestRepository,
  viewExtensions = SOURCE_VIEW_EXTENSIONS,
}: ThreeLocationWorldViewProps) {
  const [manifestState, setManifestState] = useState<ManifestState>({ status: 'loading' });
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  const [focusedLabel, setFocusedLabel] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [openInteraction, setOpenInteraction] = useState<WorldInteraction | null>(null);
  const [openExtensionId, setOpenExtensionId] = useState<string | null>(null);

  const bus = useMemo(() => new WorldEngineEventBus(), []);
  const engineRef = useRef<LocationEngine | null>(null);
  // Read by bus listeners, so a refreshed context never forces re-subscribing.
  const contextRef = useRef<WorldInteractionContext>(EMPTY_CONTEXT);
  useEffect(() => {
    contextRef.current = snapshot?.context ?? EMPTY_CONTEXT;
  }, [snapshot]);

  useEffect(() => {
    let cancelled = false;
    setManifestState({ status: 'loading' });
    setSnapshot(null);
    async function load() {
      let manifest: ThreeLocationManifest;
      try {
        manifest = await repository.getPublished(regionId);
      } catch (error) {
        if (!cancelled) {
          setManifestState({
            status: error instanceof LocationManifestNotFoundError ? 'not-found' : 'error',
          });
        }
        return;
      }
      if (cancelled) return;
      setManifestState({ status: 'ready', manifest });
      const loaded = await loadWorldSnapshot(childId);
      if (!cancelled) setSnapshot(loaded);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [childId, regionId, repository]);

  const manifest = manifestState.status === 'ready' ? manifestState.manifest : null;

  const refreshWorld = useCallback(async () => {
    const loaded = await loadWorldSnapshot(childId);
    // Keep the spawn the scene was built with; only what is available changes.
    setSnapshot((previous) => ({ ...loaded, startCheckpointId: previous?.startCheckpointId }));
  }, [childId]);

  /**
   * Every way into an interaction goes through here (walking up, tapping,
   * the list), so an extension that takes an interaction over for this
   * child (an Explorer's tide trial) cannot be skipped by one entry point.
   */
  const openInteractionFor = useCallback(
    (interaction: WorldInteraction) => {
      if (!manifest) return;
      const claimant = manifest.extensions.find((binding) =>
        viewExtensions
          .get(binding.extensionId)
          ?.claimsInteraction(interaction, { ageBand, config: binding.config }),
      );
      if (!claimant) {
        setOpenInteraction(interaction);
        return;
      }
      // Free the mouse for the overlay's buttons.
      if (typeof document !== 'undefined' && document.pointerLockElement) {
        document.exitPointerLock();
      }
      setOpenInteraction(null);
      setOpenExtensionId(claimant.extensionId);
    },
    [ageBand, manifest, viewExtensions],
  );

  useEffect(() => {
    if (!manifest) return;
    const checkpointIds = new Set(manifest.checkpoints.ids);
    // Unsubscribed one by one: `removeAllListeners` would also drop listeners
    // this view does not own (the hazard the duplication audit found).
    const unsubscribes = [
      bus.on('NpcApproached', ({ entityId }) => {
        const npc = findNpcByEntityId(manifest, entityId);
        if (!npc) return;
        void recordCharacterMet(childId, npc.npcId).catch(() => undefined);
        bus.emit('NpcStateChanged', { entityId, metByChild: true });
      }),
      bus.on('InteractableFocused', ({ entityId }) => {
        setFocusedLabel(focusLabel(manifest, entityId));
      }),
      bus.on('ObjectInteracted', ({ entityId }) => {
        const interaction = interactionForEntity(manifest, entityId, contextRef.current);
        if (interaction) openInteractionFor(interaction);
      }),
      /*
        Picking something up, as the manifest declares it (Phase 8): the
        authored toast, and the one durable fact. `recordWorldChangeOnce` is
        the island's existing idempotent write path, so a double pickup
        records one find, and the refresh is what makes a spot that needed
        this find available without leaving the region.
      */
      bus.on('CollectiblePickedUp', ({ entityId }) => {
        const collectible = findCollectibleByEntityId(manifest, entityId);
        if (!collectible) return;
        if (collectible.pickUpMessage) setToast(collectible.pickUpMessage);
        const change = pickUpWorldChange(manifest, entityId);
        if (!change) return;
        void recordWorldChangeOnce(
          childId,
          change.locationSlug,
          change.changeType,
          change.changeKey,
          change.source,
        )
          .then(() => refreshWorld())
          .catch(() => undefined);
      }),
      bus.on('PlayerEnteredZone', ({ zoneId }) => {
        if (checkpointIds.has(zoneId)) {
          void saveCheckpoint(childId, zoneId).catch(() => undefined);
          return;
        }
        const message = zoneEnterMessage(manifest, zoneId);
        if (message) setToast(message);
        const interaction = walkInInteractionForZone(manifest, zoneId, contextRef.current);
        if (interaction) openInteractionFor(interaction);
      }),
    ];
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [bus, childId, manifest, openInteractionFor, refreshWorld]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  if (manifestState.status === 'not-found' || manifestState.status === 'error') {
    return (
      <div className={styles.wrapper}>
        <p className={styles.status} role="alert">
          {manifestState.status === 'not-found'
            ? "This part of the island isn't open yet."
            : "This part of the island couldn't be loaded. Please try again later."}
        </p>
        <Link className={styles.altNavLink} to={`/island/${childId}`}>
          Go back to the harbor
        </Link>
      </div>
    );
  }

  if (!manifest || !snapshot) {
    return (
      <div className={styles.wrapper}>
        <p className={styles.status}>{manifest?.copy.loading ?? 'Loading...'}</p>
      </div>
    );
  }

  const startCheckpointId = snapshot.startCheckpointId;
  const openBinding = openExtensionId
    ? manifest.extensions.find((binding) => binding.extensionId === openExtensionId)
    : undefined;
  const openExtensionDefinition = openBinding
    ? viewExtensions.get(openBinding.extensionId)
    : undefined;
  const openExtension =
    openBinding && openExtensionDefinition
      ? { extension: openExtensionDefinition, config: openBinding.config }
      : null;
  const thingsToDo = availableInteractions(manifest, snapshot.context);
  const altNavPath = manifest.copy.altNav.to
    ? `/island/${childId}/${manifest.copy.altNav.to}`
    : `/island/${childId}`;

  const statusLine = resolveStatusLine(manifest, snapshot.context);
  const thingsToDoNotes = resolveThingsToDoNotes(manifest, snapshot.context);

  return (
    <div className={styles.wrapper}>
      <p className={styles.instructions}>{manifest.copy.instructions}</p>
      {statusLine ? <p className={styles.status}>{statusLine}</p> : null}
      <WorldStage>
        <ThreeGameContainer
          instanceKey={`${childId}:${manifest.regionId}`}
          createEngine={(parent) =>
            createLocationEngine(
              parent,
              bus,
              manifest,
              { startCheckpointId, worldState: snapshot.context },
              DEFAULT_LOCATION_ENGINE_DEPS,
            )
          }
          onEngineReady={(engine) => {
            engineRef.current = engine;
          }}
        />
        <WorldHud
          questCue={snapshot.questCue}
          companionName={snapshot.companionName}
          focusedLabel={focusedLabel}
          toastMessage={toast}
          backpackItems={snapshot.backpackItems}
        />
        {openExtension ? (
          <openExtension.extension.Overlay
            childId={childId}
            ageBand={ageBand}
            config={openExtension.config}
            sceneApi={engineRef.current?.extensionApi(openExtension.extension.id) ?? null}
            onClose={() => setOpenExtensionId(null)}
            refreshWorld={refreshWorld}
          />
        ) : null}
      </WorldStage>
      {openInteraction ? (
        <WorldActionPanel
          childId={childId}
          ageBand={ageBand}
          interaction={openInteraction}
          onDismiss={() => setOpenInteraction(null)}
          onDiscovered={() => void refreshWorld()}
        />
      ) : null}
      <details className={styles.thingsToDo}>
        <summary>Things to do here</summary>
        <ul className={styles.thingsToDoList}>
          {thingsToDo.map((interaction) => (
            <li key={interaction.id}>
              <button
                type="button"
                className={styles.thingsToDoButton}
                onClick={() => openInteractionFor(interaction)}
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
        {thingsToDoNotes.map((note) => (
          <p key={note} className={styles.status}>
            {note}
          </p>
        ))}
      </details>
      <Link className={styles.altNavLink} to={altNavPath}>
        {manifest.copy.altNav.label}
      </Link>
    </div>
  );
}
