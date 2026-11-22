/**
 * Adventure lifecycle on top of `EngineRuntime`.
 *
 * `loadAdventure` validates the definition (with the runtime's own capability registry, so
 * validation equals runtime behaviour), starts the runtime with the definition's capability
 * requests, places the definition's components, and emits `adventure.started`.
 *
 * Everything the session emits is a **claim** (`gameplay.event` on the runtime bus). The
 * session never grades, scores or rewards: Django confirms each claim (ADR-020 item 6).
 *
 * Hooks are typed and composition based: register any number with `addHooks`; each returns an
 * unsubscribe. A hook that throws never breaks play; it is reported to diagnostics by id.
 */

import { EngineError } from '../core/errors';
import type { EventMap } from '../core/eventBus';
import type { EngineRuntime } from '../core/runtime';
import {
  createGameplayEventFactory,
  type AnyGameplayEvent,
  type GameplayEventFactory,
  type GameplayEventFactoryOptions,
  type GameplayEventType,
  type GameplayEventPayloads,
} from '../contracts/gameplayEvents';
import type { ServiceRegistry } from '../core/services';
import {
  assertValidAdventure,
  profileFor,
  type AdventureDefinition,
  type ValidateAdventureOptions,
} from './adventure';
import type { ComponentRegistry } from './componentRegistry';
import type { AgeBand, ResolvedProfile } from './profiles';

export type AdventureSessionState = 'running' | 'paused' | 'completed' | 'disposed';

export interface AreaHookContext {
  readonly areaId: string;
  readonly adventure: Readonly<AdventureDefinition>;
  readonly runtime: EngineRuntime<EventMap>;
}

export interface AdventureHooks {
  onEnterArea?(context: AreaHookContext): void;
  onLeaveArea?(context: AreaHookContext): void;
  onCompleted?(context: { readonly adventure: Readonly<AdventureDefinition> }): void;
}

export interface LoadAdventureOptions {
  /** The child's age band: selects the movement and difficulty profile. Required. */
  ageBand: AgeBand;
  /** The Django `AdventureSession` UUID when play runs inside one. */
  sessionRef?: string | null;
  /** Places `definition.components` through this registry after capabilities install. */
  components?: ComponentRegistry;
  hooks?: AdventureHooks;
  /** Extra async setup (scene and asset loading), run inside `runtime.start`. */
  setup?: (runtime: EngineRuntime<EventMap>) => Promise<void> | void;
  eventFactory?: GameplayEventFactoryOptions;
  /** Forwarded to `validateAdventure`. */
  validation?: ValidateAdventureOptions;
}

export interface AdventureSession {
  readonly definition: Readonly<AdventureDefinition>;
  readonly runtime: EngineRuntime<EventMap>;
  readonly ageBand: AgeBand;
  /** The resolved movement and difficulty profile for this child's band. */
  readonly profile: ResolvedProfile;
  readonly state: AdventureSessionState;
  readonly currentAreaId: string | null;
  readonly events: GameplayEventFactory;
  /** Emits any gameplay claim through the session's factory (context filled in). */
  emit<T extends GameplayEventType>(
    type: T,
    payload: GameplayEventPayloads[T],
    areaId?: string | null,
  ): AnyGameplayEvent;
  enterArea(areaId: string): void;
  leaveArea(): void;
  /** Emits `adventure.completed` once. Returns false when already completed or not running. */
  complete(): boolean;
  pause(): void;
  resume(): void;
  addHooks(hooks: AdventureHooks): () => void;
  dispose(): void;
}

/**
 * Validates, starts and returns a running adventure session. Throws `VALIDATION_FAILED` for an
 * invalid definition, `MISSING_DEPENDENCY` for a required service the host did not provide,
 * and `INVALID_CONFIG` for an age band the adventure does not support.
 */
export async function loadAdventure(
  input: unknown,
  runtime: EngineRuntime<EventMap>,
  services: ServiceRegistry,
  options: LoadAdventureOptions,
): Promise<AdventureSession> {
  const definition = assertValidAdventure(input, runtime.capabilities, {
    ...options.validation,
    componentTypes: options.validation?.componentTypes ?? options.components,
  });
  if (!definition.ageBands.includes(options.ageBand)) {
    throw new EngineError(
      'INVALID_CONFIG',
      `Adventure "${definition.id}" does not support age band ${options.ageBand}`,
      {
        adventureId: definition.id,
        ageBand: options.ageBand,
      },
    );
  }
  const provided = new Set(services.ids());
  for (const serviceId of definition.requiredServices) {
    if (!provided.has(serviceId)) {
      throw new EngineError(
        'MISSING_DEPENDENCY',
        `Adventure "${definition.id}" needs service "${serviceId}"`,
        {
          adventureId: definition.id,
          service: serviceId,
        },
      );
    }
  }

  const profile = profileFor(definition, options.ageBand);
  const factory = createGameplayEventFactory(
    {
      realmId: definition.realmId,
      adventureId: definition.id,
      areaId: null,
      sessionRef: options.sessionRef ?? null,
    },
    options.eventFactory,
  );
  const hookSets = new Set<AdventureHooks>();
  if (options.hooks) {
    hookSets.add(options.hooks);
  }
  let state: AdventureSessionState = 'running';
  let currentAreaId: string | null = null;

  const emit = (
    type: GameplayEventType,
    payload: never,
    areaId?: string | null,
  ): AnyGameplayEvent => {
    const event = factory.create(
      type,
      payload,
      areaId === undefined ? {} : { areaId },
    ) as AnyGameplayEvent;
    runtime.events.emit('gameplay.event', event as never);
    return event;
  };
  const hookContext = (areaId: string): AreaHookContext => ({
    areaId,
    adventure: definition,
    runtime,
  });
  const runHooks = (name: keyof AdventureHooks, call: (hooks: AdventureHooks) => void): void => {
    for (const hooks of [...hookSets]) {
      try {
        call(hooks);
      } catch {
        runtime.diagnostics.warn('ADVENTURE_HOOK_THREW', { hook: name, adventure: definition.id });
      }
    }
  };

  const session: AdventureSession = {
    definition,
    runtime,
    ageBand: options.ageBand,
    profile,
    get state() {
      return state === 'disposed' || runtime.state === 'disposed' || runtime.state === 'disposing'
        ? 'disposed'
        : state === 'completed'
          ? 'completed'
          : runtime.state === 'paused'
            ? 'paused'
            : 'running';
    },
    get currentAreaId() {
      return currentAreaId;
    },
    events: factory,
    emit: (type, payload, areaId) => emit(type, payload as never, areaId),
    enterArea(areaId) {
      if (session.state !== 'running' && session.state !== 'completed') {
        throw new EngineError(
          'INVALID_STATE',
          `Cannot enter an area while the adventure is ${session.state}`,
          { areaId },
        );
      }
      if (!definition.areas.includes(areaId)) {
        throw new EngineError(
          'UNKNOWN_ID',
          `Area "${areaId}" is not part of adventure "${definition.id}"`,
          { areaId },
        );
      }
      if (currentAreaId === areaId) {
        return;
      }
      if (currentAreaId !== null) {
        session.leaveArea();
      }
      currentAreaId = areaId;
      runHooks('onEnterArea', (hooks) => hooks.onEnterArea?.(hookContext(areaId)));
      emit('exploration.area.entered', { areaId } as never, areaId);
    },
    leaveArea() {
      if (currentAreaId === null) {
        return;
      }
      const left = currentAreaId;
      currentAreaId = null;
      runHooks('onLeaveArea', (hooks) => hooks.onLeaveArea?.(hookContext(left)));
    },
    complete() {
      if (state !== 'running' || session.state !== 'running') {
        return false;
      }
      state = 'completed';
      emit('adventure.completed', {} as never);
      runHooks('onCompleted', (hooks) => hooks.onCompleted?.({ adventure: definition }));
      return true;
    },
    pause() {
      runtime.pause();
    },
    resume() {
      runtime.resume();
    },
    addHooks(hooks) {
      hookSets.add(hooks);
      return () => {
        hookSets.delete(hooks);
      };
    },
    dispose() {
      if (state === 'disposed') {
        return;
      }
      session.leaveArea();
      state = 'disposed';
      hookSets.clear();
      runtime.dispose();
    },
  };

  await runtime.start(definition.capabilities, async (started) => {
    options.components?.createAll(started, definition.components);
    await options.setup?.(started);
  });
  // A dispose() during an awaited setup wins: no adventure.started for a dead runtime.
  if (runtime.state !== 'running') {
    state = 'disposed';
    return session;
  }
  emit('adventure.started', {} as never);
  return session;
}
