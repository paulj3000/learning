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
  type LocationEngineAssets,
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
  checkpointToast,
  focusLabel,
  focusPrompt,
  findCollectibleByEntityId,
  findNpcByEntityId,
  interactionForEntity,
  pickUpWorldChange,
  walkInInteractionForZone,
  zoneEnterMessage,
} from './manifestBindings';
import { WorldActionPanel } from './WorldActionPanel';
import type { LocationViewExtensionRegistry } from './viewExtensionRegistry';
import { SOURCE_VIEW_EXTENSIONS } from '../extensions/viewExtensions';
import { chooseRenderQuality, deviceHintsFromNavigator } from './visual/renderQuality';
import { prefersReducedMotion } from '../../../../lib/motionPreference';
import { createPendingWrites, useExitParticipant } from '../../../portal/exit';
import {
  loadCameraPreference,
  loadSprintModePreference,
  saveCameraPreference,
  saveSprintModePreference,
  type SprintModePreference,
} from '../cameraPreference';
import type { CameraMode } from '../playerPresentation';
import type { PlayerAvatarModel } from '../playerAvatarCatalog';
import type { LoadedModel } from './extensionRegistry';

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
  /**
   * The parent's AI setting for this child, resolved by the route. Only an
   * extension that hosts an adventure in the room needs it, for the same
   * reason `AdventurePage` does; it defaults to off, which fails closed.
   */
  aiEnabled?: boolean;
  /** Where manifests come from. Defaults to the source-controlled repository. */
  repository?: LocationManifestRepository;
  /** The React halves of world extensions. Defaults to the shipped ones (`../extensions`). */
  viewExtensions?: LocationViewExtensionRegistry;
  /**
   * Where the scene's models come from. Defaults to the bundled loader; a
   * region served by Django gets the asset library's (TR-10, `regionAssetsFor`).
   */
  assets?: LocationEngineAssets;
  /** LAI-JMP-01a: the child's `ChildProfile.avatarKey`, for their avatar's look in third-person. */
  avatarKey?: string | null;
  /**
   * LAI-JMP-01c: the child's published avatar model and how to load it
   * (`features/player-avatar/playerAvatarSource.ts`). Absent: the placeholder (or a bundled model).
   */
  avatarSource?: {
    published: Promise<PlayerAvatarModel | null>;
    loadModel?: (ref: string) => Promise<LoadedModel>;
  };
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
  /** True when the up-front read failed, so the view can say so calmly. */
  unavailable?: boolean;
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
    return { ...EMPTY_SNAPSHOT, unavailable: true };
  }
}

export function ThreeLocationWorldView({
  childId,
  regionId,
  ageBand,
  aiEnabled = false,
  repository = sourceLocationManifestRepository,
  viewExtensions = SOURCE_VIEW_EXTENSIONS,
  assets = DEFAULT_LOCATION_ENGINE_DEPS.assets,
  avatarKey = null,
  avatarSource,
}: ThreeLocationWorldViewProps) {
  const [manifestState, setManifestState] = useState<ManifestState>({ status: 'loading' });
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  const [focusedLabel, setFocusedLabel] = useState<string | null>(null);
  /** A companion's quest cue, which wins over the snapshot's (`setQuestCue`). */
  const [companionQuestCue, setCompanionQuestCue] = useState<string | null>(null);
  /** Where companions put their own controls, inside the stage (TR-13). */
  const [hudSlot, setHudSlot] = useState<HTMLDivElement | null>(null);
  /** Where companions put a character's unprompted line, top centre of the stage (NPC F-B). */
  const [speechSlot, setSpeechSlot] = useState<HTMLDivElement | null>(null);
  /** The action prompt's verb, under `interactionAssist` only. */
  const [focusedAction, setFocusedAction] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [openInteraction, setOpenInteraction] = useState<WorldInteraction | null>(null);
  /** An interaction an extension claimed, and which extension claimed it. */
  const [claimed, setClaimed] = useState<{
    extensionId: string;
    interaction: WorldInteraction;
  } | null>(null);

  /*
    AP-04: "Leave island" waits for these (briefly, never forever) so a
    checkpoint or find written a moment before the tap is not lost, and asks
    a plain "leave now?" only while an encounter is open. Never a question.
  */
  const pendingWrites = useMemo(() => createPendingWrites(), []);
  useExitParticipant({
    save: () => pendingWrites.settle(),
    needsConfirm: () => openInteraction !== null || claimed !== null,
  });

  const bus = useMemo(() => new WorldEngineEventBus(), []);
  const engineRef = useRef<LocationEngine | null>(null);
  /*
    Also in state, not only in the ref: a companion is handed the scene
    half's `api`, and a ref assignment does not re-render - so a companion
    mounted before the engine was ready would hold `null` for the whole
    visit and quietly do nothing.
  */
  const [engine, setEngine] = useState<LocationEngine | null>(null);
  /*
    LAI-JMP-01a: the perspective. The child's saved choice goes into the
    engine; the engine reports every change (V, the HUD button, the gamepad,
    the setting below), and the view shows it and saves it for next time.
  */
  const [savedCameraMode] = useState(() => loadCameraPreference(childId));
  /** Running & sprinting: hold or toggle Shift, the child's own setting. */
  const [sprintMode, setSprintModeState] = useState<SprintModePreference>(
    () => loadSprintModePreference(childId) ?? 'hold',
  );
  const chooseSprintMode = (mode: SprintModePreference) => {
    setSprintModeState(mode);
    saveSprintModePreference(childId, mode);
    engineRef.current?.setSprintMode?.(mode);
  };
  const [cameraMode, setCameraModeState] = useState<CameraMode | null>(null);
  const onCameraModeChange = useCallback(
    (mode: CameraMode) => {
      setCameraModeState(mode);
      saveCameraPreference(childId, mode);
    },
    [childId],
  );
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
      setClaimed({ extensionId: claimant.extensionId, interaction });
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
        void pendingWrites.track(recordCharacterMet(childId, npc.npcId)).catch(() => undefined);
        bus.emit('NpcStateChanged', { entityId, metByChild: true });
      }),
      bus.on('InteractableFocused', ({ entityId }) => {
        if (manifest.interactionAssist) {
          const prompt = focusPrompt(manifest, entityId);
          setFocusedLabel(prompt?.label ?? null);
          setFocusedAction(prompt?.action ?? null);
        } else {
          setFocusedLabel(focusLabel(manifest, entityId));
        }
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
        void pendingWrites
          .track(
            recordWorldChangeOnce(
              childId,
              change.locationSlug,
              change.changeType,
              change.changeKey,
              change.source,
            ),
          )
          .then(() => refreshWorld())
          .catch(() => undefined);
      }),
      bus.on('PlayerEnteredZone', ({ zoneId }) => {
        if (checkpointIds.has(zoneId)) {
          void pendingWrites.track(saveCheckpoint(childId, zoneId)).catch(() => undefined);
          const found = checkpointToast(manifest, 'found', zoneId);
          if (found) setToast(found);
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
  }, [bus, childId, manifest, openInteractionFor, pendingWrites, refreshWorld]);

  /*
    "You are back at the pond." Said once, when a returning child's saved
    checkpoint lands, so the first thing the region tells them is where they
    are rather than what to do.
  */
  const returningCheckpointId = snapshot?.startCheckpointId;
  useEffect(() => {
    if (!manifest || !returningCheckpointId) return;
    const message = checkpointToast(manifest, 'returning', returningCheckpointId);
    if (message) setToast(message);
  }, [manifest, returningCheckpointId]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  /*
    LAI-JMP-01: a panel opening over the scene pauses play, so nothing held
    a moment ago (a key, a drag, the Jump button, a gamepad button) may still
    be held when the child comes back to it.
  */
  const panelOpen = openInteraction !== null || claimed !== null;
  useEffect(() => {
    if (panelOpen) engine?.resetInput?.();
  }, [panelOpen, engine]);

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
  const openBinding = claimed
    ? manifest.extensions.find((binding) => binding.extensionId === claimed.extensionId)
    : undefined;
  const openExtensionDefinition = openBinding
    ? viewExtensions.get(openBinding.extensionId)
    : undefined;
  const OpenOverlay = openExtensionDefinition?.Overlay;
  const openExtension =
    openBinding && openExtensionDefinition && OpenOverlay
      ? { extension: openExtensionDefinition, Overlay: OpenOverlay, config: openBinding.config }
      : null;
  /*
    Companions: mounted for the whole visit, not opened by an interaction.
    A region whose learning runs in the room needs one - the castle resumes a
    session left open yesterday and drives gestures from the hint ladder -
    and it receives the interaction it claimed rather than the view
    rendering a panel for it.
  */
  const companions = manifest.extensions.flatMap((binding) => {
    const extension = viewExtensions.get(binding.extensionId);
    const Companion = extension?.Companion;
    return Companion ? [{ id: binding.extensionId, Companion, config: binding.config }] : [];
  });
  const thingsToDo = availableInteractions(manifest, snapshot.context);
  const altNavPath = manifest.copy.altNav.to
    ? `/island/${childId}/${manifest.copy.altNav.to}`
    : `/island/${childId}`;

  const statusLine = resolveStatusLine(manifest, snapshot.context);
  const thingsToDoNotes = resolveThingsToDoNotes(manifest, snapshot.context);
  const reticleSuppressed = (manifest.noReticleBands ?? []).includes(ageBand);
  const companionOwnsBackpack = manifest.extensions.some(
    (binding) => viewExtensions.get(binding.extensionId)?.ownsBackpack === true,
  );

  return (
    <div className={styles.wrapper}>
      <p className={styles.instructions}>{manifest.copy.instructions}</p>
      {snapshot.unavailable && manifest.copy.progressUnavailable ? (
        <p className={styles.status}>{manifest.copy.progressUnavailable}</p>
      ) : null}
      {statusLine ? <p className={styles.status}>{statusLine}</p> : null}
      <WorldStage>
        <ThreeGameContainer
          instanceKey={`${childId}:${manifest.regionId}`}
          createEngine={(parent) =>
            createLocationEngine(
              parent,
              bus,
              manifest,
              {
                startCheckpointId,
                worldState: snapshot.context,
                quality: chooseRenderQuality(deviceHintsFromNavigator()),
                reducedMotion: prefersReducedMotion(),
                cameraMode: savedCameraMode ?? undefined,
                sprintMode,
                avatarKey,
                onCameraModeChange,
                publishedAvatar: avatarSource?.published,
                loadAvatarModel: avatarSource?.loadModel,
              },
              { ...DEFAULT_LOCATION_ENGINE_DEPS, assets },
            )
          }
          onEngineReady={(ready) => {
            engineRef.current = ready;
            setEngine(ready);
            setCameraModeState(ready.cameraMode?.() ?? null);
          }}
        />
        <WorldHud
          questCue={companionQuestCue ?? snapshot.questCue}
          companionName={snapshot.companionName}
          focusedLabel={reticleSuppressed ? null : focusedLabel}
          toastMessage={toast}
          backpackItems={snapshot.backpackItems}
          {...(manifest.interactionAssist
            ? {
                focusAction: focusedAction,
                onInteract: () => engineRef.current?.interact(),
                exitLink: { label: manifest.copy.altNav.label, to: altNavPath },
              }
            : {})}
          showBackpack={!companionOwnsBackpack}
          {...(engine?.jump?.enabled ? { onJump: () => engineRef.current?.pressJump?.() } : {})}
          {...(cameraMode && engine?.camera?.allowModeSwitch
            ? { cameraMode, onToggleCamera: () => engineRef.current?.toggleCameraMode?.() }
            : {})}
        />
        <div ref={setHudSlot} className={styles.stageControls} />
        <div ref={setSpeechSlot} className={styles.stageSpeech} />
        {openExtension ? (
          <openExtension.Overlay
            childId={childId}
            ageBand={ageBand}
            config={openExtension.config}
            sceneApi={engine?.extensionApi(openExtension.extension.id) ?? null}
            onClose={() => setClaimed(null)}
            refreshWorld={refreshWorld}
          />
        ) : null}
      </WorldStage>
      {companions.map(({ id, Companion, config }) => (
        <Companion
          key={id}
          childId={childId}
          regionId={regionId}
          ageBand={ageBand}
          aiEnabled={aiEnabled}
          config={config}
          bus={bus}
          sceneApi={engine?.extensionApi(id) ?? null}
          worldState={snapshot.context}
          claimedInteraction={claimed?.extensionId === id ? claimed.interaction : null}
          openInteraction={openInteraction ?? claimed?.interaction ?? null}
          onCloseInteraction={() => setClaimed(null)}
          showToast={setToast}
          setFocusLabel={setFocusedLabel}
          setQuestCue={setCompanionQuestCue}
          hudSlot={hudSlot}
          speechSlot={speechSlot}
          refreshWorld={refreshWorld}
        />
      ))}
      {openInteraction ? (
        <WorldActionPanel
          childId={childId}
          ageBand={ageBand}
          interaction={openInteraction}
          onDismiss={() => setOpenInteraction(null)}
          onDiscovered={() => void refreshWorld()}
          regionId={manifest.regionId}
        />
      ) : null}
      {cameraMode && engine?.camera?.allowModeSwitch ? (
        <fieldset className={styles.cameraSetting}>
          <legend>Camera view</legend>
          {(
            [
              ['third-person', 'Behind my explorer'],
              ['first-person', 'Through my eyes'],
            ] as const
          ).map(([mode, label]) => (
            <label key={mode} className={styles.cameraSettingOption}>
              <input
                type="radio"
                name="camera-view"
                value={mode}
                checked={cameraMode === mode}
                onChange={() => engineRef.current?.setCameraMode?.(mode)}
              />
              {label}
            </label>
          ))}
        </fieldset>
      ) : null}
      {engine?.locomotion?.sprintEnabled ? (
        <fieldset className={styles.cameraSetting}>
          <legend>Sprint with Shift</legend>
          {(
            [
              ['hold', 'Hold Shift'],
              ['toggle', 'Tap Shift to switch'],
            ] as const
          ).map(([mode, label]) => (
            <label key={mode} className={styles.cameraSettingOption}>
              <input
                type="radio"
                name="sprint-mode"
                value={mode}
                checked={sprintMode === mode}
                onChange={() => chooseSprintMode(mode)}
              />
              {label}
            </label>
          ))}
        </fieldset>
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
