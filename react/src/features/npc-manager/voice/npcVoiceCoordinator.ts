/**
 * NPC voice synchronization (LAI-NPC-029, ADR-049, ADR-053 section 8). Pure logic: no React, no
 * network, no Three.js. It joins three things the NPC Manager already has:
 *
 * - the speech player (`audio/speech`), which asks Django for speech by reference
 *   (`npcDialogueNode`, never text), plays it on the Sound Manager's `voice` channel (so child
 *   volume, mute and ducking apply) and aborts requests when stopped;
 * - the engine command contract (`contracts/engine.ts`): `animate` talk at the dialogue band while
 *   audio plays, `stop_animation` at the dialogue band to return to the behaviour's base state;
 * - the dialogue panel, which shows `state.caption` and listens for `voice.completed`.
 *
 * Captions always show: the node's authored text is the caption from the moment a node is played,
 * whether speech is off, muted, loading, failed or interrupted. Audio is an enhancement only.
 * Muted (master or voice channel silent): no speech is requested at all, so nothing is synthesized
 * that nobody hears; the caption shows and the node completes as `text_only`.
 */

import type { SpatialOptions } from '../../../audio/AudioTypes';
import type {
  SpeakRequest,
  SpeechPlayer,
  SpeechReference,
  SpeechState,
} from '../../../audio/speech/SpeechPlayer';
import type { NpcCommand } from '../contracts/engine';
import type { NpcSpeechRef, RuntimeNode } from '../contracts/types';
import { ANIMATION_PRIORITY, type AnimationState } from '../contracts/vocabulary';

/** How a node's voice ended. `text_only`: no audio was heard (no voice, muted, off or failed). */
export type NpcVoiceOutcome = 'spoken' | 'text_only' | 'interrupted';

export type NpcVoicePhase = 'idle' | 'loading' | 'speaking' | 'paused' | 'done';

export interface NpcVoiceState {
  /** The node being voiced (or last voiced). */
  nodeKey: string | null;
  /** The authored text to show. Present for every played node until `clear` or a new node. */
  caption: string | null;
  phase: NpcVoicePhase;
  /** True while the talk animation was requested. */
  talking: boolean;
  /** No audio for the current caption (no voice, muted, speech off, failed). */
  textOnly: boolean;
  /**
   * The server would not give this line's audio (speech disabled, Polly down): asking again would
   * fail the same way. Not set when audio arrived but could not play (autoplay blocked), where a
   * tap to hear it again is exactly what helps (QA-D4).
   */
  refused: boolean;
}

export type NpcVoiceEvent =
  | { type: 'voice.started'; nodeKey: string; spoken: boolean }
  | { type: 'voice.completed'; nodeKey: string; outcome: NpcVoiceOutcome };

/** The part of the speech player the coordinator needs (a `SpeechPlayer` satisfies it). */
export type NpcVoiceSpeaker = Pick<
  SpeechPlayer,
  'speak' | 'showText' | 'stop' | 'getState' | 'subscribe'
>;

export interface NpcVoiceCoordinatorOptions {
  speaker: NpcVoiceSpeaker;
  /** The engine's command sink (`NpcRuntime.send`). Optional: a 2D panel has no 3D NPC. */
  send?: (command: NpcCommand) => void;
  /** The placement that talks; null means no animation (for example a catalog-only NPC). */
  placementKey?: () => string | null;
  /** True when the child would not hear the voice (master or voice channel muted or at zero). */
  isMuted?: () => boolean;
  /** The state played while speaking. Default `talk`. */
  talkState?: AnimationState;
}

export interface PlayOptions {
  /** Place the voice at the NPC (spatial voice). Leave unset for a flat voice. */
  position?: SpatialOptions;
}

export interface NpcVoiceCoordinator {
  /**
   * Voices a node (interrupting any current one) and resolves with how it ended. Never rejects.
   * `null` (the conversation ended) interrupts and clears the caption.
   */
  play(node: RuntimeNode | null, options?: PlayOptions): Promise<NpcVoiceOutcome>;
  /** Stops the voice (a choice, close or navigation). The caption stays unless `clear`. */
  interrupt(options?: { clear?: boolean }): void;
  getState(): NpcVoiceState;
  subscribe(listener: (state: NpcVoiceState) => void): () => void;
  onEvent(listener: (event: NpcVoiceEvent) => void): () => void;
  /** Interrupts, stops listening to the speaker and drops every listener. Idempotent. */
  dispose(): void;
}

const IDLE: NpcVoiceState = {
  nodeKey: null,
  caption: null,
  phase: 'idle',
  talking: false,
  textOnly: false,
  refused: false,
};

/** Is this a well-formed `npcDialogueNode` reference? (The server checks it again.) */
export function isNpcSpeechRef(value: unknown): value is NpcSpeechRef {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.kind === 'npcDialogueNode' &&
    typeof v.npcId === 'string' &&
    v.npcId !== '' &&
    typeof v.release === 'number' &&
    Number.isInteger(v.release) &&
    v.release > 0 &&
    typeof v.dialogueKey === 'string' &&
    v.dialogueKey !== '' &&
    typeof v.nodeKey === 'string' &&
    v.nodeKey !== ''
  );
}

/** The speech-player reference for a node's speech (forwarded to the server unchanged). */
export function toSpeechReference(ref: NpcSpeechRef): SpeechReference {
  return {
    kind: 'npcDialogueNode',
    npcId: ref.npcId,
    release: ref.release,
    dialogueKey: ref.dialogueKey,
    nodeKey: ref.nodeKey,
  };
}

interface Turn {
  token: number;
  nodeKey: string;
  spoken: boolean;
  /** The speaker reported `loading` for this turn (earlier phases belong to the previous one). */
  started: boolean;
  heard: boolean;
  failed: boolean;
  resolve: (outcome: NpcVoiceOutcome) => void;
}

export function createNpcVoiceCoordinator(
  options: NpcVoiceCoordinatorOptions,
): NpcVoiceCoordinator {
  const { speaker, send, placementKey, isMuted, talkState = 'talk' } = options;
  const listeners = new Set<(state: NpcVoiceState) => void>();
  const eventListeners = new Set<(event: NpcVoiceEvent) => void>();
  let state: NpcVoiceState = IDLE;
  let turn: Turn | null = null;
  let tokens = 0;
  let disposed = false;
  /** The placement the talk animation was sent to, so it is stopped on the same one. */
  let talkingOn: string | null = null;

  function set(patch: Partial<NpcVoiceState>): void {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch {
        // A subscriber cannot break the voice.
      }
    }
  }

  function emit(event: NpcVoiceEvent): void {
    for (const listener of [...eventListeners]) {
      try {
        listener(event);
      } catch {
        // A subscriber cannot break the voice.
      }
    }
  }

  function command(cmd: NpcCommand): void {
    try {
      send?.(cmd);
    } catch {
      // The engine failing never takes the caption away.
    }
  }

  function startTalk(): void {
    if (talkingOn) return;
    const key = placementKey?.() ?? null;
    if (key) {
      talkingOn = key;
      command({
        type: 'animate',
        placementKey: key,
        state: talkState,
        mode: 'loop',
        priority: ANIMATION_PRIORITY.dialogue,
      });
    }
    set({ talking: true });
  }

  function stopTalk(): void {
    if (talkingOn) {
      command({
        type: 'stop_animation',
        placementKey: talkingOn,
        priority: ANIMATION_PRIORITY.dialogue,
      });
      talkingOn = null;
    }
    if (state.talking) set({ talking: false });
  }

  function finish(outcome: NpcVoiceOutcome): void {
    const ending = turn;
    if (!ending) return;
    turn = null;
    stopTalk();
    set({ phase: 'done', textOnly: outcome !== 'spoken' });
    emit({ type: 'voice.completed', nodeKey: ending.nodeKey, outcome });
    ending.resolve(outcome);
  }

  function onSpeech(speech: SpeechState): void {
    const active = turn;
    if (disposed || !active || !active.spoken) return;
    if (!active.started) {
      if (speech.phase !== 'loading') return;
      active.started = true;
    }
    switch (speech.phase) {
      case 'loading':
        if (state.phase !== 'loading') set({ phase: 'loading' });
        break;
      case 'playing':
        active.heard = true;
        set({ phase: 'speaking', textOnly: false });
        startTalk();
        break;
      case 'paused':
        stopTalk();
        set({ phase: 'paused' });
        break;
      case 'failed':
        active.failed = true;
        stopTalk();
        // `canReplay` is false only when no clip came back at all.
        set({ textOnly: true, refused: !speech.canReplay });
        break;
      case 'idle':
        stopTalk();
        break;
    }
  }

  const unsubscribe = speaker.subscribe(() => onSpeech(speaker.getState()));

  function halt(): void {
    if (!turn) return;
    if (turn.spoken) speaker.stop(); // aborts the request and stops the audio
    finish('interrupted');
  }

  const api: NpcVoiceCoordinator = {
    play(node, playOptions = {}) {
      if (disposed) return Promise.resolve<NpcVoiceOutcome>('interrupted');
      halt();
      if (!node) {
        set({ ...IDLE });
        return Promise.resolve<NpcVoiceOutcome>('interrupted');
      }
      const token = (tokens += 1);
      const reference = isNpcSpeechRef(node.speech) ? node.speech : null;
      let muted = false;
      try {
        muted = isMuted?.() ?? false;
      } catch {
        muted = false;
      }
      const spoken = reference !== null && !muted;
      return new Promise<NpcVoiceOutcome>((resolve) => {
        turn = {
          token,
          nodeKey: node.nodeKey,
          spoken,
          started: false,
          heard: false,
          failed: false,
          resolve,
        };
        set({
          nodeKey: node.nodeKey,
          caption: node.text,
          phase: spoken ? 'loading' : 'done',
          talking: false,
          textOnly: !spoken,
          refused: false,
        });
        emit({ type: 'voice.started', nodeKey: node.nodeKey, spoken });
        if (!spoken || !reference) {
          // No voice, muted, or no reference: the caption alone. Nothing is requested.
          speaker.showText(node.text);
          finish('text_only');
          return;
        }
        const request: SpeakRequest = {
          reference: toSpeechReference(reference),
          fallbackText: node.text,
          mode: 'interrupt',
          ...(playOptions.position ? { position: playOptions.position } : {}),
        };
        let settled: Promise<void>;
        try {
          settled = speaker.speak(request);
        } catch {
          settled = Promise.resolve();
        }
        void settled.then(() => {
          const active = turn;
          if (!active || active.token !== token) return; // replaced or interrupted already
          // Read the final phase synchronously: a failure may be the last thing reported.
          if (speaker.getState().phase === 'failed') active.failed = true;
          finish(active.heard && !active.failed ? 'spoken' : 'text_only');
        });
      });
    },

    interrupt(interruptOptions = {}) {
      if (disposed) return;
      halt();
      if (interruptOptions.clear) set({ ...IDLE });
    },

    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    onEvent(listener) {
      eventListeners.add(listener);
      return () => void eventListeners.delete(listener);
    },

    dispose() {
      if (disposed) return;
      halt();
      disposed = true;
      unsubscribe();
      listeners.clear();
      eventListeners.clear();
    },
  };
  return api;
}
