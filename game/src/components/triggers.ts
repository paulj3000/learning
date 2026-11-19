/**
 * Switches (toggle, edge-triggered) and pressure plates (pressed while the player or an object
 * is on top).
 *
 * Both write a named world signal (`SignalBoard`) that doors, platforms and puzzles read, so
 * "a plate lowers a bridge" needs no component to know another. Plates reuse the island-map
 * runtime's presentation events (`PressurePlatePressed` and `PressurePlateReleased`).
 * Movable objects (crates the child pushes) are `WorldObjectComponent` entities whose position
 * the host or movement system updates; the engine only reads them.
 */

import { defineComponent } from '../core/entities';
import { defineService } from '../core/services';
import type { CapabilityDefinition } from '../core/capabilities';
import type { Vec3Like } from '../contracts/player';
import { emitPresentation, entityKey, playerPosition, signalBoard, type GameplayRuntime } from './common';
import { configRoot, Issues } from './validate';

// --- movable world objects ---------------------------------------------------------------

export interface WorldObjectState {
  id: string;
  position: Vec3Like;
}
export const WorldObjectComponent = defineComponent<WorldObjectState>('gameplay.worldObject');

/** Registers (or returns) a movable object the plates and sockets can sense. */
export function ensureWorldObject(runtime: GameplayRuntime, id: string, position: Vec3Like): WorldObjectState {
  const key = entityKey('object', id);
  const existing = runtime.world.bySemanticId(key);
  if (existing !== undefined) {
    const state = runtime.world.get(existing, WorldObjectComponent)!;
    state.position = { ...position };
    return state;
  }
  const state: WorldObjectState = { id, position: { ...position } };
  runtime.world.add(runtime.world.create(key), WorldObjectComponent, state);
  return state;
}

export function worldObjects(runtime: GameplayRuntime): WorldObjectState[] {
  return runtime.world.query(WorldObjectComponent).map((e) => runtime.world.get(e, WorldObjectComponent)!);
}

// --- pressure plates ---------------------------------------------------------------------

export interface PressurePlateSpec {
  id: string;
  position: Vec3Like;
  halfSize: number;
  /** Stays pressed once stepped on (default: pressed only while held). */
  latch: boolean;
  /** Signal written while pressed. Default: the plate id. */
  signalId: string;
}
export interface PressurePlateState {
  spec: PressurePlateSpec;
  pressed: boolean;
}
export const PressurePlateComponent = defineComponent<PressurePlateState>('gameplay.pressurePlate');

// --- switches ----------------------------------------------------------------------------

export interface SwitchSpec {
  id: string;
  position: Vec3Like;
  interactRadius: number;
  signalId: string;
  initialOn: boolean;
}
export interface SwitchState {
  spec: SwitchSpec;
  on: boolean;
  /** Last held state seen by `interact`, for edge detection. */
  held: boolean;
}
export const SwitchComponent = defineComponent<SwitchState>('gameplay.switch');

export type SwitchResult = 'TOGGLED' | 'TOO_FAR' | 'UNKNOWN' | 'HELD';

export interface TriggersApi {
  /** Toggles a switch if the child is close enough. */
  toggle(switchId: string): SwitchResult;
  /** Feeds a held button: toggles only on the press edge, never while held. */
  interact(switchId: string, held: boolean): SwitchResult;
  isOn(switchId: string): boolean | undefined;
  isPressed(plateId: string): boolean | undefined;
}
export const TriggersService = defineService<TriggersApi>('gameplay.triggers');

export interface TriggersConfig {
  plates: PressurePlateSpec[];
  switches: SwitchSpec[];
}

export function validateTriggersConfig(input: unknown) {
  const issues = new Issues();
  const root = configRoot(input, issues);
  const plates = issues.records(
    root.plates,
    'plates',
    (item, path): PressurePlateSpec => {
      const id = issues.id(item.id, `${path}.id`);
      return {
        id,
        position: issues.vec3(item.position, `${path}.position`),
        halfSize: issues.num(item.halfSize, `${path}.halfSize`, 0.3, 4, 0.6),
        latch: issues.bool(item.latch, `${path}.latch`, false),
        signalId: issues.optionalId(item.signalId, `${path}.signalId`) ?? id,
      };
    },
    (p) => p.id,
    64,
  );
  const switches = issues.records(
    root.switches,
    'switches',
    (item, path): SwitchSpec => {
      const id = issues.id(item.id, `${path}.id`);
      return {
        id,
        position: issues.vec3(item.position, `${path}.position`),
        interactRadius: issues.num(item.interactRadius, `${path}.interactRadius`, 0.5, 6, 2),
        signalId: issues.optionalId(item.signalId, `${path}.signalId`) ?? id,
        initialOn: issues.bool(item.initialOn, `${path}.initialOn`, false),
      };
    },
    (s) => s.id,
    64,
  );
  return issues.result<TriggersConfig>({ plates, switches });
}

export const TRIGGERS_CAPABILITY_ID = 'gameplay.triggers';

export const triggersCapability: CapabilityDefinition<TriggersConfig, GameplayRuntime> = {
  id: TRIGGERS_CAPABILITY_ID,
  version: '1.0.0',
  description: 'Switches and pressure plates writing named world signals.',
  defaults: { plates: [], switches: [] },
  validate: validateTriggersConfig,
  install(runtime, config) {
    const { world } = runtime;
    const signals = signalBoard(runtime);
    for (const spec of config.plates) {
      world.add(world.create(entityKey('plate', spec.id)), PressurePlateComponent, { spec, pressed: false });
    }
    for (const spec of config.switches) {
      world.add(world.create(entityKey('switch', spec.id)), SwitchComponent, { spec, on: spec.initialOn, held: false });
      signals.set(spec.signalId, spec.initialOn);
    }
    const findSwitch = (id: string) => {
      const entity = world.bySemanticId(entityKey('switch', id));
      return entity === undefined ? undefined : world.get(entity, SwitchComponent);
    };
    const toggleSwitch = (id: string): SwitchResult => {
      const state = findSwitch(id);
      if (!state) {
        return 'UNKNOWN';
      }
      const player = playerPosition(runtime);
      if (!player || Math.hypot(player.x - state.spec.position.x, player.z - state.spec.position.z) > state.spec.interactRadius) {
        return 'TOO_FAR';
      }
      state.on = !state.on;
      signals.set(state.spec.signalId, state.on);
      emitPresentation(runtime, 'SwitchToggled', { switchId: id, on: state.on });
      return 'TOGGLED';
    };
    const api: TriggersApi = {
      toggle: toggleSwitch,
      interact(id, held) {
        const state = findSwitch(id);
        if (!state) {
          return 'UNKNOWN';
        }
        const edge = held && !state.held;
        state.held = held;
        return edge ? toggleSwitch(id) : 'HELD';
      },
      isOn: (id) => findSwitch(id)?.on,
      isPressed(id) {
        const entity = world.bySemanticId(entityKey('plate', id));
        return entity === undefined ? undefined : world.get(entity, PressurePlateComponent)?.pressed;
      },
    };
    const removeService = runtime.services.provide(TriggersService, api);

    runtime.systems.add({
      id: 'gameplay.triggers',
      phase: 'simulation',
      update() {
        const player = playerPosition(runtime);
        const objects = worldObjects(runtime);
        for (const entity of world.query(PressurePlateComponent)) {
          const state = world.get(entity, PressurePlateComponent)!;
          const { spec } = state;
          const onPlate = (p: Vec3Like) =>
            Math.abs(p.x - spec.position.x) <= spec.halfSize && Math.abs(p.z - spec.position.z) <= spec.halfSize && Math.abs(p.y - spec.position.y) <= 0.6;
          const occupied = (player !== undefined && onPlate(player)) || objects.some((o) => onPlate(o.position));
          const next = spec.latch ? state.pressed || occupied : occupied;
          if (next !== state.pressed) {
            state.pressed = next;
            signals.set(spec.signalId, next);
            emitPresentation(runtime, next ? 'PressurePlatePressed' : 'PressurePlateReleased', { plateId: spec.id });
          }
        }
      },
    });
    return () => {
      runtime.systems.remove('gameplay.triggers');
      removeService();
    };
  },
};
