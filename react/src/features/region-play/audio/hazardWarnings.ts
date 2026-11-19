import type { WorldEngineEventBus } from '../../island-map/three/worldEngineEvents';

/**
 * GE-073F: the audible half of a telegraphed hazard's warning (falling rocks). The engine bridge
 * draws the warning; this plays a region's warning cue when the warning starts (`HazardTelegraph`
 * phase WARN, which lasts at least 1.5 s), only while the child is in the hazard's audio zone, so
 * a rock cycle on the Summit is never heard from the lava. Pure wiring: no timers, no state about
 * the game beyond which zones the engine says the child is in.
 */
export interface HazardWarningCue {
  /** Sound Manager cue id. */
  readonly cue: string;
  /** The audio zone (a `PlayerEnteredZone` id) the child must be in to hear it. */
  readonly zoneId: string;
}

export function listenHazardWarnings(
  bus: WorldEngineEventBus,
  play: (cue: string) => void,
  warnings: Readonly<Record<string, HazardWarningCue>>,
): () => void {
  const inside = new Set<string>();
  const offs = [
    bus.on('PlayerEnteredZone', ({ zoneId }) => inside.add(zoneId)),
    bus.on('PlayerLeftZone', ({ zoneId }) => inside.delete(zoneId)),
    bus.on('HazardTelegraph', ({ hazardId, phase }) => {
      if (phase !== 'WARN') return;
      const warning = Object.hasOwn(warnings, hazardId) ? warnings[hazardId] : undefined;
      if (warning && inside.has(warning.zoneId)) play(warning.cue);
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
