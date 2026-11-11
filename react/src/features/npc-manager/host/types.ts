import type { Object3D } from 'three';
import type { PlayerPose } from '../contracts/engine';

/**
 * What a world gives the NPC scene host (`useNpcSceneHost`): where NPCs live and how its frame
 * loop runs. Plain Three.js and functions, no React, so a world's scene half can build it.
 */
export interface NpcHostScene {
  /** The Three.js object NPC roots are added to (usually the scene). */
  parent: Object3D;
  /** Runs `callback` once per rendered frame; returns the stop function. */
  onFrame(callback: (deltaSeconds: number) => void): () => void;
  /** Where the child stands on the ground plane, or null when unknown. */
  playerPose(): PlayerPose | null;
  /** The scene's colliders: true where an NPC may not walk. */
  isBlocked?(x: number, z: number): boolean;
}
