import type { Object3D } from 'three';
import { Vector3 } from 'three';

/**
 * A probe for the browser acceptance suites (`react/e2e/acceptance`), installed by
 * `createLocationEngine` only when Vite runs with `--mode e2e`. Every other build replaces
 * `import.meta.env.MODE` with its own mode, so the branch that installs it is removed.
 *
 * Playwright cannot steer a first-person walk to an exact spot from pixels, so the probe
 * reports where the player stands and can stand them in front of an entity, facing it. It
 * never interacts, grades or records anything: the test still presses E or taps the prompt,
 * and every outcome comes from the same engine events and server calls a child's would.
 */
export interface E2EProbe {
  player(): { x: number; z: number; yaw: number };
  entities(): { entityId: string; kind: string; x: number; z: number; focusable: boolean }[];
  /** The entity that has focus right now (the reticle or interaction assist), or null. */
  focused(): string | null;
  /** Stands the player `distance` metres from the entity on walkable ground, facing it. */
  standFacing(entityId: string, distance?: number): boolean;
  /** Stands the player at a point facing `yaw` (forward is (sin yaw, cos yaw)); walls still hold. */
  standAt(x: number, z: number, yaw: number): void;
  /**
   * Every NPC Manager root in the scene (`npc:<placementKey>`), with what the runtime reports
   * about it (`NPC_DIAGNOSTICS` in features/npc-manager/engine/createNpcRuntime.ts).
   */
  npcs(): E2ENpc[];
  /** Tilts the view (radians, negative looks down), as dragging to look would. */
  look(pitch: number): void;
  /** Whether a manifest entity is drawn (false while the NPC Manager has taken it over). */
  entityVisible(entityId: string): boolean | null;
}

export interface E2ENpc {
  placementKey: string;
  npcId: string | null;
  x: number;
  z: number;
  yaw: number;
  visible: boolean;
  placeholder: boolean | null;
  animation: {
    base: string;
    overlay: { state: string; priority: number; mode: string } | null;
    clip: string | null;
  } | null;
}

export interface E2EProbeTarget {
  entityId: string;
  kind: string;
  root: Object3D;
  focusable: boolean;
}

interface E2EProbeDeps {
  controller: {
    position: { x: number; z: number; set(x: number, y: number, z: number): void };
    yaw: number;
    pitch: number;
  };
  targets: readonly E2EProbeTarget[];
  walkable: (x: number, z: number) => boolean;
  focused: () => string | null;
  /** The scene graph, searched for NPC Manager roots. */
  scene?: Object3D;
}

const NPC_ROOT = /^npc:/;
const NPC_DIAGNOSTICS = 'npcDiagnostics';

function drawn(object: Object3D): boolean {
  for (let node: Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

declare global {
  interface Window {
    __laiE2E?: E2EProbe;
  }
}

const DIRECTIONS = 16;

export function installE2EProbe(deps: E2EProbeDeps): () => void {
  const where = new Vector3();
  const probe: E2EProbe = {
    player: () => ({
      x: deps.controller.position.x,
      z: deps.controller.position.z,
      yaw: deps.controller.yaw,
    }),
    entities: () =>
      deps.targets.map((target) => {
        target.root.getWorldPosition(where);
        return {
          entityId: target.entityId,
          kind: target.kind,
          x: where.x,
          z: where.z,
          focusable: target.focusable,
        };
      }),
    focused: deps.focused,
    standFacing(entityId, distance = 1.6) {
      const target = deps.targets.find((candidate) => candidate.entityId === entityId);
      if (!target) return false;
      target.root.getWorldPosition(where);
      for (let step = 0; step < DIRECTIONS; step += 1) {
        const angle = (step / DIRECTIONS) * Math.PI * 2;
        const x = where.x + Math.sin(angle) * distance;
        const z = where.z + Math.cos(angle) * distance;
        if (!deps.walkable(x, z)) continue;
        deps.controller.position.set(x, 0, z);
        // The controller's forward at yaw 0 is +Z, so face along (target - player).
        deps.controller.yaw = Math.atan2(where.x - x, where.z - z);
        deps.controller.pitch = 0;
        return true;
      }
      return false;
    },
    standAt(x, z, yaw) {
      deps.controller.position.set(x, 0, z);
      deps.controller.yaw = yaw;
      deps.controller.pitch = 0;
    },
    npcs() {
      const found: E2ENpc[] = [];
      deps.scene?.traverse((node) => {
        if (!NPC_ROOT.test(node.name)) return;
        node.getWorldPosition(where);
        const read = node.userData[NPC_DIAGNOSTICS] as
          | (() => {
              npcId: string;
              placeholder: boolean;
              animation: E2ENpc['animation'];
            })
          | undefined;
        const diagnostics = typeof read === 'function' ? read() : null;
        found.push({
          placementKey: node.name.slice(4),
          npcId: diagnostics?.npcId ?? null,
          x: where.x,
          z: where.z,
          yaw: node.rotation.y,
          visible: drawn(node),
          placeholder: diagnostics?.placeholder ?? null,
          animation: diagnostics?.animation ?? null,
        });
      });
      return found;
    },
    look(pitch) {
      deps.controller.pitch = pitch;
    },
    entityVisible(entityId) {
      const target = deps.targets.find((candidate) => candidate.entityId === entityId);
      return target ? drawn(target.root) : null;
    },
  };
  window.__laiE2E = probe;
  return () => {
    if (window.__laiE2E === probe) delete window.__laiE2E;
  };
}
