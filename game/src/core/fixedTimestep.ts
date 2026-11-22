/**
 * Fixed-timestep simulation clock.
 *
 * The shared movement controller already integrates in 1/120 s substeps internally
 * (`jumpConfiguration.ts`, "physics substep"). This clock lifts that discipline to the whole
 * runtime: gameplay systems step at a fixed `stepSeconds`, independent of display frame rate,
 * and presentation receives an interpolation `alpha` in [0, 1).
 *
 * Safety rails:
 * - A long frame (a background tab, a debugger pause, a slow device) is clamped to
 *   `maxFrameSeconds`, and at most `maxStepsPerFrame` steps run per frame. The surplus is
 *   dropped, never queued, so the world slows down instead of spiralling.
 * - A non-finite, negative or zero frame delta is ignored.
 *
 * Pure: the host passes real time in, so tests drive it with exact numbers.
 */

export interface FixedTimestepOptions {
  /** Simulation step, seconds. Default 1/60. Must be within [1/480, 1/15]. */
  stepSeconds?: number;
  /** Largest real-time frame delta accepted, seconds. Default 0.25. */
  maxFrameSeconds?: number;
  /** Most simulation steps run for one frame. Default 8. */
  maxStepsPerFrame?: number;
}

export interface FixedTimestepFrame {
  /** Simulation steps to run this frame, each `stepSeconds` long. */
  steps: number;
  stepSeconds: number;
  /** Fraction of a step left over, for render interpolation. */
  alpha: number;
  /** Real seconds discarded this frame by the clamps (diagnostics). */
  droppedSeconds: number;
}

export interface FixedTimestepClock {
  readonly stepSeconds: number;
  /** Advances by a real-time delta (seconds) and reports how many steps to run. */
  advance(frameSeconds: number): FixedTimestepFrame;
  /** Forgets accumulated time (on resume, so a pause is not replayed as a burst). */
  reset(): void;
  /** Total simulated seconds since creation or `reset`. */
  readonly simulatedSeconds: number;
}

export const DEFAULT_STEP_SECONDS = 1 / 60;
const MIN_STEP = 1 / 480;
const MAX_STEP = 1 / 15;

export function createFixedTimestepClock(options: FixedTimestepOptions = {}): FixedTimestepClock {
  const stepSeconds = options.stepSeconds ?? DEFAULT_STEP_SECONDS;
  if (!Number.isFinite(stepSeconds) || stepSeconds < MIN_STEP || stepSeconds > MAX_STEP) {
    throw new RangeError(
      `stepSeconds must be between ${MIN_STEP} and ${MAX_STEP}; got ${stepSeconds}`,
    );
  }
  const maxFrameSeconds = options.maxFrameSeconds ?? 0.25;
  const maxStepsPerFrame = Math.max(1, Math.floor(options.maxStepsPerFrame ?? 8));
  let accumulator = 0;
  let simulated = 0;

  return {
    stepSeconds,
    get simulatedSeconds() {
      return simulated;
    },
    advance(frameSeconds) {
      if (!Number.isFinite(frameSeconds) || frameSeconds <= 0) {
        return { steps: 0, stepSeconds, alpha: accumulator / stepSeconds, droppedSeconds: 0 };
      }
      let dropped = 0;
      let delta = frameSeconds;
      if (delta > maxFrameSeconds) {
        dropped += delta - maxFrameSeconds;
        delta = maxFrameSeconds;
      }
      accumulator += delta;
      // A tiny epsilon keeps 3 x (1/60) from yielding 2 steps through float error.
      let steps = Math.floor(accumulator / stepSeconds + 1e-9);
      if (steps > maxStepsPerFrame) {
        dropped += (steps - maxStepsPerFrame) * stepSeconds;
        steps = maxStepsPerFrame;
        accumulator = Math.min(accumulator - steps * stepSeconds, stepSeconds * 0.999);
      } else {
        accumulator -= steps * stepSeconds;
      }
      if (accumulator < 0) {
        accumulator = 0;
      }
      simulated += steps * stepSeconds;
      return {
        steps,
        stepSeconds,
        alpha: Math.min(accumulator / stepSeconds, 0.999999),
        droppedSeconds: dropped,
      };
    },
    reset() {
      accumulator = 0;
    },
  };
}
