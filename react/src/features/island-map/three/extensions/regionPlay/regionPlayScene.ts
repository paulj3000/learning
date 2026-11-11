import {
  AnimationMixer,
  BoxGeometry,
  CylinderGeometry,
  Group,
  LoopOnce,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  CanvasTexture,
  type AnimationAction,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import { prefersReducedMotion } from '../../../../../lib/motionPreference';
import { cloneAssetScene } from '../../assets/cloneAsset';
import { mountAreaEffects, type AreaEffectsApi } from './areaEffectsScene';
import { mountAreaPuzzles, type AreaPuzzleApi } from './areaPuzzleScene';
import { drawEntity, type Owned } from './areaStandIns';
import type { WorldExtension, WorldExtensionContext } from '../../runtime/extensionRegistry';
import {
  REGION_PLAY_EXTENSION_ID,
  tryParseRegionPlayConfig,
  type RegionPlayChestConfig,
} from '../../../../region-play/regionPlayConfig';
import { buildFireflies, shimmerWater } from './livingCove';
import { buildProceduralScenery } from './proceduralScenery';

/**
 * The scene half of `region-play` (TR-7): draws what a server-published
 * region's manifest leaves to it.
 *
 * - **Chests.** The catalogue model when the chest names one, held on its
 *   open clip's last frame when open; a built chest (a box with a hinged lid
 *   and gold inside) when it names none, the model fails to load, or the
 *   model has no open clip. Either way open and closed look different, and
 *   which one shows comes only from the child's server state: the config at
 *   build time, then `setChestOpen` from the companion after the play API
 *   says so. Interacting never opens a chest.
 * - **Beacons (TR-12).** A small gold star turns and bobs over every chest
 *   drawn closed, so a child can see from across the cove where treasure
 *   waits; it goes when the chest is drawn open. Placed in the scene, not
 *   under the chest, so the chest's own size (the focus marker) is unchanged.
 * - **Procedural scenery (TR-13).** Palms, the tent, the campfire, torches,
 *   flags, the rowboat, pillars, the pedestal and the gate, drawn from
 *   primitives until finished models exist (`proceduralScenery.ts`), and
 *   held still when the device asks for reduced motion.
 * - **Figures.** A placeholder character for an NPC published without a
 *   model, so the region still renders and the NPC still talks.
 * - **The way to Lookout Point (TR-17).** When the quest's completion world change is
 *   present, whether at build time or told live through `setUnlocked`, the gate's bars lift,
 *   the colliders that shut the gate and the channel are removed, the bridge is laid and the
 *   sinking planks go. The channel's side colliders stay, so the bridge is the only way across.
 *   It only opens: a world change is never undone.
 * - **A living cove (TR-18).** Shimmering water, fireflies, and Pip's reactions (his own
 *   `Talk` and `Wave` clips, or a bounce for a placeholder figure).
 * - **Rune stones (TR-16).** A stone sinks when touched and the stones flash green or orange
 *   with the server's verdict. Presentation only.
 *
 * It decides nothing and records nothing. Focus, labels, and interaction
 * stay with the runtime, which owns these entities' roots.
 */

export interface RegionPlaySceneApi {
  setChestOpen(entityId: string, open: boolean): void;
  /** Whether a chest is drawn open, or undefined for an unknown chest. */
  isChestOpen(entityId: string): boolean | undefined;
  /** Lava, steam, checkpoints, openings and the way back (ADR-047, Firepeak). */
  effects: AreaEffectsApi;
  /** How puzzle objects are shown (ADR-047 F). */
  puzzles: AreaPuzzleApi;
  /**
   * TR-14: why a chest is locked now, from server state. A `HIDDEN` chest locked by progress is
   * not drawn and cannot be focused; a chest locked by progress has no beacon.
   */
  setChestLock(entityId: string, lockReason: 'PROGRESS' | 'ITEM' | null): void;
  /** TR-14: a pickup the server says is picked up; it disappears and cannot be focused. */
  setPickupCollected(entityId: string): void;
  /** TR-14: the numbers on a puzzle's answer stones while its challenge is out, or none. */
  setRuneNumbers(numbers: ReadonlyMap<string, number> | null): void;
  /**
   * TR-17: the quest's completion world change is present, so open the gate and lay the bridge.
   * Idempotent, and never closes again. Returns whether anything changed.
   */
  setUnlocked(unlocked: boolean): boolean;
  /** Whether the way to Lookout Point is open in the scene. */
  isUnlocked(): boolean;
  /** TR-16: a rune stone sinks under the child's touch and comes back up. */
  pressRune(entityId: string): void;
  /** TR-16: every rune stone flashes green (the server said right) or orange (try again). */
  flashRunes(correct: boolean): void;
  /** TR-18: Pip reacts. `talk` while listening, `cheer` for a find. */
  reactNpc(entityId: string, reaction: 'talk' | 'cheer'): void;
  /**
   * SM-P7: where things are, for sound. A reader writes the thing's world position into `out`
   * and returns false once it is gone. They hold the object only through this closure and are
   * dropped by the audio when it is disposed. `undefined` for an unknown entity.
   */
  entityPositionReader(entityId: string): ((out: [number, number, number]) => boolean) | undefined;
  /** SM-P7: where the way to Lookout Point is shut and opens (the first lifted gate). */
  unlockPositionReader(): ((out: [number, number, number]) => boolean) | undefined;
  /** SM-P7: the camera, as a world-matrix object, for the audio listener. */
  listenerSource(): { matrixWorld: { elements: ArrayLike<number> } };
  /** SM-P7: runs `callback` on every rendered frame; returns the stop function. */
  onFrame(callback: (deltaSeconds: number) => void): () => void;
}

/** SM-P7: reads an object's world position, and reports false once it has left the scene. */
function worldPositionReader(object: Object3D): (out: [number, number, number]) => boolean {
  return (out) => {
    if (object.parent === null) return false;
    object.updateWorldMatrix(true, false);
    const e = object.matrixWorld.elements;
    out[0] = e[12] as number;
    out[1] = e[13] as number;
    out[2] = e[14] as number;
    return true;
  };
}

/** Names, so tests and debugging can find them (TR-14). */
export const KEY_NAME = 'region-play:key';
export const RUNE_STONE_NAME = 'region-play:rune-stone';
export const RUNE_LABEL_NAME = 'region-play:rune-label';
const STONE = 0x8f8a80;
const RUNE_GLOW = 0x7fe3ff;
const RUNE_RIGHT = 0x5be37d;
const RUNE_WRONG = 0xffa040;
/** How far a touched rune stone sinks, and how long its dip and its flash last. */
const RUNE_PRESS_DEPTH = 0.18;
export const RUNE_PRESS_SECONDS = 0.5;
export const RUNE_FLASH_SECONDS = 0.9;
/** A placeholder figure's hop when it reacts, in metres and seconds. */
const BOUNCE_HEIGHT = 0.25;
export const BOUNCE_SECONDS = 0.8;

const WOOD = 0x8a5a2b;
const TRIM = 0xd4a937;
const GOLD = 0xf2c94c;
const FIGURE = 0x2f8f4e;
/** How far a built lid swings back when open, in radians. */
export const OPEN_LID_ANGLE = -1.9;
/** How long a built lid takes to swing open when the server opens it mid-visit (TR-8). */
export const OPEN_SECONDS = 0.7;
/** How long the gold sparkles rise after opening. */
export const SPARKLE_SECONDS = 1.4;
const SPARKLE_COUNT = 10;
/** The beacon's name, so tests and debugging can find it. */
export const BEACON_NAME = 'region-play:beacon';
/** How high over the top of a closed chest the beacon floats, in metres. */
const BEACON_LIFT = 0.9;

interface DrawnChest {
  open: boolean;
  /** `instant`: drawn in its state with no animation (entering, or a state read from the server). */
  show(open: boolean, instant: boolean): void;
  /** Advances any opening animation. */
  tick(deltaSeconds: number): void;
  dispose(): void;
}

export const regionPlaySceneExtension: WorldExtension = {
  id: REGION_PLAY_EXTENSION_ID,
  assetIds(config) {
    const parsed = tryParseRegionPlayConfig(config);
    if (!parsed) return [];
    return [
      ...new Set([
        ...parsed.chests.flatMap((chest) => (chest.assetId ? [chest.assetId] : [])),
        // Models for stand-ins, declared only when one can be delivered (FP-3).
        ...parsed.drawn.flatMap((drawn) => (drawn.assetId ? [drawn.assetId] : [])),
        ...(parsed.effects.backdrop?.assetId ? [parsed.effects.backdrop.assetId] : []),
      ]),
    ];
  },
  mount(context: WorldExtensionContext) {
    const config = tryParseRegionPlayConfig(context.config);
    if (!config) {
      console.warn('[region-play] ignoring a binding with unreadable config');
      return;
    }
    const geometries: BufferGeometry[] = [];
    const materials: Material[] = [];
    const own = (geometry: BufferGeometry, color: number): Mesh => {
      const material = new MeshStandardMaterial({ color });
      geometries.push(geometry);
      materials.push(material);
      return new Mesh(geometry, material);
    };
    const mixers = new Set<AnimationMixer>();
    const chests = new Map<string, DrawnChest>();
    let disposed = false;

    for (const figure of config.figures) {
      const root = context.entityRoot(figure.entityId);
      if (!root) continue;
      const bodyHeight = figure.height * 0.7;
      const body = own(new CylinderGeometry(0.3, 0.35, bodyHeight, 12), FIGURE);
      body.position.y = bodyHeight / 2;
      const head = own(new SphereGeometry(figure.height * 0.15, 12, 8), FIGURE);
      head.position.y = bodyHeight + figure.height * 0.15;
      root.add(body, head);
    }

    for (const chest of config.chests) {
      const root = context.entityRoot(chest.entityId);
      if (!root) continue;
      if (chest.presentation === 'PUZZLE' || chest.presentation === 'REPLAY') {
        // The pedestal and the spyglass are scenery (TR-13, TR-20); a puzzle only remembers
        // whether it is solved, and a replay activity is never open.
        chests.set(chest.entityId, puzzleState(chest.presentation === 'PUZZLE' && chest.isOpen));
        continue;
      }
      let current: DrawnChest = builtChest(root, chest, own);
      current.show(chest.isOpen, true);
      chests.set(chest.entityId, current);
      if (!chest.assetId || !chest.openClip) continue;
      const openClip = chest.openClip;
      context
        .loadModel(chest.assetId)
        .then((asset) => {
          if (disposed) return;
          const clip = asset.animations.find((candidate) => candidate.name === openClip);
          if (!clip) {
            // No way to show it open: keep the built chest, and say why.
            console.warn(
              `[region-play] chest ${chest.entityId}: "${chest.assetId}" has no "${openClip}" clip; drawing the built chest`,
            );
            return;
          }
          const model = cloneAssetScene(asset.scene);
          model.scale.setScalar(chest.scale);
          const mixer = new AnimationMixer(model);
          const action = mixer.clipAction(clip);
          const open = current.open;
          current.dispose();
          root.add(model);
          mixers.add(mixer);
          current = modelChest(root, model, mixer, action, clip.duration, () =>
            mixers.delete(mixer),
          );
          current.show(open, true);
          chests.set(chest.entityId, current);
        })
        .catch((error: unknown) => {
          // A model that fails to load leaves the built chest (TR-7a); the cause is still reported.
          console.warn(
            `[region-play] chest ${chest.entityId}: could not load "${chest.assetId}"; drawing the built chest`,
            error,
          );
        });
    }

    // One shared shape and material for every beacon; one mesh per chest.
    const beaconGeometry = new OctahedronGeometry(0.18);
    const beaconMaterial = new MeshStandardMaterial({ color: GOLD, emissive: GOLD });
    geometries.push(beaconGeometry);
    materials.push(beaconMaterial);
    const beacons = new Map<string, { mesh: Mesh; baseY: number; shown: () => boolean }>();
    const addBeacon = (entityId: string, height: number, shown: () => boolean) => {
      const root = context.entityRoot(entityId);
      if (!root) return;
      const mesh = new Mesh(beaconGeometry, beaconMaterial);
      mesh.name = `${BEACON_NAME}:${entityId}`;
      root.updateMatrixWorld(true);
      mesh.position.setFromMatrixPosition(root.matrixWorld);
      const baseY = mesh.position.y + height + BEACON_LIFT;
      mesh.position.y = baseY;
      mesh.visible = shown();
      context.scene.add(mesh);
      beacons.set(entityId, { mesh, baseY, shown });
    };

    // TR-14: where the child may go next. A chest locked by progress shows no beacon, and a
    // hidden one is not there at all until the server says it may be found.
    const locks = new Map(config.chests.map((chest) => [chest.entityId, chest.lockReason ?? null]));
    const presentation = new Map(
      config.chests.map((chest) => [chest.entityId, chest.presentation ?? 'CHEST']),
    );
    const applyLock = (entityId: string) => {
      if (presentation.get(entityId) !== 'HIDDEN') return;
      const hidden = locks.get(entityId) === 'PROGRESS' && chests.get(entityId)?.open !== true;
      const root = context.entityRoot(entityId);
      if (root) root.visible = !hidden;
      context.setFocusable(entityId, !hidden);
    };
    for (const chest of config.chests) {
      applyLock(chest.entityId);
      addBeacon(
        chest.entityId,
        chest.placeholder.height * chest.scale,
        () =>
          chests.get(chest.entityId)?.open === false && locks.get(chest.entityId) !== 'PROGRESS',
      );
    }

    // TR-14: pickups (the key), drawn here until a catalogue model exists, and gone once taken.
    const pickups = new Map<string, Object3D>();
    const collected = new Set<string>();
    for (const pickup of config.pickups ?? []) {
      const root = context.entityRoot(pickup.entityId);
      if (!root) continue;
      const key = builtKey(own);
      root.add(key);
      pickups.set(pickup.entityId, key);
      addBeacon(pickup.entityId, 0.3, () => !collected.has(pickup.entityId));
    }

    // TR-14: rune stones a puzzle is answered with, each with a number while its challenge is out.
    const runes = new Map<
      string,
      {
        label: Sprite;
        glow: MeshStandardMaterial;
        stone: Mesh;
        /** Seconds left in the dip (TR-16), or 0. */
        press: number;
      }
    >();
    for (const rune of config.runes ?? []) {
      const root = context.entityRoot(rune.entityId);
      if (!root) continue;
      const glow = new MeshStandardMaterial({
        color: STONE,
        emissive: RUNE_GLOW,
        emissiveIntensity: 0,
      });
      const stoneGeometry = new BoxGeometry(0.7, 1.6, 0.45);
      geometries.push(stoneGeometry);
      materials.push(glow);
      const stone = new Mesh(stoneGeometry, glow);
      stone.name = RUNE_STONE_NAME;
      stone.position.y = 0.8;
      const labelMaterial = new SpriteMaterial({ transparent: true });
      materials.push(labelMaterial);
      const label = new Sprite(labelMaterial);
      label.name = RUNE_LABEL_NAME;
      label.position.y = 2.1;
      label.scale.set(0.8, 0.8, 1);
      label.visible = false;
      root.add(stone, label);
      runes.set(rune.entityId, { label, glow, stone, press: 0 });
    }
    let beaconClock = 0;
    /** A flash on every stone (TR-16): the colour and the seconds left. */
    let flash: { color: number; left: number } | null = null;
    /** Placeholder figures hopping (TR-18): entity id to seconds elapsed and resting height. */
    const bounces = new Map<string, { t: number; base: number }>();

    const procedural = buildProceduralScenery(config.procedural ?? []);
    context.scene.add(procedural.root);
    const still = prefersReducedMotion();

    // TR-18: the water and the fireflies. Held where they were first drawn when `still`.
    const water = shimmerWater((config.ambience?.water ?? []).map((id) => context.sceneryRoot(id)));
    const fireflies = buildFireflies(config.ambience?.fireflies ?? [], context.scene);

    // TR-17: the way to Lookout Point. Closed until the quest's world change is present.
    const unlock = config.unlock;
    let unlocked = false;
    const open = (instant: boolean): boolean => {
      if (!unlock || unlocked) return false;
      unlocked = true;
      for (const id of unlock.openColliders) context.removeCollider(id);
      for (const id of unlock.showWhenOpen) procedural.setVisible(id, true);
      for (const id of unlock.hideWhenOpen) procedural.setVisible(id, false);
      for (const id of unlock.liftGates) procedural.liftGate(id, instant);
      return true;
    };
    if (unlock) {
      for (const id of unlock.showWhenOpen) procedural.setVisible(id, false);
      if (unlock.unlocked) open(true);
    }

    const tickRunes = (delta: number) => {
      if (flash) {
        flash.left = Math.max(0, flash.left - delta);
        if (flash.left === 0) flash = null;
      }
      for (const rune of runes.values()) {
        if (rune.press > 0) rune.press = Math.max(0, rune.press - delta);
        // A dip that goes down and comes back: 0 at both ends, deepest in the middle.
        const dip = Math.sin((rune.press / RUNE_PRESS_SECONDS) * Math.PI);
        rune.stone.position.y = 0.8 - RUNE_PRESS_DEPTH * Math.max(0, dip);
        if (flash) {
          rune.glow.emissive.setHex(flash.color);
          rune.glow.emissiveIntensity = 0.3 + 0.7 * (flash.left / RUNE_FLASH_SECONDS);
        } else if (rune.label.visible) {
          rune.glow.emissive.setHex(RUNE_GLOW);
          rune.glow.emissiveIntensity = 0.45;
        } else {
          rune.glow.emissiveIntensity = 0;
        }
      }
    };
    const tickBounces = (delta: number) => {
      for (const [entityId, bounce] of bounces) {
        bounce.t += delta;
        const root = context.entityRoot(entityId);
        if (!root || bounce.t >= BOUNCE_SECONDS) {
          if (root) root.position.y = bounce.base;
          bounces.delete(entityId);
          continue;
        }
        root.position.y =
          bounce.base +
          Math.abs(Math.sin((bounce.t / BOUNCE_SECONDS) * Math.PI * 2)) * BOUNCE_HEIGHT;
      }
    };

    const stopFrames = context.onFrame((delta) => {
      for (const mixer of mixers) mixer.update(delta);
      for (const chest of chests.values()) chest.tick(delta);
      if (!still) {
        procedural.tick(delta);
        water.tick(delta);
        fireflies.tick(delta);
      }
      beaconClock += delta;
      tickRunes(delta);
      tickBounces(delta);
      for (const key of pickups.values()) {
        if (still) break;
        key.position.y = Math.sin(beaconClock * 2.4) * 0.08;
        key.rotation.y += delta * 1.6;
      }
      for (const beacon of beacons.values()) {
        beacon.mesh.visible = beacon.shown();
        if (still) continue;
        beacon.mesh.position.y = beacon.baseY + Math.sin(beaconClock * 2) * 0.1;
        beacon.mesh.rotation.y += delta * 1.2;
      }
    });

    // ADR-047 / Firepeak: stand-ins and puzzle objects, environment effects, puzzle visuals.
    const owned: Owned = { geometries, materials };
    for (const drawn of config.drawn) {
      const root = context.entityRoot(drawn.entityId);
      if (root) drawEntity(root, drawn, owned, context.loadModel, cloneAssetScene, () => disposed);
    }
    const effects = mountAreaEffects(
      context,
      config.effects,
      config.changeKeys,
      owned,
      () => disposed,
    );
    const puzzles = mountAreaPuzzles(context, owned);

    const api: RegionPlaySceneApi = {
      effects: effects.api,
      puzzles: puzzles.api,
      setChestOpen(entityId, open) {
        const chest = chests.get(entityId);
        if (chest && chest.open !== open) chest.show(open, false);
      },
      isChestOpen(entityId) {
        return chests.get(entityId)?.open;
      },
      setChestLock(entityId, lockReason) {
        if (!locks.has(entityId)) return;
        locks.set(entityId, lockReason);
        applyLock(entityId);
      },
      setPickupCollected(entityId) {
        const key = pickups.get(entityId);
        if (!key || collected.has(entityId)) return;
        collected.add(entityId);
        key.removeFromParent();
        context.setFocusable(entityId, false);
      },
      setUnlocked(next) {
        return next ? open(still) : false;
      },
      isUnlocked: () => unlocked,
      pressRune(entityId) {
        const rune = runes.get(entityId);
        if (rune && !still) rune.press = RUNE_PRESS_SECONDS;
      },
      flashRunes(correct) {
        if (runes.size === 0) return;
        flash = { color: correct ? RUNE_RIGHT : RUNE_WRONG, left: RUNE_FLASH_SECONDS };
      },
      reactNpc(entityId, reaction) {
        const clip = reaction === 'talk' ? 'Talk' : 'Wave';
        const animator = context.npcAnimator(entityId);
        if (animator?.clips.some((candidate) => candidate.name === clip)) {
          context.playNpcGesture(entityId, clip, reaction === 'talk' ? 2 : 3);
          return;
        }
        // A placeholder figure has no clips: it hops instead, unless the child wants stillness.
        const root = context.entityRoot(entityId);
        if (!root || still || bounces.has(entityId)) return;
        bounces.set(entityId, { t: 0, base: root.position.y });
      },
      entityPositionReader(entityId) {
        const root = context.entityRoot(entityId);
        return root ? worldPositionReader(root) : undefined;
      },
      unlockPositionReader() {
        const id = unlock?.liftGates[0];
        const gate = id ? procedural.rootOf(id) : undefined;
        return gate ? worldPositionReader(gate) : undefined;
      },
      listenerSource: () => context.camera,
      onFrame: (callback) => context.onFrame(callback),
      setRuneNumbers(numbers) {
        for (const [entityId, rune] of runes) {
          const number = numbers?.get(entityId);
          rune.label.visible = number !== undefined;
          rune.label.userData.number = number;
          const old = rune.label.material.map;
          rune.label.material.map = number === undefined ? null : numberTexture(number);
          rune.label.material.needsUpdate = true;
          old?.dispose();
        }
      },
    };

    return {
      api,
      dispose() {
        disposed = true;
        stopFrames();
        effects.dispose();
        puzzles.dispose();
        for (const beacon of beacons.values()) context.scene.remove(beacon.mesh);
        for (const rune of runes.values()) rune.label.material.map?.dispose();
        procedural.dispose();
        water.dispose();
        fireflies.dispose();
        for (const chest of chests.values()) chest.dispose();
        for (const mixer of mixers) mixer.stopAllAction();
        for (const geometry of geometries) geometry.dispose();
        for (const material of materials) material.dispose();
      },
    };
  },
};

/** A puzzle's state: no chest of its own, only whether it is solved (TR-14). */
function puzzleState(solved: boolean): DrawnChest {
  const drawn: DrawnChest = {
    open: solved,
    show(open) {
      drawn.open = open;
    },
    tick() {},
    dispose() {},
  };
  return drawn;
}

/** A gold key from primitives (TR-14), until `treasure-key` exists as a model. */
function builtKey(own: (geometry: BufferGeometry, color: number) => Mesh): Group {
  const key = new Group();
  key.name = KEY_NAME;
  const bow = own(new TorusGeometry(0.1, 0.03, 6, 12), GOLD);
  bow.position.x = -0.2;
  const shaft = own(new CylinderGeometry(0.025, 0.025, 0.36, 6).rotateZ(Math.PI / 2), GOLD);
  shaft.position.x = 0.04;
  const tooth = own(new BoxGeometry(0.05, 0.08, 0.03), GOLD);
  tooth.position.set(0.18, -0.06, 0);
  key.add(bow, shaft, tooth);
  return key;
}

/**
 * A number drawn on a canvas for a rune stone's label. Null where there is no 2D canvas (a
 * test environment); the label still carries the number in `userData.number`.
 */
function numberTexture(value: number): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = canvas.getContext('2d');
  } catch {
    context = null;
  }
  if (!context) return null;
  context.fillStyle = 'rgba(15, 30, 40, 0.75)';
  context.beginPath();
  context.arc(64, 64, 60, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#ffffff';
  context.font = 'bold 76px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(String(value), 64, 68);
  return new CanvasTexture(canvas);
}

function builtChest(
  root: Object3D,
  chest: RegionPlayChestConfig,
  own: (geometry: BufferGeometry, color: number) => Mesh,
): DrawnChest {
  const { width, height, depth } = chest.placeholder;
  const group = new Group();
  group.name = 'region-play:built-chest';
  group.scale.setScalar(chest.scale);
  const baseHeight = height * 0.6;
  const base = own(new BoxGeometry(width, baseHeight, depth), WOOD);
  base.position.y = baseHeight / 2;
  const trim = own(new BoxGeometry(width * 1.02, baseHeight * 0.12, depth * 1.02), TRIM);
  trim.position.y = baseHeight * 0.85;
  const gold = own(new BoxGeometry(width * 0.8, baseHeight * 0.1, depth * 0.8), GOLD);
  gold.position.y = baseHeight;
  gold.name = 'region-play:gold';
  // The lid hinges along the back edge: a pivot there, the lid offset forward from it.
  const hinge = new Group();
  hinge.name = 'region-play:lid-hinge';
  hinge.position.set(0, baseHeight, -depth / 2);
  const lidHeight = height - baseHeight;
  const lid = own(new BoxGeometry(width, lidHeight, depth), WOOD);
  lid.position.set(0, lidHeight / 2, depth / 2);
  hinge.add(lid);
  // Gold sparkles that rise out of the chest as it opens: the moment of reward in the world.
  const sparkles = new Group();
  sparkles.name = 'region-play:sparkles';
  sparkles.visible = false;
  for (let index = 0; index < SPARKLE_COUNT; index += 1) {
    const sparkle = own(new SphereGeometry(0.06, 6, 4), GOLD);
    const angle = (index / SPARKLE_COUNT) * Math.PI * 2;
    sparkle.userData.drift = {
      x: Math.cos(angle) * width * 0.35,
      z: Math.sin(angle) * depth * 0.35,
    };
    sparkles.add(sparkle);
  }
  group.add(base, trim, gold, hinge, sparkles);
  root.add(group);

  let opening = 0; // seconds into the lid swing; 0 when not animating
  let sparkling = 0; // seconds into the sparkle rise; 0 when not animating
  const place = (lidProgress: number) => {
    hinge.rotation.x = OPEN_LID_ANGLE * lidProgress;
    gold.position.y = baseHeight + baseHeight * 0.15 * lidProgress;
  };

  const drawn: DrawnChest = {
    open: false,
    show(open, instant) {
      drawn.open = open;
      gold.visible = open;
      if (!open || instant) {
        opening = 0;
        sparkling = 0;
        sparkles.visible = false;
        place(open ? 1 : 0);
        return;
      }
      opening = Number.EPSILON;
      sparkling = Number.EPSILON;
      sparkles.visible = true;
      place(0);
    },
    tick(delta) {
      if (opening > 0) {
        opening = Math.min(opening + delta, OPEN_SECONDS);
        const t = opening / OPEN_SECONDS;
        place(1 - (1 - t) ** 3); // ease out: a quick pop, then settling back
        if (opening >= OPEN_SECONDS) opening = 0;
      }
      if (sparkling > 0) {
        sparkling = Math.min(sparkling + delta, SPARKLE_SECONDS);
        const t = sparkling / SPARKLE_SECONDS;
        for (const sparkle of sparkles.children) {
          const drift = sparkle.userData.drift as { x: number; z: number };
          sparkle.position.set(drift.x * t, baseHeight + t * height * 1.6, drift.z * t);
          sparkle.scale.setScalar(Math.max(0.01, 1 - t));
        }
        if (sparkling >= SPARKLE_SECONDS) {
          sparkling = 0;
          sparkles.visible = false;
        }
      }
    },
    dispose() {
      root.remove(group);
    },
  };
  return drawn;
}

function modelChest(
  root: Object3D,
  model: Object3D,
  mixer: AnimationMixer,
  action: AnimationAction,
  duration: number,
  release: () => void,
): DrawnChest {
  action.setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  const drawn: DrawnChest = {
    open: false,
    show(open, instant) {
      drawn.open = open;
      action.reset();
      if (!open) {
        action.stop();
        mixer.setTime(0);
        return;
      }
      action.play();
      if (instant) {
        action.time = duration;
        mixer.update(0);
      }
    },
    tick() {
      // The mixer is advanced with every other mixer in the frame loop.
    },
    dispose() {
      mixer.stopAllAction();
      release();
      root.remove(model);
    },
  };
  return drawn;
}
