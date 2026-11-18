import type { SoundCue } from '../soundCues';
import {
  CUE_SOUNDS,
  ENTRY_AMBIENCE,
  MUSIC_CUES,
  TR_SOUND,
  ZONE_AMBIENCE,
  ZONE_PRIORITY,
  type MusicState,
} from './treasureRushSounds';

/**
 * Per-region sound tables (ADR-050). The Sound Manager hook reads one entry by region id, so a
 * region's zones, entry ambience, music and moment sounds are data, not hook code. Every id is a
 * cue id in the Django sound library, never a file; a cue without published audio is silent.
 *
 * Treasure Rush's entry points at the original tables unchanged.
 */
export interface RegionAudio {
  /** Zone rectangle id -> ambience cue. */
  readonly zoneAmbience: Readonly<Record<string, string>>;
  /** Which overlapping zone wins (the highest). Zones missing here count as 0. */
  readonly zonePriority: Readonly<Record<string, number>>;
  /** The ambience before any zone is entered, or null for none. */
  readonly entryAmbience: string | null;
  /** Cue per music state: exploration, puzzle (may equal explore) and the one-time victory. */
  readonly music: Readonly<Record<MusicState, string>>;
  /** Cue ids for each gameplay moment; the sink plays them. */
  readonly momentSounds: Readonly<Record<SoundCue, readonly string[]>>;
  /** Engine checkpoint (`CourseCheckpointReached`) and recovery (`PlayerRecovered`) cues. */
  readonly checkpointCue: string;
  readonly recoverCue: string;
}

export const TREASURE_RUSH_REGION_ID = 'treasure-rush-cove';
export const FIREPEAK_REGION_ID = 'firepeak-heart';
export const NORTH_POLE_REGION_ID = 'north-pole-village';

/** The Heart of Firepeak's cue ids (`lai/apps/audio/firepeak_cues.py`). */
export const FP_SOUND = {
  musicRealm: 'music.firepeak.realm',
  musicFinale: 'music.firepeak.finale',
  ambientLanding: 'ambient.firepeak.landing',
  ambientForest: 'ambient.firepeak.forest',
  ambientLava: 'ambient.firepeak.lava',
  ambientCave: 'ambient.firepeak.cave',
  ambientForge: 'ambient.firepeak.forge',
  ambientSummit: 'ambient.firepeak.summit_wind',
  ambientHeart: 'ambient.firepeak.heart',
  machinery: 'sfx.firepeak.machinery',
  crystalCollect: 'sfx.firepeak.crystal_collect',
  switchFlip: 'sfx.firepeak.switch',
  puzzleComplete: 'sfx.firepeak.puzzle_complete',
  checkpoint: 'sfx.firepeak.checkpoint',
  lavaRespawn: 'sfx.firepeak.lava_respawn',
  restore: 'sfx.firepeak.restore',
  complete: 'sfx.firepeak.complete',
  npcGreet: 'voice.firepeak.npc_greet',
} as const;

export const FIREPEAK_ZONE_AMBIENCE: Readonly<Record<string, string>> = {
  'explorers-landing': FP_SOUND.ambientLanding,
  'emberwood-forest': FP_SOUND.ambientForest,
  'lava-crossing': FP_SOUND.ambientLava,
  'crystal-caverns': FP_SOUND.ambientCave,
  'ancient-forge': FP_SOUND.ambientForge,
  'firepeak-summit': FP_SOUND.ambientSummit,
  'heart-chamber': FP_SOUND.ambientHeart,
};

/** Zones are sequential and do not overlap; priority only breaks a seam overlap, deeper wins. */
export const FIREPEAK_ZONE_PRIORITY: Readonly<Record<string, number>> = {
  'explorers-landing': 1,
  'emberwood-forest': 2,
  'lava-crossing': 3,
  'crystal-caverns': 4,
  'ancient-forge': 5,
  'firepeak-summit': 6,
  'heart-chamber': 7,
};

const NO_MOMENT: readonly string[] = [];

/**
 * Firepeak moments. `crystalCollect`, `puzzleComplete`, `restoration` and `switchFlip` sound only
 * when the puzzle or region layer calls `playCue(<moment>)` (see FIREPEAK_AUDIO_INVENTORY.md).
 */
export const FIREPEAK_MOMENT_SOUNDS: Readonly<Record<SoundCue, readonly string[]>> = {
  chestOpen: NO_MOMENT,
  keyPickup: NO_MOMENT,
  stoneRight: NO_MOMENT,
  stoneWrong: NO_MOMENT,
  bridgeOpen: NO_MOMENT,
  celebrate: NO_MOMENT,
  replayWin: NO_MOMENT,
  answerRight: NO_MOMENT,
  answerRetry: NO_MOMENT,
  questComplete: [FP_SOUND.complete],
  npcGreet: NO_MOMENT,
  npcInteract: NO_MOMENT,
  npcTalk: NO_MOMENT,
  npcLeave: NO_MOMENT,
  crystalCollect: [FP_SOUND.crystalCollect],
  puzzleComplete: [FP_SOUND.puzzleComplete],
  restoration: [FP_SOUND.restore],
  switchFlip: [FP_SOUND.switchFlip],
};

/** North Pole's cue ids (`lai/apps/audio/north_pole_cues.py`). */
export const NP_SOUND = {
  musicVillage: 'music.north_pole.village',
  musicForest: 'music.north_pole.forest',
  musicCelebration: 'music.north_pole.celebration',
  ambientLanding: 'ambient.north_pole.landing',
  ambientWorkshop: 'ambient.north_pole.workshop',
  ambientForest: 'ambient.north_pole.forest',
  ambientLake: 'ambient.north_pole.lake',
  ambientStables: 'ambient.north_pole.stables',
  ambientGingerbread: 'ambient.north_pole.gingerbread',
  ambientMountain: 'ambient.north_pole.mountain_wind',
  ambientObservatory: 'ambient.north_pole.observatory',
  ambientWind: 'ambient.north_pole.wind',
  snowStep: 'sfx.north_pole.snow_step',
  iceStep: 'sfx.north_pole.ice_step',
  collect: 'sfx.north_pole.collect',
  fragment: 'sfx.north_pole.fragment',
  answerRight: 'sfx.north_pole.answer_right',
  answerRetry: 'sfx.north_pole.answer_retry',
  questComplete: 'sfx.north_pole.quest_complete',
  checkpoint: 'sfx.north_pole.checkpoint',
  respawn: 'sfx.north_pole.respawn',
  reindeer: 'sfx.north_pole.reindeer',
  sleighBells: 'sfx.north_pole.sleigh_bells',
  starRestored: 'sfx.north_pole.star_restored',
  npcGreet: 'voice.north_pole.npc_greet',
} as const;

/** Zone rectangle ids (design section 4; also the narration zone ids) -> ambience cue. */
export const NORTH_POLE_ZONE_AMBIENCE: Readonly<Record<string, string>> = {
  'santas-landing': NP_SOUND.ambientLanding,
  'christmas-village': NP_SOUND.ambientLanding,
  'santas-workshop': NP_SOUND.ambientWorkshop,
  'candy-cane-forest': NP_SOUND.ambientForest,
  'frozen-lake': NP_SOUND.ambientLake,
  'reindeer-stables': NP_SOUND.ambientStables,
  'gingerbread-village': NP_SOUND.ambientGingerbread,
  'north-road': NP_SOUND.ambientWind,
  'snowflake-mountain': NP_SOUND.ambientMountain,
  'north-pole-observatory': NP_SOUND.ambientObservatory,
};

/**
 * Zones are separated by snowbank walls and do not overlap; priority only breaks a seam overlap.
 * The connecting north road is the lowest, so the place a child is walking into wins.
 */
export const NORTH_POLE_ZONE_PRIORITY: Readonly<Record<string, number>> = {
  'north-road': 1,
  'santas-landing': 2,
  'christmas-village': 3,
  'santas-workshop': 4,
  'candy-cane-forest': 5,
  'frozen-lake': 6,
  'reindeer-stables': 7,
  'gingerbread-village': 8,
  'snowflake-mountain': 9,
  'north-pole-observatory': 10,
};

/**
 * North Pole moments. `keyPickup` is raised for every pickup, `answerRight`, `answerRetry` and
 * `questComplete` by the region play layer. `crystalCollect` (a star fragment) and `restoration`
 * (the Star relights) sound only when the puzzle or region layer calls `playCue(<moment>)`
 * (see NORTH_POLE_AUDIO_INVENTORY.md). No moment here needs a chest or gate sound.
 */
export const NORTH_POLE_MOMENT_SOUNDS: Readonly<Record<SoundCue, readonly string[]>> = {
  chestOpen: NO_MOMENT,
  keyPickup: [NP_SOUND.collect],
  stoneRight: NO_MOMENT,
  stoneWrong: NO_MOMENT,
  bridgeOpen: NO_MOMENT,
  celebrate: NO_MOMENT,
  replayWin: NO_MOMENT,
  answerRight: [NP_SOUND.answerRight],
  answerRetry: [NP_SOUND.answerRetry],
  questComplete: [NP_SOUND.questComplete],
  npcGreet: NO_MOMENT,
  npcInteract: NO_MOMENT,
  npcTalk: NO_MOMENT,
  npcLeave: NO_MOMENT,
  crystalCollect: [NP_SOUND.fragment],
  puzzleComplete: NO_MOMENT,
  restoration: [NP_SOUND.starRestored],
  switchFlip: NO_MOMENT,
};

const TREASURE_RUSH_AUDIO: RegionAudio = {
  zoneAmbience: ZONE_AMBIENCE,
  zonePriority: ZONE_PRIORITY,
  entryAmbience: ENTRY_AMBIENCE,
  music: MUSIC_CUES,
  momentSounds: CUE_SOUNDS,
  checkpointCue: TR_SOUND.checkpoint,
  recoverCue: TR_SOUND.playerRecover,
};

const FIREPEAK_AUDIO: RegionAudio = {
  zoneAmbience: FIREPEAK_ZONE_AMBIENCE,
  zonePriority: FIREPEAK_ZONE_PRIORITY,
  entryAmbience: FP_SOUND.ambientLanding,
  // One theme for exploring and puzzling (no puzzle theme: the music never changes mid puzzle).
  music: { explore: FP_SOUND.musicRealm, puzzle: FP_SOUND.musicRealm, victory: FP_SOUND.musicFinale },
  momentSounds: FIREPEAK_MOMENT_SOUNDS,
  checkpointCue: FP_SOUND.checkpoint,
  recoverCue: FP_SOUND.lavaRespawn,
};

const NORTH_POLE_AUDIO: RegionAudio = {
  zoneAmbience: NORTH_POLE_ZONE_AMBIENCE,
  zonePriority: NORTH_POLE_ZONE_PRIORITY,
  entryAmbience: NP_SOUND.ambientLanding,
  // One theme for exploring and puzzling: the music never changes mid puzzle. `musicForest` is
  // reserved for a Django zone music assignment.
  music: {
    explore: NP_SOUND.musicVillage,
    puzzle: NP_SOUND.musicVillage,
    victory: NP_SOUND.musicCelebration,
  },
  momentSounds: NORTH_POLE_MOMENT_SOUNDS,
  checkpointCue: NP_SOUND.checkpoint,
  recoverCue: NP_SOUND.respawn,
};

export const REGION_AUDIO: Readonly<Record<string, RegionAudio>> = {
  [TREASURE_RUSH_REGION_ID]: TREASURE_RUSH_AUDIO,
  [FIREPEAK_REGION_ID]: FIREPEAK_AUDIO,
  [NORTH_POLE_REGION_ID]: NORTH_POLE_AUDIO,
};

/**
 * The tables for a region. A region with no entry keeps the behaviour every region had before
 * this registry (the Treasure Rush tables), so an unknown id never breaks or silences anything
 * that used to work; its zone ids simply match nothing.
 */
export function regionAudioFor(regionId: string): RegionAudio {
  return REGION_AUDIO[regionId] ?? TREASURE_RUSH_AUDIO;
}

/** The ambience cue for a zone of a region, or null (the current ambience then continues). */
export function zoneAmbienceFor(regionId: string, zoneId: string): string | null {
  return regionAudioFor(regionId).zoneAmbience[zoneId] ?? null;
}

/** The cues a gameplay moment plays in a region (empty when it has no sound there). */
export function momentSoundsFor(regionId: string, cue: SoundCue): readonly string[] {
  return regionAudioFor(regionId).momentSounds[cue] ?? NO_MOMENT;
}
