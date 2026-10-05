import {
  BoxGeometry,
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  TorusGeometry,
  type BufferGeometry,
  type Material,
} from 'three';
import { areRequirementsMet } from '../../../worldObjects';
import type { WorldExtension, WorldExtensionContext } from '../../runtime/extensionRegistry';
import { tryParseClockworkMachineryConfig } from './clockworkMachineryConfig';

/**
 * Clockwork Harbor's machinery, as a registered extension (engine Phase 9,
 * ADR-025 part G). Moved out of `clockworkHarborScene.ts` unchanged: the
 * lighthouse mechanism, the lamp at the top of the tower, the clock face and
 * its backward-running hand, and a brass gear in each Golden Gear's root.
 *
 * All of it is placeholder art drawn from code primitives, because
 * `docs/regions/clockwork.md` section 21's mechanical asset inventory (gears,
 * valves, pipes, generators) does not exist yet. That is exactly why it is an
 * extension rather than manifest vocabulary: the manifest should not grow a
 * geometry language to describe a torus that a GLB will replace. When the real
 * art lands, the manifest gains `assetId`s and this extension shrinks to the
 * two things that are genuinely mechanisms - what turns, and when.
 *
 * It carries no game state and decides nothing. Whether the lighthouse is
 * fixed comes from the child's world state through the runtime; whether an
 * answer was right stays with the Adventure Engine.
 */
const BRASS = 0xc9a227;
const IRON = 0x4a4e57;

/** The gear turns only once the machine runs; the clock hand always runs backward (section 3). */
const MECHANISM_GEAR_RADIANS_PER_SECOND = 1.4;
const CLOCK_HAND_RADIANS_PER_SECOND = 0.35;
const GOLDEN_GEAR_RADIANS_PER_SECOND = 1.1;

export const clockworkMachineryExtension: WorldExtension = {
  id: 'clockwork-machinery',
  mount(context: WorldExtensionContext) {
    const config = tryParseClockworkMachineryConfig(context.config);
    if (!config) {
      console.warn('[clockwork-machinery] ignoring a binding with unreadable config');
      return;
    }
    const lit = areRequirementsMet(
      [{ type: 'WORLD_CHANGE_PRESENT', changeKey: config.changeKey }],
      context.worldState,
    );

    const geometries: BufferGeometry[] = [];
    const materials: Material[] = [];
    const added: Object3D[] = [];
    const own = (geometry: BufferGeometry, material: Material): Mesh => {
      geometries.push(geometry);
      materials.push(material);
      return new Mesh(geometry, material);
    };

    /*
      The mechanism: a brass drum with a gear on its face, built inside the
      prop's own root. The runtime still owns the focus, the label and the
      interaction - this extension only says what the child sees there.
    */
    const mechanismRoot = context.entityRoot(config.mechanismEntityId);
    const drum = own(
      new CylinderGeometry(0.6, 0.7, 1.2, 12),
      new MeshStandardMaterial({ color: IRON }),
    );
    drum.position.y = 0.6;
    const gear = own(
      new TorusGeometry(0.45, 0.12, 8, 12),
      new MeshStandardMaterial({
        color: BRASS,
        emissive: lit ? BRASS : 0x000000,
        emissiveIntensity: lit ? 0.5 : 0,
      }),
    );
    gear.position.set(0, 1.35, 0.1);
    if (mechanismRoot) {
      mechanismRoot.add(drum, gear);
    } else {
      // The prop's requirements left it out; nothing to decorate.
      console.warn(`[clockwork-machinery] no entity root for ${config.mechanismEntityId}`);
    }

    /** The lamp at the top of the tower. Dark until the harbor's first chapter is done. */
    const lamp = own(
      new CylinderGeometry(1.1, 1.1, 1.4, 12),
      new MeshStandardMaterial({
        color: lit ? 0xfff3c4 : 0x3a3f47,
        emissive: lit ? 0xffe9a8 : 0x000000,
        emissiveIntensity: lit ? 1.2 : 0,
      }),
    );
    lamp.position.set(config.lamp.x, config.lamp.y, config.lamp.z);
    context.scene.add(lamp);
    added.push(lamp);

    /** The clock tower's face, whose hand runs backward until the Heart is repaired. */
    const clockFace = own(
      new CylinderGeometry(1.6, 1.6, 0.3, 16),
      new MeshStandardMaterial({ color: 0xf2ead6 }),
    );
    clockFace.rotation.x = Math.PI / 2;
    clockFace.position.set(config.clockFace.x, config.clockFace.y, config.clockFace.z);
    const clockHand = own(
      new BoxGeometry(0.16, 1.2, 0.1),
      new MeshStandardMaterial({ color: IRON }),
    );
    clockHand.position.set(0, 0.6, 0.2);
    const clockHandPivot = new Object3D();
    clockHandPivot.position.copy(clockFace.position);
    clockHandPivot.position.z += 0.25;
    clockHandPivot.add(clockHand);
    context.scene.add(clockFace, clockHandPivot);
    added.push(clockFace, clockHandPivot);

    /** One small brass gear inside each Golden Gear collectible's root. */
    const goldenGears: Object3D[] = [];
    for (const entityId of config.gearEntityIds) {
      const root = context.entityRoot(entityId);
      if (!root) continue; // Already found: its requirements left it out.
      const gearMesh = own(
        new TorusGeometry(0.22, 0.07, 8, 12),
        new MeshStandardMaterial({ color: BRASS, emissive: BRASS, emissiveIntensity: 0.35 }),
      );
      root.add(gearMesh);
      goldenGears.push(gearMesh);
    }

    const stopFrames = context.onFrame((deltaSeconds) => {
      if (lit) gear.rotation.z += deltaSeconds * MECHANISM_GEAR_RADIANS_PER_SECOND;
      clockHandPivot.rotation.z += deltaSeconds * CLOCK_HAND_RADIANS_PER_SECOND;
      for (const gearMesh of goldenGears) {
        gearMesh.rotation.z += deltaSeconds * GOLDEN_GEAR_RADIANS_PER_SECOND;
      }
    });

    return {
      api: { lit },
      dispose() {
        stopFrames();
        for (const object of added) object.removeFromParent();
        drum.removeFromParent();
        gear.removeFromParent();
        for (const gearMesh of goldenGears) gearMesh.removeFromParent();
        // This extension owns every geometry and material it made.
        for (const geometry of geometries) geometry.dispose();
        for (const material of materials) material.dispose();
      },
    };
  },
};
