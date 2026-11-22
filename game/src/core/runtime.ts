/**
 * The engine runtime: one object that composes lifecycle, fixed-timestep simulation,
 * entities, systems, the typed event bus, resources, services, capabilities and
 * diagnostics.
 *
 * The runtime owns no render loop and no renderer. A host (the React `GameHost`, a test, the
 * Playground) calls `tick(frameSeconds)` from its own `requestAnimationFrame`, and a
 * presentation system renders. That keeps the runtime testable in Node and lets the existing
 * `createLocationEngine` adopt it piece by piece instead of in one rewrite.
 *
 * Lifecycle contract (LAI-2103: create, start, pause, dispose):
 * - `start(requests, setup?)` validates and installs capabilities in dependency order, then
 *   runs an optional async `setup` (scene and asset loading). A failed start disposes what
 *   was installed and rethrows. A `dispose()` during start wins.
 * - `pause()` stops simulation but keeps state; `resume()` resets the accumulator so a long
 *   pause never replays as a burst of steps.
 * - `dispose()` is idempotent: uninstalls capabilities (reverse order), disposes systems,
 *   resources (reverse order), clears entities, services and listeners.
 */

import {
  createCapabilityRegistry,
  type CapabilityRegistry,
  type CapabilityRequest,
} from './capabilities';
import { createDiagnostics, type Diagnostics, type DiagnosticsOptions } from './diagnostics';
import { createEntityWorld, type EntityWorld } from './entities';
import { EngineError } from './errors';
import { createEventBus, type EventMap, type TypedEventBus } from './eventBus';
import {
  createFixedTimestepClock,
  type FixedTimestepClock,
  type FixedTimestepOptions,
} from './fixedTimestep';
import { createLifecycle, type LifecycleState } from './lifecycle';
import { createResourceScope, type ResourceScope } from './resources';
import { createServiceRegistry, type ServiceRegistry } from './services';
import { createSystemScheduler, type SystemScheduler } from './systems';

/** Events every runtime emits about itself, merged into the caller's event map. */
export type RuntimeEventMap = {
  'engine.stateChanged': { state: LifecycleState; previous: LifecycleState };
  /** A capability, system or setup step failed; `code` is an `EngineErrorCode` or `UNEXPECTED`. */
  'engine.error': { code: string; source: string };
  'engine.capabilityInstalled': { id: string; version: string };
};

export interface EngineRuntimeOptions {
  /** Stable id of what this runtime hosts (an adventure or area id), for diagnostics. */
  id: string;
  timestep?: FixedTimestepOptions;
  diagnostics?: DiagnosticsOptions | Diagnostics;
  // The registry's install context is the runtime itself.
  capabilities?: CapabilityRegistry<EngineRuntime<EventMap>>;
}

export interface EngineRuntime<Events extends EventMap = EventMap> {
  readonly id: string;
  readonly state: LifecycleState;
  readonly events: TypedEventBus<Events & RuntimeEventMap>;
  readonly world: EntityWorld;
  readonly systems: SystemScheduler;
  readonly resources: ResourceScope;
  readonly services: ServiceRegistry;
  readonly capabilities: CapabilityRegistry<EngineRuntime<EventMap>>;
  readonly diagnostics: Diagnostics;
  readonly clock: FixedTimestepClock;
  /** Installed capability ids, in install order, with their validated config. */
  readonly installed: ReadonlyMap<string, unknown>;
  /** Typed config of an installed capability. */
  capabilityConfig<T>(id: string): T | undefined;
  start(
    requests?: readonly CapabilityRequest[],
    setup?: (runtime: EngineRuntime<Events>) => Promise<void> | void,
  ): Promise<void>;
  /** Advances real time. Runs fixed steps, then one presentation frame. No-op unless running. */
  tick(frameSeconds: number): void;
  pause(): void;
  resume(): void;
  dispose(): void;
}

function isDiagnostics(value: DiagnosticsOptions | Diagnostics | undefined): value is Diagnostics {
  return typeof (value as Diagnostics | undefined)?.snapshot === 'function';
}

export function createEngineRuntime<Events extends EventMap = EventMap>(
  options: EngineRuntimeOptions,
): EngineRuntime<Events> {
  if (!options.id || !options.id.trim()) {
    throw new EngineError('INVALID_CONFIG', 'An engine runtime needs a non-empty id');
  }
  const lifecycle = createLifecycle();
  const diagnostics = isDiagnostics(options.diagnostics)
    ? options.diagnostics
    : createDiagnostics(options.diagnostics);
  const events = createEventBus<Events & RuntimeEventMap>({
    onListenerError: (error, eventName) => {
      diagnostics.warn('LISTENER_THREW', { event: eventName });
      queueMicrotask(() => {
        throw error;
      });
    },
  });
  const world = createEntityWorld();
  const systems = createSystemScheduler();
  const resources = createResourceScope(options.id, {
    onDisposeErrors: (errors, scope) => {
      diagnostics.warn('DISPOSE_FAILED', { scope, count: errors.length });
    },
  });
  const services = createServiceRegistry();
  const capabilities = options.capabilities ?? createCapabilityRegistry<EngineRuntime<EventMap>>();
  const clock = createFixedTimestepClock(options.timestep);
  const installed = new Map<string, unknown>();
  const uninstallers: { id: string; run: () => void }[] = [];
  let step = 0;

  // Event emission typed against the merged map; `as never` keeps the generic call simple.
  const emitRuntime = <Name extends keyof RuntimeEventMap>(
    name: Name,
    payload: RuntimeEventMap[Name],
  ) => events.emit(name as never, payload as never);

  lifecycle.onChange((state, previous) => emitRuntime('engine.stateChanged', { state, previous }));

  const teardown = () => {
    for (const { id, run } of uninstallers.splice(0).reverse()) {
      try {
        run();
      } catch (error) {
        diagnostics.warn('UNINSTALL_FAILED', { capability: id });
        void error;
      }
    }
    installed.clear();
    systems.disposeAll();
    resources.dispose();
    world.clear();
    services.clear();
  };

  const runtime: EngineRuntime<Events> = {
    id: options.id,
    get state() {
      return lifecycle.state;
    },
    events,
    world,
    systems,
    resources,
    services,
    capabilities,
    diagnostics,
    clock,
    installed,
    capabilityConfig<T>(id: string) {
      return installed.get(id) as T | undefined;
    },
    async start(requests = [], setup) {
      lifecycle.apply('start');
      const resolution = capabilities.resolve(requests);
      if (!resolution.ok) {
        const error = new EngineError('VALIDATION_FAILED', 'Capability configuration is invalid', {
          issues: resolution.issues,
        });
        emitRuntime('engine.error', { code: error.code, source: 'capabilities' });
        runtime.dispose();
        throw error;
      }
      try {
        for (const { definition, config } of resolution.order) {
          if (lifecycle.state !== 'starting') {
            return;
          }
          const uninstall = definition.install?.(
            runtime as unknown as EngineRuntime<EventMap>,
            config,
          );
          installed.set(definition.id, config);
          if (typeof uninstall === 'function') {
            uninstallers.push({ id: definition.id, run: uninstall });
          }
          emitRuntime('engine.capabilityInstalled', {
            id: definition.id,
            version: definition.version,
          });
        }
        if (setup) {
          await setup(runtime);
        }
      } catch (error) {
        const code = error instanceof EngineError ? error.code : 'UNEXPECTED';
        emitRuntime('engine.error', { code, source: 'start' });
        if (lifecycle.can('dispose')) {
          runtime.dispose();
        }
        throw error;
      }
      // A dispose() during an awaited setup wins.
      if (lifecycle.state === 'starting') {
        clock.reset();
        lifecycle.apply('started');
      }
    },
    tick(frameSeconds) {
      if (lifecycle.state !== 'running') {
        return;
      }
      const frame = clock.advance(frameSeconds);
      for (let i = 0; i < frame.steps; i += 1) {
        step += 1;
        systems.runStep({ dt: frame.stepSeconds, step, time: clock.simulatedSeconds });
        if (lifecycle.state !== 'running') {
          return; // a system paused or disposed the engine
        }
      }
      systems.runFrame({ frameSeconds, alpha: frame.alpha, time: clock.simulatedSeconds });
      if (diagnostics.enabled) {
        diagnostics.recordFrame(frameSeconds * 1000, frame.droppedSeconds);
        diagnostics.gauge('entities', world.size);
        diagnostics.gauge('resources', resources.count());
        diagnostics.setSystemTimings(systems.timings());
      }
    },
    pause() {
      if (lifecycle.can('pause')) {
        lifecycle.apply('pause');
      }
    },
    resume() {
      if (lifecycle.can('resume')) {
        clock.reset();
        lifecycle.apply('resume');
      }
    },
    dispose() {
      if (!lifecycle.can('dispose')) {
        return;
      }
      lifecycle.apply('dispose');
      teardown();
      lifecycle.apply('disposed');
      events.clear();
    },
  };
  return runtime;
}
