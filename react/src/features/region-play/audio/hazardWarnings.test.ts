import { describe, expect, it } from 'vitest';
import { WorldEngineEventBus } from '../../island-map/three/worldEngineEvents';
import { listenHazardWarnings } from './hazardWarnings';
import { FIREPEAK_REGION_ID, FP_SOUND, regionAudioFor } from './regionAudio';

describe('falling-rock warning sound (GE-073F)', () => {
  const warnings = regionAudioFor(FIREPEAK_REGION_ID).hazardWarnings ?? {};
  const rock = Object.keys(warnings)[0]!;

  it('Firepeak names a rumble for each rock, heard on the Summit', () => {
    expect(Object.keys(warnings).length).toBeGreaterThan(0);
    for (const warning of Object.values(warnings))
      expect(warning).toEqual({ cue: FP_SOUND.rockRumble, zoneId: 'firepeak-summit' });
  });

  it('plays when a warning starts while the child is on the Summit, and only then', () => {
    const bus = new WorldEngineEventBus();
    const played: string[] = [];
    const off = listenHazardWarnings(bus, (cue) => played.push(cue), warnings);
    const telegraph = (phase: 'WARN' | 'ACTIVE' | 'REST', hazardId = rock) =>
      bus.emit('HazardTelegraph', { hazardId, phase, secondsToImpact: 1.5, steadyWarning: false });
    telegraph('WARN'); // the child is at the lava: silent
    bus.emit('PlayerEnteredZone', { zoneId: 'firepeak-summit' });
    telegraph('WARN');
    telegraph('ACTIVE');
    telegraph('REST');
    telegraph('WARN', 'fh-lava-hazard'); // not a telegraphed rock: silent
    telegraph('WARN', 'toString'); // never reads the prototype
    bus.emit('PlayerLeftZone', { zoneId: 'firepeak-summit' });
    telegraph('WARN');
    expect(played).toEqual([FP_SOUND.rockRumble]);
    off();
    bus.emit('PlayerEnteredZone', { zoneId: 'firepeak-summit' });
    telegraph('WARN');
    expect(played).toHaveLength(1);
  });
});
