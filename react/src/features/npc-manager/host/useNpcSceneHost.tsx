import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { SpeechSource } from '../../../audio/speech/SpeechPlayer';
import { isApiError } from '../../../api/errors';
import { npcApiFor, type NpcApi } from '../api/npcApi';
import { npcModelLoaderFor } from '../api/npcModelLoader';
import { behaviorControllerFactory } from '../behavior';
import type {
  BehaviorControllerFactory,
  InputMethod,
  NpcCommand,
  NpcEngineEvent,
  NpcSpawn,
} from '../contracts/engine';
import type { NpcSceneResponse, RuntimeCharacter } from '../contracts/types';
import { ANIMATION_PRIORITY, type AnimationState } from '../contracts/vocabulary';
import type { DialogueEvent } from '../dialogue/dialogueController';
import { DIALOGUE_COPY } from '../dialogue/dialogueCopy';
import {
  npcDialogueApiFor,
  type DialogueScope,
  type NpcDialogueApi,
} from '../dialogue/npcDialogueApi';
import { signalFromEngine, signalsFromPlay, type PlayOutcome } from '../dialogue/triggers';
import { useNpcDialogue } from '../dialogue/useNpcDialogue';
import {
  createNpcRuntime,
  type NpcModelLoader,
  type NpcSceneRuntime,
} from '../engine/createNpcRuntime';
import { NpcDialoguePanel } from '../ui/NpcDialoguePanel';
import { NpcInteractionPrompt } from '../ui/NpcInteractionPrompt';
import { NPC_PROMPT_COPY, type NpcDialogueCopy, type NpcPromptCopy } from '../ui/npcUiCopy';
import { isNpcSpeechRef } from '../voice/npcVoiceCoordinator';
import { useNpcVoice } from '../voice/useNpcVoice';
import { npcHintApiFor, type NpcHintApi } from './npcHintApi';
import { bestPlayTrigger, createTriggerQueue } from './triggerQueue';
import type { NpcHostScene } from './types';

export type { NpcHostScene } from './types';

/**
 * The reusable NPC scene host (LAI-NPC-010, -015, -016). It joins the NPC Manager's pieces for
 * one 3D Area or Place so a world only supplies its scene:
 *
 *   fetch the scope's NPCs (`npcApiFor`) -> `createNpcRuntime` (shared model loader, behaviour
 *   factory, the scene's colliders) -> `update` from the scene's own render loop -> engine events
 *   to triggers (`signalFromEngine`) -> `NpcInteractionPrompt` between `npc.approached` and
 *   `npc.left` -> conversations through `useNpcDialogue` + `NpcDialoguePanel`, voiced by
 *   `useNpcVoice` (captions always) -> `interrupt_behavior` / `resume_behavior` around each one.
 *
 * Play outcomes the world already has go in through `notifyPlay` (`signalsFromPlay`): every
 * adventure event becomes a `react` command, and the outcome's most important trigger waits in
 * a queue (`./triggerQueue.ts`) until nothing else is on screen (`suspended` false, no open
 * conversation). It never decides an outcome: rewards, quests and progress stay with the world's
 * play services. An `OFFER_QUEST` choice hands the quest id to `onQuestOffer` (the world's own
 * accept flow); a `REQUEST_HINT` choice asks the hint route and shows its words.
 *
 * No release (`404 no_active_release`), Django off, or any load failure leaves the scope with no
 * managed NPCs (`status` `empty` or `failed`), never an error screen: the world keeps whatever it
 * had (Treasure Cove keeps its legacy Pip). Everything is disposed on unmount or scope change.
 *
 * World-agnostic on purpose: Storykeeper's Castle can use it unchanged with its own scene.
 * React lives here, never in `engine/` or `behavior/` (ADR-020).
 *
 * Accessibility (LAI-NPC-038, `docs/NPC_MANAGER_ACCESSIBILITY.md`): captions always show; a
 * "Hear it again" button appears only when the line has a voice the child can hear (it hides
 * while the Sound Manager's master or voice channel is muted or at zero); focus goes back to the
 * Talk prompt (or `focusReturnTarget`) when a conversation closes; and the runtime's reduced
 * motion follows `reducedMotion` OR the system's `prefers-reduced-motion`, re-read live.
 */

/** The Sound Manager's NPC events (Django `audio` `TargetType.NPC`). */
export type NpcSoundMoment = 'on_approach' | 'on_interact' | 'on_dialogue_start' | 'on_exit';

export type NpcSceneHostStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'failed';

/** Injected collaborators; each defaults to the app's real one. Tests pass fakes. */
export interface NpcSceneHostDeps {
  api?: NpcApi;
  dialogueApi?: NpcDialogueApi;
  hintApi?: NpcHintApi;
  loadModel?: NpcModelLoader;
  behaviorFactory?: BehaviorControllerFactory;
  /** Speech for the voice; `null` means captions only. */
  speechSource?: SpeechSource | null;
}

export interface UseNpcSceneHostOptions {
  childId: string;
  scope: DialogueScope;
  /** Null until the world's scene is up; the host starts when it arrives. */
  scene: NpcHostScene | null;
  reducedMotion: boolean;
  /** Another panel is open: hide the prompt and panel, and hold ambient conversations. */
  suspended?: boolean;
  /** Awaited before an `on_interact` conversation starts (a world's own "talked" call). */
  onInteract?(npcId: string, placementKey: string): Promise<void> | void;
  /** The child chose an `OFFER_QUEST` choice; accept through the world's own quest flow. */
  onQuestOffer?(questId: string, npcId: string): void;
  /** NPC sound moments, for the world's Sound Manager cues. */
  onSound?(moment: NpcSoundMoment, npcId: string, placementKey: string): void;
  /** Optional keyboard shortcut for the Talk prompt. Off by default. */
  promptHotkey?: string | null;
  /**
   * Where keyboard focus goes when a conversation closes and the Talk prompt is not shown (the
   * child walked away), for example the world's canvas or its main HUD button. Optional.
   */
  focusReturnTarget?(): HTMLElement | null;
  /** Localized copy for the prompt and the panel; English defaults (`ui/npcUiCopy.ts`). */
  copy?: { prompt?: NpcPromptCopy; dialogue?: Partial<NpcDialogueCopy> };
  deps?: NpcSceneHostDeps;
}

export interface NpcSceneHost {
  status: NpcSceneHostStatus;
  /** NPC ids the NPC Manager serves here (empty unless `ready`). */
  managedNpcIds: ReadonlySet<string>;
  /** Asks to talk to an NPC (for example from a world's own list of things to do). */
  interact(npcId: string, via?: InputMethod): boolean;
  /** A play API outcome the world received (LAI-NPC-016). */
  notifyPlay(outcome: PlayOutcome): void;
  /** Where a managed NPC stands now, or null. */
  positionOf(npcId: string): { x: number; z: number } | null;
  /**
   * A world's own scripted gesture for a managed NPC (for example Quill pointing at the
   * mantel), at the scripted priority band; `idle` releases it back to the behaviour's base
   * state. `facingYaw` turns the NPC first. False when the NPC is not managed here.
   */
  animate(npcId: string, state: AnimationState, options?: { facingYaw?: number }): boolean;
  /** True while a conversation is open or starting. */
  conversationOpen: boolean;
  /** The Talk prompt, or null. Render it on the stage. */
  prompt: ReactNode;
  /** The dialogue panel, or null. */
  panel: ReactNode;
}

interface Talking {
  npcId: string;
  placementKey: string;
}

interface Foreground extends Talking {
  /** True until `onInteract` has finished and the conversation was asked for. */
  pending: boolean;
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function reducedMotionQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(REDUCED_MOTION_QUERY)
    : null;
}

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = reducedMotionQuery();
  if (!query) return () => undefined;
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }
  query.addListener?.(onChange);
  return () => query.removeListener?.(onChange);
}

const systemPrefersReducedMotion = () => reducedMotionQuery()?.matches ?? false;

/** The system's `prefers-reduced-motion`, re-read whenever it changes. */
function useSystemReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, systemPrefersReducedMotion, () => false);
}

function scopeKey(scope: DialogueScope): string {
  return scope.kind === 'area' ? `area:${scope.regionId}` : `place:${scope.placeSlug}`;
}

export function useNpcSceneHost(options: UseNpcSceneHostOptions): NpcSceneHost {
  const { childId, scene, suspended = false, deps = {} } = options;
  const key = scopeKey(options.scope);
  const latest = useRef(options);
  latest.current = options;
  // Read by the runtime every frame (turning, procedural placeholder motion), so a change applies
  // at once; wander and patrol pick still-or-moving when an NPC is mounted.
  const systemReducedMotion = useSystemReducedMotion();
  const reducedMotionRef = useRef(false);
  reducedMotionRef.current = options.reducedMotion || systemReducedMotion;
  const promptRef = useRef<HTMLButtonElement>(null);

  // Collaborators, once per child and scope (the dialogue hook needs a stable api).
  const stableScope = useMemo<DialogueScope>(
    () =>
      key.startsWith('area:')
        ? { kind: 'area', regionId: key.slice('area:'.length) }
        : { kind: 'place', placeSlug: key.slice('place:'.length) },
    [key],
  );
  const api = useMemo(() => deps.api ?? npcApiFor(childId), [deps.api, childId]);
  const dialogueApi = useMemo(
    () => deps.dialogueApi ?? npcDialogueApiFor(childId, stableScope),
    [deps.dialogueApi, childId, stableScope],
  );
  const hintApi = useMemo(
    () => deps.hintApi ?? npcHintApiFor(childId, stableScope),
    [deps.hintApi, childId, stableScope],
  );
  const loadModel = useMemo(
    () => deps.loadModel ?? npcModelLoaderFor(childId),
    [deps.loadModel, childId],
  );
  const behaviorFactory = deps.behaviorFactory ?? behaviorControllerFactory;

  const runtimeRef = useRef<NpcSceneRuntime | null>(null);
  const queue = useMemo(() => createTriggerQueue(), []);
  const [status, setStatus] = useState<NpcSceneHostStatus>('idle');
  const [sceneData, setSceneData] = useState<NpcSceneResponse | null>(null);
  const [near, setNear] = useState<readonly string[]>([]);
  const nearRef = useRef<readonly string[]>([]);
  const [foreground, setForeground] = useState<Foreground | null>(null);
  const [talking, setTalking] = useState<Talking | null>(null);
  const talkingRef = useRef<Talking | null>(null);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [hint, setHint] = useState<{ nodeKey: string; text: string } | null>(null);
  const [queued, setQueued] = useState(0);
  const offeredQuests = useRef(new Set<string>());

  const send = useCallback((command: NpcCommand) => runtimeRef.current?.send(command), []);

  const voice = useNpcVoice({
    childId,
    placementKey: talking?.placementKey ?? null,
    send,
    source: deps.speechSource,
    scopeName: 'npc-voice',
  });
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const placementOf = useCallback(
    (npcId: string): string | null =>
      sceneData?.placements.find((placement) => placement.npcId === npcId)?.placementKey ?? null,
    [sceneData],
  );

  // Dialogue events drive the engine and the voice.
  const onDialogueEvent = useCallback(
    (event: DialogueEvent) => {
      const who = talkingRef.current;
      const placementKey = who && who.npcId === event.npcId ? who.placementKey : null;
      switch (event.type) {
        case 'dialogue.started':
          if (placementKey) {
            send({ type: 'interrupt_behavior', placementKey, reason: 'dialogue' });
            send({ type: 'face', placementKey, target: 'player' });
            latest.current.onSound?.('on_dialogue_start', event.npcId, placementKey);
          }
          return;
        case 'dialogue.node_entered':
          setHint(null);
          void voiceRef.current.play(event.node);
          if (placementKey && event.node.animationState) {
            // A talk line loops its talk clip from the moment the caption shows (QA-D2): without
            // this a captions-only line (no voice profile, speech off, muted, or a failed
            // request) never animated. When a voice does play, the voice coordinator sends the
            // same loop and stops it when the audio ends.
            send({
              type: 'animate',
              placementKey,
              state: event.node.animationState,
              ...(event.node.animationState === 'talk' ? { mode: 'loop' as const } : {}),
              priority: ANIMATION_PRIORITY.dialogue,
            });
          }
          return;
        case 'dialogue.choice_made':
          voiceRef.current.interrupt();
          return;
        case 'dialogue.ended':
        case 'dialogue.interrupted':
          void voiceRef.current.play(null);
          setHint(null);
          if (placementKey) {
            send({ type: 'stop_animation', placementKey, priority: ANIMATION_PRIORITY.dialogue });
            send({ type: 'resume_behavior', placementKey });
          }
          return;
      }
    },
    [send],
  );
  const { view, controller } = useNpcDialogue(dialogueApi, onDialogueEvent);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  const startConversation = useCallback(
    (who: Talking, trigger: Parameters<typeof controller.start>[1]) => {
      talkingRef.current = who;
      setTalking(who);
      return controllerRef.current.start(who.npcId, trigger, who.placementKey);
    },
    [],
  );

  const interactFlow = useCallback(
    async (npcId: string, placementKey: string) => {
      const who = { npcId, placementKey };
      setErrorDismissed(false);
      setForeground({ ...who, pending: true });
      // Stop and turn at once; `resume_behavior` follows whatever the conversation does.
      send({ type: 'interrupt_behavior', placementKey, reason: 'dialogue' });
      send({ type: 'face', placementKey, target: 'player' });
      latest.current.onSound?.('on_interact', npcId, placementKey);
      try {
        await latest.current.onInteract?.(npcId, placementKey);
      } catch {
        // The world's own call failed: the conversation still happens.
      }
      setForeground({ ...who, pending: false });
      await startConversation(who, 'on_interact');
      if (controllerRef.current.getView().status === 'ended') {
        send({ type: 'resume_behavior', placementKey });
      }
    },
    [send, startConversation],
  );

  const onEngineEvent = useCallback(
    (event: NpcEngineEvent) => {
      if (event.type === 'npc.left') {
        nearRef.current = nearRef.current.filter((k) => k !== event.placementKey);
        setNear(nearRef.current);
        latest.current.onSound?.('on_exit', event.npcId, event.placementKey);
        const current = controllerRef.current.getView();
        const open = current.status === 'showing' || current.status === 'loading';
        if (open && talkingRef.current?.placementKey === event.placementKey) {
          controllerRef.current.interrupt(); // the child walked away
          setForeground(null);
        }
        return;
      }
      const signal = signalFromEngine(event);
      if (!signal) return;
      const { npcId, placementKey } = signal;
      for (const trigger of signal.triggers) {
        if (trigger === 'on_spawn') {
          queue.offerSpawn(npcId, placementKey);
          setQueued((n) => n + 1);
        } else if (trigger === 'on_player_near') {
          if (!nearRef.current.includes(placementKey)) {
            nearRef.current = [...nearRef.current, placementKey];
            setNear(nearRef.current);
          }
          latest.current.onSound?.('on_approach', npcId, placementKey);
        } else if (trigger === 'on_interact') {
          void interactFlow(npcId, placementKey);
        }
      }
    },
    [queue, interactFlow],
  );
  const onEngineEventRef = useRef(onEngineEvent);
  onEngineEventRef.current = onEngineEvent;

  // Lifecycle: one runtime per scene and scope, fetched, mounted, updated, disposed.
  useEffect(() => {
    if (!scene) {
      setStatus('idle');
      return undefined;
    }
    const abort = new AbortController();
    const runtime = createNpcRuntime({
      parent: scene.parent,
      loadModel,
      reducedMotion: () => reducedMotionRef.current,
      behaviorFactory,
      ...(scene.isBlocked ? { isBlocked: (x: number, z: number) => scene.isBlocked!(x, z) } : {}),
    });
    runtimeRef.current = runtime;
    const unsubscribe = runtime.subscribe((event) => onEngineEventRef.current(event));
    const stopFrames = scene.onFrame((delta) => runtime.update(delta, scene.playerPose()));
    setStatus('loading');
    const fetchScene =
      stableScope.kind === 'area'
        ? api.getAreaNpcs(stableScope.regionId, abort.signal)
        : api.getPlaceNpcs(stableScope.placeSlug, abort.signal);
    fetchScene.then(
      (response) => {
        if (abort.signal.aborted) return;
        const spawns: NpcSpawn[] = response.placements.flatMap((placement) => {
          const character = response.characters[placement.npcId];
          return character ? [{ placement, character }] : [];
        });
        if (spawns.length === 0) {
          setStatus('empty');
          return;
        }
        runtime.mount(spawns);
        setSceneData(response);
        setStatus('ready');
      },
      (error: unknown) => {
        if (abort.signal.aborted) return;
        if (isApiError(error) && error.kind === 'aborted') return;
        // No managed NPCs; the world keeps its own. Codes only, never child data.
        console.warn(
          `[npc host] no managed NPCs for ${key}: ${isApiError(error) ? error.code : 'error'}`,
        );
        setStatus('failed');
      },
    );
    return () => {
      abort.abort();
      stopFrames();
      unsubscribe();
      controllerRef.current.interrupt();
      runtime.dispose();
      if (runtimeRef.current === runtime) runtimeRef.current = null;
      queue.clear();
      nearRef.current = [];
      talkingRef.current = null;
      offeredQuests.current.clear();
      setNear([]);
      setSceneData(null);
      setForeground(null);
      setTalking(null);
    };
  }, [scene, api, stableScope, loadModel, behaviorFactory, queue, key]);

  // A finished foreground conversation closes its panel.
  useEffect(() => {
    if (!foreground || foreground.pending) return;
    if (view.status === 'ended' || view.status === 'idle') setForeground(null);
  }, [foreground, view.status]);

  // An OFFER_QUEST choice: the world's accept flow, once per conversation and quest.
  useEffect(() => {
    const offer = view.questOffer;
    if (!offer || !view.npcId) return;
    const once = `${view.conversationId ?? ''}:${offer.questId}`;
    if (offeredQuests.current.has(once)) return;
    offeredQuests.current.add(once);
    latest.current.onQuestOffer?.(offer.questId, view.npcId);
  }, [view.questOffer, view.npcId, view.conversationId]);

  // Ambient conversations: one at a time, only when nothing else is on screen.
  const ready = status === 'ready';
  useEffect(() => {
    if (!ready || suspended || foreground) return;
    if (view.status === 'loading' || view.status === 'showing') return;
    if (!sceneData) return;
    const next = queue.take();
    if (!next) return;
    let who: Talking | null = null;
    if (next.npcId && next.placementKey) {
      who = { npcId: next.npcId, placementKey: next.placementKey };
    } else {
      const placements = sceneData.placements;
      const placement =
        placements.find((p) => nearRef.current.includes(p.placementKey)) ?? placements[0];
      if (placement) who = { npcId: placement.npcId, placementKey: placement.placementKey };
    }
    if (who) void startConversation(who, next.trigger);
  }, [ready, suspended, foreground, view.status, sceneData, queue, queued, startConversation]);

  const notifyPlay = useCallback(
    (outcome: PlayOutcome) => {
      const signals = signalsFromPlay(outcome);
      for (const event of signals.events) runtimeRef.current?.send({ type: 'react', event });
      const best = bestPlayTrigger(signals.triggers);
      if (best && queue.offerPlay(best)) setQueued((n) => n + 1);
    },
    [queue],
  );

  const interact = useCallback(
    (npcId: string, via: InputMethod = 'pointer') => {
      const placementKey = placementOf(npcId);
      if (!placementKey || !runtimeRef.current) return false;
      return runtimeRef.current.requestInteract(placementKey, via);
    },
    [placementOf],
  );

  const positionOf = useCallback(
    (npcId: string) => {
      const placementKey = placementOf(npcId);
      const root = placementKey ? runtimeRef.current?.rootOf(placementKey) : null;
      return root ? { x: root.position.x, z: root.position.z } : null;
    },
    [placementOf],
  );

  const animate = useCallback(
    (npcId: string, state: AnimationState, options?: { facingYaw?: number }) => {
      const placementKey = placementOf(npcId);
      const runtime = runtimeRef.current;
      if (!placementKey || !runtime) return false;
      if (options?.facingYaw !== undefined) {
        runtime.send({ type: 'face', placementKey, target: { yaw: options.facingYaw } });
      }
      if (state === 'idle') {
        runtime.send({
          type: 'stop_animation',
          placementKey,
          priority: ANIMATION_PRIORITY.scripted,
        });
      } else {
        runtime.send({
          type: 'animate',
          placementKey,
          state,
          priority: ANIMATION_PRIORITY.scripted,
        });
      }
      return true;
    },
    [placementOf],
  );

  const managedNpcIds = useMemo<ReadonlySet<string>>(
    () => (ready && sceneData ? new Set(sceneData.placements.map((p) => p.npcId)) : EMPTY_IDS),
    [ready, sceneData],
  );

  const close = useCallback(() => {
    setErrorDismissed(true);
    setForeground(null);
    void voiceRef.current.play(null);
    controllerRef.current.interrupt();
    const who = talkingRef.current;
    if (who) send({ type: 'resume_behavior', placementKey: who.placementKey });
  }, [send]);

  const choose = useCallback(
    async (choiceKey: string) => {
      const current = controllerRef.current;
      const choice = current.getView().choices.find((c) => c.choiceKey === choiceKey);
      if (!choice) return;
      await current.choose(choiceKey);
      if (choice.action !== 'REQUEST_HINT') return;
      const after = current.getView();
      if (after.status !== 'showing' || !after.npcId || !after.conversationId || !after.node) {
        return;
      }
      const nodeKey = after.node.nodeKey;
      try {
        const response = await hintApi.hint(after.npcId, after.conversationId);
        if (current.getView().node?.nodeKey === nodeKey) {
          setHint({ nodeKey, text: response.hint.text });
        }
      } catch {
        // No hint (AI off, refused, unavailable): the authored line stays. Never an error.
      }
    },
    [hintApi],
  );

  // --- UI -----------------------------------------------------------------------------------

  const characters = sceneData?.characters ?? {};
  const nameOf = (npcId: string | null): string =>
    (npcId && (characters[npcId] as RuntimeCharacter | undefined)?.displayName) || '';

  const isError = view.status === 'error' && !errorDismissed;
  const conversationOpen =
    view.status === 'showing' ||
    Boolean(foreground && (foreground.pending || view.status === 'loading' || isError));
  const panelVisible = conversationOpen && !suspended;

  const copy = options.copy;
  const returnFocusTo = useCallback((): HTMLElement | null => {
    if (latest.current.suspended) return null; // the other panel owns focus now
    return promptRef.current ?? latest.current.focusReturnTarget?.() ?? null;
  }, []);

  let panel: ReactNode = null;
  if (panelVisible) {
    const npcId = view.npcId ?? foreground?.npcId ?? null;
    const node = view.status === 'showing' ? view.node : null;
    const text = isError
      ? DIALOGUE_COPY.fallback
      : node
        ? hint && hint.nodeKey === node.nodeKey
          ? hint.text
          : ((voice.state.nodeKey === node.nodeKey ? voice.state.caption : null) ?? node.text)
        : null;
    // "Hear it again": only for a voiced line the child can hear, and not over a hint's words.
    const showingHint = Boolean(node && hint && hint.nodeKey === node.nodeKey);
    const replayNode =
      node && !isError && !showingHint && isNpcSpeechRef(node.speech) && voice.speechAvailable
        ? node
        : null;
    const onReplay =
      replayNode && !voice.silent ? () => void voiceRef.current.play(replayNode) : undefined;
    panel = (
      <NpcDialoguePanel
        speakerName={nameOf(npcId)}
        text={text}
        nodeKey={hint && node ? `${node.nodeKey}:hint` : (node?.nodeKey ?? null)}
        choices={node ? view.choices.map((c) => ({ key: c.choiceKey, label: c.label })) : []}
        busy={Boolean(foreground?.pending) || view.busy || view.status === 'loading'}
        onChoose={(choiceKey) => void choose(choiceKey)}
        onContinue={() => {
          if (view.status === 'showing') void controllerRef.current.advance();
          else close();
        }}
        onClose={close}
        onReplay={onReplay}
        replayDisabled={voice.state.nodeKey === node?.nodeKey && voice.state.phase === 'loading'}
        returnFocusTo={returnFocusTo}
        copy={copy?.dialogue}
      />
    );
  }

  let prompt: ReactNode = null;
  if (ready && !suspended && !conversationOpen && near.length > 0) {
    const placementKey = near[near.length - 1];
    const placement = sceneData?.placements.find((p) => p.placementKey === placementKey);
    if (placement) {
      prompt = (
        <NpcInteractionPrompt
          label={(copy?.prompt ?? NPC_PROMPT_COPY).talkTo(nameOf(placement.npcId))}
          buttonRef={promptRef}
          hotkey={options.promptHotkey ?? null}
          onInteract={(via) => runtimeRef.current?.requestInteract(placementKey, via)}
        />
      );
    }
  }

  return {
    status,
    managedNpcIds,
    interact,
    notifyPlay,
    positionOf,
    animate,
    conversationOpen,
    prompt,
    panel,
  };
}
