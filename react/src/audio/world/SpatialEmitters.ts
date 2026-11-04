import type { ListenerPose, SoundHandle, SoundPlayer, SpatialOptions, Vec3 } from '../AudioTypes';
import { DEFAULT_SPATIAL } from '../spatial';

/**
 * Reusable positional sound emitters (SM-P7). They attach a sound to a place in a scene and keep it
 * there, with no knowledge of any game or of Three.js: a position is read through a function, so
 * the same code serves a chest, a character, a waterfall or anything else that has a place.
 *
 * - **No React and no per-frame renders.** `update()` is called from the scene's frame loop; it
 *   re-reads each position into a preallocated tuple and only tells the engine when it moved.
 * - **Static and moving sources** use the same path; a static one simply never moves.
 * - **Loops are range-aware.** A looping emitter plays only while the listener is within its
 *   `maxDistance` (plus a little hysteresis), stops itself beyond it and resumes on return, so a
 *   scene full of distant waterfalls costs nothing.
 * - **Cleanup.** Removing an emitter, its source going away (`read` returns false), or the scope
 *   being disposed stops the sound; nothing keeps a reference to the scene object, only the reader
 *   the caller supplied, which `remove`/`dispose` drop.
 * - **Missing audio is silent.** A sound that cannot play is simply absent; the emitter stays and
 *   does not retry in a loop.
 */

/** Writes the source's current world position into `out`. Returns false once the source is gone. */
export type PositionReader = (out: [number, number, number]) => boolean;

export interface EmitterConfig {
  id: string;
  soundId: string;
  read: PositionReader;
  /** Loop until removed (default false: `start()` plays once). */
  loop?: boolean;
  /** Distances and directionality; the position always comes from `read`. */
  spatial?: Omit<SpatialOptions, 'position'>;
  /** Called when the source disappeared and the emitter removed itself. */
  onGone?(): void;
}

export interface Emitter {
  readonly id: string;
  readonly playing: boolean;
  /** Plays a one-shot emitter (a loop starts by itself when in range). */
  start(): Promise<void>;
  /** Stops the sound and forgets the source. */
  remove(): void;
}

export interface SpatialEmittersOptions {
  player: SoundPlayer & { readonly disposed?: boolean };
  /** Metres past `maxDistance` before a loop stops, and back inside it before it resumes. */
  hysteresis?: number;
  /** Ignore moves smaller than this many metres. */
  epsilon?: number;
  /** Tells the engine where the listener is (usually `manager.setListener`). */
  setListener?(pose: ListenerPose): void;
}

export interface SpatialEmitters {
  add(config: EmitterConfig): Emitter;
  /** Plays a sound once at a place and forgets it. Resolves its handle, or null. */
  playAt(
    soundId: string,
    at: Vec3,
    spatial?: Omit<SpatialOptions, 'position'>,
  ): Promise<SoundHandle | null>;
  /** The listener moved. The pose object may be reused by the caller every frame. */
  setListener(pose: ListenerPose): void;
  /** Call once per frame. Allocation-free when nothing moves. */
  update(): void;
  readonly size: number;
  dispose(): void;
}

interface Entry {
  config: EmitterConfig;
  pos: [number, number, number];
  last: [number, number, number];
  handle: SoundHandle | null;
  pending: boolean;
  /** A sound that could not play is not retried until the emitter leaves and re-enters range. */
  failed: boolean;
  inRange: boolean;
  removed: boolean;
  generation: number;
}

export function createSpatialEmitters(options: SpatialEmittersOptions): SpatialEmitters {
  const { player } = options;
  const hysteresis = options.hysteresis ?? 2;
  const epsilon = options.epsilon ?? 0.01;
  const entries = new Map<string, Entry>();
  let pose: ListenerPose | null = null;
  let disposed = false;

  const rangeOf = (entry: Entry) =>
    entry.config.spatial?.maxDistance ?? DEFAULT_SPATIAL.maxDistance;

  function distanceToListener(position: readonly [number, number, number]): number {
    if (!pose) return 0;
    const dx = position[0] - pose.position[0];
    const dy = position[1] - pose.position[1];
    const dz = position[2] - pose.position[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function stopSound(entry: Entry): void {
    entry.generation += 1;
    const handle = entry.handle;
    entry.handle = null;
    entry.pending = false;
    handle?.stop({ fadeOutMs: 120 });
  }

  async function startSound(entry: Entry, once: boolean): Promise<void> {
    if (entry.pending || entry.handle || entry.removed || disposed) return;
    entry.pending = true;
    const mine = (entry.generation += 1);
    const handle = await player.play(entry.config.soundId, {
      loop: once ? false : entry.config.loop,
      spatial: { ...entry.config.spatial, position: [...entry.pos] as unknown as Vec3 },
    });
    if (mine !== entry.generation || entry.removed || disposed) {
      handle?.stop(); // removed, out of range or disposed while loading
      return;
    }
    entry.pending = false;
    if (!handle) {
      entry.failed = true;
      return;
    }
    entry.handle = handle;
    void handle.whenEnded().then((reason) => {
      if (entry.handle !== handle) return;
      entry.handle = null;
      // A one-shot that finished, or a loop the engine stopped, is not restarted by itself.
      if (reason !== 'finished') entry.failed = entry.config.loop === true;
    });
  }

  function removeEntry(entry: Entry, notify: boolean): void {
    if (entry.removed) return;
    entry.removed = true;
    stopSound(entry);
    entries.delete(entry.config.id);
    if (notify) entry.config.onGone?.();
  }

  const api: SpatialEmitters = {
    add(config) {
      const previous = entries.get(config.id);
      if (previous) removeEntry(previous, false);
      const entry: Entry = {
        config,
        pos: [0, 0, 0],
        last: [NaN, NaN, NaN],
        handle: null,
        pending: false,
        failed: false,
        inRange: false,
        removed: false,
        generation: 0,
      };
      if (disposed || !config.read(entry.pos)) {
        entry.removed = true;
        return { id: config.id, playing: false, start: async () => undefined, remove() {} };
      }
      entries.set(config.id, entry);
      entry.last = [...entry.pos];
      entry.inRange = distanceToListener(entry.pos) <= rangeOf(entry);
      if (config.loop && entry.inRange) void startSound(entry, false);
      return {
        id: config.id,
        get playing() {
          return entry.handle !== null;
        },
        start: () => startSound(entry, !config.loop),
        remove: () => removeEntry(entry, false),
      };
    },

    async playAt(soundId, at, spatial) {
      if (disposed) return null;
      return player.play(soundId, { spatial: { ...spatial, position: at } });
    },

    setListener(next) {
      pose = next;
      options.setListener?.(next);
    },

    update() {
      if (disposed) return;
      if (player.disposed) {
        api.dispose();
        return;
      }
      for (const entry of [...entries.values()]) {
        if (!entry.config.read(entry.pos)) {
          removeEntry(entry, true);
          continue;
        }
        const [x, y, z] = entry.pos;
        const moved =
          Math.abs(x - entry.last[0]) > epsilon ||
          Math.abs(y - entry.last[1]) > epsilon ||
          Math.abs(z - entry.last[2]) > epsilon;
        if (moved) {
          entry.last[0] = x;
          entry.last[1] = y;
          entry.last[2] = z;
          entry.handle?.setPosition(x, y, z);
        }
        if (!entry.config.loop) continue;
        const distance = distanceToListener(entry.pos);
        const range = rangeOf(entry);
        if (entry.inRange && distance > range + hysteresis) {
          entry.inRange = false;
          entry.failed = false;
          stopSound(entry);
        } else if (!entry.inRange && distance <= range) {
          entry.inRange = true;
          void startSound(entry, false);
        }
      }
    },

    get size() {
      return entries.size;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of [...entries.values()]) removeEntry(entry, false);
      entries.clear();
    },
  };
  return api;
}
