import { AnimationClip, Bone, Group, Object3D, VectorKeyframeTrack, QuaternionKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';
import { PLAYER_MOVEMENT_STATES, type PlayerMovementState } from '../contracts/player';
import { AnimationStateMachine, type AnimationInput } from './animationStateMachine';
import { CrossfadeBlender, easeFade, lerpWeights, locomotionBlend, normaliseWeights } from './blending';
import { withoutRootMotionFor } from './rootMotion';
import { createThreeAnimationDriver, type ActionLike, type MixerLike } from './threeAnimationDriver';

const sum = (w: Record<string, number> | Readonly<Record<string, number>>) => Object.values(w).reduce((a, b) => a + b, 0);

describe('blending math', () => {
  it('normalises weights and drops junk', () => {
    expect(normaliseWeights({ a: 2, b: 2 })).toEqual({ a: 0.5, b: 0.5 });
    expect(normaliseWeights({ a: -1, b: NaN, c: 0 })).toEqual({});
    expect(sum(normaliseWeights({ a: 3, b: 1, c: 1e-9 }))).toBeCloseTo(1);
  });

  it('lerps over the union of clips and always sums to 1', () => {
    const mid = lerpWeights({ a: 1 }, { b: 1 }, 0.25);
    expect(mid.a).toBeCloseTo(0.75);
    expect(mid.b).toBeCloseTo(0.25);
    expect(lerpWeights({ a: 1 }, { b: 1 }, 5)).toEqual({ b: 1 });
  });

  it('eases a fade in and out', () => {
    expect(easeFade(0)).toBe(0);
    expect(easeFade(1)).toBe(1);
    expect(easeFade(0.5)).toBeCloseTo(0.5);
    expect(easeFade(0.1)).toBeLessThan(0.1);
  });

  it('crossfades over the duration and ends exactly on the target', () => {
    const blender = new CrossfadeBlender();
    blender.snap({ idle: 1 });
    blender.retarget({ walk: 1 }, 0.2);
    const halfway = blender.advance(0.1);
    expect(halfway.idle).toBeCloseTo(0.5);
    expect(sum(halfway)).toBeCloseTo(1);
    expect(blender.advance(0.2)).toEqual({ walk: 1 });
    expect(blender.fading).toBe(false);
  });

  it('starts an interrupting fade from the weights reached, never snapping', () => {
    const blender = new CrossfadeBlender();
    blender.snap({ idle: 1 });
    blender.retarget({ walk: 1 }, 0.2);
    const mid = { ...blender.advance(0.1) };
    blender.retarget({ jump: 1 }, 0.1);
    const start = blender.advance(0);
    expect(start.idle).toBeCloseTo(mid.idle!);
    expect(start.walk).toBeCloseTo(mid.walk!);
    const later = blender.advance(0.05);
    expect(sum(later)).toBeCloseTo(1);
    expect(later.jump).toBeGreaterThan(0);
    expect(blender.advance(1)).toEqual({ jump: 1 });
  });

  it('a zero duration snaps; setTarget moves a running fade without restarting it', () => {
    const blender = new CrossfadeBlender();
    blender.snap({ a: 1 });
    blender.retarget({ b: 1 }, 0);
    expect(blender.weights).toEqual({ b: 1 });
    blender.retarget({ c: 1 }, 1);
    blender.advance(0.5);
    blender.setTarget({ d: 1 });
    expect(sum(blender.advance(0.1))).toBeCloseTo(1);
  });

  it('matches walk and run weights to the achieved speed', () => {
    const spec = { walkSpeed: 2, runSpeed: 4, hasRun: true };
    expect(locomotionBlend(0, spec).weights).toEqual({ idle: 1, walk: 0, run: 0 });
    expect(locomotionBlend(2, spec).weights.walk).toBeCloseTo(1);
    const between = locomotionBlend(3, spec).weights;
    expect(between.walk).toBeCloseTo(0.5);
    expect(between.run).toBeCloseTo(0.5);
    expect(locomotionBlend(9, spec).weights.run).toBeCloseTo(1);
    for (const s of [0, 0.1, 0.3, 1, 2, 2.5, 4, 8, NaN, -3]) {
      const w = locomotionBlend(s, spec).weights;
      expect(w.idle + w.walk + w.run).toBeCloseTo(1);
    }
  });

  it('plays the walk cycle faster for the run band when there is no run clip, within bounds', () => {
    const noRun = locomotionBlend(3.4, { walkSpeed: 2, runSpeed: 4, hasRun: false });
    expect(noRun.weights.run).toBe(0);
    expect(noRun.timeScale.walk).toBeCloseTo(1.7);
    expect(locomotionBlend(10, { walkSpeed: 2, runSpeed: 4, hasRun: false }).timeScale.walk).toBeCloseTo(1.7);
    expect(locomotionBlend(2, { walkSpeed: 2, runSpeed: 4, hasRun: true }).timeScale.walk).toBeCloseTo(1);
    expect(locomotionBlend(0.5, { walkSpeed: 2, runSpeed: 4, hasRun: true }).timeScale.walk).toBeCloseTo(0.6);
  });
});

const FULL = { idle: 'Idle', walk: 'Walk', run: 'Run', jump: 'Jump', fall: 'Fall', land: 'Land', interact: 'Point' };

function input(movement: PlayerMovementState, horizontalSpeed = 0): AnimationInput {
  return { movement, horizontalSpeed, walkSpeed: 2, runSpeed: 4 };
}

function settled(machine: AnimationStateMachine, i: AnimationInput) {
  let frame = machine.update(i, 0);
  for (let n = 0; n < 60; n += 1) frame = machine.update(i, 1 / 30);
  return frame;
}

describe('animation state machine', () => {
  it('maps every movement state to something for a full rig', () => {
    for (const state of PLAYER_MOVEMENT_STATES) {
      const machine = new AnimationStateMachine(FULL);
      const frame = settled(machine, input(state, 0));
      expect(sum(frame.weights)).toBeCloseTo(1);
    }
  });

  it('shows idle, walk and run clips by achieved speed', () => {
    expect(settled(new AnimationStateMachine(FULL), input('IDLE')).weights).toEqual({ Idle: 1 });
    expect(settled(new AnimationStateMachine(FULL), input('WALK', 2)).weights).toEqual({ Walk: 1 });
    expect(settled(new AnimationStateMachine(FULL), input('SPRINT', 6)).weights).toEqual({ Run: 1 });
  });

  it('stops the feet when blocked: a WALK state with zero achieved speed shows idle', () => {
    expect(settled(new AnimationStateMachine(FULL), input('WALK', 0)).weights).toEqual({ Idle: 1 });
  });

  it('uses the avatar own clip names through its animationMap', () => {
    const machine = new AnimationStateMachine({ idle: 'rig|stand', jump: 'rig|hop' });
    expect(settled(machine, input('AIRBORNE')).weights).toEqual({ 'rig|hop': 1 });
  });

  it('plays Jump while airborne, Fall while falling, Land on landing', () => {
    const m = new AnimationStateMachine(FULL);
    expect(settled(m, input('JUMP_START')).weights).toEqual({ Jump: 1 });
    expect(settled(m, input('FALLING')).weights).toEqual({ Fall: 1 });
    expect(settled(m, input('LANDING')).weights).toEqual({ Land: 1 });
  });

  it('keeps walk or idle in the air when the model has no jump clip', () => {
    const map = { idle: 'Idle', walk: 'Walk' };
    expect(settled(new AnimationStateMachine(map), input('AIRBORNE', 2)).weights).toEqual({ Walk: 1 });
    expect(settled(new AnimationStateMachine(map), input('JUMP_START', 0)).weights).toEqual({ Idle: 1 });
    expect(settled(new AnimationStateMachine(map), input('FALLING', 2)).weights).toEqual({ Walk: 1 });
  });

  it('falls back from Fall to Jump, and from Land to the ground clip', () => {
    const map = { idle: 'Idle', walk: 'Walk', jump: 'Jump' };
    expect(settled(new AnimationStateMachine(map), input('FALLING', 2)).weights).toEqual({ Jump: 1 });
    expect(settled(new AnimationStateMachine(map), input('LANDING', 0)).weights).toEqual({ Idle: 1 });
    expect(settled(new AnimationStateMachine(map), input('LANDING', 2)).weights).toEqual({ Walk: 1 });
  });

  it('never throws and holds the last pose for a model with no clips at all', () => {
    const machine = new AnimationStateMachine({});
    expect(machine.update(input('WALK', 2), 0.016).weights).toEqual({});
    expect(machine.update(input('AIRBORNE'), 0.016).weights).toEqual({});
  });

  it('crossfades with the configured duration and survives an interruption mid-fade', () => {
    const machine = new AnimationStateMachine(FULL);
    settled(machine, input('IDLE'));
    const a = machine.update(input('JUMP_START'), 0.05);
    expect(a.weights.Jump).toBeGreaterThan(0);
    expect(a.weights.Idle).toBeGreaterThan(0);
    const b = machine.update(input('FALLING'), 0.01);
    expect(sum(b.weights)).toBeCloseTo(1);
    expect(b.weights.Jump).toBeGreaterThan(0);
    expect(b.weights.Fall).toBeGreaterThanOrEqual(0);
    expect(settled(machine, input('FALLING')).weights).toEqual({ Fall: 1 });
  });

  it('marks jump and land as one-shots and walk as looping', () => {
    const machine = new AnimationStateMachine(FULL);
    expect(settled(machine, input('AIRBORNE')).oneShots).toEqual(['Jump']);
    expect(settled(machine, input('WALK', 2)).oneShots).toEqual([]);
  });

  it('plays a gesture only when the avatar has its clip, then returns', () => {
    const machine = new AnimationStateMachine(FULL);
    settled(machine, input('IDLE'));
    expect(machine.playGesture('celebrate', 1)).toBe(false);
    expect(machine.playGesture('interact', 0.5)).toBe(true);
    expect(settled(machine, input('IDLE')).weights).toEqual({ Idle: 1 });
    const machine2 = new AnimationStateMachine(FULL);
    settled(machine2, input('IDLE'));
    machine2.playGesture('interact', 5);
    expect(settled(machine2, input('IDLE')).weights).toEqual({ Point: 1 });
  });

  it('honours custom definitions (data driven)', () => {
    const machine = new AnimationStateMachine(
      { idle: 'I', swim: 'S' },
      {
        movementRoles: { IDLE: 'idle', WALK: 'idle', RUN: 'idle', SPRINT: 'idle', JUMP_START: 'idle', AIRBORNE: 'idle', FALLING: 'idle', LANDING: 'idle', CLIMBING: 'idle', SWIMMING: 'swim', SLIDING: 'idle' },
        states: { idle: { loop: true, fallbacks: [] }, swim: { loop: true, fallbacks: ['idle'] } },
        defaultFade: 0,
        fades: {},
      },
    );
    expect(machine.update(input('SWIMMING'), 0).weights).toEqual({ S: 1 });
  });
});

describe('three animation driver', () => {
  function fakeMixer() {
    const log: string[] = [];
    const actions = new Map<string, ActionLike & { weight: number; scale: number; playing: boolean; loop: number }>();
    const mixer: MixerLike = {
      clipAction(clip) {
        const action = {
          enabled: false,
          clampWhenFinished: false,
          weight: 0,
          scale: 1,
          playing: false,
          loop: -1,
          play() { action.playing = true; log.push(`play ${clip.name}`); },
          stop() { action.playing = false; log.push(`stop ${clip.name}`); },
          reset() { log.push(`reset ${clip.name}`); },
          setLoop(mode: number) { action.loop = mode; },
          setEffectiveWeight(w: number) { action.weight = w; },
          setEffectiveTimeScale(s: number) { action.scale = s; },
        };
        actions.set(clip.name, action);
        return action;
      },
      update: (dt) => void log.push(`update ${dt}`),
    };
    return { mixer, actions, log };
  }
  const clips = ['Idle', 'Walk', 'Jump'].map((n) => new AnimationClip(n, 1, []));

  it('applies weights and speeds, starts clips once and stops faded-out ones', () => {
    const { mixer, actions, log } = fakeMixer();
    const driver = createThreeAnimationDriver(mixer, clips);
    driver.apply({ state: 'locomotion', requestedRole: 'ground', weights: { Idle: 0.5, Walk: 0.5 }, timeScales: { Walk: 1.2 }, oneShots: [] });
    expect(actions.get('Walk')!.weight).toBe(0.5);
    expect(actions.get('Walk')!.scale).toBe(1.2);
    driver.apply({ state: 'locomotion', requestedRole: 'ground', weights: { Idle: 0.2, Walk: 0.8 }, timeScales: {}, oneShots: [] });
    expect(log.filter((l) => l === 'play Walk')).toHaveLength(1);
    expect(actions.get('Walk')!.scale).toBe(1);
    driver.apply({ state: 'jump', requestedRole: 'jump', weights: { Jump: 1 }, timeScales: {}, oneShots: ['Jump'] });
    expect(log).toContain('stop Idle');
    expect(log).toContain('stop Walk');
    expect(actions.get('Jump')!.clampWhenFinished).toBe(true);
    expect(driver.appliedWeights()).toEqual({ Idle: 0, Walk: 0, Jump: 1 });
    driver.update(0.016);
    expect(log.at(-1)).toBe('update 0.016');
    driver.dispose();
    expect(driver.clipNames()).toEqual([]);
  });
});

describe('root motion correction', () => {
  /** Scene > Armature > Hips(root bone) > Spine, as a Mixamo export lays it out. */
  function rig() {
    const model = new Group();
    model.name = 'Scene';
    const armature = new Object3D();
    armature.name = 'Armature';
    const hips = new Bone();
    hips.name = 'Hips';
    hips.position.set(0, 1, 0);
    const spine = new Bone();
    spine.name = 'Spine';
    hips.add(spine);
    armature.add(hips);
    model.add(armature);
    return { model, hips };
  }

  const walkClip = () =>
    new AnimationClip('Walk', 1, [
      new VectorKeyframeTrack('Hips.position', [0, 0.5, 1], [0, 1, 0, 0.3, 1.1, 2, 0.6, 1, 4]),
      new VectorKeyframeTrack('Spine.position', [0, 1], [0, 0, 0, 0, 0.2, 1]),
      new QuaternionKeyframeTrack('Hips.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
      new VectorKeyframeTrack('Scene.position', [0, 1], [0, 0, 0, 0, 0, 5]),
    ]);

  it('pins the root bone horizontally and keeps its vertical bob', () => {
    const { model } = rig();
    const [fixed] = withoutRootMotionFor([walkClip()], model);
    const hips = fixed!.tracks.find((t) => t.name === 'Hips.position')!;
    expect(Array.from(hips.values)).toEqual([0, 1, 0, 0, 1.1, 0, 0, 1, 0].map((v) => expect.closeTo(v, 5)));
  });

  it('drops top-level position tracks and keeps rotations and deeper positions', () => {
    const { model } = rig();
    const [fixed] = withoutRootMotionFor([walkClip()], model);
    const names = fixed!.tracks.map((t) => t.name);
    expect(names).not.toContain('Scene.position');
    expect(names).toContain('Hips.quaternion');
    expect(names).toContain('Spine.position');
    expect(fixed!.tracks.find((t) => t.name === 'Spine.position')!.values[5]).toBe(1);
  });

  it('never changes the loaded clip', () => {
    const { model } = rig();
    const clip = walkClip();
    const before = Array.from(clip.tracks[0]!.values);
    const [fixed] = withoutRootMotionFor([clip], model);
    expect(fixed).not.toBe(clip);
    expect(Array.from(clip.tracks[0]!.values)).toEqual(before);
  });

  it('returns a clip that has no root motion unchanged', () => {
    const { model } = rig();
    const clip = new AnimationClip('Wave', 1, [new QuaternionKeyframeTrack('Spine.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])]);
    expect(withoutRootMotionFor([clip], model)[0]).toBe(clip);
  });

  it('pins an extra named hips bone below a root bone, and a full pin when keepVertical is false', () => {
    const model = new Group();
    model.name = 'Scene';
    const root = new Bone();
    root.name = 'Root';
    const hips = new Bone();
    hips.name = 'Pelvis';
    hips.position.set(0, 0.9, 0);
    root.add(hips);
    const holder = new Object3D();
    holder.name = 'Rig';
    holder.add(root);
    model.add(holder);
    const clip = new AnimationClip('Run', 1, [new VectorKeyframeTrack('Pelvis.position', [0, 1], [0, 0.9, 0, 1, 1.0, 3])]);
    const [fixed] = withoutRootMotionFor([clip], model, { extraRootNames: ['Pelvis'] });
    expect(Array.from(fixed!.tracks[0]!.values.slice(3))).toEqual([expect.closeTo(0, 5), expect.closeTo(1.0, 5), expect.closeTo(0, 5)]);
    const [flat] = withoutRootMotionFor([clip], model, { extraRootNames: ['Pelvis'], keepVertical: false });
    expect(Array.from(flat!.tracks[0]!.values.slice(3))).toEqual([expect.closeTo(0, 5), expect.closeTo(0.9, 5), expect.closeTo(0, 5)]);
  });

  it('handles a Mixamo armature turned a quarter round X, where up is local Z', () => {
    const { model, hips } = rig();
    const armature = model.getObjectByName('Armature')!;
    armature.rotation.x = -Math.PI / 2;
    armature.scale.setScalar(0.01);
    armature.updateMatrixWorld(true);
    hips.position.set(0, 0, 100);
    // Forward travel on local Y (world -Z after the turn), a rise on local Z (world up).
    const clip = new AnimationClip('Walk', 1, [new VectorKeyframeTrack('Hips.position', [0, 1], [0, 0, 100, 0, 50, 110])]);
    const [fixed] = withoutRootMotionFor([clip], model);
    const v = Array.from(fixed!.tracks[0]!.values.slice(3));
    expect(v[0]).toBeCloseTo(0, 4);
    expect(v[1]).toBeCloseTo(0, 4);
    expect(v[2]).toBeCloseTo(110, 3);
  });
});
