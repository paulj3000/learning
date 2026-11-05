/**
 * NPC engine contract (contract v1, docs/NPC_MANAGER_CONTRACTS.md section 6).
 *
 * The engine (`../engine/`, Three.js only, ADR-020) renders, animates and moves NPCs. It never
 * calls the network, validates answers, awards progress or calls AI: it emits typed events and
 * obeys typed commands. Engine modules must not import React, API clients, Amplify or AWS SDKs.
 */

import type { AdventureEvent, AnimationState } from './vocabulary';
import type { BehaviorSpec, RuntimeCharacter, RuntimePlacement } from './types';

export type InputMethod = 'pointer' | 'keyboard' | 'touch';

export type NpcLoadFailure = 'model_unavailable' | 'timeout' | 'invalid_model' | 'aborted';

/** Behaviour states the behaviour state machine reports (LAI-NPC-020). */
export type BehaviorState =
  | 'idle'
  | 'moving'
  | 'paused'
  | 'following'
  | 'waiting_for_player'
  | 'reacting'
  | 'interrupted'
  | 'returning';

export type NpcEngineEvent =
  | { type: 'npc.loaded'; placementKey: string; npcId: string; placeholder: boolean }
  | { type: 'npc.load_failed'; placementKey: string; npcId: string; reason: NpcLoadFailure }
  | { type: 'npc.approached'; placementKey: string; npcId: string }
  | { type: 'npc.left'; placementKey: string; npcId: string }
  | { type: 'npc.interact_requested'; placementKey: string; npcId: string; via: InputMethod }
  | { type: 'npc.waypoint_reached'; placementKey: string; index: number }
  | { type: 'npc.behavior_changed'; placementKey: string; state: BehaviorState }
  | { type: 'npc.animation_finished'; placementKey: string; state: AnimationState };

export type NpcEngineEventType = NpcEngineEvent['type'];

export type AnimationMode = 'loop' | 'once';

export type NpcCommand =
  | {
      type: 'animate';
      placementKey: string;
      state: AnimationState;
      /** Default: loop for LOOPING_ANIMATION_STATES, once otherwise. */
      mode?: AnimationMode;
      /** ANIMATION_PRIORITY band; default dialogue. */
      priority?: number;
    }
  | { type: 'stop_animation'; placementKey: string; priority: number }
  | { type: 'face'; placementKey: string; target: 'player' | { yaw: number } }
  /** Play each NPC's configured reaction (behaviour `reactions`), or only one NPC's. */
  | { type: 'react'; event: AdventureEvent; placementKey?: string }
  /** Pause movement for a conversation; `resume_behavior` restores where it left off. */
  | { type: 'interrupt_behavior'; placementKey: string; reason: 'dialogue' | 'scripted' }
  | { type: 'resume_behavior'; placementKey: string }
  | { type: 'set_visible'; placementKey: string; visible: boolean };

/** Everything the engine needs to place one NPC, joined from an `NpcSceneResponse`. */
export interface NpcSpawn {
  placement: RuntimePlacement;
  character: RuntimeCharacter;
}

export interface PlayerPose {
  x: number;
  z: number;
}

/**
 * Behaviour controller (LAI-NPC-019 to 024; implemented in `../behavior/`, consumed by the
 * runtime in `../engine/`). Pure logic: no Three.js objects, no React, no network. The runtime
 * calls `update` once per frame and applies the frame to the NPC's root and animator.
 */
export type Locomotion = 'idle' | 'walk' | 'run';

export interface BehaviorFrame {
  /** World position on the ground plane and facing (radians), after boundaries. */
  x: number;
  z: number;
  yaw: number;
  locomotion: Locomotion;
  /** `npc.waypoint_reached` and `npc.behavior_changed` events produced this frame. */
  events: NpcEngineEvent[];
}

export interface BehaviorController {
  update(deltaSeconds: number, player: PlayerPose | null): BehaviorFrame;
  /** Stop moving (a conversation or a scripted beat) and remember where to resume. */
  interrupt(reason: 'dialogue' | 'scripted'): void;
  /** Continue from where `interrupt` stopped. */
  resume(): void;
  /** The animation state configured for this adventure event (reaction), or null. */
  react(event: AdventureEvent): AnimationState | null;
  state(): BehaviorState;
  dispose(): void;
}

export interface BehaviorControllerArgs {
  placementKey: string;
  /** null: stationary, facing `home.yaw`. */
  spec: BehaviorSpec | null;
  home: { x: number; z: number; yaw: number };
  /** Existing scene collision (e.g. the location's colliders); true when blocked. */
  isBlocked?: (x: number, z: number) => boolean;
  /** Injected for deterministic tests (wander). Default Math.random. */
  random?: () => number;
}

export type BehaviorControllerFactory = (args: BehaviorControllerArgs) => BehaviorController;

/**
 * Lifecycle (LAI-NPC-008, -037):
 * 1. `mount(spawns)` adds a placeholder per spawn at once, then loads models in the background
 *    through the injected loader (shared cache; never one network request per frame). Mounting
 *    again replaces the previous set (removed NPCs are disposed).
 * 2. `update(dt, player)` is called once per frame by the host's render loop: mixers, behaviour,
 *    proximity. No allocation-heavy scene traversal; distant NPCs update at a lower rate.
 * 3. `send(command)` is synchronous and idempotent for repeated identical commands.
 * 4. `dispose()` aborts pending loads, stops and uncaches mixers, disposes cloned geometries,
 *    materials and textures it owns (never shared cached sources), removes listeners, detaches
 *    roots from the scene. Any call after `dispose` is a no-op.
 */
export interface NpcRuntime {
  mount(spawns: readonly NpcSpawn[]): void;
  update(deltaSeconds: number, player: PlayerPose | null): void;
  send(command: NpcCommand): void;
  subscribe(listener: (event: NpcEngineEvent) => void): () => void;
  /** The placement keys currently mounted. */
  placements(): string[];
  dispose(): void;
}
