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
  ambientWind: 'ambient.treasure_rush.wind',
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

/** Lookout Point, beyond the gate (SM-P7). */
export const LOOKOUT_ZONE = 'cove-zone-lookout';

/** The ambience each zone of Treasure Cove plays. Ids are the layout's zone rectangle ids. */
export const ZONE_AMBIENCE: Readonly<Record<string, string>> = {
  'cove-zone-landing': TR_SOUND.ambientOcean,
  'cove-zone-grove': TR_SOUND.ambientJungle,
  'cove-zone-beach': TR_SOUND.ambientOcean,
  'cove-zone-ruins': TR_SOUND.ambientCave,
  [LOOKOUT_ZONE]: TR_SOUND.ambientWind,
};

/**
 * Which zone wins when zones overlap (the highest). The ruins' echo outranks the open sea, and the
 * wind at Lookout Point outranks the shore. Staff can override these through zone assignments.
 */
export const ZONE_PRIORITY: Readonly<Record<string, number>> = {
  'cove-zone-landing': 1,
  'cove-zone-beach': 1,
  'cove-zone-grove': 2,
  'cove-zone-lookout': 2,
  'cove-zone-ruins': 3,
};

/** The child arrives at Pirate Landing, so that is the ambience before any zone is entered. */
export const ENTRY_AMBIENCE = TR_SOUND.ambientOcean;

/** The ambience for a zone, or `null` for a zone with none (the current ambience then continues). */
export function ambienceForZone(zoneId: string): string | null {
  return ZONE_AMBIENCE[zoneId] ?? null;
}

/**
 * Which cues of a moment are heard from where it happened (SM-P7). Everything else stays flat:
 * correct and retry feedback, rewards, quest completion, music and instructions must be heard
 * clearly wherever the child stands.
 */
export const POSITIONAL_CUES: ReadonlySet<string> = new Set([
  TR_SOUND.chestOpen,
  TR_SOUND.treasureReveal,
  TR_SOUND.keyDiscover,
  TR_SOUND.bridgeOpen,
]);

/** How far a one-shot in the cove carries (metres): clear nearby, gone across the cove. */
export const ONE_SHOT_SPATIAL = { refDistance: 3, maxDistance: 40, rolloffFactor: 1 } as const;

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
  // NPC moments have no built-in sound: staff assign one per NPC (`NPC_CUE_EVENTS`).
  npcGreet: [],
  npcInteract: [],
  npcTalk: [],
  npcLeave: [],
};

/**
 * LAI-NPC-015: which Sound Manager NPC event (Django `audio` `TargetType.NPC`) each NPC moment
 * is. The sound is whatever staff assigned to that NPC and event in the region's published audio
 * manifest; with no assignment the moment is silent (the dialogue's voice and captions remain).
 */
export const NPC_CUE_EVENTS: Readonly<Partial<Record<SoundCue, string>>> = {
  npcGreet: 'on_approach',
  npcInteract: 'on_interact',
  npcTalk: 'on_dialogue_start',
  npcLeave: 'on_exit',
};

export type MusicState = 'explore' | 'puzzle' | 'victory';

export const MUSIC_CUES: Readonly<Record<MusicState, string>> = {
  explore: TR_SOUND.musicExplore,
  puzzle: TR_SOUND.musicPuzzle,
  victory: TR_SOUND.musicVictory,
};
