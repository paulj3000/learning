import { Box3, BoxGeometry, Group, Mesh, MeshStandardMaterial, type Object3D } from 'three';

/**
 * A reusable artifact pedestal (SC-R07-02): the Three.js object that shows one
 * owned keepsake on a gold plate, for the Trophy Room and any later display.
 *
 * It is engine-adjacent, so it imports `three` and nothing else: no React, no
 * API client, no AWS. It **grants nothing and decides nothing**: whether the
 * keepsake is owned comes from the caller (the castle's usual `ITEM_OWNED` /
 * `ITEM_ABSENT` evaluation of the child's inventory), and the pedestal only
 * shows it. What the keepsake is called and says stays in `trophyDisplay` and
 * the castle guide, the accessible equivalent.
 *
 * States (`nextPedestalState`, pure):
 *
 * - `empty`: the keepsake is not owned (or none is bound). Gold plate only.
 * - `loading`: owned, and a model is being fetched. Plate and a soft placeholder.
 * - `occupied`: the keepsake is shown (the model, or the primitive when no model is named).
 * - `failed`: the model failed or timed out. The primitive fallback is shown: never blank,
 *   never an error to the child.
 *
 * `occupied` or `failed` go back to `empty` only if ownership goes away (a parent cleared the
 * backpack). A late asset result after that is ignored.
 *
 * Reduced motion: no spin and no bob, a static pose. Otherwise a slow spin (at most
 * 0.2 rad/s) and a gentle bob under 3 cm.
 */
export type PedestalState = 'empty' | 'loading' | 'occupied' | 'failed';

export type PedestalEvent =
  | { type: 'OWNED'; hasModel: boolean }
  | { type: 'NOT_OWNED' }
  | { type: 'ASSET_READY' }
  | { type: 'ASSET_FAILED' }
  | { type: 'ASSET_TIMEOUT' };

/** The pedestal's state machine. Pure and total: an event that does not apply changes nothing. */
export function nextPedestalState(state: PedestalState, event: PedestalEvent): PedestalState {
  switch (event.type) {
    case 'NOT_OWNED':
      return 'empty';
    case 'OWNED':
      if (state !== 'empty') return state;
      return event.hasModel ? 'loading' : 'occupied';
    case 'ASSET_READY':
      return state === 'loading' ? 'occupied' : state;
    case 'ASSET_FAILED':
    case 'ASSET_TIMEOUT':
      return state === 'loading' ? 'failed' : state;
    default:
      return state;
  }
}

/** The widest a keepsake may be on the plate (metres), across x and z. */
export const PEDESTAL_FOOTPRINT = 0.36;
export const DEFAULT_TARGET_HEIGHT = 0.3;
/** Spin and bob limits (metres, radians per second). */
export const MAX_SPIN_RAD_PER_S = 0.2;
export const MAX_BOB_M = 0.03;
export const DEFAULT_LOAD_TIMEOUT_MS = 8000;

const PLATE_HALF = 0.2;
const PLATE_HEIGHT = 0.03;
const PLATE_GOLD = 0xd8b45a;
const PLACEHOLDER = 0xfff4d6;
const FALLBACK = 0xc9a24a;

export interface Bounds {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

export interface ScaleFit {
  /** One uniform scale, applied to all three axes. */
  scale: number;
  /** Where to put the model's origin so it is centred on the plate and stands on it. */
  offset: { x: number; y: number; z: number };
}

/**
 * Scale normalisation, applied once at load: a uniform scale so the keepsake's footprint fits
 * `footprint` (max of width and depth) and its height fits `targetHeight`, whichever is tighter;
 * centred on the plate in x and z, its base on `baseY`. A degenerate or non-finite box keeps
 * scale 1 and is only centred, so a broken model can never become invisible or enormous.
 */
export function fitToPedestal(
  bounds: Bounds,
  {
    footprint = PEDESTAL_FOOTPRINT,
    targetHeight = DEFAULT_TARGET_HEIGHT,
    baseY = 0,
  }: { footprint?: number; targetHeight?: number; baseY?: number } = {},
): ScaleFit {
  const width = bounds.max.x - bounds.min.x;
  const depth = bounds.max.z - bounds.min.z;
  const height = bounds.max.y - bounds.min.y;
  const finite = [width, depth, height, bounds.min.x, bounds.min.y, bounds.min.z].every(
    Number.isFinite,
  );
  if (!finite) return { scale: 1, offset: { x: 0, y: baseY, z: 0 } };
  const spread = Math.max(width, depth);
  const candidates = [
    spread > 0 ? footprint / spread : Number.POSITIVE_INFINITY,
    height > 0 ? targetHeight / height : Number.POSITIVE_INFINITY,
  ];
  const tightest = Math.min(...candidates);
  const scale = Number.isFinite(tightest) && tightest > 0 ? tightest : 1;
  const centreX = (bounds.min.x + bounds.max.x) / 2;
  const centreZ = (bounds.min.z + bounds.max.z) / 2;
  return {
    scale,
    offset: { x: -centreX * scale, y: baseY - bounds.min.y * scale, z: -centreZ * scale },
  };
}

/** The idle pose at `seconds`. Reduced motion is always the static pose. */
export function pedestalPose(
  seconds: number,
  reducedMotion: boolean,
): { rotationY: number; bob: number } {
  if (reducedMotion || !Number.isFinite(seconds)) return { rotationY: 0, bob: 0 };
  return {
    rotationY: (seconds * MAX_SPIN_RAD_PER_S * 0.75) % (Math.PI * 2),
    bob: Math.sin(seconds * 1.2) * MAX_BOB_M * 0.8,
  };
}

export interface ArtifactPedestalOptions {
  id: string;
  /** The plate's base, in world space (the pedestal column itself is scenery). */
  position: { x: number; y: number; z: number };
  itemId?: string;
  /** A model by asset id (ADR-030: ids, never URLs). Absent: the primitive is the keepsake. */
  modelRef?: string;
  targetHeight?: number;
  reducedMotion: boolean;
  /** Resolves a model by asset id. The loader owns its cache, so the pedestal never disposes it. */
  loadModel?: (modelRef: string) => Promise<Object3D>;
  timeoutMs?: number;
}

export interface ArtifactPedestal {
  group: Group;
  state: () => PedestalState;
  /** Ownership from the child's inventory. The only input that moves the pedestal. */
  setOwned: (owned: boolean) => void;
  /** Advance the idle animation. Does nothing under reduced motion. */
  tick: (seconds: number) => void;
  dispose: () => void;
}

/** Builds a pedestal top: the plate, and whichever keepsake object the state calls for. */
export function createArtifactPedestal(options: ArtifactPedestalOptions): ArtifactPedestal {
  const { id, position, itemId, modelRef, reducedMotion, loadModel } = options;
  const targetHeight = options.targetHeight ?? DEFAULT_TARGET_HEIGHT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
  const hasModel = Boolean(modelRef && loadModel);
  const owned = new Set<Mesh>();

  const group = new Group();
  group.name = `artifact-pedestal-${id}`;
  group.position.set(position.x, position.y, position.z);

  const ownMesh = (name: string, color: number, w: number, h: number, d: number, opacity = 1) => {
    const mesh = new Mesh(
      new BoxGeometry(w, h, d),
      new MeshStandardMaterial({ color, transparent: opacity < 1, opacity }),
    );
    mesh.name = name;
    owned.add(mesh);
    return mesh;
  };

  const plate = ownMesh(
    `${group.name}-plate`,
    PLATE_GOLD,
    PLATE_HALF * 2,
    PLATE_HEIGHT,
    PLATE_HALF * 2,
  );
  plate.position.y = PLATE_HEIGHT / 2;
  group.add(plate);

  const display = new Group();
  display.name = `${group.name}-display`;
  display.position.y = PLATE_HEIGHT;
  group.add(display);

  let state: PedestalState = 'empty';
  let shown: Object3D | null = null;
  let model: Object3D | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let load = 0; // increments per load, so a stale result is ignored
  let disposed = false;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const show = (next: Object3D | null) => {
    if (shown) display.remove(shown);
    shown = next;
    if (next) display.add(next);
  };

  // Built once, on first need, and disposed with the pedestal.
  let fallback: Mesh | null = null;
  let placeholder: Mesh | null = null;
  const primitive = () => {
    if (!fallback) {
      const side = PEDESTAL_FOOTPRINT * 0.6;
      fallback = ownMesh(`${group.name}-fallback`, FALLBACK, side, targetHeight * 0.6, side);
      fallback.position.y = (targetHeight * 0.6) / 2;
    }
    return fallback;
  };
  const soft = () => {
    if (!placeholder) {
      placeholder = ownMesh(`${group.name}-placeholder`, PLACEHOLDER, 0.16, 0.16, 0.16, 0.35);
      placeholder.position.y = 0.08;
    }
    return placeholder;
  };

  const render = () => {
    if (state === 'empty') show(null);
    else if (state === 'loading') show(soft());
    else if (state === 'occupied') show(model ?? primitive());
    else show(primitive());
  };

  const dispatch = (event: PedestalEvent) => {
    if (disposed) return;
    const next = nextPedestalState(state, event);
    if (next === state) return;
    state = next;
    if (state !== 'loading') clearTimer();
    if (state === 'empty') {
      load += 1;
      model = null;
    }
    render();
  };

  const startLoad = () => {
    if (!modelRef || !loadModel) return;
    const mine = ++load;
    timer = setTimeout(() => {
      if (mine === load) dispatch({ type: 'ASSET_TIMEOUT' });
    }, timeoutMs);
    loadModel(modelRef).then(
      (object) => {
        if (disposed || mine !== load || state !== 'loading') return;
        const fit = fitToPedestal(new Box3().setFromObject(object), { targetHeight });
        object.scale.setScalar(fit.scale);
        object.position.set(fit.offset.x, fit.offset.y, fit.offset.z);
        const holder = new Group();
        holder.name = `${group.name}-model`;
        holder.add(object);
        model = holder;
        dispatch({ type: 'ASSET_READY' });
      },
      () => {
        if (mine === load) dispatch({ type: 'ASSET_FAILED' });
      },
    );
  };

  return {
    group,
    state: () => state,
    setOwned(isOwned: boolean) {
      if (!itemId) return; // an unbound pedestal is always empty
      if (!isOwned) {
        dispatch({ type: 'NOT_OWNED' });
        return;
      }
      const before = state;
      dispatch({ type: 'OWNED', hasModel });
      if (before === 'empty' && state === 'loading') startLoad();
    },
    tick(seconds: number) {
      const pose = pedestalPose(seconds, reducedMotion);
      display.rotation.y = pose.rotationY;
      display.position.y = PLATE_HEIGHT + Math.max(0, pose.bob);
    },
    dispose() {
      disposed = true;
      clearTimer();
      show(null);
      group.removeFromParent();
      for (const mesh of owned) {
        mesh.geometry.dispose();
        (mesh.material as MeshStandardMaterial).dispose();
      }
      owned.clear();
    },
  };
}
