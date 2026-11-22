/**
 * Systems: the behaviour half of entity/component composition.
 *
 * A system is a plain object with an id, a phase and an `update`. Phases run in a fixed order
 * every simulation step (`input`, `simulation`, `postSimulation`), and `presentation` runs
 * once per rendered frame with the interpolation alpha. Within a phase, systems run by
 * `order` then registration order. No inheritance: a capability contributes systems.
 */

import { EngineError } from './errors';

export type SimulationPhase = 'input' | 'simulation' | 'postSimulation';
export type SystemPhase = SimulationPhase | 'presentation';

export const SIMULATION_PHASES: readonly SimulationPhase[] = [
  'input',
  'simulation',
  'postSimulation',
];

export interface StepContext {
  /** Fixed step length, seconds. */
  dt: number;
  /** Simulation step counter since start. */
  step: number;
  /** Simulated seconds since start. */
  time: number;
}

export interface FrameContext {
  /** Real seconds since the previous rendered frame (clamped). */
  frameSeconds: number;
  /** Interpolation fraction between the last two simulation states. */
  alpha: number;
  time: number;
}

export interface EngineSystem {
  readonly id: string;
  readonly phase: SystemPhase;
  /** Lower runs first. Default 0. */
  readonly order?: number;
  update(context: StepContext & FrameContext): void;
  dispose?(): void;
}

export interface SystemScheduler {
  add(system: EngineSystem): () => void;
  remove(id: string): boolean;
  has(id: string): boolean;
  runStep(context: StepContext): void;
  runFrame(context: FrameContext): void;
  ids(phase?: SystemPhase): string[];
  /** Per-system last update duration (ms), when timing is enabled. */
  timings(): ReadonlyMap<string, number>;
  setTiming(enabled: boolean, now?: () => number): void;
  disposeAll(): void;
}

export function createSystemScheduler(): SystemScheduler {
  const systems: { system: EngineSystem; seq: number }[] = [];
  let seq = 0;
  let timing = false;
  let clock: () => number = () => performance.now();
  const timings = new Map<string, number>();

  const ordered = (phase: SystemPhase) =>
    systems
      .filter((s) => s.system.phase === phase)
      .sort((a, b) => (a.system.order ?? 0) - (b.system.order ?? 0) || a.seq - b.seq)
      .map((s) => s.system);

  const run = (phase: SystemPhase, context: StepContext & FrameContext) => {
    for (const system of ordered(phase)) {
      if (timing) {
        const start = clock();
        system.update(context);
        timings.set(system.id, clock() - start);
      } else {
        system.update(context);
      }
    }
  };

  const scheduler: SystemScheduler = {
    add(system) {
      if (systems.some((s) => s.system.id === system.id)) {
        throw new EngineError('DUPLICATE_ID', `System "${system.id}" is already registered`, {
          system: system.id,
        });
      }
      systems.push({ system, seq: seq++ });
      return () => {
        scheduler.remove(system.id);
      };
    },
    remove(id) {
      const index = systems.findIndex((s) => s.system.id === id);
      if (index < 0) {
        return false;
      }
      const [removed] = systems.splice(index, 1);
      removed!.system.dispose?.();
      timings.delete(id);
      return true;
    },
    has: (id) => systems.some((s) => s.system.id === id),
    runStep(context) {
      const full = { ...context, frameSeconds: context.dt, alpha: 0 };
      for (const phase of SIMULATION_PHASES) {
        run(phase, full);
      }
    },
    runFrame(context) {
      run('presentation', { ...context, dt: context.frameSeconds, step: -1 });
    },
    ids(phase) {
      return phase ? ordered(phase).map((s) => s.id) : systems.map((s) => s.system.id);
    },
    timings: () => timings,
    setTiming(enabled, now) {
      timing = enabled;
      if (now) {
        clock = now;
      }
      if (!enabled) {
        timings.clear();
      }
    },
    disposeAll() {
      for (const { system } of systems.splice(0).reverse()) {
        system.dispose?.();
      }
      timings.clear();
    },
  };
  return scheduler;
}
