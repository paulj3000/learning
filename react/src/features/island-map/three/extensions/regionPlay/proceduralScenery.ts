import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RegionPlayProceduralConfig } from '../../../../region-play/regionPlayConfig';

/**
 * Scenery drawn from primitives (TR-13), for the parts of Treasure Cove the
 * bundled catalogue has no model for yet: palms, the tent, the campfire,
 * torches, flags, the rowboat, ruin pillars, the pedestal and the gate. Each
 * is meant to be replaced by a finished model
 * (`docs/TREASURE_RUSH_ASSET_REQUIREMENTS.md`).
 *
 * Decoration only: never interactive, never an event, never game state. Each
 * shape builds once per region from shared geometries and materials; palms,
 * the most numerous, are instanced, three draw calls for the whole cove.
 * `tick` animates (palms sway, flames flicker, flags wave, the boat bobs, the
 * gem pulses) and is not called when the device asks for reduced motion.
 */

/** The name of each placeholder's root, so tests and debugging can find it. */
export const PROCEDURAL_NAME = 'region-play:procedural';
export const PALM_TRUNKS_NAME = 'region-play:palm-trunks';
/** The gate's bars, which TR-17 lifts when the gate opens. */
export const GATE_BARS_NAME = 'region-play:gate-bars';

const COLORS = {
  trunk: 0x8b6a43,
  frond: 0x3f9a3a,
  coconut: 0x5b3b22,
  canvas: 0xe8dcc0,
  stone: 0xa39b8b,
  wood: 0x8a5a2b,
  darkWood: 0x5e3b1c,
  iron: 0x3b3b3b,
  flame: 0xff8a2a,
  flameCore: 0xffd34d,
  gem: 0x7fe3ff,
  flag: 0x1d1d1d,
} as const;

const DEFAULT_HEIGHT: Partial<Record<RegionPlayProceduralConfig['shape'], number>> = {
  PALM: 4.8,
  FLAG: 5,
  PILLAR: 3,
};

export interface ProceduralScenery {
  /** Everything drawn, one child per placeholder plus the palm batches. */
  root: Group;
  /** Advances decorative animation by `deltaSeconds`. */
  tick(deltaSeconds: number): void;
  dispose(): void;
}

/** A small kit of shared geometries and materials, so each shape costs its meshes and nothing more. */
class Kit {
  readonly geometries: BufferGeometry[] = [];
  readonly materials: Material[] = [];
  private readonly byColor = new Map<string, MeshStandardMaterial>();

  geometry<T extends BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  material(color: number, glow = false): MeshStandardMaterial {
    const key = `${color}:${glow}`;
    let material = this.byColor.get(key);
    if (!material) {
      material = new MeshStandardMaterial({
        color,
        ...(glow ? { emissive: color, emissiveIntensity: 0.9 } : {}),
        side: DoubleSide,
      });
      this.byColor.set(key, material);
      this.materials.push(material);
    }
    return material;
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}

type Animate = (time: number) => void;

export function buildProceduralScenery(
  entries: readonly RegionPlayProceduralConfig[],
): ProceduralScenery {
  const kit = new Kit();
  const root = new Group();
  root.name = 'region-play:procedural-scenery';
  const animations: Animate[] = [];

  const shared = memo(() => ({
    torchPole: kit.geometry(new CylinderGeometry(0.05, 0.07, 1.6, 6).translate(0, 0.8, 0)),
    torchBowl: kit.geometry(new CylinderGeometry(0.16, 0.1, 0.16, 8).translate(0, 1.66, 0)),
    flame: kit.geometry(new ConeGeometry(0.13, 0.4, 7).translate(0, 0.2, 0)),
    flameCore: kit.geometry(new ConeGeometry(0.07, 0.24, 6).translate(0, 0.12, 0)),
    unitPillar: kit.geometry(new CylinderGeometry(0.42, 0.5, 1, 10).translate(0, 0.5, 0)),
    capital: kit.geometry(new BoxGeometry(1.1, 0.25, 1.1)),
  }));

  const palms = entries.filter((entry) => entry.shape === 'PALM');
  if (palms.length > 0) animations.push(addPalms(palms, kit, root));

  for (const entry of entries) {
    if (entry.shape === 'PALM') continue;
    const group = new Group();
    group.name = `${PROCEDURAL_NAME}:${entry.id}`;
    group.position.set(entry.x, 0, entry.z);
    group.rotation.y = entry.rotationY ?? 0;
    const height = entry.height ?? DEFAULT_HEIGHT[entry.shape] ?? 1;
    const phase = hashPhase(entry.id);
    const animate = BUILDERS[entry.shape](group, { entry, height, phase, kit, shared: shared() });
    if (animate) animations.push(animate);
    root.add(group);
  }

  let time = 0;
  return {
    root,
    tick(deltaSeconds) {
      time += deltaSeconds;
      for (const animate of animations) animate(time);
    },
    dispose() {
      root.removeFromParent();
      kit.dispose();
    },
  };
}

interface BuildContext {
  entry: RegionPlayProceduralConfig;
  height: number;
  phase: number;
  kit: Kit;
  shared: {
    torchPole: BufferGeometry;
    torchBowl: BufferGeometry;
    flame: BufferGeometry;
    flameCore: BufferGeometry;
    unitPillar: BufferGeometry;
    capital: BufferGeometry;
  };
}

type Builder = (group: Group, context: BuildContext) => Animate | undefined;

const BUILDERS: Record<Exclude<RegionPlayProceduralConfig['shape'], 'PALM'>, Builder> = {
  TENT(group, { entry, kit }) {
    const canvas = new Mesh(
      kit.geometry(new ConeGeometry(1.8, 2.3, 4).rotateY(Math.PI / 4).translate(0, 1.15, 0)),
      kit.material(entry.color ?? COLORS.canvas),
    );
    const flap = new Mesh(
      kit.geometry(new PlaneGeometry(0.9, 1.3).translate(0, 0.65, 1.28)),
      kit.material(COLORS.darkWood),
    );
    const pole = new Mesh(
      kit.geometry(new CylinderGeometry(0.04, 0.04, 0.6).translate(0, 2.5, 0)),
      kit.material(COLORS.wood),
    );
    group.add(canvas, flap, pole);
    return undefined;
  },

  CAMPFIRE(group, { kit, shared, phase }) {
    const stones = new Mesh(
      kit.geometry(new TorusGeometry(0.55, 0.13, 5, 10).rotateX(Math.PI / 2).translate(0, 0.08, 0)),
      kit.material(COLORS.stone),
    );
    const logs = new Mesh(
      kit.geometry(
        mergeGeometries([
          new BoxGeometry(0.9, 0.14, 0.14).rotateY(0.5).translate(0, 0.1, 0),
          new BoxGeometry(0.9, 0.14, 0.14).rotateY(-0.5).translate(0, 0.14, 0),
        ]),
      ),
      kit.material(COLORS.darkWood),
    );
    const flames = flameGroup(kit, shared, 2.2);
    flames.position.y = 0.15;
    group.add(stones, logs, flames);
    return flicker(flames, phase);
  },

  TORCH(group, { kit, shared, phase }) {
    group.add(
      new Mesh(shared.torchPole, kit.material(COLORS.wood)),
      new Mesh(shared.torchBowl, kit.material(COLORS.iron)),
    );
    const flames = flameGroup(kit, shared, 1);
    flames.position.y = 1.72;
    group.add(flames);
    return flicker(flames, phase);
  },

  FLAG(group, { entry, height, kit, phase }) {
    const pole = new Mesh(
      kit.geometry(new CylinderGeometry(0.06, 0.08, height, 6).translate(0, height / 2, 0)),
      kit.material(COLORS.wood),
    );
    const hinge = new Group();
    hinge.position.y = height - 0.6;
    const cloth = new Mesh(
      kit.geometry(new PlaneGeometry(1.6, 1).translate(0.8, 0, 0)),
      kit.material(entry.color ?? COLORS.flag),
    );
    hinge.add(cloth);
    group.add(pole, hinge);
    return (time) => {
      hinge.rotation.y = Math.sin(time * 1.8 + phase) * 0.28;
      cloth.scale.x = 1 + Math.sin(time * 3.1 + phase) * 0.04;
    };
  },

  ROWBOAT(group, { kit, phase }) {
    const boat = new Group();
    const hull = new Mesh(
      kit.geometry(new BoxGeometry(1.3, 0.45, 3.2).translate(0, 0.22, 0)),
      kit.material(COLORS.wood),
    );
    const inside = new Mesh(
      kit.geometry(new BoxGeometry(1.05, 0.05, 2.9).translate(0, 0.42, 0)),
      kit.material(COLORS.darkWood),
    );
    const bench = new Mesh(
      kit.geometry(new BoxGeometry(1.2, 0.06, 0.3).translate(0, 0.5, 0.3)),
      kit.material(COLORS.darkWood),
    );
    const oar = new Mesh(
      kit.geometry(new BoxGeometry(0.08, 0.05, 2.4).rotateY(0.3).translate(0.4, 0.56, -0.2)),
      kit.material(COLORS.trunk),
    );
    boat.add(hull, inside, bench, oar);
    group.add(boat);
    return (time) => {
      boat.position.y = Math.sin(time * 1.3 + phase) * 0.06;
      boat.rotation.z = Math.sin(time * 1.1 + phase) * 0.05;
      boat.rotation.x = Math.sin(time * 0.8 + phase) * 0.03;
    };
  },

  PILLAR(group, { entry, height, kit, shared }) {
    const shaft = new Mesh(shared.unitPillar, kit.material(entry.color ?? COLORS.stone));
    shaft.scale.y = height;
    group.add(shaft);
    if (height > 2) {
      const capital = new Mesh(shared.capital, kit.material(entry.color ?? COLORS.stone));
      capital.position.y = height + 0.12;
      group.add(capital);
    }
    return undefined;
  },

  PEDESTAL(group, { kit, phase }) {
    const stone = kit.material(COLORS.stone);
    group.add(
      new Mesh(kit.geometry(new CylinderGeometry(0.9, 1, 0.3, 12).translate(0, 0.15, 0)), stone),
      new Mesh(kit.geometry(new CylinderGeometry(0.5, 0.62, 0.9, 10).translate(0, 0.75, 0)), stone),
      new Mesh(kit.geometry(new BoxGeometry(0.95, 0.12, 0.95).translate(0, 1.26, 0)), stone),
    );
    const gemMaterial = new MeshStandardMaterial({
      color: COLORS.gem,
      emissive: COLORS.gem,
      emissiveIntensity: 0.8,
    });
    kit.materials.push(gemMaterial);
    const gem = new Mesh(kit.geometry(new OctahedronGeometry(0.28)), gemMaterial);
    gem.position.y = 1.75;
    group.add(gem);
    return (time) => {
      gem.rotation.y = time * 0.8;
      gem.position.y = 1.75 + Math.sin(time * 1.6 + phase) * 0.08;
      gemMaterial.emissiveIntensity = 0.6 + (Math.sin(time * 2.2) + 1) * 0.3;
    };
  },

  GATE(group, { kit }) {
    const stone = kit.material(COLORS.stone);
    const post = kit.geometry(new BoxGeometry(0.7, 3.4, 0.7).translate(0, 1.7, 0));
    const left = new Mesh(post, stone);
    left.position.x = -2.35;
    const right = new Mesh(post, stone);
    right.position.x = 2.35;
    const lintel = new Mesh(
      kit.geometry(new BoxGeometry(5.4, 0.5, 0.8).translate(0, 3.55, 0)),
      stone,
    );
    const bars = new Mesh(
      kit.geometry(
        mergeGeometries([
          ...[-1.6, -0.96, -0.32, 0.32, 0.96, 1.6].map((x) =>
            new CylinderGeometry(0.05, 0.05, 3, 6).translate(x, 1.5, 0),
          ),
          new BoxGeometry(4, 0.12, 0.12).translate(0, 0.9, 0),
          new BoxGeometry(4, 0.12, 0.12).translate(0, 2.3, 0),
        ]),
      ),
      kit.material(COLORS.iron),
    );
    bars.name = GATE_BARS_NAME;
    group.add(left, right, lintel, bars);
    return undefined;
  },
};

function flameGroup(kit: Kit, shared: BuildContext['shared'], size: number): Group {
  const flames = new Group();
  const outer = new Mesh(shared.flame, kit.material(COLORS.flame, true));
  const core = new Mesh(shared.flameCore, kit.material(COLORS.flameCore, true));
  flames.add(outer, core);
  flames.scale.setScalar(size);
  return flames;
}

function flicker(flames: Group, phase: number): Animate {
  const base = flames.scale.x;
  return (time) => {
    const wobble = Math.sin(time * 9 + phase) * 0.08 + Math.sin(time * 13.7 + phase * 2) * 0.06;
    flames.scale.set(base * (1 - wobble * 0.5), base * (1 + wobble), base * (1 - wobble * 0.5));
  };
}

/**
 * Every palm in three instanced meshes: trunks, fronds, coconuts. Each palm
 * leans its own way and sways on its own phase; the matrices are rewritten
 * per tick, which for a few dozen instances is cheaper than one draw call each.
 */
function addPalms(palms: readonly RegionPlayProceduralConfig[], kit: Kit, root: Group): Animate {
  const trunkGeometry = kit.geometry(new CylinderGeometry(0.11, 0.2, 1, 7).translate(0, 0.5, 0));
  const frond = new BoxGeometry(0.55, 0.05, 2).translate(0, 0, 1);
  const fronds = kit.geometry(
    mergeGeometries(
      Array.from({ length: 7 }, (_, index) =>
        frond
          .clone()
          .rotateX(0.5)
          .rotateY((index / 7) * Math.PI * 2),
      ),
    ),
  );
  frond.dispose();
  const coconuts = kit.geometry(
    mergeGeometries(
      [0, 2.1, 4.2].map((angle) =>
        new SphereGeometry(0.14, 6, 5).translate(
          Math.cos(angle) * 0.18,
          -0.15,
          Math.sin(angle) * 0.18,
        ),
      ),
    ),
  );

  const trunks = new InstancedMesh(trunkGeometry, kit.material(COLORS.trunk), palms.length);
  trunks.name = PALM_TRUNKS_NAME;
  const crowns = new InstancedMesh(fronds, kit.material(COLORS.frond), palms.length);
  crowns.name = 'region-play:palm-crowns';
  const nuts = new InstancedMesh(coconuts, kit.material(COLORS.coconut), palms.length);
  nuts.name = 'region-play:palm-coconuts';
  root.add(trunks, crowns, nuts);

  const phases = palms.map((palm) => hashPhase(palm.id));
  const base = new Matrix4();
  const trunk = new Matrix4();
  const crown = new Matrix4();
  const rotation = new Quaternion();
  const euler = new Euler(0, 0, 0, 'YXZ');
  const unit = new Vector3(1, 1, 1);
  const at = new Vector3();
  const step = new Matrix4();

  const place = (time: number) => {
    palms.forEach((palm, index) => {
      const height = palm.height ?? DEFAULT_HEIGHT.PALM ?? 4.8;
      const sway = Math.sin(time * 0.9 + phases[index]!) * 0.025;
      euler.set(0, palm.rotationY ?? 0, 0.09 + sway);
      rotation.setFromEuler(euler);
      base.compose(at.set(palm.x, 0, palm.z), rotation, unit);
      trunk.copy(base).multiply(step.makeScale(1, height, 1));
      trunks.setMatrixAt(index, trunk);
      euler.set(Math.sin(time * 1.3 + phases[index]!) * 0.05, time * 0.05, 0);
      crown
        .copy(base)
        .multiply(step.makeTranslation(0, height, 0))
        .multiply(step.makeRotationFromEuler(euler));
      crowns.setMatrixAt(index, crown);
      nuts.setMatrixAt(index, crown);
    });
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    nuts.instanceMatrix.needsUpdate = true;
  };
  place(0);
  // Bounds for culling and raycasts, after the first placement.
  for (const mesh of [trunks, crowns, nuts]) mesh.computeBoundingSphere();
  return place;
}

/** A stable phase per id, so neighbouring flames and palms never move in step. */
function hashPhase(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) | 0;
  return ((hash >>> 0) % 628) / 100;
}

function memo<T>(make: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= make());
}

/** For tests: the placeholder root for one entry. */
export function proceduralRoot(scene: Object3D, id: string): Object3D | undefined {
  return scene.getObjectByName(`${PROCEDURAL_NAME}:${id}`);
}
