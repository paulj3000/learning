import { describe, expect, it } from 'vitest';
import {
  FIREPEAK_REGION_ID,
  FIREPEAK_ZONE_AMBIENCE,
  FP_SOUND,
  REGION_AUDIO,
  TREASURE_RUSH_REGION_ID,
  momentSoundsFor,
  regionAudioFor,
  zoneAmbienceFor,
} from './regionAudio';
import { puzzleSolveCues } from '../soundCues';
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

  it('keeps each realm finale to its own realm (GE-070 QA item 18)', () => {
    // Returning to Pip with the treasure completes Pip's quest; the Treasure Rush finale is its
    // own (TR-14, on main since 2026-11-03), never a Firepeak cue.
    const tr = regionAudioFor(TREASURE_RUSH_REGION_ID);
    expect(momentSoundsFor(TREASURE_RUSH_REGION_ID, 'questComplete')).toEqual([TR_SOUND.questComplete]);
    expect(tr.music.victory).toBe(TR_SOUND.musicVictory);
    const firepeakCues = new Set<string>(Object.values(FP_SOUND));
    const trCues = [
      ...Object.values(tr.momentSounds).flat(),
      ...Object.values(tr.music),
      ...Object.values(tr.zoneAmbience),
      tr.entryAmbience,
      tr.checkpointCue,
      tr.recoverCue,
    ];
    expect(trCues.filter((cue) => cue && firepeakCues.has(cue))).toEqual([]);
    // A solve that finishes no quest raises no finale anywhere.
    expect(puzzleSolveCues('OBSERVE_FEATURES', { correct: true, solvedNow: true, questUpdates: [{ justCompleted: false }] })).not.toContain('questComplete');
    expect(puzzleSolveCues('OBSERVE_FEATURES', { correct: true, solvedNow: true, questUpdates: [{ justCompleted: true }] })).toContain('questComplete');
  });

  it('falls back silently for an unknown region', () => {
    expect(() => regionAudioFor('nowhere')).not.toThrow();
    expect(regionAudioFor('nowhere')).toBe(regionAudioFor(TREASURE_RUSH_REGION_ID));
    expect(zoneAmbienceFor('nowhere', 'lava-crossing')).toBeNull();
    expect(zoneAmbienceFor('', '')).toBeNull();
    expect(momentSoundsFor('nowhere', 'puzzleComplete')).toEqual([]);
  });
});
