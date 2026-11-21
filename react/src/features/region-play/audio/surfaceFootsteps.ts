import type {
  WorldEngineEventBus,
  WorldEngineEventMap,
} from '../../island-map/three/worldEngineEvents';

/**
 * GE-074: one footstep sound per step, chosen by the surface underfoot.
 *
 * The live controller emits `PlayerFootstep`; under the engine bridge, `environment.volumes` turns
 * the same step into `SurfaceFootstep { footstepCue }` (`iceStep`, `snowStep`) synchronously, in
 * either listener order. Both are gathered for the current step and decided one microtask later:
 * the region's cue for that surface when it maps one, else the default footstep. Never two sounds
 * for one step; a region with no map plays the default exactly as before.
 */

type Gait = WorldEngineEventMap['PlayerFootstep']['gait'];

export function listenFootsteps(
  bus: Pick<WorldEngineEventBus, 'on'>,
  play: (cue: string, gait: Gait) => void,
  defaultCue: string,
  surfaceCues: Readonly<Record<string, string>> = {},
): () => void {
  // The step being gathered: its gait (from PlayerFootstep) and its surface cue, if any. An event
  // of a kind the pending step already has belongs to the next step, so the pending one is
  // decided first: two steps in one tick are two sounds.
  let gait: Gait | null = null;
  let surfaceCue: string | null = null;
  let surfaceSeen = false;
  let scheduled = false;
  const decide = () => {
    if (gait !== null) play(surfaceCue ?? defaultCue, gait);
    gait = null;
    surfaceCue = null;
    surfaceSeen = false;
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      decide();
    });
  };
  const offStep = bus.on('PlayerFootstep', (step) => {
    if (gait !== null) decide();
    gait = step.gait;
    schedule();
  });
  const offSurface = bus.on('SurfaceFootstep', ({ footstepCue }) => {
    if (surfaceSeen) decide();
    surfaceSeen = true;
    const mapped = footstepCue ? surfaceCues[footstepCue] : undefined;
    surfaceCue = mapped ?? null;
    schedule();
  });
  return () => {
    offStep();
    offSurface();
    gait = null;
  };
}
