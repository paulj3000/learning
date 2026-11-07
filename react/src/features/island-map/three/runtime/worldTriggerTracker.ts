import { boxContains, type TriggerVolume } from './sceneLayout';

/**
 * The edge-triggered "what changed this frame" logic every region's
 * `frame()` duplicated (zone entered, NPC approached, crosshair focus
 * changed), as one pure class. Each is reported once per change, never once
 * per frame while it stays true, which is the discipline `NpcApproached`
 * and `InteractableFocused` already promise (`worldEngineEvents.ts`).
 */

export interface ApproachTarget {
  entityId: string;
  x: number;
  z: number;
}

export interface TriggerStep {
  /** `NpcApproached` entity ids, in authored order. */
  approachedEntityIds: string[];
  /** Present only when the focused entity differs from last frame. */
  focusChanged?: { entityId: string | null };
  /** `PlayerEnteredZone` ids, in `TriggerVolume` order. */
  enteredZoneIds: string[];
  /** `PlayerLeftZone` ids (SM-P7). Present only when the player left a zone this frame. */
  leftZoneIds?: string[];
}

export class WorldTriggerTracker {
  private readonly insideZone = new Map<string, boolean>();
  private readonly nearEntity = new Map<string, boolean>();
  private focused: string | null = null;

  private readonly volumes: readonly TriggerVolume[];
  private readonly approachTargets: readonly ApproachTarget[];
  private readonly approachRangeMeters: number;

  constructor(
    volumes: readonly TriggerVolume[],
    approachTargets: readonly ApproachTarget[],
    approachRangeMeters: number,
  ) {
    this.volumes = volumes;
    this.approachTargets = approachTargets;
    this.approachRangeMeters = approachRangeMeters;
  }

  step(position: { x: number; y: number; z: number }, focusedEntityId: string | null): TriggerStep {
    const approachedEntityIds: string[] = [];
    for (const target of this.approachTargets) {
      const near =
        Math.hypot(position.x - target.x, position.y, position.z - target.z) <=
        this.approachRangeMeters;
      if (near && !this.nearEntity.get(target.entityId)) {
        approachedEntityIds.push(target.entityId);
      }
      this.nearEntity.set(target.entityId, near);
    }

    let focusChanged: TriggerStep['focusChanged'];
    if (focusedEntityId !== this.focused) {
      focusChanged = { entityId: focusedEntityId };
      this.focused = focusedEntityId;
    }

    const enteredZoneIds: string[] = [];
    let leftZoneIds: string[] | undefined;
    for (const volume of this.volumes) {
      const inside = boxContains(volume.box, position);
      const was = this.insideZone.get(volume.id) === true;
      if (inside && !was) {
        enteredZoneIds.push(volume.id);
      } else if (!inside && was) {
        (leftZoneIds ??= []).push(volume.id);
      }
      this.insideZone.set(volume.id, inside);
    }

    // Optional fields appear only when they have something to say, so a quiet frame is unchanged.
    return {
      approachedEntityIds,
      ...(focusChanged ? { focusChanged } : {}),
      enteredZoneIds,
      ...(leftZoneIds ? { leftZoneIds } : {}),
    };
  }
}
