/**
 * Doors and gates: LOCKED, UNLOCKED, OPENING, OPEN (and CLOSING).
 *
 * A closed door or gate is a SOLID collider with `gate: true`: gates are never jumpable
 * (jumping standard). Whether it is locked comes from a host-provided requirement check
 * (`RequirementCheckService`) or a world signal; the engine never decides a quest or learning
 * requirement itself. Opening slides the collider up and removes it when fully open. Closing
 * (or relocking) puts the collider back only once the child no longer overlaps it, so a door
 * can never trap or shove a child.
 */

import { defineComponent } from '../core/entities';
import { defineService } from '../core/services';
import type { CapabilityDefinition } from '../core/capabilities';
import type { Vec3Like } from '../contracts/player';
import { PhysicsProviderService } from '../contracts/physics';
import {
  emitPresentation,
  entityKey,
  playerPosition,
  requirementMet,
  type GameplayRuntime,
} from './common';
import { configRoot, Issues } from './validate';

export type DoorPhase = 'LOCKED' | 'UNLOCKED' | 'OPENING' | 'OPEN' | 'CLOSING';

export interface DoorSpec {
  id: string;
  /** Bottom centre of the door. */
  position: Vec3Like;
  /** Width (x), height (y) and depth (z). */
  size: Vec3Like;
  /** Host requirement (or signal) id; absent means never locked. */
  requirementId?: string;
  /** Opens by itself when unlocked and the child comes within `approachRadius`. */
  autoOpen: boolean;
  approachRadius: number;
  openSeconds: number;
  /** Closes again when the requirement stops being met (otherwise stays open). */
  relockWhenUnmet: boolean;
}

export interface DoorState {
  spec: DoorSpec;
  phase: DoorPhase;
  /** 0 closed to 1 fully open. */
  progress: number;
  hasCollider: boolean;
  /** Where a pending close ends up. */
  closeTarget: 'UNLOCKED' | 'LOCKED';
}
export const DoorComponent = defineComponent<DoorState>('gameplay.door');

export interface DoorsApi {
  /** Opens an unlocked door. Returns false (and bumps) when locked. */
  requestOpen(doorId: string): 'OPENING' | 'LOCKED' | 'ALREADY_OPEN' | 'UNKNOWN';
  requestClose(doorId: string): boolean;
  phaseOf(doorId: string): DoorPhase | undefined;
}
export const DoorsService = defineService<DoorsApi>('gameplay.doors');

export interface DoorsConfig {
  doors: DoorSpec[];
}

/** Half-width of the child's body plus skin, for the "never close on the child" test. */
export const BODY_CLEARANCE = 0.45;
const BODY_HEIGHT = 1.7;

export function validateDoorsConfig(input: unknown) {
  const issues = new Issues();
  const root = configRoot(input, issues);
  const doors = issues.records(
    root.doors,
    'doors',
    (item, path): DoorSpec => ({
      id: issues.id(item.id, `${path}.id`),
      position: issues.vec3(item.position, `${path}.position`),
      size: (() => {
        const size = issues.vec3(item.size, `${path}.size`, 100);
        if (size.x <= 0 || size.y <= 0 || size.z <= 0) {
          issues.add(`${path}.size`, 'every dimension must be positive');
        }
        return size;
      })(),
      requirementId: issues.optionalId(item.requirementId, `${path}.requirementId`),
      autoOpen: issues.bool(item.autoOpen, `${path}.autoOpen`, false),
      approachRadius: issues.num(item.approachRadius, `${path}.approachRadius`, 0.5, 10, 2.5),
      openSeconds: issues.num(item.openSeconds, `${path}.openSeconds`, 0.2, 6, 1),
      relockWhenUnmet: issues.bool(item.relockWhenUnmet, `${path}.relockWhenUnmet`, false),
    }),
    (d) => d.id,
    128,
  );
  return issues.result<DoorsConfig>({ doors });
}

function boxOf(spec: DoorSpec, lift: number) {
  const { position: p, size: s } = spec;
  return {
    min: { x: p.x - s.x / 2, y: p.y + lift, z: p.z - s.z / 2 },
    max: { x: p.x + s.x / 2, y: p.y + s.y + lift, z: p.z + s.z / 2 },
  };
}

export const DOORS_CAPABILITY_ID = 'gameplay.doors';

export const doorsCapability: CapabilityDefinition<DoorsConfig, GameplayRuntime> = {
  id: DOORS_CAPABILITY_ID,
  version: '1.0.0',
  description:
    'Doors and gates: solid gate colliders, host requirement check, collider removal while opening.',
  defaults: { doors: [] },
  validate: validateDoorsConfig,
  install(runtime, config) {
    const { world } = runtime;
    const physics = runtime.services.require(PhysicsProviderService);
    const cleanups: (() => void)[] = [];

    const addCollider = (state: DoorState) => {
      const box = boxOf(state.spec, 0);
      physics.addCollider({
        id: state.spec.id,
        kind: 'SOLID',
        gate: true,
        min: box.min,
        max: box.max,
      });
      state.hasCollider = true;
    };
    const setPhase = (state: DoorState, phase: DoorPhase) => {
      if (state.phase !== phase) {
        state.phase = phase;
        emitPresentation(runtime, 'DoorStateChanged', { doorId: state.spec.id, state: phase });
      }
    };
    for (const spec of config.doors) {
      const locked =
        spec.requirementId !== undefined && !requirementMet(runtime, spec.requirementId);
      const state: DoorState = {
        spec,
        phase: locked ? 'LOCKED' : 'UNLOCKED',
        progress: 0,
        hasCollider: false,
        closeTarget: 'UNLOCKED',
      };
      world.add(world.create(entityKey('door', spec.id)), DoorComponent, state);
      addCollider(state);
    }
    cleanups.push(() => {
      for (const entity of world.query(DoorComponent)) {
        const state = world.get(entity, DoorComponent)!;
        if (state.hasCollider) {
          physics.removeCollider(state.spec.id);
          state.hasCollider = false;
        }
      }
    });

    const find = (id: string) => {
      const entity = world.bySemanticId(entityKey('door', id));
      return entity === undefined ? undefined : world.get(entity, DoorComponent);
    };
    const playerOverlaps = (state: DoorState): boolean => {
      const player = playerPosition(runtime);
      if (!player) {
        return false;
      }
      const box = boxOf(state.spec, 0);
      return (
        player.x >= box.min.x - BODY_CLEARANCE &&
        player.x <= box.max.x + BODY_CLEARANCE &&
        player.z >= box.min.z - BODY_CLEARANCE &&
        player.z <= box.max.z + BODY_CLEARANCE &&
        player.y < box.max.y &&
        player.y + BODY_HEIGHT > box.min.y
      );
    };

    const api: DoorsApi = {
      phaseOf: (id) => find(id)?.phase,
      requestOpen(id) {
        const state = find(id);
        if (!state) {
          return 'UNKNOWN';
        }
        if (state.phase === 'LOCKED') {
          emitPresentation(runtime, 'DoorBumped', { doorId: id });
          return 'LOCKED';
        }
        if (state.phase === 'OPEN' || state.phase === 'OPENING') {
          return 'ALREADY_OPEN';
        }
        setPhase(state, 'OPENING');
        return 'OPENING';
      },
      requestClose(id) {
        const state = find(id);
        if (!state || (state.phase !== 'OPEN' && state.phase !== 'OPENING')) {
          return false;
        }
        state.closeTarget = 'UNLOCKED';
        setPhase(state, 'CLOSING');
        return true;
      },
    };
    const removeService = runtime.services.provide(DoorsService, api);

    runtime.systems.add({
      id: 'gameplay.doors',
      phase: 'simulation',
      update(context) {
        const player = playerPosition(runtime);
        for (const entity of world.query(DoorComponent)) {
          const state = world.get(entity, DoorComponent)!;
          const { spec } = state;
          const met = requirementMet(runtime, spec.requirementId);
          if (state.phase === 'LOCKED' && met) {
            setPhase(state, 'UNLOCKED');
          } else if (
            !met &&
            (state.phase === 'UNLOCKED' ||
              (spec.relockWhenUnmet && (state.phase === 'OPEN' || state.phase === 'OPENING')))
          ) {
            if (state.phase === 'UNLOCKED') {
              setPhase(state, 'LOCKED');
            } else {
              state.closeTarget = 'LOCKED';
              setPhase(state, 'CLOSING');
            }
          }
          if (state.phase === 'UNLOCKED' && spec.autoOpen && player) {
            if (
              Math.hypot(player.x - spec.position.x, player.z - spec.position.z) <=
              spec.approachRadius
            ) {
              setPhase(state, 'OPENING');
            }
          }
          if (state.phase === 'OPENING') {
            state.progress = Math.min(1, state.progress + context.dt / spec.openSeconds);
            if (state.hasCollider) {
              if (state.progress >= 1) {
                physics.removeCollider(spec.id);
                state.hasCollider = false;
              } else {
                const box = boxOf(spec, state.progress * spec.size.y);
                physics.updateCollider(spec.id, box.min, box.max);
              }
            }
            if (state.progress >= 1) {
              setPhase(state, 'OPEN');
            }
          } else if (state.phase === 'CLOSING') {
            // Wait until the child is clear, then close in one step (never on top of them).
            if (!playerOverlaps(state)) {
              state.progress = 0;
              if (state.hasCollider) {
                const box = boxOf(spec, 0);
                physics.updateCollider(spec.id, box.min, box.max);
              } else {
                addCollider(state);
              }
              setPhase(state, state.closeTarget);
            }
          }
        }
      },
    });
    return () => {
      runtime.systems.remove('gameplay.doors');
      removeService();
      cleanups.forEach((c) => c());
    };
  },
};
