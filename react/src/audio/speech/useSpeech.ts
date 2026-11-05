import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { speechApiFor } from '../../api/speech/speechApi';
import { useSoundManager, useSoundScope } from '../react/hooks';
import {
  createSpeechPlayer,
  type SpeakRequest,
  type SpeechPlayer,
  type SpeechSource,
  type SpeechState,
} from './SpeechPlayer';

export interface UseSpeechOptions {
  childId: string;
  /** The scope's name; speech stops with it. Default `speech`. */
  scopeName?: string;
  /**
   * Where speech comes from. Defaults to Django for this child; `null` (a build without the API)
   * means text only. Tests pass their own.
   */
  source?: SpeechSource | null;
}

export interface UseSpeech {
  state: SpeechState;
  speak(request: SpeakRequest): Promise<void>;
  showText(text: string): void;
  stop(): void;
  skip(): void;
  pause(): void;
  resume(): void;
  replay(): Promise<void>;
  clearCaption(): void;
}

const IDLE_STATE: SpeechState = {
  phase: 'idle',
  caption: null,
  captionFrom: null,
  queued: 0,
  canReplay: false,
  textOnly: false,
};

/**
 * Spoken dialogue with captions for a game component (SM-P8-06). One player per mount, played in
 * the component's own scope so it ends with the component; safe under StrictMode (the player is
 * rebuilt by the effect, and nothing pending from the first one can start late).
 *
 * Calls made before the player exists are text only, so `speak` is always safe to call.
 */
export function useSpeech(options: UseSpeechOptions): UseSpeech {
  const { childId, scopeName = 'speech' } = options;
  const manager = useSoundManager();
  const scope = useSoundScope(scopeName);
  const source = useMemo(
    () => (options.source === undefined ? speechApiFor(childId) : options.source),
    [childId, options.source],
  );
  const ref = useRef<SpeechPlayer | null>(null);
  const [state, setState] = useState<SpeechState>(IDLE_STATE);
  const pendingText = useRef<string | null>(null);

  useEffect(() => {
    const player = createSpeechPlayer({ manager, player: scope, source });
    ref.current = player;
    const off = player.subscribe(() => setState(player.getState()));
    if (pendingText.current) {
      player.showText(pendingText.current);
      pendingText.current = null;
    }
    return () => {
      off();
      player.dispose();
      if (ref.current === player) ref.current = null;
    };
  }, [manager, scope, source]);

  const speak = useCallback((request: SpeakRequest) => {
    const player = ref.current;
    if (!player) {
      pendingText.current = request.fallbackText ?? null;
      return Promise.resolve();
    }
    return player.speak(request);
  }, []);

  return useMemo(
    () => ({
      state,
      speak,
      showText: (text) => {
        if (ref.current) ref.current.showText(text);
        else pendingText.current = text;
      },
      stop: () => ref.current?.stop(),
      skip: () => ref.current?.skip(),
      pause: () => ref.current?.pause(),
      resume: () => ref.current?.resume(),
      replay: () => ref.current?.replay() ?? Promise.resolve(),
      clearCaption: () => ref.current?.clearCaption(),
    }),
    [state, speak],
  );
}
