/**
 * Shared plumbing for the gameplay components (Game Engine Core, gameplay components).
 *
 * Rules every component here follows (ADR-020 item 6, scoring standard):
 * - It detects **world facts** (the child stepped here, this plate is held) and emits
 *   presentation events plus gameplay **claims**. It never validates a learning answer,
 *   awards progress, grants an item or calls AI. Django confirms every claim.
 * - Required routes carry no timers, no loss and no lives. A fall or hazard asks the host to
 *   move the child to a checkpoint; nothing else changes.
 * - State machines are pure and step on the runtime's fixed `dt`, so they behave the same on
 *   every device and in tests.
 */

import type { GameplayEvent, GameplayEventFactory, GameplayEventPayloads, GameplayEventType } from '../contracts/gameplayEvents';
import type { EnginePresentationEventMap } from '../contracts/engineEvents';
import { PLAYER_ENTITY_ID, PlayerTransformComponent, type Vec3Like } from '../contracts/player';
import type { EngineRuntime } from '../core/runtime';
import type { EventMap } from '../core/eventBus';
import { defineService } from '../core/services';

export type GameplayRuntime = EngineRuntime<EventMap>;

// --- services the host provides ---------------------------------------------------------

/** Live accessibility settings. The host mutates the object when the child's setting changes. */
export interface GameplaySettings {
  reducedMotion: boolean;
}
export const GameplaySettingsService = defineService<GameplaySettings>('gameplay.settings');

/** Builds validated gameplay claims for the current realm, adventure and area. */
export const GameplayEventFactoryService = defineService<GameplayEventFactory>('gameplay.eventFactory');

/**
 * Host requirement check for doors, gates and portals: `true` when the requirement (an authored
 * id such as a quest step or a world change) is met. The engine never decides this itself.
 */
export type RequirementChecker = (requirementId: string) => boolean;
export const RequirementCheckService = defineService<RequirementChecker>('gameplay.requirements');

/** The reduced-motion multiplier for platforms, spin and drift (jumping standard: 60%). */
export const REDUCED_MOTION_SPEED_SCALE = 0.6;

// --- presentation events this package adds ----------------------------------------------

export type SteadyOrBlink = 'BLINK' | 'STEADY_DIM';

export interface HazardRecoveryRequest {
  hazardId: string;
  /** Authored kind, for copy and sound (WATER, LAVA, FALLING_ROCK, ...). */
  hazardKind: string;
  reason: 'HAZARD';
  /** The checkpoint to return to (latest reached, else the one the hazard names). */
  checkpointId: string | null;
  position: Readonly<Vec3Like>;
  yaw: number;
  /** Kind, localizable message key. Never a damage or lives message. */
  messageKey: string;
}

export type GameplayPresentationEventMap = {
  CollectiblePickedUp: { collectibleId: string };
  ChestStateChanged: { chestId: string; state: 'CLOSED' | 'OPENING' | 'OPEN'; replay: boolean };
  ChestBlocked: { chestId: string; reason: 'LOCKED_BY_CHALLENGE' | 'TOO_FAR' };
  DoorStateChanged: { doorId: string; state: 'LOCKED' | 'UNLOCKED' | 'OPENING' | 'OPEN' | 'CLOSING' };
  DoorBumped: { doorId: string };
  PortalRequested: { portalId: string; targetAreaId: string };
  PortalBlocked: { portalId: string };
  SwitchToggled: { switchId: string; on: boolean };
  PlatformPhaseChanged: { platformId: string; phase: string; warning: SteadyOrBlink | null };
  PlatformLaunch: { platformId: string; height: number };
  HazardRecoveryRequested: HazardRecoveryRequest;
  HazardTelegraph: { hazardId: string; phase: 'WARN' | 'ACTIVE' | 'REST'; secondsToImpact: number; steadyWarning: boolean };
  PuzzleProgress: { puzzleId: string; progress: number; total: number };
  PuzzleReset: { puzzleId: string };
  PuzzleCompleted: { puzzleId: string; viaAlternative: boolean };
  JumpRouteChosen: { challengeId: string; routeId: string; accessible: boolean };
  SurfaceFootstep: { surfaceId: string; footstepCue: string | null };
  AtmosphereChanged: { kind: 'LIGHTING' | 'WEATHER'; id: string };
};

export type AllPresentationEvents = EnginePresentationEventMap & GameplayPresentationEventMap;

export function emitPresentation<K extends keyof AllPresentationEvents>(runtime: GameplayRuntime, name: K, payload: AllPresentationEvents[K]): void {
  runtime.events.emit(name as never, payload as never);
}

/** Subscribes to any presentation event by name (tests and hosts). */
export function onPresentation<K extends keyof AllPresentationEvents>(
  runtime: GameplayRuntime,
  name: K,
  listener: (payload: AllPresentationEvents[K]) => void,
): () => void {
  return runtime.events.on(name as never, listener as never);
}

/** Emits a gameplay claim on the bus (`gameplay.event`). Returns null without a factory. */
export function emitClaim<T extends GameplayEventType>(
  runtime: GameplayRuntime,
  type: T,
  payload: GameplayEventPayloads[T],
): GameplayEvent<T> | null {
  const factory = runtime.services.get(GameplayEventFactoryService);
  if (!factory) {
    runtime.diagnostics.warn('NO_EVENT_FACTORY', { type });
    return null;
  }
  const event = factory.create(type, payload);
  if (!event) {
    // A factory may decline (an invalid claim it counted, or a lazy binding with no visit yet).
    return null;
  }
  runtime.events.emit('gameplay.event' as never, event as never);
  return event;
}

// --- reading the world -------------------------------------------------------------------

export function playerPosition(runtime: GameplayRuntime): Readonly<Vec3Like> | undefined {
  const entity = runtime.world.bySemanticId(PLAYER_ENTITY_ID);
  return entity === undefined ? undefined : runtime.world.get(entity, PlayerTransformComponent)?.position;
}

export function playerSupportId(runtime: GameplayRuntime): string | null {
  const entity = runtime.world.bySemanticId(PLAYER_ENTITY_ID);
  return entity === undefined ? null : (runtime.world.get(entity, PlayerTransformComponent)?.supportId ?? null);
}

export function isReducedMotion(runtime: GameplayRuntime): boolean {
  return runtime.services.get(GameplaySettingsService)?.reducedMotion ?? false;
}

export function requirementMet(runtime: GameplayRuntime, requirementId: string | undefined): boolean {
  if (requirementId === undefined) {
    return true;
  }
  const check = runtime.services.get(RequirementCheckService);
  return (check ? check(requirementId) : false) || signalBoard(runtime).get(requirementId);
}

// --- signals -----------------------------------------------------------------------------

/**
 * Named boolean world signals: plates, switches and puzzles write them, and doors, platforms
 * and puzzles read them. It is how "a pressure plate lowers a bridge" is wired without
 * components knowing each other. Signals are world facts, not progress.
 */
export interface SignalBoard {
  get(id: string): boolean;
  set(id: string, value: boolean): void;
  onChange(listener: (id: string, value: boolean) => void): () => void;
  /** Rising-edge counter, for sequences. */
  riseCount(id: string): number;
}
export const SignalBoardService = defineService<SignalBoard>('gameplay.signals');

export function createSignalBoard(): SignalBoard {
  const values = new Map<string, boolean>();
  const rises = new Map<string, number>();
  const listeners = new Set<(id: string, value: boolean) => void>();
  return {
    get: (id) => values.get(id) ?? false,
    set(id, value) {
      if ((values.get(id) ?? false) === value) {
        return;
      }
      values.set(id, value);
      if (value) {
        rises.set(id, (rises.get(id) ?? 0) + 1);
      }
      for (const listener of [...listeners]) {
        listener(id, value);
      }
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    riseCount: (id) => rises.get(id) ?? 0,
  };
}

/** The runtime's signal board, created on first use (the runtime clears services on dispose). */
export function signalBoard(runtime: GameplayRuntime): SignalBoard {
  const existing = runtime.services.get(SignalBoardService);
  if (existing) {
    return existing;
  }
  const board = createSignalBoard();
  runtime.services.provide(SignalBoardService, board);
  return board;
}

/** Entity semantic ids are namespaced by kind so two kinds may reuse an authored id. */
export function entityKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

export const GAMEPLAY_SYSTEM_PHASE = 'simulation' as const;
