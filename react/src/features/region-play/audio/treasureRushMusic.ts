import type { SoundPlayer } from '../../../audio';
import { createSoundSlot, type SoundSlot } from './soundSlot';
import { MUSIC_CUES } from './treasureRushSounds';

/**
 * Treasure Rush's music: calm exploration, a gentler puzzle theme while a rune puzzle is out, and
 * a one-time victory. This is a small state holder over one `SoundSlot`, not a playlist engine.
 * Changes fade out the old track and fade in the new one (the Sound Manager has no true
 * crossfade or ducking yet; see docs/audio/TREASURE_RUSH_AUDIO.md).
 */
export interface TreasureRushMusic {
  /** Whether a rune puzzle is out; chooses between the puzzle and exploration themes. */
  setPuzzleActive(active: boolean): void;
  /** Plays the victory theme once, then returns to the exploration or puzzle theme. */
  playVictory(): void;
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

  const base = () => (puzzle ? MUSIC_CUES.puzzle : MUSIC_CUES.explore);
  const settle = () => slot.set(victory ? MUSIC_CUES.victory : base());
  const backToBase = () => {
    victory = false;
    settle();
  };

  const slot: SoundSlot = createSoundSlot(player, {
    fadeMs: MUSIC_FADE_MS,
    // The victory theme ending, or having no audio to play, hands the room back to its music.
    onEnded: (id) => {
      if (id === MUSIC_CUES.victory) backToBase();
    },
    onUnavailable: (id) => {
      if (id === MUSIC_CUES.victory) backToBase();
    },
  });

  return {
    setPuzzleActive(active) {
      if (puzzle === active) return;
      puzzle = active;
      settle();
    },
    playVictory() {
      if (victory) return;
      victory = true;
      settle();
    },
    reapply: () => slot.reapply(),
    activate() {
      slot.activate();
      settle();
    },
    deactivate: () => slot.deactivate(),
    get wanted() {
      return slot.wanted;
    },
  };
}
