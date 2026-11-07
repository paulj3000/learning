import { createMusicDirector, type MusicDirector } from '../music/MusicDirector';
import type { SoundPlayer } from '../AudioTypes';
import type { ManifestAssignment } from '../manifest/manifestTypes';

/**
 * Environmental audio zones (SM-P7). A game reports "entered zone X" and "left zone X" (from its
 * own location or region state, not from here), and the zones pick one ambient bed.
 *
 * - **Overlap.** Several zones can be active at once. The bed comes from the active zone with the
 *   highest `priority`; ties go to the most recently entered. A zone with no cue is skipped, so a
 *   quiet zone inside a noisy one keeps the noisy bed.
 * - **Fallback.** With no active zone that has a cue, `defaultCue` plays; with none of those, the
 *   bed fades to silence.
 * - **Transitions** are true crossfades through the shared `MusicDirector`, so a bed is never
 *   doubled, a rapid run of entries and exits ends on the right bed, and a bed that is already
 *   playing is never restarted by re-entering a zone that shares it.
 * - **Cleanup.** `dispose()` (or disposing the scope) stops the bed and ignores later events.
 */

export interface ZoneSpec {
  id: string;
  /** The logical ambient cue, or none for a zone that adds no sound of its own. */
  cue?: string;
  priority?: number;
}

export interface AudioZonesOptions {
  player: SoundPlayer;
  zones: readonly ZoneSpec[];
  /** Played when no active zone provides a bed (for example the area's own ambience). */
  defaultCue?: string;
  fadeMs?: number;
  /** Play the first bed at once (default). A React hook passes false and calls `activate()`. */
  autoStart?: boolean;
}

export interface AudioZones {
  enter(zoneId: string): void;
  exit(zoneId: string): void;
  /** Replaces the zone table (a new manifest). The bed is re-resolved. */
  setZones(zones: readonly ZoneSpec[]): void;
  /** Zones the listener is in now, oldest first. */
  readonly active: readonly string[];
  /** The cue the bed should be, or null for silence. */
  readonly cue: string | null;
  /** Tries the wanted bed again if nothing is playing (a new manifest arrived). */
  retry(): void;
  /** Stops sound but remembers which zones are active. */
  deactivate(): void;
  activate(): void;
  dispose(): void;
}

export function createAudioZones(options: AudioZonesOptions): AudioZones {
  const director: MusicDirector = createMusicDirector({
    player: options.player,
    crossfadeMs: options.fadeMs ?? 1500,
    // A zone whose bed has no audio falls back to the default bed instead of going silent.
    onUnavailable(target) {
      const fallback = options.defaultCue;
      if (fallback && target.sound && target.sound !== fallback && target.sound === current) {
        void director.play({ sound: fallback });
      }
    },
  });
  let zones = new Map(options.zones.map((zone) => [zone.id, zone]));
  const active: string[] = [];
  let current: string | null = null;
  let disposed = false;
  let running = options.autoStart !== false;

  function resolve(): string | null {
    let best: ZoneSpec | null = null;
    // Walk oldest to newest so a later entry wins a tie.
    for (const id of active) {
      const zone = zones.get(id);
      if (!zone?.cue) continue;
      if (!best || (zone.priority ?? 0) >= (best.priority ?? 0)) best = zone;
    }
    return best?.cue ?? options.defaultCue ?? null;
  }

  function apply(): void {
    if (disposed) return;
    const next = resolve();
    if (next === current) return;
    current = next;
    if (!running) return;
    if (next === null) director.stop({ fadeMs: options.fadeMs ?? 1500 });
    else void director.play({ sound: next });
  }

  const api: AudioZones = {
    enter(zoneId) {
      if (disposed || !zones.has(zoneId)) return;
      const at = active.indexOf(zoneId);
      if (at >= 0) active.splice(at, 1); // re-entering makes it the most recent
      active.push(zoneId);
      apply();
    },
    exit(zoneId) {
      if (disposed) return;
      const at = active.indexOf(zoneId);
      if (at < 0) return;
      active.splice(at, 1);
      apply();
    },
    setZones(next) {
      zones = new Map(next.map((zone) => [zone.id, zone]));
      for (let i = active.length - 1; i >= 0; i -= 1) {
        if (!zones.has(active[i] as string)) active.splice(i, 1);
      }
      apply();
    },
    get active() {
      return active;
    },
    get cue() {
      return current;
    },
    retry() {
      if (!disposed && running) void director.retry();
    },
    deactivate() {
      running = false;
      director.deactivate();
    },
    activate() {
      if (disposed || running) return;
      running = true;
      current = resolve();
      void director.activate().then(() => {
        const want = current;
        if (want === null) director.stop({ fadeMs: options.fadeMs ?? 1500 });
        else if (director.wanted?.sound !== want) void director.play({ sound: want });
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      director.deactivate();
    },
  };
  // The first bed is the default, before any zone is entered.
  current = resolve();
  if (running && current) void director.play({ sound: current });
  return api;
}

/** Zone specs from a published manifest: assignments on target `zone`, event `on_enter`. */
export function zonesFromAssignments(assignments: readonly ManifestAssignment[]): ZoneSpec[] {
  return assignments
    .filter((a) => a.targetType === 'zone' && a.event === 'on_enter')
    .map((a) => ({ id: a.targetId, cue: a.soundId, priority: a.priority ?? 0 }));
}
