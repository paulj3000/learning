import { TR_SOUND } from '../../../../region-play/audio/treasureRushSounds';
import type { CastleRoomId } from '../../castleLayout';
import type { CastleSoundMoment } from './castleSoundCues';

/**
 * Storykeeper Castle's logical sound ids (SC-R06-01). They are cue ids in the Django sound library
 * (`lai/apps/audio/castle_cues.py`), never file names or urls: which file a cue plays is decided
 * by staff in Django Admin and reaches the castle through the published audio manifest for the
 * region `storykeeper-castle`. With no published audio a cue is silent and play goes on.
 * The full event map and the list of audio still to make is `docs/audio/STORYKEEPER_CASTLE_AUDIO.md`.
 *
 * Shared cues (`sfx.learning.*`, `sfx.quest.complete`, `sfx.treasure.reveal`, `sfx.reward.collect`
 * and the movement and platform cues) are the same library rows Treasure Rush uses: reused, never
 * duplicated.
 */
export const CASTLE_SOUND = {
  ambientHall: 'ambient.castle.hall',
  ambientGallery: 'ambient.castle.gallery',
  ambientCostume: 'ambient.castle.costume',
  ambientTower: 'ambient.castle.tower',
  ambientStudio: 'ambient.castle.studio',
  ambientLibrary: 'ambient.castle.library',
  ambientTrophy: 'ambient.castle.trophy',
  ambientSecret: 'ambient.castle.secret',
  musicExplore: 'music.castle.explore',
  musicStory: 'music.castle.story',
  bookOpen: 'sfx.castle.book_open',
  bookClose: 'sfx.castle.book_close',
  pageRestore: 'sfx.castle.page_restore',
  questStart: 'sfx.castle.quest_start',
  npcGreet: 'sfx.castle.npc_greet',
  hintChime: 'sfx.castle.hint_chime',
  artifactFound: 'sfx.castle.artifact_found',
  door: 'ui.castle.door',
  // Shared with every region (`lai/apps/audio/treasure_rush_cues.py`).
  learningCorrect: TR_SOUND.learningCorrect,
  learningRetry: TR_SOUND.learningRetry,
  questComplete: TR_SOUND.questComplete,
  treasureReveal: TR_SOUND.treasureReveal,
  rewardCollect: TR_SOUND.rewardCollect,
} as const;

/** The cue ids the castle owns (not the shared ones): what `seed_castle_sound` creates. */
export const CASTLE_OWNED_CUES: readonly string[] = [
  CASTLE_SOUND.ambientHall,
  CASTLE_SOUND.ambientGallery,
  CASTLE_SOUND.ambientCostume,
  CASTLE_SOUND.ambientTower,
  CASTLE_SOUND.ambientStudio,
  CASTLE_SOUND.ambientLibrary,
  CASTLE_SOUND.ambientTrophy,
  CASTLE_SOUND.ambientSecret,
  CASTLE_SOUND.musicExplore,
  CASTLE_SOUND.musicStory,
  CASTLE_SOUND.bookOpen,
  CASTLE_SOUND.bookClose,
  CASTLE_SOUND.pageRestore,
  CASTLE_SOUND.questStart,
  CASTLE_SOUND.npcGreet,
  CASTLE_SOUND.hintChime,
  CASTLE_SOUND.artifactFound,
  CASTLE_SOUND.door,
];

/** The bed each room plays. Every `CastleRoomId` has one (a test holds this). */
export const ROOM_AMBIENCE: Readonly<Record<CastleRoomId, string>> = {
  'entry-hall': CASTLE_SOUND.ambientHall,
  'story-hall': CASTLE_SOUND.ambientHall,
  'character-gallery': CASTLE_SOUND.ambientGallery,
  'costume-room': CASTLE_SOUND.ambientCostume,
  'east-corridor': CASTLE_SOUND.ambientHall,
  'setting-tower': CASTLE_SOUND.ambientTower,
  'illustration-studio': CASTLE_SOUND.ambientStudio,
  'great-library': CASTLE_SOUND.ambientLibrary,
  'trophy-room': CASTLE_SOUND.ambientTrophy,
  'secret-chamber': CASTLE_SOUND.ambientSecret,
};

/**
 * Bed priority by room. A child is in one room at a time, so this only matters if staff zone
 * assignments ever overlap; the special rooms outrank the plain halls.
 */
export const ROOM_PRIORITY: Readonly<Record<CastleRoomId, number>> = {
  'entry-hall': 40,
  'story-hall': 40,
  'character-gallery': 40,
  'costume-room': 40,
  'east-corridor': 40,
  'setting-tower': 42,
  'illustration-studio': 40,
  'great-library': 42,
  'trophy-room': 40,
  'secret-chamber': 45,
};

/** Before the child's room is known (and for a room whose bed has no audio): the hall. */
export const ENTRY_AMBIENCE = CASTLE_SOUND.ambientHall;

/** The ambience for a room id, or `null` for an id that is not a castle room. */
export function ambienceForRoom(roomId: string): string | null {
  return (ROOM_AMBIENCE as Readonly<Record<string, string>>)[roomId] ?? null;
}

/**
 * Cues heard from where they happened: an NPC's greeting and a found artifact. Everything else is
 * flat on purpose: right and try-again feedback, hints, the Storybook, quests, music and narration
 * must be heard clearly wherever the child faces.
 */
export const POSITIONAL_CUES: ReadonlySet<string> = new Set([
  CASTLE_SOUND.npcGreet,
  CASTLE_SOUND.artifactFound,
]);

/** How far a placed one-shot carries in the castle's rooms (metres), like Quill's voice. */
export const ONE_SHOT_SPATIAL = { refDistance: 2.5, maxDistance: 20, rolloffFactor: 1 } as const;

/** What each castle moment sounds like. A moment may play several cues together. */
export const CASTLE_CUE_SOUNDS: Readonly<Record<CastleSoundMoment, readonly string[]>> = {
  bookOpen: [CASTLE_SOUND.bookOpen],
  bookClose: [CASTLE_SOUND.bookClose],
  pageRestored: [CASTLE_SOUND.pageRestore],
  questStart: [CASTLE_SOUND.questStart],
  questComplete: [CASTLE_SOUND.questComplete],
  npcGreet: [CASTLE_SOUND.npcGreet],
  hint: [CASTLE_SOUND.hintChime],
  answerRight: [CASTLE_SOUND.learningCorrect],
  answerRetry: [CASTLE_SOUND.learningRetry],
  artifactFound: [CASTLE_SOUND.artifactFound],
  roomDoor: [CASTLE_SOUND.door],
};

/**
 * A castle cue with no audio published plays this shared cue instead. Anything not listed is
 * silent when missing.
 */
export const CUE_FALLBACK: Readonly<Record<string, string>> = {
  [CASTLE_SOUND.pageRestore]: CASTLE_SOUND.treasureReveal,
  [CASTLE_SOUND.artifactFound]: CASTLE_SOUND.rewardCollect,
};

/**
 * Moments a Sprout (ages 3 to 4) does not hear: no try-again sound at all. The words on the card
 * still say it gently, and the hint chime stays (it is soft by design).
 */
export const SPROUT_SILENT_MOMENTS: ReadonlySet<CastleSoundMoment> = new Set(['answerRetry']);

export type CastleMusicState = 'explore' | 'story';

export const CASTLE_MUSIC: Readonly<Record<CastleMusicState, string>> = {
  explore: CASTLE_SOUND.musicExplore,
  story: CASTLE_SOUND.musicStory,
};

/** The shared movement and platform cues the castle's jumping course already raises (SC-JMP). */
export const SHARED_MOVEMENT = {
  playerJump: TR_SOUND.playerJump,
  playerLand: TR_SOUND.playerLand,
  platformActivate: TR_SOUND.platformActivate,
  platformMove: TR_SOUND.platformMove,
  platformStop: TR_SOUND.platformStop,
  pressurePlate: TR_SOUND.pressurePlate,
  bounce: TR_SOUND.bounce,
  checkpoint: TR_SOUND.checkpoint,
  playerRecover: TR_SOUND.playerRecover,
  platformGoal: TR_SOUND.platformGoal,
} as const;
