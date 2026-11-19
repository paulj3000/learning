import {
  AnimationClip,
  Bone,
  Group,
  Object3D,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from 'three';

/** Test fixtures for root-motion handling (Defect 1): procedural, no production GLB needed. */

/**
 * A Mixamo-shaped rig: `Scene > Armature (turned +90 deg about X, scale 0.01) > Hips > Spine`.
 * Hips local +Y is world forward (+Z) and local -Z is world up, as in a real export. Rest:
 * hips 1 m up.
 */
export function mixamoRig(): { scene: Group; hips: Bone; spine: Bone } {
  const scene = new Group();
  scene.name = 'Scene';
  const armature = new Object3D();
  armature.name = 'Armature';
  armature.rotation.x = Math.PI / 2;
  armature.scale.setScalar(0.01);
  const hips = new Bone();
  hips.name = 'mixamorigHips';
  hips.position.set(0, 0, -100);
  const spine = new Bone();
  spine.name = 'mixamorigSpine';
  spine.position.set(0, 10, 0);
  scene.add(armature);
  armature.add(hips);
  hips.add(spine);
  return { scene, hips, spine };
}

/** A walk that travels 1.5 m forward over its cycle and bobs 5 cm, as a non-in-place export does. */
export function rootMotionWalk(): AnimationClip {
  return new AnimationClip('Walk', 1, [
    new VectorKeyframeTrack(
      'mixamorigHips.position',
      [0, 0.5, 1],
      [0, 0, -100, 0, 75, -105, 0, 150, -100],
    ),
    new QuaternionKeyframeTrack(
      'mixamorigSpine.quaternion',
      [0, 1],
      [0, 0, 0, 1, 0, 0.1, 0, 0.995],
    ),
  ]);
}
