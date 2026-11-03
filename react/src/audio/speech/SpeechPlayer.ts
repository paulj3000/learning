import type { SoundHandle, SoundManager, SoundPlayer, SpatialOptions } from '../AudioTypes';

/**
 * Spoken dialogue on the shared Sound Manager (SM-P8-06, SM-P8-07). It is not an audio engine:
 * it asks the server for speech (by reference, never by text), registers the returned clip as a
 * temporary sound on the `voice` channel and plays it through the caller's scope, so child volume
 * and mute, automatic music ducking, spatial placement, handles and scope cleanup all come from
 * the Sound Manager unchanged.
 *
 * Captions come first. The text the child can read (`fallbackText`, or the server's approved
 * text once it arrives) is shown from the moment `speak` is called and stays when audio is
 * muted, slow, blocked or failed. A failure is a state (`failed`), never an exception or a dialog.
 *
 * - Utterance level only: a caption is shown for the whole utterance. There is no word timing.
 * - A request that finishes after `stop`, an interruption or `dispose` is ignored; it can never
 *   start audio late.
 * - Identical references in flight share one request.
 */

export type SpeechReference =
  | { kind: 'utterance'; id: string }
  | { kind: 'line'; id: string }
  | { kind: 'npcNode'; npcId: string; nodeId: string };

export interface SpeechClipInfo {
  /** Ready to play: same-origin path made absolute, or https. */
  url: string;
  expiresInSeconds: number;
  /** The approved text, exactly what is spoken. The caption. */
  text: string;
  voiceProfile: string;
  cached: boolean;
}

export interface SpeechSource {
  request(reference: SpeechReference, signal: AbortSignal): Promise<SpeechClipInfo>;
}

export interface SpeakRequest {
  reference: SpeechReference;
  /** The text to show right away and when audio is unavailable (the line the game already has). */
  fallbackText?: string;
  /** `interrupt` (default) replaces what is speaking; `queue` waits its turn. */
  mode?: 'interrupt' | 'queue';
  /** Place the voice in the scene (an NPC's mouth). Leave unset for narration and instructions. */
  position?: SpatialOptions;
}

export type SpeechPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'failed';

export interface SpeechState {
  phase: SpeechPhase;
  /** What to show. Present from the start of a `speak` until the next one replaces it. */
  caption: string | null;
  /** Where the caption text came from. */
  captionFrom: 'speech' | 'fallback' | null;
  queued: number;
  /** The last utterance can be heard again. */
  canReplay: boolean;
  /** Audio was not produced for the current caption (failed, disabled, blocked): read only. */
  textOnly: boolean;
}

export interface SpeechPlayer {
  /** Resolves when this utterance has ended, been replaced, or failed. Never rejects. */
  speak(request: SpeakRequest): Promise<void>;
  /** Shows text with no audio at all (speech off, no reference). */
  showText(text: string): void;
  stop(): void;
  /** Ends the current utterance and goes on to the next queued one. */
  skip(): void;
  pause(): void;
  resume(): void;
  replay(): Promise<void>;
  clearCaption(): void;
  getState(): SpeechState;
  subscribe(listener: () => void): () => void;
  /** Stops everything and ignores any answer still on its way. Idempotent. */
  dispose(): void;
}

export interface SpeechPlayerOptions {
  manager: SoundManager;
  /** Normally a scope, so leaving the game ends the voice. */
  player: SoundPlayer & { readonly disposed?: boolean };
  /** `null`: no speech in this build; every `speak` becomes a caption only. */
  source: SpeechSource | null;
}

interface Entry {
  request: SpeakRequest;
  done: () => void;
}

const IDLE: SpeechState = {
  phase: 'idle',
  caption: null,
  captionFrom: null,
  queued: 0,
  canReplay: false,
  textOnly: false,
};

let counter = 0;

export function createSpeechPlayer(options: SpeechPlayerOptions): SpeechPlayer {
  const { manager, player, source } = options;
  const listeners = new Set<() => void>();
  const inflight = new Map<string, Promise<SpeechClipInfo>>();

  let state: SpeechState = IDLE;
  let disposed = false;
  let generation = 0;
  let running = false;
  let queue: Entry[] = [];
  let current: { handle: SoundHandle | null; owner: string; abort: AbortController } | null = null;
  let endCurrent: (() => void) | null = null;
  /** The last utterance, to say again. */
  let last: SpeakRequest | null = null;

  function set(patch: Partial<SpeechState>): void {
    state = { ...state, ...patch, queued: queue.length };
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A subscriber cannot break speech.
      }
    }
  }

  const keyOf = (reference: SpeechReference) => JSON.stringify(reference);

  function fetchClip(reference: SpeechReference, signal: AbortSignal): Promise<SpeechClipInfo> {
    if (!source) return Promise.reject(new Error('no speech source'));
    const key = keyOf(reference);
    const shared = inflight.get(key);
    if (shared) return shared;
    const promise = source.request(reference, signal).finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }

  function release(): void {
    if (!current) return;
    manager.releaseDefinitions(current.owner);
    current = null;
  }

  function haltCurrent(): void {
    generation += 1; // anything still on its way is now stale
    const active = current;
    if (active) {
      active.abort.abort();
      active.handle?.stop({ fadeOutMs: 80 });
    }
    release();
    endCurrent?.();
    endCurrent = null;
  }

  async function playOne(entry: Entry): Promise<void> {
    const { request } = entry;
    const mine = (generation += 1);
    const owner = `speech:${(counter += 1)}`;
    const abort = new AbortController();
    current = { handle: null, owner, abort };
    const finished = new Promise<void>((resolve) => {
      endCurrent = resolve;
    });
    const stale = () => mine !== generation || disposed;

    set({
      phase: 'loading',
      caption: request.fallbackText ?? null,
      captionFrom: request.fallbackText ? 'fallback' : null,
      textOnly: false,
    });

    let clip: SpeechClipInfo | null = null;
    if (source) {
      try {
        clip = await fetchClip(request.reference, abort.signal);
      } catch {
        clip = null;
      }
    }
    if (stale()) return finished;
    if (!clip) {
      last = request;
      set({ phase: 'failed', canReplay: false, textOnly: true });
      release();
      endCurrent = null;
      return;
    }
    last = request;
    // The server's approved text is what is spoken, so it is the caption that matches the audio.
    set({ caption: clip.text, captionFrom: 'speech', canReplay: true });

    const id = `voice.speech.u${counter}`;
    manager.replaceDefinitions(owner, [{ id, channel: 'voice', url: clip.url }]);
    const handle = await player.play(id, request.position ? { spatial: request.position } : {});
    if (stale()) {
      handle?.stop();
      return finished;
    }
    if (!handle) {
      // Muted channels still play silently; null means blocked, unavailable or missing.
      set({ phase: 'failed', textOnly: true });
      release();
      endCurrent = null;
      return;
    }
    if (current) current.handle = handle;
    set({ phase: 'playing' });
    void handle.whenEnded().then((reason) => {
      if (stale() || current?.handle !== handle) return;
      release();
      if (reason === 'failed') set({ phase: 'failed', textOnly: true });
      else set({ phase: 'idle' });
      endCurrent?.();
      endCurrent = null;
    });
    return finished;
  }

  async function pump(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (!disposed) {
        const entry = queue.shift();
        if (!entry) break;
        try {
          await playOne(entry);
        } finally {
          entry.done();
        }
      }
    } finally {
      running = false;
      if (!disposed) set({});
    }
  }

  const api: SpeechPlayer = {
    speak(request) {
      return new Promise<void>((resolve) => {
        if (disposed) {
          resolve();
          return;
        }
        if ((request.mode ?? 'interrupt') === 'interrupt') {
          const waiting = queue;
          queue = [];
          for (const entry of waiting) entry.done();
          haltCurrent();
        }
        queue.push({ request, done: resolve });
        set({});
        void pump();
      });
    },

    showText(text) {
      if (disposed) return;
      const waiting = queue;
      queue = [];
      for (const entry of waiting) entry.done();
      haltCurrent();
      set({
        phase: 'idle',
        caption: text,
        captionFrom: 'fallback',
        textOnly: true,
        canReplay: false,
      });
    },

    stop() {
      if (disposed) return;
      const waiting = queue;
      queue = [];
      for (const entry of waiting) entry.done();
      haltCurrent();
      set({ phase: 'idle' });
    },

    skip() {
      if (disposed) return;
      haltCurrent();
      set({ phase: 'idle' });
    },

    pause() {
      if (disposed || state.phase !== 'playing') return;
      current?.handle?.pause();
      set({ phase: 'paused' });
    },

    resume() {
      if (disposed || state.phase !== 'paused') return;
      current?.handle?.resume();
      set({ phase: 'playing' });
    },

    async replay() {
      const previous = last;
      if (disposed || !previous) return;
      // The same utterance again. The server answers from its cache and issues a fresh signed
      // url, so an expired one is never played.
      await api.speak({ ...previous, mode: 'interrupt' });
    },

    clearCaption() {
      if (disposed || state.phase === 'loading' || state.phase === 'playing') return;
      set({ caption: null, captionFrom: null, textOnly: false });
    },

    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      for (const entry of queue) entry.done();
      queue = [];
      current?.abort.abort();
      current?.handle?.stop();
      release();
      endCurrent?.();
      endCurrent = null;
      listeners.clear();
    },
  };
  return api;
}
