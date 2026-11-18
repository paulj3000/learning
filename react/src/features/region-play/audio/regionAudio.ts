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

export const REGION_AUDIO: Readonly<Record<string, RegionAudio>> = {
  [TREASURE_RUSH_REGION_ID]: TREASURE_RUSH_AUDIO,
  [FIREPEAK_REGION_ID]: FIREPEAK_AUDIO,
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
