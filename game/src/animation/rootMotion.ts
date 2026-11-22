/**
 * Root-motion correction (GE-030), ported and generalised from `withoutRootMotionFor` in
 * `react/.../three/playerAnimation.ts` (the P0 avatar-drift fix).
 *
 * The canonical `PlayerTransform` is the only thing that moves the avatar. A clip authored
 * with forward travel on the skeleton's root or hips (a Mixamo walk) would otherwise carry the
 * avatar away from where movement put it, through a wall or past a gate. So:
 * - position tracks on the model's top-level nodes are dropped;
 * - position tracks on the skeleton's root bones (and any extra names given, e.g. a hips bone
 *   under a root bone) keep only their vertical part (a walk's bob, a jump's crouch), with the
 *   horizontal part pinned to the bone's rest position;
 * - everything else (rotations, deeper positions) is untouched.
 *
 * Never changes the loaded clips: a changed clip is a new `AnimationClip`.
 */

import {
  AnimationClip,
  Matrix4,
  Quaternion,
  Vector3,
  VectorKeyframeTrack,
  type Bone,
  type KeyframeTrack,
  type Object3D,
} from 'three';

export interface RootMotionOptions {
  /** Extra node names whose horizontal travel is pinned (a hips bone below a root bone). */
  extraRootNames?: readonly string[];
  /**
   * Keep the vertical part of root-bone position tracks (default true). `false` pins the bone
   * completely, for a rig whose vertical bob should not show.
   */
  keepVertical?: boolean;
}

/** Position tracks on the model's top-level nodes dropped (where exporters put root motion). */
export function withoutRootMotion(
  clips: readonly AnimationClip[],
  rootNodeNames: ReadonlySet<string>,
): AnimationClip[] {
  return clips.map((clip) => {
    const tracks = clip.tracks.filter((track) => {
      const { node, property } = trackTarget(track);
      return !(property === 'position' && (node === '' || rootNodeNames.has(node)));
    });
    return tracks.length === clip.tracks.length
      ? clip
      : new AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
  });
}

/** Bones whose parent is not a bone: the skeleton's roots. */
export function rootBonesOf(model: Object3D): Bone[] {
  const roots: Bone[] = [];
  model.traverse((node) => {
    const bone = node as Bone;
    if (bone.isBone && !(bone.parent as Bone | null)?.isBone) {
      roots.push(bone);
    }
  });
  return roots;
}

/** The node a track animates (`mixamorigHips.position` -> `mixamorigHips`) and its property. */
function trackTarget(track: KeyframeTrack): { node: string; property: string } {
  const dot = track.name.lastIndexOf('.');
  return { node: track.name.slice(0, dot), property: track.name.slice(dot + 1) };
}

/**
 * World up expressed in `bone`'s parent space, relative to `model`. A Mixamo armature is
 * turned a quarter round X and scaled 0.01, so "up" for its hips is local Z, not Y.
 */
function localUp(bone: Object3D, model: Object3D): Vector3 {
  model.updateWorldMatrix(true, true);
  const parent = bone.parent ?? model;
  const relative = new Matrix4().copy(model.matrixWorld).invert().multiply(parent.matrixWorld);
  const rotation = new Quaternion();
  relative.decompose(new Vector3(), rotation, new Vector3());
  return new Vector3(0, 1, 0).applyQuaternion(rotation.invert()).normalize();
}

export function withoutRootMotionFor(
  clips: readonly AnimationClip[],
  model: Object3D,
  options: RootMotionOptions = {},
): AnimationClip[] {
  const keepVertical = options.keepVertical !== false;
  const topLevel = new Set<string>([model.name, ...model.children.map((child) => child.name)]);
  const roots = new Map<string, { rest: Vector3; up: Vector3 }>();
  const consider = (bone: Object3D) => {
    if (topLevel.has(bone.name) || bone.name === '') {
      return;
    }
    roots.set(bone.name, {
      rest: bone.position.clone(),
      up: keepVertical ? localUp(bone, model) : new Vector3(0, 0, 0),
    });
  };
  for (const bone of rootBonesOf(model)) {
    consider(bone);
  }
  for (const name of options.extraRootNames ?? []) {
    const node = model.getObjectByName(name);
    if (node) {
      consider(node);
    }
  }
  return withoutRootMotion(clips, topLevel).map((clip) => {
    let changed = false;
    const tracks = clip.tracks.map((track) => {
      const { node, property } = trackTarget(track);
      const root = property === 'position' ? roots.get(node) : undefined;
      // 3 per key, or 9 for a glTF CUBICSPLINE track (tangents and value).
      if (!root || (track.getValueSize() !== 3 && track.getValueSize() !== 9)) {
        return track;
      }
      changed = true;
      return pinHorizontal(track, root.rest, root.up);
    });
    return changed ? new AnimationClip(clip.name, clip.duration, tracks, clip.blendMode) : clip;
  });
}

/**
 * A copy of a position track whose every key is the rest position plus its vertical offset.
 * A glTF CUBICSPLINE track stores (in-tangent, value, out-tangent) per key: tangents keep only
 * their vertical part, and the loader's spline interpolant is carried over.
 */
function pinHorizontal(track: KeyframeTrack, rest: Vector3, up: Vector3): KeyframeTrack {
  const source = track.values;
  const values = new Float32Array(source.length);
  const cubic = source.length === track.times.length * 9;
  const key = new Vector3();
  for (let i = 0; i < source.length; i += 3) {
    key.fromArray(source, i);
    const isTangent = cubic && (i / 3) % 3 !== 1;
    if (isTangent) {
      key.copy(up).multiplyScalar(key.dot(up));
    } else {
      const rise = key.sub(rest).dot(up);
      key.copy(rest).addScaledVector(up, rise);
    }
    values[i] = key.x;
    values[i + 1] = key.y;
    values[i + 2] = key.z;
  }
  const copy = new VectorKeyframeTrack(track.name, Array.from(track.times), Array.from(values));
  if (cubic) {
    // GLTFLoader replaces `createInterpolant` on a CUBICSPLINE track; keep its spline.
    type WithFactory = { createInterpolant?: unknown };
    (copy as unknown as WithFactory).createInterpolant = (
      track as unknown as WithFactory
    ).createInterpolant;
  } else {
    copy.setInterpolation(track.getInterpolation());
  }
  return copy;
}
