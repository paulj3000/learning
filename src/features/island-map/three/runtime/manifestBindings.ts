import {
  isInteractionAvailable,
  type WorldInteraction,
  type WorldInteractionContext,
} from '../../worldObjects';
import type { CollectibleSpec, NpcPlacementSpec, ThreeLocationManifest } from './locationManifest';

/**
 * Pure lookups from the semantic ids a scene emits to what the manifest
 * says they mean. The generic world view resolves every event through these
 * rather than through per-region `if (entityId === ...)` chains (the
 * pattern the audit found in every region view).
 */

export function findNpcByEntityId(
  manifest: ThreeLocationManifest,
  entityId: string,
): NpcPlacementSpec | undefined {
  return manifest.npcs.find((npc) => npc.entityId === entityId);
}

export function findCollectibleByEntityId(
  manifest: ThreeLocationManifest,
  entityId: string,
): CollectibleSpec | undefined {
  return manifest.collectibles.find((collectible) => collectible.entityId === entityId);
}

/**
 * Where a picked-up collectible's world change is recorded, or `undefined`
 * when picking it up changes nothing durable.
 *
 * The location defaults to the manifest's own, which is the usual case; a
 * region that is not an `IslandLocation` (the harbour hub) has to name one,
 * and validation requires it.
 */
export function pickUpWorldChange(
  manifest: ThreeLocationManifest,
  entityId: string,
): { locationSlug: string; changeType: string; changeKey: string; source: string } | undefined {
  const change = findCollectibleByEntityId(manifest, entityId)?.worldChange;
  if (!change) return undefined;
  const locationSlug = change.locationSlug ?? manifest.locationSlug;
  if (locationSlug === undefined) return undefined;
  return {
    locationSlug,
    changeType: change.changeType,
    changeKey: change.changeKey,
    // Not an adventure session, so provenance says where it really came from.
    source: `exploration:${entityId}`,
  };
}

/**
 * The child-facing crosshair label for a focused entity, or `null`.
 *
 * NPCs and props only: `WorldHud` renders every label as "<label>: press E
 * to talk", which would be wrong for a collectible. Collectible labels stay
 * in the manifest for when the HUD can take a verb. (Props already read
 * "press E to talk" in Pirate Builder Bay's own view, so that is unchanged.)
 */
export function focusLabel(
  manifest: ThreeLocationManifest,
  entityId: string | null,
): string | null {
  if (entityId === null) return null;
  return (
    findNpcByEntityId(manifest, entityId)?.label ??
    manifest.props.find((prop) => prop.entityId === entityId)?.label ??
    null
  );
}

/** The interaction an interacted entity is bound to, if it is bound and currently available. */
export function interactionForEntity(
  manifest: ThreeLocationManifest,
  entityId: string,
  context: WorldInteractionContext,
): WorldInteraction | undefined {
  const interactionId =
    findNpcByEntityId(manifest, entityId)?.interactionId ??
    manifest.props.find((prop) => prop.entityId === entityId)?.interactionId;
  if (!interactionId) return undefined;
  const interaction = manifest.interactions.find((candidate) => candidate.id === interactionId);
  return interaction && isInteractionAvailable(interaction, context) ? interaction : undefined;
}

/**
 * The first available walk-in (APPROACH/ENTER) interaction whose zone was
 * just entered. `zoneId` defaults to the interaction's own id, as
 * `WorldInteraction.zoneId` documents.
 */
export function walkInInteractionForZone(
  manifest: ThreeLocationManifest,
  zoneId: string,
  context: WorldInteractionContext,
): WorldInteraction | undefined {
  return manifest.interactions.find(
    (interaction) =>
      (interaction.trigger === 'APPROACH' || interaction.trigger === 'ENTER') &&
      (interaction.zoneId ?? interaction.id) === zoneId &&
      isInteractionAvailable(interaction, context),
  );
}

/** The authored toast for stepping into a building or zone, if any. */
export function zoneEnterMessage(
  manifest: ThreeLocationManifest,
  zoneId: string,
): string | undefined {
  return (
    manifest.buildings.find((building) => building.interiorZone.id === zoneId)?.enterMessage ??
    manifest.zones.find((zone) => zone.rect.id === zoneId)?.enterMessage
  );
}

/** Interactions the child can use right now, for the non-graphical "Things to do here" list. */
export function availableInteractions(
  manifest: ThreeLocationManifest,
  context: WorldInteractionContext,
): WorldInteraction[] {
  return manifest.interactions.filter((interaction) =>
    isInteractionAvailable(interaction, context),
  );
}
