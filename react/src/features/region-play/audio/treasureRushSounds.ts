import type { SoundCue } from '../soundCues';

/**
 * Treasure Rush's logical sound ids (SM-P3). They are cue ids in the Django sound library
 * (`lai/apps/audio/treasure_rush_cues.py`), never file names or urls: which file a cue plays is
 * decided by staff in Django Admin and reaches the game through the published audio manifest.
 * The full event map is `docs/audio/TREASURE_RUSH_AUDIO.md`.
 */
export const TR_SOUND = {
  ambientOcean: 'ambient.treasure_rush.ocean',
  ambientJungle: 'ambient.treasure_rush.jungle',
  ambientCave: 'ambient.treasure_rush.cave',
  musicExplore: 'music.treasure_rush.explore',
  musicPuzzle: 'music.treasure_rush.puzzle',
  musicVictory: 'music.treasure_rush.victory',
  chestOpen: 'sfx.chest.open',
  treasureReveal: 'sfx.treasure.reveal',
  keyDiscover: 'sfx.key.discover',
  rewardCollect: 'sfx.reward.collect',
  bridgeOpen: 'sfx.world.bridge_open',
  learningCorrect: 'sfx.learning.correct',
  learningRetry: 'sfx.learning.retry',
  learningComplete: 'sfx.learning.complete',
  questComplete: 'sfx.quest.complete',
} as const;

/** The ambience each zone of Treasure Cove plays. Ids are the layout's zone rectangle ids. */
export const ZONE_AMBIENCE: Readonly<Record<string, string>> = {
  'cove-zone-landing': TR_SOUND.ambientOcean,
  'cove-zone-grove': TR_SOUND.ambientJungle,
  'cove-zone-beach': TR_SOUND.ambientOcean,
  'cove-zone-ruins': TR_SOUND.ambientCave,
};

/** The child arrives at Pirate Landing, so that is the ambience before any zone is entered. */
export const ENTRY_AMBIENCE = TR_SOUND.ambientOcean;

/** The ambience for a zone, or `null` for a zone with none (the current ambience then continues). */
export function ambienceForZone(zoneId: string): string | null {
  return ZONE_AMBIENCE[zoneId] ?? null;
}

/**
 * What each moment of play sounds like, in order. A moment may play several cues together; the
 * mixer decides what that sounds like. Moments with no entry are silent.
 */
export const CUE_SOUNDS: Readonly<Record<SoundCue, readonly string[]>> = {
  chestOpen: [TR_SOUND.chestOpen, TR_SOUND.treasureReveal],
  keyPickup: [TR_SOUND.keyDiscover],
  stoneRight: [TR_SOUND.learningComplete],
  stoneWrong: [TR_SOUND.learningRetry],
  bridgeOpen: [TR_SOUND.bridgeOpen],
  celebrate: [TR_SOUND.rewardCollect],
  replayWin: [TR_SOUND.learningCorrect],
  answerRight: [TR_SOUND.learningCorrect],
  answerRetry: [TR_SOUND.learningRetry],
  questComplete: [TR_SOUND.questComplete],
};

export type MusicState = 'explore' | 'puzzle' | 'victory';

export const MUSIC_CUES: Readonly<Record<MusicState, string>> = {
  explore: TR_SOUND.musicExplore,
  puzzle: TR_SOUND.musicPuzzle,
  victory: TR_SOUND.musicVictory,
};
