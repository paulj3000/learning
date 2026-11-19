/**
 * Environment volume specs: surfaces (ice, mud, sand, snow), force volumes (wind, current,
 * conveyor, updraft), water and ladders, with definition-time validation.
 *
 * All volumes are axis-aligned boxes (the engine's collision model), authored as data.
 * Validation reports problems instead of clamping, and a force volume that would push a child
 * toward a hazard is a definition error (`forceHazardIssues`): "wind never pushes a child into
 * a hazard" is checked when the content is authored, and again at query time.
 */

import { type ExternalForceKind, type SurfaceProfile } from '../contracts/physics';
import type { Vec3Like } from '../contracts/player';
import { inflateRect, sweptRectHitsRect, type Rect } from '../components/geometry';
import { Issues, isRecord, type Json } from '../components/validate';

export interface BoxSpec {
  min: Vec3Like;
  max: Vec3Like;
}

/** Friction floor: at or above this a child still stops within about a metre. */
export const MIN_SURFACE_FRICTION = 0.1;

export const SURFACE_PRESETS: Readonly<Record<string, Pick<SurfaceProfile, 'friction' | 'speedMultiplier' | 'footstepCue'>>> = Object.freeze({
  ground: { friction: 1, speedMultiplier: 1, footstepCue: 'groundStep' },
  ice: { friction: 0.15, speedMultiplier: 1, footstepCue: 'iceStep' },
  snow: { friction: 0.7, speedMultiplier: 0.85, footstepCue: 'snowStep' },
  mud: { friction: 0.8, speedMultiplier: 0.6, footstepCue: 'mudStep' },
  sand: { friction: 0.85, speedMultiplier: 0.8, footstepCue: 'sandStep' },
});

export interface SurfaceVolumeSpec {
  id: string;
  box: BoxSpec;
  /** Higher wins where volumes overlap; ties go to the smaller volume, then the id. */
  priority: number;
  profile: SurfaceProfile;
}

export interface ForceVolumeSpec {
  id: string;
  kind: ExternalForceKind;
  box: BoxSpec;
  /** Push direction (normalised on use). Horizontal for wind, current and conveyors. */
  direction: Vec3Like;
  /** Acceleration, m/s squared. */
  strength: number;
  /** Per-volume clamp on the acceleration actually applied (after ramp and reduced motion). */
  maxAcceleration: number;
  /** Seconds to reach full strength after the child enters. */
  rampInSeconds: number;
  /** Gate: the volume is active only while this signal is true (always when absent). */
  signalId?: string;
  affectsGrounded: boolean;
  /** Never push toward a hazard: validated at definition and checked per query. Default true. */
  neverPushIntoHazard: boolean;
  /** How far past the volume a pushed child may drift, metres, for the hazard check. */
  runOut: number;
  priority: number;
}

export interface WaterVolumeSpec {
  id: string;
  /** The box's top is the water surface. */
  box: BoxSpec;
}

export interface LadderSpec {
  id: string;
  x: number;
  z: number;
  halfWidth: number;
  depth: number;
  bottomY: number;
  topY: number;
  facingYaw: number;
  exitTop: Vec3Like;
}

export interface EnvironmentVolumesConfig {
  surfaces: SurfaceVolumeSpec[];
  forces: ForceVolumeSpec[];
  waters: WaterVolumeSpec[];
  ladders: LadderSpec[];
  /** Hazard footprints known at authoring time, for the push-into-hazard check. */
  hazardRects: Rect[];
}

export const FORCE_KINDS: readonly ExternalForceKind[] = ['WIND', 'CURRENT', 'CONVEYOR', 'UPDRAFT'];
export const FORCE_LIMITS = { maxStrength: 20, maxAcceleration: 12, maxRamp: 5, maxRunOut: 20, reducedMotionScale: 0.5 } as const;

function readBox(value: unknown, path: string, issues: Issues): BoxSpec {
  if (!isRecord(value)) {
    issues.add(path, 'must be a box with min and max');
    return { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } };
  }
  const min = issues.vec3(value.min, `${path}.min`);
  const max = issues.vec3(value.max, `${path}.max`);
  if (min.x >= max.x || min.y >= max.y || min.z >= max.z) {
    issues.add(path, 'min must be less than max on every axis');
  }
  return { min, max };
}

function readSurface(item: Json, path: string, issues: Issues): SurfaceVolumeSpec {
  const id = issues.id(item.id, `${path}.id`);
  const surfaceId = issues.id(item.surfaceId, `${path}.surfaceId`);
  const preset = SURFACE_PRESETS[surfaceId] ?? { friction: 1, speedMultiplier: 1, footstepCue: undefined };
  const cue = item.footstepCue;
  if (cue !== undefined && (typeof cue !== 'string' || !/^[A-Za-z][A-Za-z0-9_.]{0,63}$/.test(cue))) {
    issues.add(`${path}.footstepCue`, 'must be a cue id');
  }
  return {
    id,
    box: readBox(item.box, `${path}.box`, issues),
    priority: issues.num(item.priority, `${path}.priority`, 0, 100, 0),
    profile: {
      id: surfaceId,
      friction: issues.num(item.friction, `${path}.friction`, MIN_SURFACE_FRICTION, 1, preset.friction),
      speedMultiplier: issues.num(item.speedMultiplier, `${path}.speedMultiplier`, 0.5, 1.5, preset.speedMultiplier),
      footstepCue: typeof cue === 'string' ? cue : preset.footstepCue,
    },
  };
}

function readForce(item: Json, path: string, issues: Issues): ForceVolumeSpec {
  const direction = issues.vec3(item.direction, `${path}.direction`, 100);
  if (Math.hypot(direction.x, direction.y, direction.z) < 1e-6) {
    issues.add(`${path}.direction`, 'must not be the zero vector');
  }
  const kind = issues.oneOf<ExternalForceKind>(item.kind, `${path}.kind`, FORCE_KINDS);
  const strength = issues.num(item.strength, `${path}.strength`, 0, FORCE_LIMITS.maxStrength);
  return {
    id: issues.id(item.id, `${path}.id`),
    kind,
    box: readBox(item.box, `${path}.box`, issues),
    direction,
    strength,
    maxAcceleration: issues.num(item.maxAcceleration, `${path}.maxAcceleration`, 0.1, FORCE_LIMITS.maxAcceleration, Math.min(strength || 0.1, 6)),
    rampInSeconds: issues.num(item.rampInSeconds, `${path}.rampInSeconds`, 0, FORCE_LIMITS.maxRamp, 0.5),
    signalId: issues.optionalId(item.signalId, `${path}.signalId`),
    affectsGrounded: issues.bool(item.affectsGrounded, `${path}.affectsGrounded`, true),
    neverPushIntoHazard: issues.bool(item.neverPushIntoHazard, `${path}.neverPushIntoHazard`, true),
    runOut: issues.num(item.runOut, `${path}.runOut`, 0, FORCE_LIMITS.maxRunOut, 1.5),
    priority: issues.num(item.priority, `${path}.priority`, 0, 100, 0),
  };
}

/** Forces whose push direction, over the volume's extent and run-out, reaches a hazard. */
export function forceHazardIssues(forces: readonly ForceVolumeSpec[], hazards: readonly Rect[], margin = 0.25): { path: string; message: string }[] {
  const out: { path: string; message: string }[] = [];
  forces.forEach((force, index) => {
    if (!force.neverPushIntoHazard) {
      return;
    }
    const dx = force.direction.x;
    const dz = force.direction.z;
    if (Math.hypot(dx, dz) < 1e-9) {
      return;
    }
    const box: Rect = { minX: force.box.min.x, maxX: force.box.max.x, minZ: force.box.min.z, maxZ: force.box.max.z };
    hazards.forEach((hazard, hazardIndex) => {
      if (sweptRectHitsRect(box, dx, dz, force.runOut, inflateRect(hazard, margin))) {
        out.push({
          path: `forces[${index}]`,
          message: `force "${force.id}" pushes toward hazard ${hazardIndex} (declared neverPushIntoHazard); move it, turn it or shorten runOut`,
        });
      }
    });
  });
  return out;
}

export function validateEnvironmentVolumesConfig(input: unknown) {
  const issues = new Issues();
  const root = isRecord(input) ? input : {};
  if (input !== undefined && !isRecord(input)) {
    issues.add('', 'must be an object');
  }
  const surfaces = issues.records(root.surfaces, 'surfaces', (item, path) => readSurface(item, path, issues), (s) => s.id, 128);
  const forces = issues.records(root.forces, 'forces', (item, path) => readForce(item, path, issues), (f) => f.id, 64);
  const waters = issues.records(
    root.waters,
    'waters',
    (item, path): WaterVolumeSpec => ({ id: issues.id(item.id, `${path}.id`), box: readBox(item.box, `${path}.box`, issues) }),
    (w) => w.id,
    32,
  );
  const ladders = issues.records(
    root.ladders,
    'ladders',
    (item, path): LadderSpec => {
      const bottomY = issues.num(item.bottomY, `${path}.bottomY`, -50, 100);
      const topY = issues.num(item.topY, `${path}.topY`, -50, 100);
      if (topY <= bottomY) {
        issues.add(`${path}.topY`, 'must be above bottomY');
      }
      return {
        id: issues.id(item.id, `${path}.id`),
        x: issues.num(item.x, `${path}.x`, -1000, 1000),
        z: issues.num(item.z, `${path}.z`, -1000, 1000),
        halfWidth: issues.num(item.halfWidth, `${path}.halfWidth`, 0.2, 3, 0.5),
        depth: issues.num(item.depth, `${path}.depth`, 0.2, 3, 0.6),
        bottomY,
        topY,
        facingYaw: issues.num(item.facingYaw, `${path}.facingYaw`, -Math.PI * 2, Math.PI * 2, 0),
        exitTop: issues.vec3(item.exitTop, `${path}.exitTop`),
      };
    },
    (l) => l.id,
    32,
  );
  const hazardRects = Array.isArray(root.hazardRects) ? root.hazardRects.map((r, i) => issues.rect(r, `hazardRects[${i}]`)) : [];
  for (const problem of forceHazardIssues(forces, hazardRects)) {
    issues.add(problem.path, problem.message);
  }
  return issues.result<EnvironmentVolumesConfig>({ surfaces, forces, waters, ladders, hazardRects });
}

