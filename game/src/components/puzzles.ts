/**
 * Environmental puzzles: a generic, engine-detected state machine for world-mechanics puzzles.
 *
 * Kinds: `SEQUENCE` (signals, from plates or switches, raised in order), `ALL_HELD` (every
 * signal true together, optionally for a short hold) and `SOCKETS` (arrange objects into
 * sockets). The engine only detects the world fact and emits a `puzzle.completed` claim; it
 * does **not** grade learning answers (those go to Django through LearningRef events). A wrong
 * step simply resets the puzzle: nothing is lost and nothing counts down.
 *
 * Accessibility: every puzzle declares an `alternative` (an action id the host exposes as a
 * button or switch-access control) that completes it without movement, with the same claim.
 *
 * Completion raises `solvedSignalId`, so doors, platforms and bridges can open from it.
 */

import { defineComponent } from '../core/entities';
import { defineService } from '../core/services';
import type { CapabilityDefinition } from '../core/capabilities';
import { emitClaim, emitPresentation, entityKey, signalBoard, type GameplayRuntime } from './common';
import { worldObjects } from './triggers';
import { configRoot, Issues, type Json } from './validate';

export type PuzzleKind = 'SEQUENCE' | 'ALL_HELD' | 'SOCKETS';

export interface SocketSpec {
  id: string;
  x: number;
  z: number;
  radius: number;
  /** The world object id that fits this socket. */
  accepts: string;
}

interface PuzzleBase {
  id: string;
  /** Raised when solved. Default: `puzzle.<id>`. */
  solvedSignalId: string;
  /** The non-movement way to complete it (accessibility). Required. */
  alternativeActionId: string;
}
export interface SequencePuzzleSpec extends PuzzleBase {
  kind: 'SEQUENCE';
  steps: string[];
}
export interface AllHeldPuzzleSpec extends PuzzleBase {
  kind: 'ALL_HELD';
  signalIds: string[];
  holdSeconds: number;
}
export interface SocketsPuzzleSpec extends PuzzleBase {
  kind: 'SOCKETS';
  sockets: SocketSpec[];
}
export type PuzzleSpec = SequencePuzzleSpec | AllHeldPuzzleSpec | SocketsPuzzleSpec;

export interface PuzzleState {
  spec: PuzzleSpec;
  completed: boolean;
  viaAlternative: boolean;
  /** SEQUENCE: next expected step index. */
  index: number;
  /** ALL_HELD: seconds all signals have been true. */
  held: number;
  progress: number;
}
export const PuzzleComponent = defineComponent<PuzzleState>('gameplay.puzzle');

export interface PuzzlesApi {
  /** Completes a puzzle through its declared non-movement action. */
  completeViaAlternative(puzzleId: string, actionId: string): boolean;
  isCompleted(puzzleId: string): boolean | undefined;
  progressOf(puzzleId: string): { progress: number; total: number } | undefined;
}
export const PuzzlesService = defineService<PuzzlesApi>('gameplay.puzzles');

export interface PuzzlesConfig {
  puzzles: PuzzleSpec[];
}

function totalOf(spec: PuzzleSpec): number {
  return spec.kind === 'SEQUENCE' ? spec.steps.length : spec.kind === 'ALL_HELD' ? spec.signalIds.length : spec.sockets.length;
}

function idList(value: unknown, path: string, issues: Issues, min: number, max: number): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    issues.add(path, `must list ${min} to ${max} ids`);
    return [];
  }
  return value.map((v, i) => issues.id(v, `${path}[${i}]`));
}

export function validatePuzzlesConfig(input: unknown) {
  const issues = new Issues();
  const root = configRoot(input, issues);
  const puzzles = issues.records(
    root.puzzles,
    'puzzles',
    (item: Json, path): PuzzleSpec => {
      const id = issues.id(item.id, `${path}.id`);
      const base = {
        id,
        solvedSignalId: issues.optionalId(item.solvedSignalId, `${path}.solvedSignalId`) ?? `puzzle.${id}`,
        alternativeActionId: (() => {
          if (item.alternativeActionId === undefined) {
            issues.add(`${path}.alternativeActionId`, 'a non-movement way to complete the puzzle must be declared');
            return '';
          }
          return issues.id(item.alternativeActionId, `${path}.alternativeActionId`);
        })(),
      };
      const kind = issues.oneOf<PuzzleKind>(item.kind, `${path}.kind`, ['SEQUENCE', 'ALL_HELD', 'SOCKETS']);
      if (kind === 'SEQUENCE') {
        const steps = idList(item.steps, `${path}.steps`, issues, 2, 12);
        return { ...base, kind, steps };
      }
      if (kind === 'ALL_HELD') {
        return { ...base, kind, signalIds: idList(item.signalIds, `${path}.signalIds`, issues, 2, 12), holdSeconds: issues.num(item.holdSeconds, `${path}.holdSeconds`, 0, 2, 0) };
      }
      const sockets = issues.records(
        item.sockets,
        `${path}.sockets`,
        (s, sp): SocketSpec => ({
          id: issues.id(s.id, `${sp}.id`),
          x: issues.num(s.x, `${sp}.x`, -1000, 1000),
          z: issues.num(s.z, `${sp}.z`, -1000, 1000),
          radius: issues.num(s.radius, `${sp}.radius`, 0.2, 3, 0.8),
          accepts: issues.id(s.accepts, `${sp}.accepts`),
        }),
        (s) => s.id,
        12,
      );
      if (sockets.length < 1) {
        issues.add(`${path}.sockets`, 'needs at least one socket');
      }
      return { ...base, kind: 'SOCKETS', sockets };
    },
    (p) => p.id,
    64,
  );
  return issues.result<PuzzlesConfig>({ puzzles });
}

export const PUZZLES_CAPABILITY_ID = 'gameplay.puzzles';

export const puzzlesCapability: CapabilityDefinition<PuzzlesConfig, GameplayRuntime> = {
  id: PUZZLES_CAPABILITY_ID,
  version: '1.0.0',
  description: 'World-mechanics puzzles (sequence, all held, sockets) emitting puzzle.completed; never grades learning.',
  defaults: { puzzles: [] },
  validate: validatePuzzlesConfig,
  install(runtime, config) {
    const { world } = runtime;
    const signals = signalBoard(runtime);
    for (const spec of config.puzzles) {
      world.add(world.create(entityKey('puzzle', spec.id)), PuzzleComponent, { spec, completed: false, viaAlternative: false, index: 0, held: 0, progress: 0 });
    }
    const states = () => world.query(PuzzleComponent).map((e) => world.get(e, PuzzleComponent)!);
    const find = (id: string) => states().find((s) => s.spec.id === id);

    const setProgress = (state: PuzzleState, progress: number) => {
      if (progress !== state.progress) {
        state.progress = progress;
        emitPresentation(runtime, 'PuzzleProgress', { puzzleId: state.spec.id, progress, total: totalOf(state.spec) });
      }
    };
    const complete = (state: PuzzleState, viaAlternative: boolean) => {
      if (state.completed) {
        return;
      }
      state.completed = true;
      state.viaAlternative = viaAlternative;
      setProgress(state, totalOf(state.spec));
      signals.set(state.spec.solvedSignalId, true);
      emitPresentation(runtime, 'PuzzleCompleted', { puzzleId: state.spec.id, viaAlternative });
      emitClaim(runtime, 'puzzle.completed', { puzzleId: state.spec.id });
    };

    const offSignals = signals.onChange((signalId, value) => {
      if (!value) {
        return;
      }
      for (const state of states()) {
        const { spec } = state;
        if (spec.kind !== 'SEQUENCE' || state.completed || !spec.steps.includes(signalId)) {
          continue;
        }
        if (signalId === spec.steps[state.index]) {
          state.index += 1;
          setProgress(state, state.index);
          if (state.index >= spec.steps.length) {
            complete(state, false);
          }
        } else {
          // A wrong step starts over, gently: a restart of the same puzzle, never a penalty.
          const restartsAtOne = signalId === spec.steps[0];
          state.index = restartsAtOne ? 1 : 0;
          emitPresentation(runtime, 'PuzzleReset', { puzzleId: spec.id });
          state.progress = state.index;
          if (restartsAtOne) {
            emitPresentation(runtime, 'PuzzleProgress', { puzzleId: spec.id, progress: 1, total: spec.steps.length });
          }
        }
      }
    });

    const api: PuzzlesApi = {
      completeViaAlternative(puzzleId, actionId) {
        const state = find(puzzleId);
        if (!state || state.spec.alternativeActionId !== actionId) {
          return false;
        }
        complete(state, true);
        return true;
      },
      isCompleted: (id) => find(id)?.completed,
      progressOf(id) {
        const state = find(id);
        return state ? { progress: state.progress, total: totalOf(state.spec) } : undefined;
      },
    };
    const removeService = runtime.services.provide(PuzzlesService, api);

    runtime.systems.add({
      id: 'gameplay.puzzles',
      phase: 'simulation',
      update(context) {
        const objects = worldObjects(runtime);
        for (const state of states()) {
          if (state.completed) {
            continue;
          }
          const { spec } = state;
          if (spec.kind === 'ALL_HELD') {
            const count = spec.signalIds.filter((s) => signals.get(s)).length;
            if (count === spec.signalIds.length) {
              state.held += context.dt;
              if (state.held >= spec.holdSeconds) {
                complete(state, false);
              }
            } else {
              state.held = 0;
              setProgress(state, count);
            }
          } else if (spec.kind === 'SOCKETS') {
            const filled = spec.sockets.filter((socket) =>
              objects.some((o) => o.id === socket.accepts && Math.hypot(o.position.x - socket.x, o.position.z - socket.z) <= socket.radius),
            ).length;
            setProgress(state, filled);
            if (filled === spec.sockets.length) {
              complete(state, false);
            }
          }
        }
      },
    });
    return () => {
      runtime.systems.remove('gameplay.puzzles');
      offSignals();
      removeService();
    };
  },
};
