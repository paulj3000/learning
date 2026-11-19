/**
 * Pure crossfade and locomotion blend math (GE-030). No Three.js: weights are plain records
 * keyed by clip name, so everything here is testable without a mixer.
 *
 * Invariants: weights are finite, non-negative and sum to 1 (or are empty); an interruption
 * mid-fade starts the next fade from the weights the previous one had reached, so the pose
 * never pops.
 */

export type ClipWeights = Readonly<Record<string, number>>;

const EPSILON = 1e-4;

/** Weights scaled to sum to 1; negative and non-finite entries become 0; tiny ones are dropped. */
export function normaliseWeights(weights: ClipWeights): Record<string, number> {
  let total = 0;
  const cleaned: Record<string, number> = {};
  for (const [name, value] of Object.entries(weights)) {
    if (Number.isFinite(value) && value > EPSILON) {
      cleaned[name] = value;
      total += value;
    }
  }
  if (total <= 0) {
    return {};
  }
  for (const name of Object.keys(cleaned)) {
    cleaned[name] = cleaned[name]! / total;
  }
  return cleaned;
}

/** `from` to `to` by `t` (0 to 1), over the union of their clips, normalised. */
export function lerpWeights(from: ClipWeights, to: ClipWeights, t: number): Record<string, number> {
  const k = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 1));
  const mixed: Record<string, number> = {};
  for (const name of new Set([...Object.keys(from), ...Object.keys(to)])) {
    mixed[name] = (from[name] ?? 0) * (1 - k) + (to[name] ?? 0) * k;
  }
  return normaliseWeights(mixed);
}

/** Smoothstep, so a fade eases in and out instead of starting and stopping abruptly. */
export function easeFade(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
}

/**
 * A crossfade between clip weight sets. `retarget` begins a fade from wherever the weights
 * are now (an interruption never snaps); `setTarget` moves the target of the running fade
 * without restarting it (the continuously changing locomotion mix).
 */
export class CrossfadeBlender {
  private from: Record<string, number> = {};
  private target: Record<string, number> = {};
  private current: Record<string, number> = {};
  private elapsed = 0;
  private duration = 0;

  get weights(): ClipWeights {
    return this.current;
  }

  /** Whether a fade is still in progress. */
  get fading(): boolean {
    return this.elapsed < this.duration;
  }

  /** Jump straight to `target` (a first frame, a teleport). */
  snap(target: ClipWeights): void {
    this.target = normaliseWeights(target);
    this.current = { ...this.target };
    this.from = { ...this.target };
    this.elapsed = 0;
    this.duration = 0;
  }

  /** Start a fade to `target` over `seconds`, from the current weights. */
  retarget(target: ClipWeights, seconds: number): void {
    this.from = { ...this.current };
    this.target = normaliseWeights(target);
    this.elapsed = 0;
    this.duration = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    if (this.duration === 0) {
      this.current = { ...this.target };
    }
  }

  /** Change the target without restarting the fade. */
  setTarget(target: ClipWeights): void {
    this.target = normaliseWeights(target);
    if (this.duration === 0 || this.elapsed >= this.duration) {
      this.current = { ...this.target };
    }
  }

  advance(deltaSeconds: number): ClipWeights {
    const dt = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
    if (this.elapsed < this.duration) {
      this.elapsed = Math.min(this.duration, this.elapsed + dt);
      this.current = lerpWeights(this.from, this.target, easeFade(this.elapsed / this.duration));
    } else {
      this.current = { ...this.target };
    }
    return this.current;
  }
}

// --- locomotion ----------------------------------------------------------------------------

export interface LocomotionSpec {
  /** Top walking speed, m/s. */
  walkSpeed: number;
  /** Running speed, m/s (the sprint pace may exceed it; the weights saturate). */
  runSpeed: number;
  /** Whether the avatar has its own run clip. Without it the walk cycle stands in, sped up. */
  hasRun: boolean;
  /** Under this speed the avatar stands still. Default 0.2 m/s. */
  idleBelow?: number;
}

export interface LocomotionBlend {
  /** Weights over the roles `idle`, `walk` and `run`. */
  readonly weights: Readonly<{ idle: number; walk: number; run: number }>;
  /** Playback speed multipliers so the feet match the ground (no skating). */
  readonly timeScale: Readonly<{ walk: number; run: number }>;
}

const MIN_WALK_TIME_SCALE = 0.6;
const MAX_WALK_TIME_SCALE = 1.25;
const MAX_WALK_AS_RUN_TIME_SCALE = 1.7;
const MIN_RUN_TIME_SCALE = 0.8;
const MAX_RUN_TIME_SCALE = 1.3;

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : 1;
}

/**
 * Speed-matched walk and run blending by the **achieved** horizontal speed (zero into a wall:
 * the feet stop with the body). Idle fades into walk across a short band above `idleBelow`;
 * walk fades into run between `walkSpeed` and `runSpeed`. With no run clip the walk cycle
 * covers the run band, sped up to at most 1.7x.
 */
export function locomotionBlend(speed: number, spec: LocomotionSpec): LocomotionBlend {
  const s = Number.isFinite(speed) && speed > 0 ? speed : 0;
  const idleBelow = spec.idleBelow ?? 0.2;
  const walk = Math.max(spec.walkSpeed, idleBelow + 0.1);
  const run = Math.max(spec.runSpeed, walk + 0.1);
  const band = Math.min(0.4, walk - idleBelow);

  const moving = clamp((s - idleBelow) / band, 0, 1);
  const running = spec.hasRun ? clamp((s - walk) / (run - walk), 0, 1) : 0;
  const weights = { idle: 1 - moving, walk: moving * (1 - running), run: moving * running };
  const walkScale = clamp(s / walk, MIN_WALK_TIME_SCALE, spec.hasRun ? MAX_WALK_TIME_SCALE : MAX_WALK_AS_RUN_TIME_SCALE);
  const runScale = clamp(s / run, MIN_RUN_TIME_SCALE, MAX_RUN_TIME_SCALE);
  return { weights, timeScale: { walk: walkScale, run: runScale } };
}
