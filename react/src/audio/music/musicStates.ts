import { createMusicDirector, type MusicDirector, type MusicTarget } from './MusicDirector';
import type { SoundPlayer } from '../AudioTypes';

/**
 * Named music states over a `MusicDirector` (SM-P6): the vocabulary a game uses to ask for music
 * without knowing cue ids. A game maps only the states it uses to a playlist or a sound; the rest
 * are ignored, so no game has to support all of them.
 *
 * - `idle` is silence (fade out). It needs no mapping.
 * - `victory` and other one-shots hand back to a state when they finish (`returnTo`).
 * - `narration` is a music state like any other (a quieter bed for a story, for example). Ducking
 *   for speech is automatic in the Sound Manager and does not use this.
 */

export type MusicStateName =
  'exploration' | 'puzzle' | 'suspense' | 'victory' | 'narration' | 'idle';

export type MusicStateMap = Partial<Record<Exclude<MusicStateName, 'idle'>, MusicTarget>>;

export interface MusicStatesOptions {
  player: SoundPlayer;
  states: MusicStateMap;
  playlists?: readonly import('./playlist').PlaylistDefinition[];
  crossfadeMs?: number;
  random?: () => number;
  /**
   * Where a state goes when its music finishes by itself (a one-shot victory). Return `null` to
   * stay silent. Default: stay where it is.
   */
  returnTo?(finished: MusicStateName): MusicStateName | null;
}

export interface MusicStates {
  readonly state: MusicStateName;
  /** Asks for a state's music. A state with no mapping is ignored (returns false). */
  setState(state: MusicStateName): Promise<boolean>;
  /** Tries the current state again (call it when a new manifest arrives). */
  retry(): Promise<boolean>;
  activate(): Promise<boolean>;
  deactivate(): void;
  readonly director: MusicDirector;
}

export function createMusicStates(options: MusicStatesOptions): MusicStates {
  let state: MusicStateName = 'idle';
  let director: MusicDirector;

  const stateOf = (target: MusicTarget): MusicStateName | null => {
    for (const [name, mapped] of Object.entries(options.states)) {
      if (mapped && mapped.playlist === target.playlist && mapped.sound === target.sound) {
        return name as MusicStateName;
      }
    }
    return null;
  };

  async function setState(next: MusicStateName): Promise<boolean> {
    if (next === 'idle') {
      state = 'idle';
      director.stop();
      return true;
    }
    const target = options.states[next];
    if (!target) return false;
    state = next;
    return director.play(target);
  }

  director = createMusicDirector({
    player: options.player,
    crossfadeMs: options.crossfadeMs,
    random: options.random,
    onFinished(target) {
      const finished = stateOf(target);
      if (finished === null || finished !== state) return;
      const back = options.returnTo?.(finished);
      if (back) void setState(back);
    },
    onUnavailable(target) {
      // A one-shot with no audio hands back at once, as if it had finished.
      const missing = stateOf(target);
      if (missing === null || missing !== state) return;
      const back = options.returnTo?.(missing);
      if (back && back !== missing) void setState(back);
    },
  });
  for (const definition of options.playlists ?? []) director.definePlaylist(definition);

  return {
    get state() {
      return state;
    },
    setState,
    retry: () => director.retry(),
    activate: () => director.activate(),
    deactivate: () => director.deactivate(),
    director,
  };
}
