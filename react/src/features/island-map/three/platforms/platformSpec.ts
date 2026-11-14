import type { WorldRequirement } from '../../worldObjects';
import type { GroundPoint, RectZone, Vec3 } from '../runtime/locationManifest';

/**
 * Platforming content for any manifest-driven 3D location (LAI-JMP-02, LAI-JMP-04; ADR-059).
 *
 * A location lists its platforms, pressure plates, course checkpoints, hazards and goals here.
 * Every platform is one axis-aligned box the shared movement controller already understands (a
 * jumpable collider: the child stands on its top and bumps its sides). The runtime moves that
 * box in place, so collision always matches where the platform is drawn, and carries a child
 * standing on it. No second physics engine.
 *
 * Positions and paths are layout (seed- or manifest-authored, ADR-033 / LAI-0805); speeds,
 * pauses, bounce heights and on/off are tuning, which staff may change in Django Admin through
 * the 3D Area's content revision (`tuning`, applied over the authored values).
 */

export interface PlatformSize {
  /** Along world X, metres. */
  width: number;
  /** Thickness: bottom to the top the child stands on, metres. */
  height: number;
  /** Along world Z, metres. */
  depth: number;
}

export type PlatformPathMode = 'LOOP' | 'PING_PONG' | 'ONCE';

export interface PlatformMotionSpec {
  /**
   * Where it travels, as offsets from `position` (metres). The platform starts at `position`
   * (offset 0,0,0) and visits each waypoint in turn.
   */
  path: readonly Vec3[];
  /** Metres per second along the path. */
  speed: number;
  /** Seconds it waits at each end (and at every waypoint), so the child can step on and off. */
  pauseSeconds?: number;
  /** `PING_PONG` (default): there and back. `LOOP`: back to the start and round again. `ONCE`: stop at the end. */
  mode?: PlatformPathMode;
}

export type PlatformTrigger = 'ALWAYS' | 'PLATE' | 'SWITCH' | 'ZONE' | 'SIGNAL' | 'WORLD_STATE';

export interface PlatformActivationSpec {
  /**
   * What sets it going. `ALWAYS` (default): from the start. `PLATE`: while a pressure plate is
   * pressed (`source` = plate id). `SWITCH`: an interactive prop toggles it (`source` = the
   * prop's entityId). `ZONE`: while the child is in a zone (`source` = zone rect id). `SIGNAL`:
   * when the game signals it (`source` = signal name; e.g. an educational challenge was
   * completed). `WORLD_STATE`: when `requirements` hold (persistent unlocks, read on entry).
   */
  trigger: PlatformTrigger;
  source?: string;
  requirements?: readonly WorldRequirement[];
  /** Seconds between the trigger and the platform starting. */
  delaySeconds?: number;
  /** When the trigger lets go: `STAY` (default) stops where it is; `RETURN` goes back to its start. */
  reset?: 'STAY' | 'RETURN';
  /** Not there at all (drawn or solid) until first activated: a bridge that appears. */
  hiddenUntilActive?: boolean;
}

export interface PlatformVanishSpec {
  /** `TIMED`: on a fixed cycle. `STAND`: vanishes a while after the child steps on it. */
  mode: 'TIMED' | 'STAND';
  /** Seconds it stays (for `STAND`: after the child steps on). At least 1.5. */
  visibleSeconds: number;
  /** Seconds it is gone before it returns. */
  hiddenSeconds: number;
  /** Seconds of blinking before it vanishes. Default 1. */
  warningSeconds?: number;
  /** `TIMED` only: where in the cycle it starts, seconds. */
  offsetSeconds?: number;
}

/** Logical Sound Manager cue ids for this platform; defaults come from the location's audio. */
export interface PlatformSounds {
  activated?: string;
  moving?: string;
  stopped?: string;
  bounce?: string;
}

export interface PlatformSpec {
  id: string;
  /** A published or bundled model drawn in place of the procedural block (Asset Manager id). */
  assetId?: string;
  /** Procedural block colour (0xRRGGBB) when there is no model, or while it loads. */
  color?: number;
  size: PlatformSize;
  /** Rest position: bottom centre, metres. */
  position: Vec3;
  /** Model turn about Y (visual only; the collision box stays on the world axes). */
  rotationY?: number;
  motion?: PlatformMotionSpec;
  /** A round turntable turning at this rate; carries a rider round its centre. */
  spin?: { degreesPerSecond: number };
  /** A bounce pad: landing on it throws the child up to about this height, metres. */
  bounce?: { height: number };
  vanish?: PlatformVanishSpec;
  activation?: PlatformActivationSpec;
  sounds?: PlatformSounds;
  /** Draw a marker where a moving platform goes (default true for moving platforms). */
  indicator?: boolean;
}

export interface PressurePlateSpec {
  id: string;
  position: GroundPoint;
  /** Half the side of the square plate, metres. Default 0.6. */
  halfSize?: number;
  /** Stays pressed once stepped on (default false: pressed only while stood on). */
  latch?: boolean;
  color?: number;
}

/** A place a child who falls goes back to, once they have reached it this visit. */
export interface CourseCheckpointSpec {
  id: string;
  x: number;
  z: number;
  yaw?: number;
  /** Child-facing, read aloud: "the old dock". */
  label: string;
  /** Half the side of the square that counts as reaching it, metres. Default 1. */
  halfSize?: number;
}

/** Ground that sends a child back to the latest checkpoint (water under a missed jump). */
export interface HazardSpec {
  id: string;
  rect: RectZone;
  /** Feet at or below this height inside `rect` count as in the hazard. Default 0.05. */
  belowY?: number;
}

/** The end of a course: reaching it is reported once per visit (sound, Pip, the chest). */
export interface PlatformGoalSpec {
  id: string;
  rect: RectZone;
}

/** Staff-editable tuning for one platform (Django content revision, `scene.platformTuning`). */
export interface PlatformTuning {
  /** Off: the platform is not there this visit. */
  enabled?: boolean;
  speed?: number;
  pauseSeconds?: number;
  bounceHeight?: number;
  visibleSeconds?: number;
  hiddenSeconds?: number;
}

export interface PlatformingSpec {
  platforms: readonly PlatformSpec[];
  pressurePlates?: readonly PressurePlateSpec[];
  checkpoints?: readonly CourseCheckpointSpec[];
  hazards?: readonly HazardSpec[];
  goals?: readonly PlatformGoalSpec[];
  /** Per platform id, merged over the authored values when the scene is built. */
  tuning?: Readonly<Record<string, PlatformTuning>>;
}

// --- limits (forgiving by design, ages 3 to 8) -------------------------------------------------

export const PLATFORM_LIMITS = {
  /** The narrowest top a child must land on, metres. */
  minTop: 0.8,
  maxSize: 30,
  maxThickness: 10,
  minSpeed: 0.2,
  maxSpeed: 4,
  maxPause: 10,
  maxWaypoints: 16,
  maxPathReach: 60,
  minBounce: 0.5,
  maxBounce: 4,
  minVisible: 1.5,
  maxCycle: 60,
  maxSpin: 45,
  maxDelay: 30,
  maxPlatforms: 64,
} as const;

export interface PlatformIssue {
  path: string;
  message: string;
}

const TRIGGERS: readonly PlatformTrigger[] = ['ALWAYS', 'PLATE', 'SWITCH', 'ZONE', 'SIGNAL', 'WORLD_STATE'];
const MODES: readonly PlatformPathMode[] = ['LOOP', 'PING_PONG', 'ONCE'];

/** Everything a location needs checked about its platforming, beyond its own fields. */
export interface PlatformingContext {
  /** Prop entity ids a `SWITCH` may name. */
  propIds: ReadonlySet<string>;
  /** Zone rect ids a `ZONE` may name. */
  zoneIds: ReadonlySet<string>;
  /** Half extents of the playable area. */
  bounds: { halfExtentX: number; halfExtentZ: number };
  /** Solid boxes (authored colliders, walls) a checkpoint must not stand in. */
  solids: readonly { minX: number; maxX: number; minZ: number; maxZ: number }[];
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const within = (value: unknown, low: number, high: number) => finite(value) && value >= low && value <= high;

/**
 * Structural and safety checks: sizes, speeds and timings within forgiving limits; activation
 * sources that exist; checkpoints inside the area, never inside a solid or on a platform that
 * moves, vanishes or appears later.
 */
export function validatePlatforming(
  spec: PlatformingSpec | undefined,
  context: PlatformingContext,
): PlatformIssue[] {
  if (spec === undefined) return [];
  const issues: PlatformIssue[] = [];
  const report = (path: string, message: string) => issues.push({ path, message });
  if (typeof spec !== 'object' || spec === null || !Array.isArray(spec.platforms)) {
    return [{ path: 'platforming', message: 'must be an object with a platforms list' }];
  }
  if (spec.platforms.length > PLATFORM_LIMITS.maxPlatforms) {
    report('platforming.platforms', `at most ${PLATFORM_LIMITS.maxPlatforms} platforms`);
  }
  const ids = new Set<string>();
  const unique = (id: unknown, path: string) => {
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9:_-]{0,79}$/.test(id)) {
      report(path, 'id must be lower-case letters, digits, - _ : (1 to 80)');
    } else if (ids.has(id)) {
      report(path, `duplicate id ${id}`);
    } else {
      ids.add(id);
    }
  };
  const plates = new Set((spec.pressurePlates ?? []).map((plate) => plate.id));
  const inBounds = (x: unknown, z: unknown) =>
    finite(x) && finite(z) && Math.abs(x) <= context.bounds.halfExtentX && Math.abs(z) <= context.bounds.halfExtentZ;
  const checkVec = (value: Vec3 | undefined, path: string, reach: number) => {
    if (!value || !within(value.x, -reach, reach) || !within(value.y, -reach, reach) || !within(value.z, -reach, reach)) {
      report(path, `must be {x, y, z} within ${reach} m`);
      return false;
    }
    return true;
  };

  spec.platforms.forEach((platform, index) => {
    const path = `platforming.platforms[${index}]`;
    unique(platform.id, `${path}.id`);
    const size = platform.size;
    if (!size || !within(size.width, PLATFORM_LIMITS.minTop, PLATFORM_LIMITS.maxSize) || !within(size.depth, PLATFORM_LIMITS.minTop, PLATFORM_LIMITS.maxSize)) {
      report(`${path}.size`, `width and depth must be ${PLATFORM_LIMITS.minTop} to ${PLATFORM_LIMITS.maxSize} m (forgiving tops)`);
    }
    if (!size || !within(size.height, 0.05, PLATFORM_LIMITS.maxThickness)) {
      report(`${path}.size.height`, `must be 0.05 to ${PLATFORM_LIMITS.maxThickness} m`);
    }
    if (checkVec(platform.position, `${path}.position`, 200) && !inBounds(platform.position.x, platform.position.z)) {
      report(`${path}.position`, 'must be inside the location bounds');
    }
    if (platform.assetId !== undefined && (typeof platform.assetId !== 'string' || !platform.assetId)) {
      report(`${path}.assetId`, 'must be an asset id');
    }
    if (platform.color !== undefined && !within(platform.color, 0, 0xffffff)) {
      report(`${path}.color`, 'must be a colour from 0 to 16777215');
    }
    const motion = platform.motion;
    if (motion !== undefined) {
      if (!Array.isArray(motion.path) || motion.path.length < 1 || motion.path.length > PLATFORM_LIMITS.maxWaypoints) {
        report(`${path}.motion.path`, `must list 1 to ${PLATFORM_LIMITS.maxWaypoints} waypoints`);
      } else {
        motion.path.forEach((point: Vec3, at: number) => checkVec(point, `${path}.motion.path[${at}]`, PLATFORM_LIMITS.maxPathReach));
      }
      if (!within(motion.speed, PLATFORM_LIMITS.minSpeed, PLATFORM_LIMITS.maxSpeed)) {
        report(`${path}.motion.speed`, `must be ${PLATFORM_LIMITS.minSpeed} to ${PLATFORM_LIMITS.maxSpeed} m/s (predictable)`);
      }
      if (motion.pauseSeconds !== undefined && !within(motion.pauseSeconds, 0, PLATFORM_LIMITS.maxPause)) {
        report(`${path}.motion.pauseSeconds`, `must be 0 to ${PLATFORM_LIMITS.maxPause}`);
      }
      if (motion.mode !== undefined && !MODES.includes(motion.mode)) {
        report(`${path}.motion.mode`, `must be one of ${MODES.join(', ')}`);
      }
    }
    if (platform.spin !== undefined && !within(platform.spin.degreesPerSecond, -PLATFORM_LIMITS.maxSpin, PLATFORM_LIMITS.maxSpin)) {
      report(`${path}.spin.degreesPerSecond`, `must be within ±${PLATFORM_LIMITS.maxSpin} (gentle)`);
    }
    if (platform.spin !== undefined && motion !== undefined) {
      report(`${path}.spin`, 'a platform either travels a path or spins, not both');
    }
    if (platform.bounce !== undefined && !within(platform.bounce.height, PLATFORM_LIMITS.minBounce, PLATFORM_LIMITS.maxBounce)) {
      report(`${path}.bounce.height`, `must be ${PLATFORM_LIMITS.minBounce} to ${PLATFORM_LIMITS.maxBounce} m`);
    }
    const vanish = platform.vanish;
    if (vanish !== undefined) {
      if (vanish.mode !== 'TIMED' && vanish.mode !== 'STAND') report(`${path}.vanish.mode`, 'must be TIMED or STAND');
      if (!within(vanish.visibleSeconds, PLATFORM_LIMITS.minVisible, PLATFORM_LIMITS.maxCycle)) {
        report(`${path}.vanish.visibleSeconds`, `must be ${PLATFORM_LIMITS.minVisible} to ${PLATFORM_LIMITS.maxCycle} (no rushing)`);
      }
      if (!within(vanish.hiddenSeconds, 0.5, PLATFORM_LIMITS.maxCycle)) {
        report(`${path}.vanish.hiddenSeconds`, `must be 0.5 to ${PLATFORM_LIMITS.maxCycle}`);
      }
      if (vanish.warningSeconds !== undefined && !within(vanish.warningSeconds, 0, vanish.visibleSeconds)) {
        report(`${path}.vanish.warningSeconds`, 'must be 0 up to visibleSeconds');
      }
    }
    const activation = platform.activation;
    if (activation !== undefined) {
      const at = `${path}.activation`;
      if (!TRIGGERS.includes(activation.trigger)) report(`${at}.trigger`, `must be one of ${TRIGGERS.join(', ')}`);
      const source = activation.source;
      if (activation.trigger === 'PLATE' && !(typeof source === 'string' && plates.has(source))) {
        report(`${at}.source`, 'must name a pressure plate of this location');
      }
      if (activation.trigger === 'SWITCH' && !(typeof source === 'string' && context.propIds.has(source))) {
        report(`${at}.source`, 'must name an interactive prop (entityId) of this location');
      }
      if (activation.trigger === 'ZONE' && !(typeof source === 'string' && context.zoneIds.has(source))) {
        report(`${at}.source`, 'must name a zone of this location');
      }
      if (activation.trigger === 'SIGNAL' && !(typeof source === 'string' && /^[a-z0-9][a-z0-9:_.-]{0,79}$/.test(source))) {
        report(`${at}.source`, 'must be a signal name');
      }
      if (activation.trigger === 'WORLD_STATE' && !(Array.isArray(activation.requirements) && activation.requirements.length > 0)) {
        report(`${at}.requirements`, 'WORLD_STATE needs at least one requirement');
      }
      if (activation.delaySeconds !== undefined && !within(activation.delaySeconds, 0, PLATFORM_LIMITS.maxDelay)) {
        report(`${at}.delaySeconds`, `must be 0 to ${PLATFORM_LIMITS.maxDelay}`);
      }
      if (activation.reset !== undefined && activation.reset !== 'STAY' && activation.reset !== 'RETURN') {
        report(`${at}.reset`, 'must be STAY or RETURN');
      }
    }
  });

  (spec.pressurePlates ?? []).forEach((plate, index) => {
    const path = `platforming.pressurePlates[${index}]`;
    unique(plate.id, `${path}.id`);
    if (!inBounds(plate.position?.x, plate.position?.z)) report(`${path}.position`, 'must be inside the location bounds');
    if (plate.halfSize !== undefined && !within(plate.halfSize, 0.3, 3)) report(`${path}.halfSize`, 'must be 0.3 to 3 m');
  });

  const unsafePlatforms = spec.platforms.filter(
    (platform) => platform.motion || platform.spin || platform.vanish || platform.bounce || platform.activation?.hiddenUntilActive,
  );
  (spec.checkpoints ?? []).forEach((checkpoint, index) => {
    const path = `platforming.checkpoints[${index}]`;
    unique(checkpoint.id, `${path}.id`);
    if (typeof checkpoint.label !== 'string' || !checkpoint.label.trim() || checkpoint.label.length > 60) {
      report(`${path}.label`, 'must be child-facing text of 1 to 60 characters');
    }
    if (!inBounds(checkpoint.x, checkpoint.z)) {
      report(path, 'must be inside the location bounds');
      return;
    }
    if (context.solids.some((box) => checkpoint.x >= box.minX && checkpoint.x <= box.maxX && checkpoint.z >= box.minZ && checkpoint.z <= box.maxZ)) {
      report(path, 'must not stand inside an obstacle');
    }
    for (const platform of unsafePlatforms) {
      if (footprintContains(platform, checkpoint.x, checkpoint.z)) {
        report(path, `must not be on ${platform.id}, which moves, vanishes or appears later`);
      }
    }
  });

  (spec.hazards ?? []).forEach((hazard, index) => {
    const path = `platforming.hazards[${index}]`;
    unique(hazard.id, `${path}.id`);
    checkRect(hazard.rect, `${path}.rect`, report);
    if (hazard.belowY !== undefined && !within(hazard.belowY, -5, 5)) report(`${path}.belowY`, 'must be -5 to 5 m');
  });
  (spec.goals ?? []).forEach((goal, index) => {
    unique(goal.id, `platforming.goals[${index}].id`);
    checkRect(goal.rect, `platforming.goals[${index}].rect`, report);
  });
  if (spec.hazards?.length && !spec.checkpoints?.length) {
    report('platforming.checkpoints', 'a course with hazards needs at least one checkpoint to return to');
  }

  for (const [id, tuning] of Object.entries(spec.tuning ?? {})) {
    for (const issue of validateTuning(tuning)) report(`platforming.tuning.${id}.${issue.path}`, issue.message);
  }
  return issues;
}

/** Checks one platform's staff tuning (the same limits as authored values). */
export function validateTuning(tuning: PlatformTuning): PlatformIssue[] {
  const issues: PlatformIssue[] = [];
  if (typeof tuning !== 'object' || tuning === null) return [{ path: '', message: 'must be an object' }];
  const known = new Set(['enabled', 'speed', 'pauseSeconds', 'bounceHeight', 'visibleSeconds', 'hiddenSeconds']);
  for (const key of Object.keys(tuning)) if (!known.has(key)) issues.push({ path: key, message: 'unknown setting' });
  if (tuning.enabled !== undefined && typeof tuning.enabled !== 'boolean') issues.push({ path: 'enabled', message: 'must be true or false' });
  if (tuning.speed !== undefined && !within(tuning.speed, PLATFORM_LIMITS.minSpeed, PLATFORM_LIMITS.maxSpeed)) {
    issues.push({ path: 'speed', message: `must be ${PLATFORM_LIMITS.minSpeed} to ${PLATFORM_LIMITS.maxSpeed}` });
  }
  if (tuning.pauseSeconds !== undefined && !within(tuning.pauseSeconds, 0, PLATFORM_LIMITS.maxPause)) {
    issues.push({ path: 'pauseSeconds', message: `must be 0 to ${PLATFORM_LIMITS.maxPause}` });
  }
  if (tuning.bounceHeight !== undefined && !within(tuning.bounceHeight, PLATFORM_LIMITS.minBounce, PLATFORM_LIMITS.maxBounce)) {
    issues.push({ path: 'bounceHeight', message: `must be ${PLATFORM_LIMITS.minBounce} to ${PLATFORM_LIMITS.maxBounce}` });
  }
  if (tuning.visibleSeconds !== undefined && !within(tuning.visibleSeconds, PLATFORM_LIMITS.minVisible, PLATFORM_LIMITS.maxCycle)) {
    issues.push({ path: 'visibleSeconds', message: `must be ${PLATFORM_LIMITS.minVisible} to ${PLATFORM_LIMITS.maxCycle}` });
  }
  if (tuning.hiddenSeconds !== undefined && !within(tuning.hiddenSeconds, 0.5, PLATFORM_LIMITS.maxCycle)) {
    issues.push({ path: 'hiddenSeconds', message: `must be 0.5 to ${PLATFORM_LIMITS.maxCycle}` });
  }
  return issues;
}

/** The authored platforms with staff tuning applied; disabled ones are left out. */
export function applyTuning(spec: PlatformingSpec): PlatformSpec[] {
  const tuning = spec.tuning ?? {};
  const out: PlatformSpec[] = [];
  for (const platform of spec.platforms) {
    const tune = tuning[platform.id];
    if (!tune || validateTuning(tune).length > 0) {
      out.push(platform);
      continue;
    }
    if (tune.enabled === false) continue;
    out.push({
      ...platform,
      ...(platform.motion
        ? {
            motion: {
              ...platform.motion,
              ...(tune.speed !== undefined ? { speed: tune.speed } : {}),
              ...(tune.pauseSeconds !== undefined ? { pauseSeconds: tune.pauseSeconds } : {}),
            },
          }
        : {}),
      ...(platform.bounce && tune.bounceHeight !== undefined ? { bounce: { height: tune.bounceHeight } } : {}),
      ...(platform.vanish
        ? {
            vanish: {
              ...platform.vanish,
              ...(tune.visibleSeconds !== undefined ? { visibleSeconds: tune.visibleSeconds } : {}),
              ...(tune.hiddenSeconds !== undefined ? { hiddenSeconds: tune.hiddenSeconds } : {}),
            },
          }
        : {}),
    });
  }
  return out;
}

/** Whether (x, z) is over ground the platform sweeps anywhere along its path. */
function footprintContains(platform: PlatformSpec, x: number, z: number): boolean {
  const points = [{ x: 0, y: 0, z: 0 }, ...(platform.motion?.path ?? [])];
  const hw = platform.size.width / 2;
  const hd = platform.size.depth / 2;
  const xs = points.map((offset) => platform.position.x + offset.x);
  const zs = points.map((offset) => platform.position.z + offset.z);
  return x >= Math.min(...xs) - hw && x <= Math.max(...xs) + hw && z >= Math.min(...zs) - hd && z <= Math.max(...zs) + hd;
}

function checkRect(rect: RectZone | undefined, path: string, report: (path: string, message: string) => void) {
  if (!rect || ![rect.minX, rect.maxX, rect.minZ, rect.maxZ].every(finite) || rect.maxX <= rect.minX || rect.maxZ <= rect.minZ) {
    report(path, 'must be a rect with minX < maxX and minZ < maxZ');
  }
}
