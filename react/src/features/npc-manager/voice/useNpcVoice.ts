import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SoundSettings } from '../../../audio/AudioTypes';
import { useSoundManager, useSoundScope, useSoundSettings } from '../../../audio/react/hooks';
import { createSpeechPlayer, type SpeechSource } from '../../../audio/speech/SpeechPlayer';
import { speechApiFor } from '../../../api/speech/speechApi';
import type { NpcCommand } from '../contracts/engine';
import type { RuntimeNode } from '../contracts/types';
import {
  createNpcVoiceCoordinator,
  type NpcVoiceCoordinator,
  type NpcVoiceEvent,
  type NpcVoiceOutcome,
  type NpcVoiceState,
  type PlayOptions,
} from './npcVoiceCoordinator';

/** True when the child would not hear the voice channel at all. */
export function voiceIsSilent(settings: SoundSettings): boolean {
  const voice = settings.channels.voice;
  return (
    settings.masterMuted ||
    settings.masterVolume <= 0 ||
    (voice !== undefined && (voice.muted || voice.volume <= 0))
  );
}

export interface UseNpcVoiceOptions {
  childId: string;
  /** The talking NPC's placement (for the talk animation); null for none. */
  placementKey: string | null;
  /** The engine's command sink (`NpcRuntime.send`). Optional. */
  send?: (command: NpcCommand) => void;
  /** Completion and start events (for example to enable the panel's Next button). */
  onEvent?: (event: NpcVoiceEvent) => void;
  /** Defaults to Django for this child; `null` means text only. Tests pass their own. */
  source?: SpeechSource | null;
  /** The sound scope; the voice stops with it. Default `npc-voice`. */
  scopeName?: string;
}

export interface UseNpcVoice {
  state: NpcVoiceState;
  play(node: RuntimeNode | null, options?: PlayOptions): Promise<NpcVoiceOutcome>;
  interrupt(options?: { clear?: boolean }): void;
  /**
   * True while the child would not hear the voice channel (master or voice muted or at zero).
   * Follows the Sound Manager live, so a "hear it again" control can hide while muted.
   */
  silent: boolean;
  /** False when there is no speech source at all (`source: null`): captions only. */
  speechAvailable: boolean;
}

const IDLE_STATE: NpcVoiceState = {
  nodeKey: null,
  caption: null,
  phase: 'idle',
  talking: false,
  textOnly: false,
};

/**
 * React wrapper around the NPC voice coordinator (LAI-NPC-029). One speech player per mount, in
 * its own Sound Manager scope on the `voice` channel, so unmounting stops the voice and cancels
 * any request. Engine modules must never import this file (ADR-020).
 *
 * A node played before the player exists (first render) shows its caption at once and is voiced
 * when the player is ready.
 */
export function useNpcVoice(options: UseNpcVoiceOptions): UseNpcVoice {
  const { childId, scopeName = 'npc-voice' } = options;
  const manager = useSoundManager();
  const scope = useSoundScope(scopeName);
  const source = useMemo(
    () => (options.source === undefined ? speechApiFor(childId) : options.source),
    [childId, options.source],
  );
  const latest = useRef(options);
  latest.current = options;
  const ref = useRef<NpcVoiceCoordinator | null>(null);
  const pending = useRef<{
    node: RuntimeNode;
    options: PlayOptions | undefined;
    resolve: (outcome: NpcVoiceOutcome) => void;
  } | null>(null);
  const [state, setState] = useState<NpcVoiceState>(IDLE_STATE);
  const silent = voiceIsSilent(useSoundSettings());
  const speechAvailable = source !== null;

  useEffect(() => {
    const player = createSpeechPlayer({ manager, player: scope, source });
    const coordinator = createNpcVoiceCoordinator({
      speaker: player,
      send: (command) => latest.current.send?.(command),
      placementKey: () => latest.current.placementKey,
      isMuted: () => voiceIsSilent(manager.getSettings()),
    });
    ref.current = coordinator;
    const offState = coordinator.subscribe(setState);
    const offEvent = coordinator.onEvent((event) => latest.current.onEvent?.(event));
    const waiting = pending.current;
    pending.current = null;
    if (waiting) {
      void coordinator.play(waiting.node, waiting.options).then(waiting.resolve);
    }
    return () => {
      offState();
      offEvent();
      coordinator.dispose(); // stops the talk animation and the voice
      player.dispose(); // aborts any request still on its way
      if (ref.current === coordinator) ref.current = null;
    };
  }, [manager, scope, source]);

  const play = useCallback((node: RuntimeNode | null, playOptions?: PlayOptions) => {
    const coordinator = ref.current;
    if (coordinator) return coordinator.play(node, playOptions);
    pending.current?.resolve('interrupted');
    pending.current = null;
    if (!node) {
      setState(IDLE_STATE);
      return Promise.resolve<NpcVoiceOutcome>('interrupted');
    }
    // Caption first, always.
    setState({ ...IDLE_STATE, nodeKey: node.nodeKey, caption: node.text, phase: 'loading' });
    return new Promise<NpcVoiceOutcome>((resolve) => {
      pending.current = { node, options: playOptions, resolve };
    });
  }, []);

  const interrupt = useCallback((interruptOptions?: { clear?: boolean }) => {
    pending.current?.resolve('interrupted');
    pending.current = null;
    if (ref.current) ref.current.interrupt(interruptOptions);
    else if (interruptOptions?.clear) setState(IDLE_STATE);
  }, []);

  return useMemo(
    () => ({ state, play, interrupt, silent, speechAvailable }),
    [state, play, interrupt, silent, speechAvailable],
  );
}
