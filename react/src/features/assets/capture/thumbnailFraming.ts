/**
 * Camera framing for staff GLB thumbnails, spec version 1
 * (`docs/processing/GLB_THUMBNAIL_SPEC.md` section 3). A port of
 * `scripts/processing/bench/thumbnail_framing.py`; no Three.js import, so it is plain math.
 * glTF is right-handed with +Y up and the model faces +Z.
 */

export const SPEC_VERSION = '1';
export const FOV_DEGREES = 45;
export const AZIMUTH_DEGREES = 35; // from +Z toward +X
export const ELEVATION_DEGREES = 20;
export const PADDING = 1.25;
export const FALLBACK_RADIUS = 1; // a zero size box is framed as a unit sphere
export const NEAR_FLOOR_RATIO = 0.01;
export const CLIP_MARGIN = 2;
export const BACKGROUND = 0xeef1f4;

export type Vec3 = readonly [number, number, number];

export class FramingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FramingError';
  }
}

export interface SpecCamera {
  position: Vec3;
  target: Vec3;
  fovDegrees: number;
  aspect: number;
  near: number;
  far: number;
  distance: number;
  radius: number;
  degenerate: boolean;
}

/** Unit vector from the target toward the camera. */
export function direction(azimuth = AZIMUTH_DEGREES, elevation = ELEVATION_DEGREES): Vec3 {
  const a = (azimuth * Math.PI) / 180;
  const e = (elevation * Math.PI) / 180;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
}

export function boundingSphere(low: Vec3, high: Vec3): { centre: Vec3; radius: number } {
  if (![...low, ...high].every(Number.isFinite)) throw new FramingError('bounds must be finite');
  if (low.some((l, i) => high[i] < l)) throw new FramingError('bounds are inverted');
  const centre: Vec3 = [(low[0] + high[0]) / 2, (low[1] + high[1]) / 2, (low[2] + high[2]) / 2];
  const radius = Math.hypot(high[0] - low[0], high[1] - low[1], high[2] - low[2]) / 2;
  return { centre, radius };
}

/** Near and far planes for a camera `distance` from a sphere of `radius` (spec section 3). */
export function clipPlanes(distance: number, radius: number): { near: number; far: number } {
  return {
    near: Math.max(distance - CLIP_MARGIN * radius, distance * NEAR_FLOOR_RATIO),
    far: distance + CLIP_MARGIN * radius,
  };
}

export function frame(
  low: Vec3,
  high: Vec3,
  options: {
    aspect?: number;
    azimuth?: number;
    elevation?: number;
    fov?: number;
    padding?: number;
  } = {},
): SpecCamera {
  const {
    aspect = 1,
    azimuth = AZIMUTH_DEGREES,
    elevation = ELEVATION_DEGREES,
    fov = FOV_DEGREES,
    padding = PADDING,
  } = options;
  if (!(fov > 0 && fov < 180) || !(Number.isFinite(aspect) && aspect > 0)) {
    throw new FramingError('fov or aspect out of range');
  }
  const sphere = boundingSphere(low, high);
  const degenerate = !(sphere.radius > 0);
  const radius = degenerate ? FALLBACK_RADIUS : sphere.radius;
  const vertical = (fov * Math.PI) / 180 / 2;
  const horizontal = Math.atan(Math.tan(vertical) * aspect);
  const distance = (padding * radius) / Math.sin(Math.min(vertical, horizontal));
  const unit = direction(azimuth, elevation);
  const position: Vec3 = [
    sphere.centre[0] + unit[0] * distance,
    sphere.centre[1] + unit[1] * distance,
    sphere.centre[2] + unit[2] * distance,
  ];
  const { near, far } = clipPlanes(distance, radius);
  return {
    position,
    target: sphere.centre,
    fovDegrees: fov,
    aspect,
    near,
    far,
    distance,
    radius,
    degenerate,
  };
}
