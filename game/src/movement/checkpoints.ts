/**
 * Course checkpoints (GE-020): a pure tracker with no scene and no clock.
 *
 * It records which checkpoints a child has reached and which is the recovery point, and its
 * `recoveryPoint()` plugs straight into `FirstPersonController`'s `recoveryPoint` option. Safe
 * ground memory (the last place the child stood safely, honouring `isSafeGround`) lives in the
 * controller itself (`lastSafe`), so a recovery with no checkpoint still goes somewhere safe.
 *
 * `reset()` forgets checkpoints only. It never touches items, quest or progress state: a
 * respawn loses nothing the child earned (jumping standard, "safe recovery"). Checkpoints are
 * never on moving or vanishing platforms: `validateCheckpoints` rejects them.
 */

import type { ValidationIssue } from '../core/errors';

export type CheckpointSurface = 'GROUND' | 'MOVING' | 'VANISHING';

export interface CheckpointSpec {
  /** Semantic id, unique in the course. */
  readonly id: string;
  /** Child-facing label (readable aloud). */
  readonly label?: string;
  readonly x: number;
  readonly z: number;
  /** Facing when put back, radians. */
  readonly yaw?: number;
  /** What the checkpoint sits on. Moving and vanishing supports are invalid. Default GROUND. */
  readonly surface?: CheckpointSurface;
}

export type CheckpointResume = 'LATEST' | 'FURTHEST';

export interface CheckpointOptions {
  /** How close counts as reached, metres. Default 1.5. */
  reach?: number;
  /** Which reached checkpoint a recovery uses. Default the latest reached. */
  resume?: CheckpointResume;
}

export const DEFAULT_CHECKPOINT_REACH = 1.5;
export const CHECKPOINT_REACH_LIMITS = Object.freeze({ min: 0.5, max: 6 });

export function validateCheckpoints(specs: readonly CheckpointSpec[], path = 'checkpoints'): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  specs.forEach((spec, index) => {
    const at = `${path}[${index}]`;
    if (typeof spec.id !== 'string' || spec.id.trim() === '') {
      issues.push({ path: `${at}.id`, message: 'needs a non-empty id' });
    } else if (seen.has(spec.id)) {
      issues.push({ path: `${at}.id`, message: `duplicate checkpoint id "${spec.id}"` });
    } else {
      seen.add(spec.id);
    }
    if (!Number.isFinite(spec.x) || !Number.isFinite(spec.z)) {
      issues.push({ path: at, message: 'needs finite x and z' });
    }
    if (spec.yaw !== undefined && !Number.isFinite(spec.yaw)) {
      issues.push({ path: `${at}.yaw`, message: 'must be a number' });
    }
    if (spec.surface !== undefined && spec.surface !== 'GROUND') {
      issues.push({ path: `${at}.surface`, message: 'checkpoints are never on moving or vanishing platforms' });
    }
  });
  return issues;
}

export interface RecoveryPoint {
  x: number;
  z: number;
  yaw?: number;
}

export class CheckpointTracker {
  private readonly specs: readonly CheckpointSpec[];
  private readonly reachRadius: number;
  private readonly resume: CheckpointResume;
  private readonly reached = new Set<string>();
  private latestId: string | null = null;

  constructor(specs: readonly CheckpointSpec[], options: CheckpointOptions = {}) {
    this.specs = specs.slice();
    const reach = options.reach;
    this.reachRadius =
      typeof reach === 'number' && Number.isFinite(reach)
        ? Math.min(CHECKPOINT_REACH_LIMITS.max, Math.max(CHECKPOINT_REACH_LIMITS.min, reach))
        : DEFAULT_CHECKPOINT_REACH;
    this.resume = options.resume ?? 'LATEST';
  }

  /** Marks a checkpoint reached. Returns false when unknown or already reached. */
  reach(id: string): boolean {
    if (!this.specs.some((s) => s.id === id) || this.reached.has(id)) {
      return false;
    }
    this.reached.add(id);
    this.latestId = id;
    return true;
  }

  /** Reaches every checkpoint within range of (x, z). Returns the newly reached specs, in course order. */
  update(x: number, z: number): CheckpointSpec[] {
    const fresh: CheckpointSpec[] = [];
    for (const spec of this.specs) {
      if (this.reached.has(spec.id)) {
        continue;
      }
      if (Math.hypot(spec.x - x, spec.z - z) <= this.reachRadius && this.reach(spec.id)) {
        fresh.push(spec);
      }
    }
    return fresh;
  }

  /** The reached checkpoint a recovery would use (latest, or furthest along the course). */
  current(): CheckpointSpec | null {
    if (this.resume === 'LATEST') {
      return this.specs.find((s) => s.id === this.latestId) ?? null;
    }
    let best: CheckpointSpec | null = null;
    for (const spec of this.specs) {
      if (this.reached.has(spec.id)) {
        best = spec;
      }
    }
    return best;
  }

  /** Where to put a lost child, or null (the controller then uses its last safe ground). */
  recoveryPoint = (): RecoveryPoint | null => {
    const spec = this.current();
    if (!spec) {
      return null;
    }
    return spec.yaw === undefined ? { x: spec.x, z: spec.z } : { x: spec.x, z: spec.z, yaw: spec.yaw };
  };

  hasReached(id: string): boolean {
    return this.reached.has(id);
  }

  reachedIds(): string[] {
    return this.specs.filter((s) => this.reached.has(s.id)).map((s) => s.id);
  }

  /** Restores reached checkpoints (a resumed session). Unknown ids are ignored. */
  restore(ids: readonly string[]): void {
    this.reset();
    for (const id of ids) {
      this.reach(id);
    }
  }

  /** Forgets checkpoints only. Never touches items, quest or progress state. */
  reset(): void {
    this.reached.clear();
    this.latestId = null;
  }
}
