import {
  Box3,
  Box3Helper,
  Color,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  type Object3D,
} from 'three';

/**
 * A development-only collision view (Defect 2 follow-up). Off by default, never in a production
 * build, and never a child-facing control: it is switched on only by a developer, locally, with
 *
 * - `?collisionDebug=1` on the play URL, or
 * - `localStorage.setItem('lai.collisionDebug', '1')` in the browser console,
 *
 * and only when Vite serves a development build (`import.meta.env.DEV`; `vite build` replaces it
 * with `false`, so the branch that creates the overlay is removed from production bundles).
 *
 * It draws, in the 3D scene:
 * - the child's collision footprint as a cylinder (radius + skin, body height), green;
 * - the authoritative feet position (the controller's), a white dot;
 * - the avatar's render position, a magenta dot (on top of the white one when in sync);
 * - the camera's follow/aim point, a yellow dot;
 * - solid colliders within `NEARBY_METRES` as red boxes, jumpable ones as orange boxes;
 *
 * and a small text line with the movement state, gait speed and camera distance. It only reads
 * the engine; nothing it does can move the child or change a collider.
 */

export const COLLISION_DEBUG_QUERY = 'collisionDebug';
export const COLLISION_DEBUG_STORAGE_KEY = 'lai.collisionDebug';
/** Colliders nearer than this to the child are drawn, metres. */
export const NEARBY_METRES = 6;
/** How often the nearby-collider set is rebuilt, seconds. */
const REFRESH_SECONDS = 0.25;

/**
 * Whether the overlay is on. Pure, so it is testable: `dev` is `import.meta.env.DEV`, `search`
 * the page's query string, `storage` the page's localStorage (absent or throwing: off).
 */
export function collisionDebugEnabled(
  dev: boolean,
  search: string,
  storage?: Pick<Storage, 'getItem'> | null,
): boolean {
  if (!dev) return false;
  try {
    if (new URLSearchParams(search).get(COLLISION_DEBUG_QUERY) === '1') return true;
  } catch {
    // an unreadable query string: fall through to storage
  }
  try {
    return storage?.getItem(COLLISION_DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export interface CollisionDebugFrame {
  feet: { x: number; y: number; z: number };
  avatar: { x: number; y: number; z: number } | null;
  aim: { x: number; y: number; z: number };
  radius: number;
  skin: number;
  bodyHeight: number;
  colliders: readonly Box3[];
  jumpable: ReadonlySet<Box3>;
  movementState: string;
  locomotionSpeed: number;
  cameraMode: string;
  cameraDistance: number;
}

export interface CollisionDebugOverlay {
  readonly root: Group;
  update(deltaSeconds: number, frame: CollisionDebugFrame): void;
  /** The status line, as last written (also shown in `label` when a parent was given). */
  readonly status: () => string;
  dispose(): void;
}

function dot(color: number, radius = 0.06): Mesh {
  const mesh = new Mesh(
    new SphereGeometry(radius, 8, 6),
    new MeshBasicMaterial({ color, depthTest: false }),
  );
  mesh.renderOrder = 999;
  return mesh;
}

export function createCollisionDebugOverlay(parent?: HTMLElement | null): CollisionDebugOverlay {
  const root = new Group();
  root.name = 'collision-debug';

  const footprint = new LineSegments(
    new EdgesGeometry(new CylinderGeometry(1, 1, 1, 24, 1, true)),
    new LineBasicMaterial({ color: 0x33dd55, depthTest: false }),
  );
  footprint.name = 'collision-debug:footprint';
  const feet = dot(0xffffff, 0.07);
  feet.name = 'collision-debug:feet';
  const avatar = dot(0xff33cc, 0.05);
  avatar.name = 'collision-debug:avatar';
  const aim = dot(0xffdd33);
  aim.name = 'collision-debug:aim';
  const boxes = new Group();
  boxes.name = 'collision-debug:colliders';
  root.add(footprint, feet, avatar, aim, boxes);

  let label: HTMLDivElement | null = null;
  if (parent) {
    label = document.createElement('div');
    label.setAttribute('data-testid', 'collision-debug');
    label.setAttribute('aria-hidden', 'true');
    Object.assign(label.style, {
      position: 'absolute',
      left: '8px',
      bottom: '8px',
      padding: '2px 6px',
      font: '12px monospace',
      color: '#fff',
      background: 'rgba(0,0,0,0.6)',
      pointerEvents: 'none',
      zIndex: '50',
    });
    parent.appendChild(label);
  }

  let sinceRefresh = Number.POSITIVE_INFINITY;
  let status = '';
  const solid = new Color(0xff3333);
  const hop = new Color(0xff9933);

  function clearBoxes(): void {
    for (const child of [...boxes.children] as Object3D[]) {
      boxes.remove(child);
      const helper = child as Box3Helper;
      helper.geometry.dispose();
      (helper.material as LineBasicMaterial).dispose();
    }
  }

  return {
    root,
    status: () => status,
    update(deltaSeconds, frame) {
      const reach = frame.radius + frame.skin;
      footprint.scale.set(reach, frame.bodyHeight, reach);
      footprint.position.set(frame.feet.x, frame.feet.y + frame.bodyHeight / 2, frame.feet.z);
      feet.position.set(frame.feet.x, frame.feet.y + 0.02, frame.feet.z);
      avatar.visible = frame.avatar !== null;
      if (frame.avatar) avatar.position.set(frame.avatar.x, frame.avatar.y + 0.05, frame.avatar.z);
      aim.position.set(frame.aim.x, frame.aim.y, frame.aim.z);

      sinceRefresh += Number.isFinite(deltaSeconds) ? deltaSeconds : 0;
      if (sinceRefresh >= REFRESH_SECONDS) {
        sinceRefresh = 0;
        clearBoxes();
        for (const box of frame.colliders) {
          const dx = Math.max(box.min.x - frame.feet.x, 0, frame.feet.x - box.max.x);
          const dz = Math.max(box.min.z - frame.feet.z, 0, frame.feet.z - box.max.z);
          if (Math.hypot(dx, dz) > NEARBY_METRES) continue;
          // A copy: the helper must never hold (or change) the controller's own box.
          boxes.add(new Box3Helper(box.clone(), frame.jumpable.has(box) ? hop : solid));
        }
      }

      const drift = frame.avatar
        ? Math.hypot(frame.avatar.x - frame.feet.x, frame.avatar.z - frame.feet.z)
        : 0;
      status =
        `${frame.movementState} ${frame.locomotionSpeed.toFixed(2)} m/s` +
        ` | r ${frame.radius.toFixed(2)}+${frame.skin.toFixed(2)}` +
        ` | avatar drift ${drift.toFixed(3)} m` +
        ` | ${frame.cameraMode} ${frame.cameraDistance.toFixed(2)} m`;
      if (label) label.textContent = status;
    },
    dispose() {
      clearBoxes();
      root.parent?.remove(root);
      footprint.geometry.dispose();
      (footprint.material as LineBasicMaterial).dispose();
      for (const mesh of [feet, avatar, aim]) {
        mesh.geometry.dispose();
        (mesh.material as MeshBasicMaterial).dispose();
      }
      label?.remove();
    },
  };
}
