/**
 * Treasure chests: CLOSED, OPENING, OPEN.
 *
 * Opening is requested by the child (`requestOpen`, normally from the interact button).
 * Whether a learning challenge gates it is host data (`challengeGated`): the engine does not
 * run or grade the challenge. The host calls `unlock(id)` after Django confirms the
 * challenge, and the chest then opens exactly as an ungated one does.
 *
 * REPLAY chests (scoring standard: "replay grants nothing permanent") open with the same
 * animation but never emit the discovery claim; the presentation event says `replay: true`
 * so the host shows no reward. The engine itself grants nothing in either case.
 */

import { defineComponent } from '../core/entities';
import { defineService } from '../core/services';
import type { CapabilityDefinition } from '../core/capabilities';
import type { Vec3Like } from '../contracts/player';
import { emitClaim, emitPresentation, entityKey, playerPosition, type GameplayRuntime } from './common';
import { configRoot, Issues } from './validate';

export type ChestPhase = 'CLOSED' | 'OPENING' | 'OPEN';

export interface ChestSpec {
  id: string;
  position: Vec3Like;
  /** How close the child must be to ask it to open, metres. */
  interactRadius: number;
  /** A learning challenge (host-owned) must be cleared first. */
  challengeGated: boolean;
  /** A replay chest grants nothing and emits no discovery claim. */
  replay: boolean;
  openSeconds: number;
}

export interface ChestState {
  spec: ChestSpec;
  phase: ChestPhase;
  unlocked: boolean;
  /** 0 to 1 lid progress, for the presentation. */
  progress: number;
}
export const ChestComponent = defineComponent<ChestState>('gameplay.chest');

export type ChestRequestResult = 'OPENING' | 'ALREADY_OPEN' | 'LOCKED_BY_CHALLENGE' | 'TOO_FAR' | 'UNKNOWN';

export interface ChestsApi {
  requestOpen(chestId: string): ChestRequestResult;
  /** The host confirmed the gating challenge (Django said so). */
  unlock(chestId: string): boolean;
  phaseOf(chestId: string): ChestPhase | undefined;
}
export const ChestsService = defineService<ChestsApi>('gameplay.chests');

export interface ChestsConfig {
  chests: ChestSpec[];
}

export function validateChestsConfig(input: unknown) {
  const issues = new Issues();
  const root = configRoot(input, issues);
  const chests = issues.records(
    root.chests,
    'chests',
    (item, path): ChestSpec => ({
      id: issues.id(item.id, `${path}.id`),
      position: issues.vec3(item.position, `${path}.position`),
      interactRadius: issues.num(item.interactRadius, `${path}.interactRadius`, 0.5, 6, 2.5),
      challengeGated: issues.bool(item.challengeGated, `${path}.challengeGated`, false),
      replay: issues.bool(item.replay, `${path}.replay`, false),
      openSeconds: issues.num(item.openSeconds, `${path}.openSeconds`, 0.2, 5, 0.9),
    }),
    (c) => c.id,
    128,
  );
  return issues.result<ChestsConfig>({ chests });
}

export const CHESTS_CAPABILITY_ID = 'gameplay.chests';

export const chestsCapability: CapabilityDefinition<ChestsConfig, GameplayRuntime> = {
  id: CHESTS_CAPABILITY_ID,
  version: '1.0.0',
  description: 'Treasure chests: closed, opening, open; challenge gating and replay behaviour are host data.',
  defaults: { chests: [] },
  validate: validateChestsConfig,
  install(runtime, config) {
    const { world } = runtime;
    for (const spec of config.chests) {
      world.add(world.create(entityKey('chest', spec.id)), ChestComponent, { spec, phase: 'CLOSED', unlocked: !spec.challengeGated, progress: 0 });
    }
    const find = (id: string) => {
      const entity = world.bySemanticId(entityKey('chest', id));
      return entity === undefined ? undefined : world.get(entity, ChestComponent);
    };
    const api: ChestsApi = {
      phaseOf: (id) => find(id)?.phase,
      unlock(id) {
        const state = find(id);
        if (!state) {
          return false;
        }
        state.unlocked = true;
        return true;
      },
      requestOpen(id) {
        const state = find(id);
        if (!state) {
          return 'UNKNOWN';
        }
        if (state.phase !== 'CLOSED') {
          return 'ALREADY_OPEN';
        }
        const player = playerPosition(runtime);
        if (!player || Math.hypot(player.x - state.spec.position.x, player.z - state.spec.position.z) > state.spec.interactRadius) {
          emitPresentation(runtime, 'ChestBlocked', { chestId: id, reason: 'TOO_FAR' });
          return 'TOO_FAR';
        }
        if (!state.unlocked) {
          emitPresentation(runtime, 'ChestBlocked', { chestId: id, reason: 'LOCKED_BY_CHALLENGE' });
          return 'LOCKED_BY_CHALLENGE';
        }
        state.phase = 'OPENING';
        emitPresentation(runtime, 'ChestStateChanged', { chestId: id, state: 'OPENING', replay: state.spec.replay });
        return 'OPENING';
      },
    };
    const removeService = runtime.services.provide(ChestsService, api);
    runtime.systems.add({
      id: 'gameplay.chests',
      phase: 'simulation',
      update(context) {
        for (const entity of world.query(ChestComponent)) {
          const state = world.get(entity, ChestComponent)!;
          if (state.phase !== 'OPENING') {
            continue;
          }
          state.progress = Math.min(1, state.progress + context.dt / state.spec.openSeconds);
          if (state.progress >= 1) {
            state.phase = 'OPEN';
            emitPresentation(runtime, 'ChestStateChanged', { chestId: state.spec.id, state: 'OPEN', replay: state.spec.replay });
            if (!state.spec.replay) {
              // The closest v1 claim: the child found something. Django decides what, if anything, it means.
              emitClaim(runtime, 'exploration.discovery.found', { discoveryId: state.spec.id });
            }
          }
        }
      },
    });
    return () => {
      runtime.systems.remove('gameplay.chests');
      removeService();
    };
  },
};
