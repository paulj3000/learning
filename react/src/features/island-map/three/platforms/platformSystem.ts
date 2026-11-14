import { Box3, Vector3 } from 'three';
import { areRequirementsMet, type WorldInteractionContext } from '../../worldObjects';
import type { RectZone } from '../runtime/locationManifest';
import {
  advanceMotion,
  copyMotionState,
  createPathMotion,
  initialMotionState,
  motionOffset,
  type PathMotion,
  type PathMotionState,
} from './platformMotion';
import {
  applyTuning,
  type CourseCheckpointSpec,
  type PlatformSpec,
  type PlatformingSpec,
  type PressurePlateSpec,
} from './platformSpec';

/**
 * The shared platform runtime (LAI-JMP-02, LAI-JMP-04; ADR-059). Owns each platform's state and
 * its one collision box, which it registers with the movement controller as a jumpable collider
 * and moves in place every frame. The controller stays authoritative for the child: this only
 * tells it to carry a rider, bounce, or go back to a checkpoint.
 *
 * Safety rules, enforced here rather than trusted to content:
 * - A platform never moves into a child's body (it waits), so nobody is pushed through a wall,
 *   squashed under a lift or trapped between platforms.
 * - A rider is carried with collision tests (`FirstPersonController.carry`), never through walls.
 * - A vanished platform's box is emptied, so no invisible collider is left behind, and it only
 *   comes back when the child is not where it would appear.
 * - Moving, spinning, vanishing and bounce platforms are never remembered as safe ground: a lost
 *   child goes back to the latest course checkpoint (or the last safe ground), never into air.
 * Deterministic: the same time steps give the same motion.
 */

/** What the runtime needs from the movement controller (`FirstPersonController`). */
export interface PlatformPlayer {
  readonly position: { x: number; y: number; z: number };
  readonly grounded: boolean;
  supportingBox(): Box3 | null;
  carry(dx: number, dy: number, dz: number): void;
  inheritVelocity(vx: number, vz: number): void;
  launch(height: number): void;
  recover(reason: 'HAZARD'): void;
}

export type PlatformEvent =
  | { type: 'ACTIVATED'; platformId: string; cue?: string }
  | { type: 'MOVING'; platformId: string; cue?: string }
  | { type: 'STOPPED'; platformId: string; cue?: string }
  | { type: 'VANISHED'; platformId: string }
  | { type: 'APPEARED'; platformId: string }
  | { type: 'BOUNCED'; platformId: string; cue?: string }
  | { type: 'PLATE_PRESSED'; plateId: string }
  | { type: 'PLATE_RELEASED'; plateId: string }
  | { type: 'SWITCH'; entityId: string; on: boolean }
  | { type: 'CHECKPOINT'; checkpointId: string; label: string }
  | { type: 'GOAL'; goalId: string }
  | { type: 'RECOVERED_TO'; checkpointId: string | null };

export interface PlatformSystemOptions {
  /** The controller's live collider list and jumpable set: platforms are added to both. */
  colliders: Box3[];
  jumpable: Set<Box3>;
  worldState: WorldInteractionContext;
  /** Zone rects by id, for `ZONE` triggers. */
  zones: ReadonlyMap<string, RectZone>;
  /** Slower platforms and turntables for children who asked for less motion. */
  reducedMotion?: boolean;
  bodyHeight?: number;
  stepHeight?: number;
}

/** Speed factor for moving platforms and turntables under reduced motion. */
export const REDUCED_MOTION_FACTOR = 0.6;

const DEFAULT_BODY = 1.7;
const DEFAULT_STEP = 0.25;
const EPSILON = 1e-4;
const DEG = Math.PI / 180;

export interface PlatformState {
  readonly spec: PlatformSpec;
  /** The live collision box (empty while the platform is not there). */
  readonly box: Box3;
  /** Bottom centre now. */
  readonly position: Vector3;
  /** Turntable angle, radians (presentation follows it). */
  spinAngle: number;
  /** Present: drawn and solid. */
  present: boolean;
  /** About to vanish: presentation blinks it (or dims it, under reduced motion). */
  warning: boolean;
  active: boolean;
  moving: boolean;
}

interface Runtime extends PlatformState {
  motion: PathMotion | null;
  state: PathMotionState;
  saved: PathMotionState;
  speed: number;
  delayLeft: number;
  triggerWas: boolean;
  everActivated: boolean;
  returning: boolean;
  vanishClock: number;
  hiddenLeft: number;
  standClock: number;
  unsafe: boolean;
}

export interface PlateState {
  readonly spec: PressurePlateSpec;
  pressed: boolean;
}

export class PlatformSystem {
  readonly platforms: readonly PlatformState[];
  readonly plates: readonly PlateState[];
  private readonly runtimes: Runtime[];
  private readonly byBox = new Map<Box3, Runtime>();
  private readonly spec: PlatformingSpec;
  private readonly options: PlatformSystemOptions;
  private readonly body: number;
  private readonly step: number;
  private readonly signals = new Set<string>();
  private readonly switches = new Set<string>();
  private readonly switchIds: ReadonlySet<string>;
  private readonly reachedCheckpoints = new Set<string>();
  private readonly reachedGoals = new Set<string>();
  private readonly insideGoals = new Set<string>();
  private latestCheckpoint: CourseCheckpointSpec | null = null;
  private events: PlatformEvent[] = [];
  private readonly offset = { x: 0, y: 0, z: 0 };
  private readonly candidate = new Box3();
  private readonly before = new Vector3();
  private readonly target = new Vector3();
  private disposed = false;
  /** The platform the child stood on last frame, and its sideways speed then. */
  private lastRider: Runtime | null = null;
  private riderVelocityX = 0;
  private riderVelocityZ = 0;

  constructor(spec: PlatformingSpec, options: PlatformSystemOptions) {
    this.spec = spec;
    this.options = options;
    this.body = options.bodyHeight ?? DEFAULT_BODY;
    this.step = options.stepHeight ?? DEFAULT_STEP;
    const factor = options.reducedMotion ? REDUCED_MOTION_FACTOR : 1;
    this.runtimes = applyTuning(spec).map((platform) => {
      const motion = platform.motion
        ? createPathMotion(platform.motion.path, platform.motion.mode ?? 'PING_PONG', platform.motion.pauseSeconds ?? 0)
        : null;
      const runtime: Runtime = {
        spec: platform,
        box: new Box3(),
        position: new Vector3(platform.position.x, platform.position.y, platform.position.z),
        spinAngle: 0,
        present: true,
        warning: false,
        active: false,
        moving: false,
        motion,
        state: initialMotionState(),
        saved: initialMotionState(),
        speed: (platform.motion?.speed ?? 0) * factor,
        delayLeft: 0,
        triggerWas: false,
        everActivated: false,
        returning: false,
        vanishClock: platform.vanish?.offsetSeconds ?? 0,
        hiddenLeft: 0,
        standClock: 0,
        unsafe: Boolean(platform.motion || platform.spin || platform.vanish || platform.bounce || platform.activation?.hiddenUntilActive),
      };
      runtime.present = !platform.activation?.hiddenUntilActive;
      this.writeBox(runtime);
      options.colliders.push(runtime.box);
      options.jumpable.add(runtime.box);
      this.byBox.set(runtime.box, runtime);
      return runtime;
    });
    this.platforms = this.runtimes;
    this.plates = (spec.pressurePlates ?? []).map((plate) => ({ spec: plate, pressed: false }));
    this.switchIds = new Set(
      this.runtimes
        .filter((runtime) => runtime.spec.activation?.trigger === 'SWITCH')
        .map((runtime) => runtime.spec.activation!.source!),
    );
  }

  /** Signals an activation by name (an educational challenge completed, a quest step done). */
  signal(name: string, on = true): void {
    if (on) this.signals.add(name);
    else this.signals.delete(name);
  }

  /** Whether `entityId` is a switch this system owns (the engine routes its interaction here). */
  isSwitch(entityId: string): boolean {
    return this.switchIds.has(entityId);
  }

  /** Flips a switch; returns its new state. */
  toggleSwitch(entityId: string): boolean {
    const on = !this.switches.has(entityId);
    if (on) this.switches.add(entityId);
    else this.switches.delete(entityId);
    this.events.push({ type: 'SWITCH', entityId, on });
    return on;
  }

  /** The most recent course checkpoint reached this visit, for the controller's recovery. */
  recoveryPoint(): { x: number; z: number; yaw?: number } | null {
    const point = this.latestCheckpoint;
    return point ? { x: point.x, z: point.z, ...(point.yaw !== undefined ? { yaw: point.yaw } : {}) } : null;
  }

  /** The id of the latest course checkpoint reached, or null. */
  latestCheckpointId(): string | null {
    return this.latestCheckpoint?.id ?? null;
  }

  /** Whether standing here may be remembered as safe ground (not on a moving or vanishing platform). */
  isSafeGround(x: number, y: number, z: number): boolean {
    for (const runtime of this.runtimes) {
      if (!runtime.unsafe || !runtime.present) continue;
      const box = runtime.box;
      if (x >= box.min.x && x <= box.max.x && z >= box.min.z && z <= box.max.z && Math.abs(box.max.y - y) < 0.06) {
        return false;
      }
    }
    for (const hazard of this.spec.hazards ?? []) {
      if (inRect(hazard.rect, x, z) && y <= (hazard.belowY ?? 0.05)) return false;
    }
    return true;
  }

  /** The platform a box belongs to, if it is one of these. */
  platformOf(box: Box3 | null): PlatformState | null {
    return box ? (this.byBox.get(box) ?? null) : null;
  }

  /** Drains this frame's events. */
  consumeEvents(): PlatformEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /**
   * One frame, before the controller moves the child: triggers, motion (yielding to the child),
   * carrying the rider, bounce pads, checkpoints, hazards and goals.
   */
  update(seconds: number, player: PlatformPlayer): void {
    if (this.disposed) return;
    const dt = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    const feet = player.position;
    const rider = this.byBox.get(player.supportingBox() as Box3) ?? null;
    // Left a moving platform into the air (a jump, or a step off): keep its sideways speed.
    if (this.lastRider && !rider && !player.grounded) {
      player.inheritVelocity(this.riderVelocityX, this.riderVelocityZ);
    }
    this.lastRider = null;

    this.updatePlates(player);

    for (const runtime of this.runtimes) {
      this.updateActivation(runtime, dt, player);
      this.updateVanish(runtime, dt, rider === runtime, player);
      this.before.copy(runtime.position);
      const spun = this.updateSpin(runtime, dt, rider === runtime);
      const moved = this.updateMotion(runtime, dt, player, rider === runtime);
      if (moved !== runtime.moving) {
        runtime.moving = moved;
        this.events.push(
          moved
            ? { type: 'MOVING', platformId: runtime.spec.id, ...cue(runtime.spec.sounds?.moving) }
            : { type: 'STOPPED', platformId: runtime.spec.id, ...cue(runtime.spec.sounds?.stopped) },
        );
      }
      if (rider === runtime && runtime.present) {
        const dx = runtime.position.x - this.before.x;
        const dy = runtime.position.y - this.before.y;
        const dz = runtime.position.z - this.before.z;
        let sx = 0;
        let sz = 0;
        if (spun !== 0) {
          // Round the turntable's centre (after its own travel).
          const rx = feet.x + dx - runtime.position.x;
          const rz = feet.z + dz - runtime.position.z;
          const cos = Math.cos(spun);
          const sin = Math.sin(spun);
          sx = rx * cos - rz * sin - rx;
          sz = rx * sin + rz * cos - rz;
        }
        if (dx !== 0 || dy !== 0 || dz !== 0 || sx !== 0 || sz !== 0) player.carry(dx + sx, dy, dz + sz);
        this.lastRider = runtime;
        this.riderVelocityX = dt > 0 ? dx / dt : 0;
        this.riderVelocityZ = dt > 0 ? dz / dt : 0;
      }
    }

    // A bounce pad throws whoever is standing on it, however they got there.
    if (rider && rider.present && rider.spec.bounce && player.grounded) {
      player.launch(rider.spec.bounce.height);
      this.events.push({ type: 'BOUNCED', platformId: rider.spec.id, ...cue(rider.spec.sounds?.bounce) });
    }

    this.updateCourse(player);
  }

  /** Removes every platform box from the controller. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const runtime of this.runtimes) {
      const index = this.options.colliders.indexOf(runtime.box);
      if (index >= 0) this.options.colliders.splice(index, 1);
      this.options.jumpable.delete(runtime.box);
    }
  }

  // --- internals --------------------------------------------------------------------------

  private triggerOn(runtime: Runtime, player: PlatformPlayer): boolean {
    const activation = runtime.spec.activation;
    if (!activation) return true;
    switch (activation.trigger) {
      case 'ALWAYS':
        return true;
      case 'PLATE':
        return this.plates.some((plate) => plate.spec.id === activation.source && plate.pressed);
      case 'SWITCH':
        return this.switches.has(activation.source ?? '');
      case 'ZONE': {
        const zone = this.options.zones.get(activation.source ?? '');
        return zone ? inRect(zone, player.position.x, player.position.z) : false;
      }
      case 'SIGNAL':
        return this.signals.has(activation.source ?? '');
      case 'WORLD_STATE':
        return areRequirementsMet(activation.requirements, this.options.worldState);
    }
  }

  private updateActivation(runtime: Runtime, dt: number, player: PlatformPlayer): void {
    const on = this.triggerOn(runtime, player);
    if (on && !runtime.triggerWas) runtime.delayLeft = runtime.spec.activation?.delaySeconds ?? 0;
    runtime.triggerWas = on;
    if (on) {
      if (runtime.delayLeft > 0) {
        runtime.delayLeft = Math.max(0, runtime.delayLeft - dt);
        if (runtime.delayLeft > 0) return;
      }
      if (!runtime.active) {
        runtime.active = true;
        runtime.returning = false;
        runtime.everActivated = true;
        this.events.push({ type: 'ACTIVATED', platformId: runtime.spec.id, ...cue(runtime.spec.sounds?.activated) });
        if (runtime.spec.activation?.hiddenUntilActive && !runtime.present) this.tryAppear(runtime, player);
      }
    } else if (runtime.active) {
      runtime.active = false;
      runtime.returning = runtime.spec.activation?.reset === 'RETURN';
    }
    // A bridge revealed while the child stood where it appears comes as soon as they move away.
    if (runtime.spec.activation?.hiddenUntilActive && runtime.everActivated && !runtime.present && !runtime.spec.vanish) {
      this.tryAppear(runtime, player);
    }
  }

  private updateVanish(runtime: Runtime, dt: number, riding: boolean, player: PlatformPlayer): void {
    const vanish = runtime.spec.vanish;
    if (!vanish || (runtime.spec.activation?.hiddenUntilActive && !runtime.everActivated)) return;
    const warning = vanish.warningSeconds ?? 1;
    if (vanish.mode === 'TIMED') {
      runtime.vanishClock += dt;
      const cycle = vanish.visibleSeconds + vanish.hiddenSeconds;
      const t = ((runtime.vanishClock % cycle) + cycle) % cycle;
      const show = t < vanish.visibleSeconds;
      runtime.warning = show && t > vanish.visibleSeconds - warning;
      if (show && !runtime.present) this.tryAppear(runtime, player);
      else if (!show && runtime.present) this.hide(runtime);
      return;
    }
    // STAND: counts while the child stands on it, then rests hidden and comes back.
    if (runtime.present) {
      if (riding) runtime.standClock += dt;
      runtime.warning = runtime.standClock > vanish.visibleSeconds - warning && runtime.standClock > 0;
      if (runtime.standClock >= vanish.visibleSeconds) {
        this.hide(runtime);
        runtime.hiddenLeft = vanish.hiddenSeconds;
      }
    } else {
      runtime.hiddenLeft -= dt;
      if (runtime.hiddenLeft <= 0 && this.tryAppear(runtime, player)) runtime.standClock = 0;
    }
  }

  private hide(runtime: Runtime): void {
    runtime.present = false;
    runtime.warning = false;
    runtime.box.makeEmpty();
    this.events.push({ type: 'VANISHED', platformId: runtime.spec.id });
  }

  /** Comes back only where it would not appear inside the child. */
  private tryAppear(runtime: Runtime, player: PlatformPlayer): boolean {
    this.boxAt(runtime, runtime.position, this.candidate);
    if (this.overlapsBody(this.candidate, player)) return false;
    runtime.present = true;
    runtime.box.copy(this.candidate);
    this.events.push({ type: 'APPEARED', platformId: runtime.spec.id });
    return true;
  }

  private updateSpin(runtime: Runtime, dt: number, riding: boolean): number {
    const spin = runtime.spec.spin;
    if (!spin || !runtime.active || !runtime.present) return 0;
    const factor = this.options.reducedMotion ? REDUCED_MOTION_FACTOR : 1;
    const delta = spin.degreesPerSecond * DEG * factor * dt;
    runtime.spinAngle += delta;
    return riding ? delta : 0;
  }

  /** Advances along the path unless that would move into the child; returns whether it moved. */
  private updateMotion(runtime: Runtime, dt: number, player: PlatformPlayer, riding: boolean): boolean {
    const motion = runtime.motion;
    if (!motion || !runtime.present || (!runtime.active && !runtime.returning) || dt === 0) return false;
    copyMotionState(runtime.state, runtime.saved);
    const moved = advanceMotion(motion, runtime.state, dt, runtime.speed, runtime.returning);
    if (runtime.returning && runtime.state.from === 0 && runtime.state.along <= 1e-9) runtime.returning = false;
    if (!moved) return false;
    motionOffset(motion, runtime.state, this.offset);
    const target = this.target.set(
      runtime.spec.position.x + this.offset.x,
      runtime.spec.position.y + this.offset.y,
      runtime.spec.position.z + this.offset.z,
    );
    this.boxAt(runtime, target, this.candidate);
    const blocked = riding ? this.riderHeadBlocked(runtime, player, target.y - runtime.position.y) : this.overlapsBody(this.candidate, player);
    if (blocked) {
      // Wait for the child: no move this frame.
      copyMotionState(runtime.saved, runtime.state);
      return false;
    }
    runtime.position.copy(target);
    runtime.box.copy(this.candidate);
    return true;
  }

  /** A lift never squeezes its rider into something above. */
  private riderHeadBlocked(runtime: Runtime, player: PlatformPlayer, rise: number): boolean {
    if (rise <= 0) return false;
    const { x, z } = player.position;
    const head = player.position.y + this.body;
    for (const box of this.options.colliders) {
      if (box === runtime.box || box.isEmpty() || !this.options.jumpable.has(box)) continue;
      if (x < box.min.x || x > box.max.x || z < box.min.z || z > box.max.z) continue;
      if (box.min.y >= head - EPSILON && box.min.y < head + rise) return true;
    }
    return false;
  }

  private overlapsBody(box: Box3, player: PlatformPlayer): boolean {
    if (box.isEmpty()) return false;
    const { x, y, z } = player.position;
    if (x < box.min.x || x > box.max.x || z < box.min.z || z > box.max.z) return false;
    return box.max.y > y + this.step + EPSILON && box.min.y < y + this.body - EPSILON;
  }

  private boxAt(runtime: Runtime, at: Vector3, into: Box3): Box3 {
    const { width, height, depth } = runtime.spec.size;
    into.min.set(at.x - width / 2, at.y, at.z - depth / 2);
    into.max.set(at.x + width / 2, at.y + height, at.z + depth / 2);
    return into;
  }

  private writeBox(runtime: Runtime): void {
    if (runtime.present) this.boxAt(runtime, runtime.position, runtime.box);
    else runtime.box.makeEmpty();
  }

  private updatePlates(player: PlatformPlayer): void {
    const { x, y, z } = player.position;
    for (const plate of this.plates as PlateState[]) {
      const half = plate.spec.halfSize ?? 0.6;
      const on =
        player.grounded &&
        y < 0.5 &&
        Math.abs(x - plate.spec.position.x) <= half &&
        Math.abs(z - plate.spec.position.z) <= half;
      if (on && !plate.pressed) {
        plate.pressed = true;
        this.events.push({ type: 'PLATE_PRESSED', plateId: plate.spec.id });
      } else if (!on && plate.pressed && !plate.spec.latch) {
        plate.pressed = false;
        this.events.push({ type: 'PLATE_RELEASED', plateId: plate.spec.id });
      }
    }
  }

  private updateCourse(player: PlatformPlayer): void {
    const { x, y, z } = player.position;
    if (player.grounded) {
      for (const checkpoint of this.spec.checkpoints ?? []) {
        const half = checkpoint.halfSize ?? 1;
        if (Math.abs(x - checkpoint.x) > half || Math.abs(z - checkpoint.z) > half) continue;
        if (this.latestCheckpoint?.id !== checkpoint.id) {
          this.latestCheckpoint = checkpoint;
          if (!this.reachedCheckpoints.has(checkpoint.id)) {
            this.reachedCheckpoints.add(checkpoint.id);
            this.events.push({ type: 'CHECKPOINT', checkpointId: checkpoint.id, label: checkpoint.label });
          }
        }
      }
      for (const hazard of this.spec.hazards ?? []) {
        if (inRect(hazard.rect, x, z) && y <= (hazard.belowY ?? 0.05) && !player.supportingBox()) {
          player.recover('HAZARD');
          this.events.push({ type: 'RECOVERED_TO', checkpointId: this.latestCheckpoint?.id ?? null });
          return;
        }
      }
    }
    for (const goal of this.spec.goals ?? []) {
      const inside = inRect(goal.rect, x, z);
      if (inside && !this.insideGoals.has(goal.id)) {
        this.insideGoals.add(goal.id);
        if (!this.reachedGoals.has(goal.id)) {
          this.reachedGoals.add(goal.id);
          this.events.push({ type: 'GOAL', goalId: goal.id });
        }
      } else if (!inside) {
        this.insideGoals.delete(goal.id);
      }
    }
  }
}

function inRect(rect: RectZone, x: number, z: number): boolean {
  return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

function cue(id: string | undefined): { cue?: string } {
  return id ? { cue: id } : {};
}
