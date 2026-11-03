import type { SoundPlayer } from '../../../audio';
import { createMusicStates } from '../../../audio/music';
import { MUSIC_CUES } from './treasureRushSounds';

/**
 * Treasure Rush's music: calm exploration, a gentler puzzle theme while a rune puzzle is out, and
 * a one-time victory. It is a thin mapping onto the shared `MusicStates` (SM-P6), which does the
 * work: true overlapping crossfades, one stream at a time, no duplicates, and cleanup with the
 * scope. This file only says which cue each state is and when the game is in it.
 */
export interface TreasureRushMusic {
  /** Whether a rune puzzle is out; chooses between the puzzle and exploration themes. */
  setPuzzleActive(active: boolean): void;
  /** Plays the victory theme once, then returns to the exploration or puzzle theme. */
  playVictory(): void;
  /** Tries the wanted music again if it is not playing (a new manifest arrived). */
  reapply(): void;
  activate(): void;
  deactivate(): void;
  /** The cue that should currently be playing. */
  readonly wanted: string | null;
}

export const MUSIC_FADE_MS = 1200;

export function createTreasureRushMusic(player: SoundPlayer): TreasureRushMusic {
  let puzzle = false;
  let victory = false;
  let activated = false;

  const base = () => (puzzle ? 'puzzle' : 'exploration');
  const states = createMusicStates({
    player,
    crossfadeMs: MUSIC_FADE_MS,
    states: {
      exploration: { sound: MUSIC_CUES.explore },
      puzzle: { sound: MUSIC_CUES.puzzle },
      victory: { sound: MUSIC_CUES.victory },
    },
    // The victory theme ending, or having no audio to play, hands the room back to its music.
    returnTo(finished) {
      if (finished !== 'victory') return null;
      victory = false;
      return base();
    },
  });

  const settle = () => {
    if (activated) void states.setState(victory ? 'victory' : base());
  };

  return {
    setPuzzleActive(active) {
      if (puzzle === active) return;
      puzzle = active;
      if (!victory) settle();
    },
    playVictory() {
      if (victory) return;
      victory = true;
      settle();
    },
    reapply: () => void states.retry(),
    activate() {
      activated = true;
      void states.activate().then((resumed) => {
        if (!resumed && !states.director.wanted) settle();
      });
    },
    deactivate() {
      states.deactivate();
    },
    get wanted() {
      return states.director.wanted?.sound ?? null;
    },
  };
}
