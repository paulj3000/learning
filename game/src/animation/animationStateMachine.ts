/**
 * A generic, data-driven animation state machine (GE-030).
 *
 * It decides which clips play, at what weight and speed, for a `PlayerMovementState`
 * (contracts/player.ts). It owns no mixer: it returns an `AnimationFrame` of clip weights that
 * `threeAnimationDriver.ts` applies. It never moves anything: the canonical transform alone
 * places the avatar, and a clip's travel is removed by `rootMotion.ts`.
 *
 * Data, not code, says how it behaves:
 * - `movementRoles` maps a movement state to an animation **role** (`idle`, `walk`, `jump`...);
 * - the avatar's own `animationMap` maps roles to clip names, so any rig works;
 * - each role lists `fallbacks`, tried in order when the avatar has no clip for it. The
 *   pseudo-role `ground` means "whatever the feet are doing": idle, walk or run by achieved
 *   speed. So a model with no Jump clip keeps walk or idle while airborne, and no Fall or Land
 *   clip falls back to Jump or the ground clip (jumping standard, "Camera and animation");
 * - `fades` gives crossfade seconds per transition (`from>to`, `*` as a wildcard).
 *
 * Ground clips (idle, walk, run) form one **locomotion** state whose internal mix follows the
 * achieved horizontal speed (`blending.ts`), so the feet stop when the body is blocked.
 */

import type { PlayerMovementState } from '../contracts/player';
import { CrossfadeBlender, locomotionBlend, type ClipWeights } from './blending';

/** Role name to clip name, as an avatar authors it. */
export type AnimationMap = Readonly<Partial<Record<string, string>>>;

export const GROUND_ROLE = 'ground';
const LOCOMOTION = 'locomotion';
const LOCOMOTION_ROLES: ReadonlySet<string> = new Set(['idle', 'walk', 'run', GROUND_ROLE]);

export interface AnimationStateSpec {
  /** Whether the clip loops. A one-shot holds its last pose until the state changes. */
  readonly loop: boolean;
  /** Roles tried, in order, when the avatar has no clip for this one. */
  readonly fallbacks: readonly string[];
}

export interface AnimationMachineDefinition {
  readonly movementRoles: Readonly<Record<PlayerMovementState, string>>;
  readonly states: Readonly<Record<string, AnimationStateSpec>>;
  readonly defaultFade: number;
  /** Crossfade seconds by `from>to` (a state name; `locomotion` for idle, walk and run). */
  readonly fades: Readonly<Record<string, number>>;
}

export const DEFAULT_ANIMATION_DEFINITION: AnimationMachineDefinition = Object.freeze({
  movementRoles: Object.freeze({
    IDLE: GROUND_ROLE,
    WALK: GROUND_ROLE,
    RUN: GROUND_ROLE,
    SPRINT: GROUND_ROLE,
    JUMP_START: 'jump',
    AIRBORNE: 'jump',
    FALLING: 'fall',
    LANDING: 'land',
    CLIMBING: 'climb',
    SWIMMING: 'swim',
    SLIDING: 'slide',
  }),
  states: Object.freeze({
    idle: { loop: true, fallbacks: [] },
    walk: { loop: true, fallbacks: ['idle'] },
    run: { loop: true, fallbacks: ['walk', 'idle'] },
    jump: { loop: false, fallbacks: [GROUND_ROLE] },
    fall: { loop: true, fallbacks: ['jump', GROUND_ROLE] },
    land: { loop: false, fallbacks: [GROUND_ROLE] },
    climb: { loop: true, fallbacks: ['idle'] },
    swim: { loop: true, fallbacks: ['walk', 'idle'] },
    slide: { loop: true, fallbacks: ['idle'] },
    interact: { loop: false, fallbacks: [] },
    celebrate: { loop: false, fallbacks: [] },
  }),
  defaultFade: 0.2,
  fades: Object.freeze({
    '*>jump': 0.1,
    '*>fall': 0.15,
    '*>land': 0.08,
    'land>locomotion': 0.15,
    '*>interact': 0.12,
    '*>celebrate': 0.12,
  }),
});

export interface AnimationInput {
  movement: PlayerMovementState;
  /** The achieved horizontal speed, m/s (the transform's velocity: zero into a wall). */
  horizontalSpeed: number;
  /** Top walking speed, m/s: the walk cycle plays at its authored speed at this pace. */
  walkSpeed: number;
  /** Running pace, m/s. Defaults to the walk speed times 1.6. */
  runSpeed?: number;
}

export interface AnimationFrame {
  /** The state shown: `locomotion`, or a role such as `jump`. */
  readonly state: string;
  /** The role the movement state asked for, before fallbacks. */
  readonly requestedRole: string;
  /** Clip name to weight; sums to 1 (empty when the avatar has no usable clip). */
  readonly weights: ClipWeights;
  /** Clip name to playback speed. */
  readonly timeScales: Readonly<Record<string, number>>;
  /** Clips that play once and hold (a jump or land), by name. */
  readonly oneShots: readonly string[];
}

interface Resolved {
  /** The state (category) and the clip weights wanted. */
  state: string;
  weights: Record<string, number>;
  timeScales: Record<string, number>;
}

export class AnimationStateMachine {
  private readonly blender = new CrossfadeBlender();
  private state = '';
  private gesture: { role: string; remaining: number } | null = null;
  private last: AnimationFrame = { state: '', requestedRole: '', weights: {}, timeScales: {}, oneShots: [] };

  private readonly map: AnimationMap;
  private readonly definition: AnimationMachineDefinition;

  constructor(map: AnimationMap, definition: AnimationMachineDefinition = DEFAULT_ANIMATION_DEFINITION) {
    this.map = map;
    this.definition = definition;
  }

  get currentState(): string {
    return this.state;
  }

  /** Whether the avatar has its own clip for `role` (no fallbacks). */
  hasClip(role: string): boolean {
    return typeof this.map[role] === 'string' && this.map[role] !== '';
  }

  /**
   * A short one-shot gesture (interact, celebrate) over the current state. False when the
   * avatar has no clip for it. `durationSeconds` is the clip's length.
   */
  playGesture(role: string, durationSeconds: number): boolean {
    if (!this.hasClip(role) || !(durationSeconds > 0)) {
      return false;
    }
    this.gesture = { role, remaining: durationSeconds };
    return true;
  }

  update(input: AnimationInput, deltaSeconds: number): AnimationFrame {
    const dt = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
    let requested = this.definition.movementRoles[input.movement] ?? GROUND_ROLE;
    if (this.gesture) {
      this.gesture.remaining -= dt;
      if (this.gesture.remaining <= 0) {
        this.gesture = null;
      } else {
        requested = this.gesture.role;
      }
    }
    const resolved = this.resolve(requested, input);
    if (!resolved) {
      // Nothing playable: hold whatever is showing rather than snapping to the bind pose.
      return { ...this.last, requestedRole: requested, weights: this.blender.advance(dt) };
    }
    if (resolved.state !== this.state) {
      if (this.state === '') {
        this.blender.snap(resolved.weights);
      } else {
        this.blender.retarget(resolved.weights, this.fadeSeconds(this.state, resolved.state));
      }
      this.state = resolved.state;
    } else {
      this.blender.setTarget(resolved.weights);
    }
    const weights = this.blender.advance(dt);
    const oneShots = Object.keys(weights).filter((clip) => this.isOneShotClip(clip));
    this.last = { state: resolved.state, requestedRole: requested, weights, timeScales: resolved.timeScales, oneShots };
    return this.last;
  }

  private isOneShotClip(clip: string): boolean {
    return Object.entries(this.map).some(([role, name]) => name === clip && this.definition.states[role]?.loop === false);
  }

  private fadeSeconds(from: string, to: string): number {
    const f = this.definition.fades;
    return f[`${from}>${to}`] ?? f[`${from}>*`] ?? f[`*>${to}`] ?? this.definition.defaultFade;
  }

  /** Walks `role` then its fallbacks; the first one the avatar can play wins. */
  private resolve(role: string, input: AnimationInput): Resolved | null {
    const seen = new Set<string>();
    const queue = [role];
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (seen.has(next)) {
        continue;
      }
      seen.add(next);
      if (LOCOMOTION_ROLES.has(next)) {
        const ground = this.locomotion(input);
        if (ground) {
          return ground;
        }
      } else if (this.hasClip(next)) {
        return { state: next, weights: { [this.map[next]!]: 1 }, timeScales: { [this.map[next]!]: 1 } };
      }
      queue.unshift(...(this.definition.states[next]?.fallbacks ?? []));
    }
    return null;
  }

  private locomotion(input: AnimationInput): Resolved | null {
    const { idle, walk, run } = { idle: this.map.idle, walk: this.map.walk, run: this.map.run };
    if (!idle && !walk && !run) {
      return null;
    }
    const walkSpeed = input.walkSpeed > 0 ? input.walkSpeed : 2;
    const blend = locomotionBlend(input.horizontalSpeed, {
      walkSpeed,
      runSpeed: input.runSpeed ?? walkSpeed * 1.6,
      hasRun: Boolean(run),
    });
    const weights: Record<string, number> = {};
    const add = (clip: string | undefined, w: number, fallback: string | undefined) => {
      const target = clip ?? fallback;
      if (target && w > 0) {
        weights[target] = (weights[target] ?? 0) + w;
      }
    };
    add(idle, blend.weights.idle, walk);
    add(walk, blend.weights.walk, idle ?? run);
    add(run, blend.weights.run, walk);
    const timeScales: Record<string, number> = {};
    if (walk) timeScales[walk] = blend.timeScale.walk;
    if (run) timeScales[run] = blend.timeScale.run;
    if (idle) timeScales[idle] = 1;
    return { state: LOCOMOTION, weights, timeScales };
  }
}
