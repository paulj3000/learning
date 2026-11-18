import { describe, expect, it } from 'vitest';
import {
  FIREPEAK_REGION_ID,
  FIREPEAK_ZONE_AMBIENCE,
  FP_SOUND,
  NORTH_POLE_MOMENT_SOUNDS,
  NORTH_POLE_REGION_ID,
  NORTH_POLE_ZONE_AMBIENCE,
  NORTH_POLE_ZONE_PRIORITY,
  NP_SOUND,
  REGION_AUDIO,
  TREASURE_RUSH_REGION_ID,
  momentSoundsFor,
  regionAudioFor,
  zoneAmbienceFor,
} from './regionAudio';
import { builtInZonesFor, mergeZones } from './useTreasureRushAudio';
import {
  CUE_SOUNDS,
  ENTRY_AMBIENCE,
  MUSIC_CUES,
  TR_SOUND,
  ZONE_AMBIENCE,
  ZONE_PRIORITY,
} from './treasureRushSounds';

const FIREPEAK_ZONES = [
  'explorers-landing',
  'emberwood-forest',
  'lava-crossing',
  'crystal-caverns',
  'ancient-forge',
  'firepeak-summit',
  'heart-chamber',
];
const NORTH_POLE_ZONES = [
  'santas-landing',
  'christmas-village',
  'santas-workshop',
  'candy-cane-forest',
  'frozen-lake',
  'reindeer-stables',
  'gingerbread-village',
  'north-road',
  'snowflake-mountain',
  'north-pole-observatory',
];
const CUE_ID = /^(music|ambient|sfx|voice|ui)(\.[a-z0-9_]{1,30}){1,4}$/;

describe('region audio registry', () => {
  it('keeps Treasure Rush exactly as it was', () => {
    const tr = regionAudioFor(TREASURE_RUSH_REGION_ID);
    expect(tr.zoneAmbience).toBe(ZONE_AMBIENCE);
    expect(tr.zonePriority).toBe(ZONE_PRIORITY);
    expect(tr.entryAmbience).toBe(ENTRY_AMBIENCE);
    expect(tr.music).toBe(MUSIC_CUES);
    expect(tr.momentSounds).toBe(CUE_SOUNDS);
    expect(tr.checkpointCue).toBe(TR_SOUND.checkpoint);
    expect(tr.recoverCue).toBe(TR_SOUND.playerRecover);
    expect(zoneAmbienceFor(TREASURE_RUSH_REGION_ID, 'cove-zone-ruins')).toBe(TR_SOUND.ambientCave);
    expect(mergeZones([]).map((z) => z.id)).toEqual(Object.keys(ZONE_AMBIENCE));
  });

  it('resolves every Firepeak zone to its ambience', () => {
    expect(Object.keys(FIREPEAK_ZONE_AMBIENCE)).toEqual(FIREPEAK_ZONES);
    for (const zone of FIREPEAK_ZONES) {
      const cue = zoneAmbienceFor(FIREPEAK_REGION_ID, zone);
      expect(cue).toMatch(/^ambient\.firepeak\./);
    }
    expect(zoneAmbienceFor(FIREPEAK_REGION_ID, 'lava-crossing')).toBe(FP_SOUND.ambientLava);
    expect(zoneAmbienceFor(FIREPEAK_REGION_ID, 'cove-zone-ruins')).toBeNull();
    const zones = builtInZonesFor(REGION_AUDIO[FIREPEAK_REGION_ID]);
    expect(zones).toHaveLength(7);
    expect(new Set(zones.map((z) => z.priority)).size).toBe(7);
  });

  it('only names valid cue ids', () => {
    for (const cue of Object.values(FP_SOUND)) expect(cue).toMatch(CUE_ID);
  });

  it('maps the Firepeak moments and checkpoint cues', () => {
    const fp = regionAudioFor(FIREPEAK_REGION_ID);
    expect(fp.checkpointCue).toBe(FP_SOUND.checkpoint);
    expect(fp.recoverCue).toBe(FP_SOUND.lavaRespawn);
    expect(fp.music.victory).toBe(FP_SOUND.musicFinale);
    expect(momentSoundsFor(FIREPEAK_REGION_ID, 'crystalCollect')).toEqual([FP_SOUND.crystalCollect]);
    expect(momentSoundsFor(FIREPEAK_REGION_ID, 'puzzleComplete')).toEqual([FP_SOUND.puzzleComplete]);
    expect(momentSoundsFor(FIREPEAK_REGION_ID, 'restoration')).toEqual([FP_SOUND.restore]);
    expect(momentSoundsFor(FIREPEAK_REGION_ID, 'questComplete')).toEqual([FP_SOUND.complete]);
    expect(momentSoundsFor(FIREPEAK_REGION_ID, 'chestOpen')).toEqual([]);
    expect(momentSoundsFor(TREASURE_RUSH_REGION_ID, 'crystalCollect')).toEqual([]);
  });

  it('resolves every North Pole zone to its ambience', () => {
    expect(Object.keys(NORTH_POLE_ZONE_AMBIENCE)).toEqual(NORTH_POLE_ZONES);
    for (const zone of NORTH_POLE_ZONES) {
      expect(zoneAmbienceFor(NORTH_POLE_REGION_ID, zone)).toMatch(/^ambient\.north_pole\./);
    }
    expect(zoneAmbienceFor(NORTH_POLE_REGION_ID, 'frozen-lake')).toBe(NP_SOUND.ambientLake);
    expect(zoneAmbienceFor(NORTH_POLE_REGION_ID, 'snowflake-mountain')).toBe(
      NP_SOUND.ambientMountain,
    );
    expect(zoneAmbienceFor(NORTH_POLE_REGION_ID, 'lava-crossing')).toBeNull();
    expect(zoneAmbienceFor(FIREPEAK_REGION_ID, 'frozen-lake')).toBeNull();
    expect(zoneAmbienceFor(TREASURE_RUSH_REGION_ID, 'frozen-lake')).toBeNull();
    const zones = builtInZonesFor(REGION_AUDIO[NORTH_POLE_REGION_ID]);
    expect(zones).toHaveLength(10);
    expect(new Set(zones.map((z) => z.priority)).size).toBe(10);
    expect(Object.keys(NORTH_POLE_ZONE_PRIORITY).sort()).toEqual([...NORTH_POLE_ZONES].sort());
    const road = NORTH_POLE_ZONE_PRIORITY['north-road'];
    for (const zone of NORTH_POLE_ZONES) {
      if (zone !== 'north-road') expect(NORTH_POLE_ZONE_PRIORITY[zone]).toBeGreaterThan(road);
    }
  });

  it('only names valid North Pole cue ids, all on the north_pole prefix', () => {
    for (const cue of Object.values(NP_SOUND)) {
      expect(cue).toMatch(CUE_ID);
      expect(cue).toMatch(/^(music|ambient|sfx|voice)\.north_pole\./);
    }
    expect(Object.values(NP_SOUND)).toHaveLength(25);
    expect(new Set(Object.values(NP_SOUND)).size).toBe(25);
  });

  it('maps the North Pole music, entry ambience, moments and checkpoint cues', () => {
    const np = regionAudioFor(NORTH_POLE_REGION_ID);
    expect(np.entryAmbience).toBe(NP_SOUND.ambientLanding);
    expect(np.music).toEqual({
      explore: NP_SOUND.musicVillage,
      puzzle: NP_SOUND.musicVillage,
      victory: NP_SOUND.musicCelebration,
    });
    expect(np.checkpointCue).toBe(NP_SOUND.checkpoint);
    expect(np.recoverCue).toBe(NP_SOUND.respawn);
    expect(momentSoundsFor(NORTH_POLE_REGION_ID, 'keyPickup')).toEqual([NP_SOUND.collect]);
    expect(momentSoundsFor(NORTH_POLE_REGION_ID, 'crystalCollect')).toEqual([NP_SOUND.fragment]);
    expect(momentSoundsFor(NORTH_POLE_REGION_ID, 'answerRight')).toEqual([NP_SOUND.answerRight]);
    expect(momentSoundsFor(NORTH_POLE_REGION_ID, 'answerRetry')).toEqual([NP_SOUND.answerRetry]);
    expect(momentSoundsFor(NORTH_POLE_REGION_ID, 'questComplete')).toEqual([
      NP_SOUND.questComplete,
    ]);
    expect(momentSoundsFor(NORTH_POLE_REGION_ID, 'restoration')).toEqual([NP_SOUND.starRestored]);
    expect(momentSoundsFor(NORTH_POLE_REGION_ID, 'chestOpen')).toEqual([]);
    // Every moment is present, and every cue it plays belongs to North Pole.
    for (const cues of Object.values(NORTH_POLE_MOMENT_SOUNDS)) {
      for (const cue of cues) expect(cue).toContain('.north_pole.');
    }
  });

  it('leaves Treasure Rush and Firepeak untouched by the North Pole entry', () => {
    expect(momentSoundsFor(TREASURE_RUSH_REGION_ID, 'answerRight')).toEqual(
      regionAudioFor(TREASURE_RUSH_REGION_ID).momentSounds.answerRight,
    );
    expect(momentSoundsFor(FIREPEAK_REGION_ID, 'answerRight')).toEqual([]);
    expect(momentSoundsFor(FIREPEAK_REGION_ID, 'keyPickup')).toEqual([]);
    expect(regionAudioFor(FIREPEAK_REGION_ID).recoverCue).toBe(FP_SOUND.lavaRespawn);
    expect(Object.keys(REGION_AUDIO)).toEqual([
      TREASURE_RUSH_REGION_ID,
      FIREPEAK_REGION_ID,
      NORTH_POLE_REGION_ID,
    ]);
  });

  it('falls back silently for an unknown region', () => {
    expect(() => regionAudioFor('nowhere')).not.toThrow();
    expect(regionAudioFor('nowhere')).toBe(regionAudioFor(TREASURE_RUSH_REGION_ID));
    expect(zoneAmbienceFor('nowhere', 'lava-crossing')).toBeNull();
    expect(zoneAmbienceFor('', '')).toBeNull();
    expect(momentSoundsFor('nowhere', 'puzzleComplete')).toEqual([]);
  });
});
