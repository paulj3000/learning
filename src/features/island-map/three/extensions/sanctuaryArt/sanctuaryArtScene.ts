import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
  type Material,
} from 'three';
import { areRequirementsMet } from '../../../worldObjects';
import type { WorldExtension, WorldExtensionContext } from '../../runtime/extensionRegistry';
import { tryParseSanctuaryArtConfig } from './sanctuaryArtConfig';

/**
 * The Dragon's Sanctuary's placeholder art, as a registered extension
 * (engine Phase 9, ADR-025 part G). Moved out of `dragonsSanctuaryScene.ts`
 * unchanged: the forge hearth and its fire bowl, the firelight, the three
 * rune sockets, the rune stones out in the valley, the two sealed gates with
 * their seams of light, the dragon scales, Ember's silhouette, and the sky
 * cliffs past the north wall.
 *
 * All of it is `three` primitives, because the roadmap's "Initial Asset
 * List" - a sanctuary gate, a forge, roosts, cliffs, crystals, rune stones
 * and a rigged Ember with thirteen clips - does not exist in
 * `assets/manifest.ts` yet (ADR-020). That is what makes it an extension
 * rather than manifest vocabulary: the manifest should not grow a geometry
 * language to describe a cone that a GLB will replace.
 *
 * **It carries no game state and decides nothing.** Which sockets glow and
 * whether the bowl burns come from the child's world state through the
 * runtime's own `requirements` vocabulary; whether an answer was right stays
 * with the Adventure Engine. Every interactive thing here is a manifest
 * entity whose root this fills in, so focus, labels, interactions and pickup
 * all stay with the generic runtime.
 */
const BASALT = 0x4a4048;
const EMBER_ORANGE = 0xd9622b;
const OLD_BRONZE = 0x9c7a3c;
const SCALE_GREEN = 0x3f8f6b;
const CRYSTAL_BLUE = 0x5fb8d9;

export const sanctuaryArtExtension: WorldExtension = {
  id: 'sanctuary-art',
  mount(context: WorldExtensionContext) {
    const config = tryParseSanctuaryArtConfig(context.config);
    if (!config) {
      console.warn('[sanctuary-art] ignoring a binding with unreadable config');
      return;
    }
    const present = (changeKey: string) =>
      areRequirementsMet([{ type: 'WORLD_CHANGE_PRESENT', changeKey }], context.worldState);
    const forgeLit = present(config.forgeChangeKey);

    const geometries: BufferGeometry[] = [];
    const materials: Material[] = [];
    const added: Object3D[] = [];
    const own = (geometry: BufferGeometry, material: Material): Mesh => {
      geometries.push(geometry);
      materials.push(material);
      return new Mesh(geometry, material);
    };
    const into = (entityId: string, ...objects: Object3D[]): void => {
      const root = context.entityRoot(entityId);
      if (!root) return; // Its requirements left it out; nothing to draw.
      root.add(...objects);
    };
    const onto = (...objects: Object3D[]): void => {
      context.scene.add(...objects);
      added.push(...objects);
    };

    /*
      The forge hearth: a basalt block with a fire bowl on top. The bowl is
      the whole region's status light - dark and cold, or burning - and the
      firelight is why lighting the forge changes the room rather than one
      mesh.
    */
    const hearthBlock = own(
      new BoxGeometry(1.6, 1.1, 1.6),
      new MeshStandardMaterial({ color: BASALT }),
    );
    hearthBlock.position.y = 0.55;
    const fireBowl = own(
      new CylinderGeometry(0.7, 0.45, 0.5, 12),
      new MeshStandardMaterial({
        color: forgeLit ? EMBER_ORANGE : 0x2e2a30,
        emissive: forgeLit ? EMBER_ORANGE : 0x000000,
        emissiveIntensity: forgeLit ? 1.4 : 0,
      }),
    );
    fireBowl.position.y = 1.35;
    into(config.hearthEntityId, hearthBlock, fireBowl);
    if (forgeLit) {
      const firelight = new PointLight(0xffb066, 2.2, 18);
      firelight.position.y = 2.2;
      into(config.hearthEntityId, firelight);
      added.push(firelight);
    }

    /*
      The three rune sockets on the hearth wall. A socket holding a rune the
      child has found glows; an empty one does not. The child's own progress,
      shown in the room rather than in a counter.
    */
    for (const socket of config.sockets) {
      const filled = forgeLit || present(socket.changeKey);
      const mesh = own(
        new TorusGeometry(0.28, 0.08, 8, 14),
        new MeshStandardMaterial({
          color: filled ? EMBER_ORANGE : BASALT,
          emissive: filled ? EMBER_ORANGE : 0x000000,
          emissiveIntensity: filled ? 0.8 : 0,
        }),
      );
      mesh.position.set(socket.x, 1.5, socket.z);
      onto(mesh);
    }

    /** A rune still out in the valley: a basalt slab with a burning glyph. */
    for (const entityId of config.runeEntityIds) {
      const stone = own(
        new BoxGeometry(0.45, 0.9, 0.2),
        new MeshStandardMaterial({ color: BASALT }),
      );
      stone.position.y = 0.45;
      const glyph = own(
        new TorusGeometry(0.16, 0.05, 6, 12),
        new MeshStandardMaterial({
          color: EMBER_ORANGE,
          emissive: EMBER_ORANGE,
          emissiveIntensity: 0.7,
        }),
      );
      glyph.position.set(0, 0.55, 0.13);
      into(entityId, stone, glyph);
    }

    /** The sealed gates: a slab across the valley, with a seam of light at the crack. */
    for (const gate of config.gates) {
      const slab = own(
        new BoxGeometry(gate.halfWidth * 2, gate.height, gate.thickness * 2),
        new MeshStandardMaterial({ color: BASALT }),
      );
      slab.position.y = gate.height / 2;
      const seamColor = gate.seam === 'CRYSTAL' ? CRYSTAL_BLUE : EMBER_ORANGE;
      const seam = own(
        new BoxGeometry(0.12, gate.height * 0.7, 0.05),
        new MeshStandardMaterial({
          color: seamColor,
          emissive: seamColor,
          emissiveIntensity: 0.6,
        }),
      );
      seam.position.set(0, gate.height / 2, gate.thickness + 0.03);
      into(gate.entityId, slab, seam);
    }

    /** Dragon scales: a small green shard each. */
    for (const entityId of config.scaleEntityIds) {
      const scale = own(
        new IcosahedronGeometry(0.22, 0),
        new MeshStandardMaterial({
          color: SCALE_GREEN,
          emissive: SCALE_GREEN,
          emissiveIntensity: 0.3,
        }),
      );
      into(entityId, scale);
    }

    /*
      Ember: a cone body, a sphere head and two folded wings, at the scale a
      dragon would be so the roost is sized for the real asset. The character
      model the runtime loads for her stands in the same root - a child-sized
      biped alone in a dragon's roost reads as a person, and the silhouette is
      the one thing the placeholder can honestly get right.
    */
    const body = own(
      new ConeGeometry(1.1, 2.6, 8),
      new MeshStandardMaterial({ color: EMBER_ORANGE }),
    );
    body.position.set(0, 1.3, -1.8);
    const head = own(
      new SphereGeometry(0.55, 10, 8),
      new MeshStandardMaterial({ color: EMBER_ORANGE }),
    );
    head.position.set(0, 2.7, -1.3);
    const wings = [-1, 1].map((side) => {
      const wing = own(
        new BoxGeometry(0.15, 1.4, 1.1),
        new MeshStandardMaterial({ color: OLD_BRONZE }),
      );
      wing.position.set(side * 0.95, 1.7, -2);
      wing.rotation.z = side * 0.25;
      return wing;
    });
    into(config.emberEntityId, body, head, ...wings);

    /*
      The Sky Cliffs, out beyond the north wall. Deliberately drawn and
      deliberately unreachable: the honest way to show a place a child cannot
      go is to put it past the wall rather than behind a door that never opens.
    */
    for (const cliff of config.skyCliffs) {
      const rock = own(
        new ConeGeometry(cliff.halfWidth, cliff.height, 6),
        new MeshStandardMaterial({ color: 0x5b5566 }),
      );
      rock.position.set(cliff.x, cliff.height / 2, cliff.z);
      onto(rock);
    }

    return {
      api: { forgeLit },
      dispose() {
        for (const object of added) object.removeFromParent();
        for (const geometry of geometries) geometry.dispose();
        for (const material of materials) material.dispose();
      },
    };
  },
};
