import type { WorldAction, WorldInteraction, WorldRequirement } from '../../worldObjects';
import {
  LOCATION_MANIFEST_SCHEMA_VERSION,
  type CollectibleSpec,
  type GroundPoint,
  type RectZone,
  type ThreeLocationManifest,
} from './locationManifest';
import {
  findAdventureBindingIssues,
  type AdventureBindingIssueKind,
  type BindableStep,
} from './adventureStepBindings';

/**
 * Pure validation for `ThreeLocationManifest`
 * (`docs/engine/10_IMPLEMENTATION_PHASES.md` Phase 1). The same shape as
 * `worlds/validate.ts`: registries are passed in, never imported here, so a
 * test can hand in a tiny fixture and a future Admin publish step can hand
 * in whatever the published catalog says. `locationManifestRegistries.ts`
 * builds the source-controlled set.
 *
 * Returns every issue rather than throwing on the first, so an author sees
 * the whole list at once. An empty array means the manifest is publishable.
 */

/** The registries a manifest's references are checked against. */
export interface LocationManifestRegistries {
  /** `clips` lets an NPC/collectible `idleClip` be checked against what the asset really authors. */
  assets: readonly { id: string; clips: readonly string[] }[];
  npcIds: readonly string[];
  checkpoints: readonly { id: string; regionId: string }[];
  worldSlugs: readonly string[];
  locations: readonly { slug: string; worldSlug: string }[];
  /**
   * `steps` lets an `adventureBindings` entry be checked against the options
   * the step really declares. A registry entry without steps carries none,
   * so any binding into it is reported rather than silently skipped.
   */
  adventures: readonly { slug: string; locationSlug: string; steps?: readonly BindableStep[] }[];
  discoveryIds: readonly string[];
  /** `ItemDefinition.id`s, for `ITEM_OWNED` requirements. */
  itemIds: readonly string[];
  storySlugs: readonly string[];
  /** Ids registered in the world-extension registry. */
  extensionIds: readonly string[];
}

export type LocationManifestIssueKind =
  | 'NOT_JSON_SERIALIZABLE'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'INVALID_VALUE'
  | 'INVALID_RECT'
  | 'DUPLICATE_ID'
  | 'OUT_OF_BOUNDS'
  | 'UNKNOWN_WORLD'
  | 'UNKNOWN_LOCATION'
  | 'LOCATION_IN_WRONG_WORLD'
  | 'CHECKPOINT_MISMATCH'
  | 'UNKNOWN_ASSET'
  | 'UNKNOWN_CLIP'
  | 'UNKNOWN_NPC'
  | 'UNKNOWN_INTERACTION'
  | 'UNKNOWN_ZONE'
  | 'UNKNOWN_DISCOVERY'
  | 'UNKNOWN_ITEM'
  | 'UNKNOWN_ADVENTURE'
  | 'ADVENTURE_IN_WRONG_LOCATION'
  | 'UNKNOWN_STORY'
  | 'UNKNOWN_EXTENSION'
  | 'MISSING_COPY'
  /** A world change nothing can stop coming back: see `checkCollectibleWorldChange`. */
  | 'UNGATED_WORLD_CHANGE'
  /** Every `adventureBindings` problem, reported by `adventureStepBindings.ts`. */
  | AdventureBindingIssueKind;

/** One thing wrong with a manifest. Developer/author-facing; never shown to a child. */
export interface LocationManifestIssue {
  kind: LocationManifestIssueKind;
  /** A dotted path into the manifest, e.g. `npcs[0].assetId`. */
  path: string;
  detail: string;
}

/**
 * Walks `value` and reports anything `JSON.stringify` would drop or
 * mangle: functions, symbols, bigints, non-finite numbers, and any object
 * that is not a plain object or array (a `three` `Vector3`, a `Map`, a
 * React element's class instance...). `undefined` on an object property is
 * allowed, since that is how TypeScript optional fields are absent.
 */
export function findNonJsonValues(value: unknown, path = '$'): { path: string; reason: string }[] {
  if (value === null) return [];
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return [];
    case 'number':
      return Number.isFinite(value) ? [] : [{ path, reason: 'non-finite number' }];
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'bigint':
      return [{ path, reason: typeof value }];
    case 'object':
      break;
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findNonJsonValues(item, `${path}[${index}]`));
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    return [{ path, reason: 'non-plain object' }];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    child === undefined ? [] : findNonJsonValues(child, `${path}.${key}`),
  );
}

export function validateLocationManifest(
  manifest: ThreeLocationManifest,
  registries: LocationManifestRegistries,
): LocationManifestIssue[] {
  const issues: LocationManifestIssue[] = [];
  const report = (kind: LocationManifestIssueKind, path: string, detail: string) => {
    issues.push({ kind, path, detail });
  };

  for (const problem of findNonJsonValues(manifest)) {
    report('NOT_JSON_SERIALIZABLE', problem.path, `${problem.reason} is not plain JSON`);
  }

  if (manifest.schemaVersion !== LOCATION_MANIFEST_SCHEMA_VERSION) {
    report(
      'UNSUPPORTED_SCHEMA_VERSION',
      'schemaVersion',
      `expected ${LOCATION_MANIFEST_SCHEMA_VERSION}, got ${String(manifest.schemaVersion)}`,
    );
  }
  if (!Number.isInteger(manifest.version) || manifest.version < 1) {
    report('INVALID_VALUE', 'version', 'version must be a positive integer');
  }

  // Identity: world, location, checkpoints.
  if (!registries.worldSlugs.includes(manifest.worldSlug)) {
    report('UNKNOWN_WORLD', 'worldSlug', `no world "${manifest.worldSlug}"`);
  }
  if (manifest.locationSlug !== undefined) {
    const location = registries.locations.find((entry) => entry.slug === manifest.locationSlug);
    if (!location) {
      report('UNKNOWN_LOCATION', 'locationSlug', `no location "${manifest.locationSlug}"`);
    } else if (location.worldSlug !== manifest.worldSlug) {
      report(
        'LOCATION_IN_WRONG_WORLD',
        'locationSlug',
        `"${location.slug}" belongs to "${location.worldSlug}", not "${manifest.worldSlug}"`,
      );
    }
  }
  const authoredCheckpointIds = registries.checkpoints
    .filter((checkpoint) => checkpoint.regionId === manifest.regionId)
    .map((checkpoint) => checkpoint.id);
  if (authoredCheckpointIds.length === 0) {
    report(
      'CHECKPOINT_MISMATCH',
      'checkpoints.ids',
      `no checkpoints are authored for region "${manifest.regionId}"`,
    );
  } else if (authoredCheckpointIds.join('|') !== manifest.checkpoints.ids.join('|')) {
    report(
      'CHECKPOINT_MISMATCH',
      'checkpoints.ids',
      `must list region "${manifest.regionId}"'s authored checkpoints in order: ${authoredCheckpointIds.join(', ')}`,
    );
  }
  requirePositive(manifest.checkpoints.triggerHalfSize, 'checkpoints.triggerHalfSize', report);

  // Geometry.
  requirePositive(manifest.bounds.halfExtentX, 'bounds.halfExtentX', report);
  requirePositive(manifest.bounds.halfExtentZ, 'bounds.halfExtentZ', report);
  requirePositive(manifest.bounds.wallThickness, 'bounds.wallThickness', report);
  const inBounds = (point: GroundPoint) =>
    Math.abs(point.x) <= manifest.bounds.halfExtentX &&
    Math.abs(point.z) <= manifest.bounds.halfExtentZ;
  const checkInBounds = (point: GroundPoint, path: string) => {
    if (!inBounds(point)) {
      report('OUT_OF_BOUNDS', path, `(${point.x}, ${point.z}) is outside the walkable bounds`);
    }
  };

  // Scene ids share one namespace: they are what the scene emits as entity/zone ids.
  const sceneIds = new Map<string, string>();
  const claimSceneId = (id: string, path: string) => {
    const existing = sceneIds.get(id);
    if (existing) {
      report('DUPLICATE_ID', path, `"${id}" is already used at ${existing}`);
    } else {
      sceneIds.set(id, path);
    }
  };
  const checkRect = (rect: RectZone, path: string) => {
    claimSceneId(rect.id, `${path}.id`);
    if (!(rect.minX < rect.maxX && rect.minZ < rect.maxZ)) {
      report('INVALID_RECT', path, `"${rect.id}" must have min < max on both axes`);
    }
  };

  const assetById = new Map(registries.assets.map((asset) => [asset.id, asset]));
  const checkAsset = (assetId: string, path: string, clip?: string) => {
    const asset = assetById.get(assetId);
    if (!asset) {
      report('UNKNOWN_ASSET', path, `no asset "${assetId}"`);
      return;
    }
    if (clip !== undefined && !asset.clips.includes(clip)) {
      report('UNKNOWN_CLIP', path, `asset "${assetId}" has no "${clip}" clip`);
    }
  };

  const interactionIds = new Set(manifest.interactions.map((interaction) => interaction.id));
  const checkInteractionRef = (interactionId: string | undefined, path: string) => {
    if (interactionId !== undefined && !interactionIds.has(interactionId)) {
      report('UNKNOWN_INTERACTION', path, `no interaction "${interactionId}" in this manifest`);
    }
  };

  const checkRequirements = (
    requirements: readonly WorldRequirement[] | undefined,
    path: string,
  ) => {
    requirements?.forEach((requirement, index) => {
      checkRequirement(requirement, `${path}[${index}]`, registries, report);
    });
  };

  manifest.colliders.forEach((collider, index) => {
    checkRect(collider.rect, `colliders[${index}].rect`);
    checkRequirements(collider.requirements, `colliders[${index}].requirements`);
  });

  manifest.buildings.forEach((building, index) => {
    const path = `buildings[${index}]`;
    claimSceneId(building.id, `${path}.id`);
    checkRect(building.interiorZone, `${path}.interiorZone`);
    checkInBounds(building, path);
    requirePositive(building.halfWidth, `${path}.halfWidth`, report);
    requirePositive(building.halfDepth, `${path}.halfDepth`, report);
    requirePositive(building.height, `${path}.height`, report);
    if (new Set(building.wallSides).size !== building.wallSides.length) {
      report('INVALID_VALUE', `${path}.wallSides`, 'a wall side is listed twice');
    }
    checkAsset(building.wallAssetId, `${path}.wallAssetId`);
    if (building.roofAssetId !== undefined) checkAsset(building.roofAssetId, `${path}.roofAssetId`);
    if (building.doorAssetId !== undefined) checkAsset(building.doorAssetId, `${path}.doorAssetId`);
  });

  manifest.scenery.forEach((item, index) => {
    const path = `scenery[${index}]`;
    claimSceneId(item.id, `${path}.id`);
    checkRequirements(item.requirements, `${path}.requirements`);
    switch (item.kind) {
      case 'TILED_GROUND':
        checkAsset(item.assetId, `${path}.assetId`);
        requirePositive(item.tileSize, `${path}.tileSize`, report);
        checkRect(item.area, `${path}.area`);
        break;
      case 'FLAT_PLANE':
        checkRect(item.area, `${path}.area`);
        break;
      case 'BOX':
        checkRect(item.area, `${path}.area`);
        if (!(item.minY < item.maxY)) {
          report('INVALID_VALUE', `${path}.maxY`, 'a box needs minY < maxY');
        }
        break;
      case 'MODEL':
        checkAsset(item.assetId, `${path}.assetId`);
        break;
      case 'CLUSTER':
      case 'LOD_PLACEMENTS':
        checkAsset(item.assetId, `${path}.assetId`);
        if (item.positions.length === 0) {
          report('INVALID_VALUE', `${path}.positions`, 'needs at least one position');
        }
        break;
      case 'RUN':
        checkAsset(item.assetId, `${path}.assetId`);
        requirePositive(item.segmentLength, `${path}.segmentLength`, report);
        break;
    }
  });

  manifest.npcs.forEach((npc, index) => {
    const path = `npcs[${index}]`;
    claimSceneId(npc.entityId, `${path}.entityId`);
    if (!registries.npcIds.includes(npc.npcId)) {
      report('UNKNOWN_NPC', `${path}.npcId`, `no NPC "${npc.npcId}"`);
    }
    checkAsset(npc.assetId, `${path}.assetId`, npc.idleClip);
    checkInBounds(npc.position, `${path}.position`);
    checkInteractionRef(npc.interactionId, `${path}.interactionId`);
    requireText(npc.label, `${path}.label`, report);
  });

  manifest.props.forEach((prop, index) => {
    const path = `props[${index}]`;
    claimSceneId(prop.entityId, `${path}.entityId`);
    checkAsset(prop.assetId, `${path}.assetId`, prop.interactClip);
    checkInBounds(prop.position, `${path}.position`);
    checkInteractionRef(prop.interactionId, `${path}.interactionId`);
    requireText(prop.label, `${path}.label`, report);
  });

  manifest.collectibles.forEach((collectible, index) => {
    const path = `collectibles[${index}]`;
    claimSceneId(collectible.entityId, `${path}.entityId`);
    checkAsset(collectible.assetId, `${path}.assetId`, collectible.idleClip);
    checkInBounds(collectible.position, `${path}.position`);
    requireText(collectible.label, `${path}.label`, report);
    checkRequirements(collectible.requirements, `${path}.requirements`);
    if (collectible.pickUpMessage !== undefined) {
      requireText(collectible.pickUpMessage, `${path}.pickUpMessage`, report);
    }
    checkCollectibleWorldChange(collectible, path, manifest, registries, report);
  });

  manifest.zones.forEach((zone, index) => {
    checkRect(zone.rect, `zones[${index}].rect`);
  });

  manifest.ambient.forEach((ambient, index) => {
    const path = `ambient[${index}]`;
    claimSceneId(ambient.id, `${path}.id`);
    if (ambient.path.length < 3) {
      report('INVALID_VALUE', `${path}.path`, 'a closed loop needs at least three points');
    }
    requirePositive(ambient.loopsPerSecond, `${path}.loopsPerSecond`, report);
    if ('assetId' in ambient.appearance) {
      checkAsset(ambient.appearance.assetId, `${path}.appearance.assetId`);
    }
  });

  // Interactions: unique, walk-in ones have a zone, and every action resolves.
  const zoneIds = new Set([
    ...manifest.zones.map((zone) => zone.rect.id),
    ...manifest.buildings.map((building) => building.interiorZone.id),
  ]);
  const seenInteractionIds = new Set<string>();
  manifest.interactions.forEach((interaction, index) => {
    const path = `interactions[${index}]`;
    if (seenInteractionIds.has(interaction.id)) {
      report('DUPLICATE_ID', `${path}.id`, `interaction "${interaction.id}" is listed twice`);
    }
    seenInteractionIds.add(interaction.id);
    requireText(interaction.title, `${path}.title`, report);
    if (isWalkInTrigger(interaction)) {
      const zoneId = interaction.zoneId ?? interaction.id;
      if (!zoneIds.has(zoneId)) {
        report('UNKNOWN_ZONE', `${path}.zoneId`, `no zone "${zoneId}" in this manifest`);
      }
    }
    checkAction(interaction.action, `${path}.action`, registries, report);
    checkRequirements(interaction.requirements, `${path}.requirements`);
  });

  /*
    Adventure step bindings (Phase 8). The generic check lives beside the
    binding type, so the regions whose tables have not moved into a manifest
    yet are checked by the same code (`adventureStepBindings.ts`).
  */
  const placedEntityIds = [
    ...manifest.npcs.map((npc) => npc.entityId),
    ...manifest.props.map((prop) => prop.entityId),
    ...manifest.collectibles.map((collectible) => collectible.entityId),
  ];
  issues.push(
    ...findAdventureBindingIssues(manifest.adventureBindings, {
      adventures: registries.adventures,
      placedEntityIds,
    }),
  );
  manifest.adventureBindings.forEach((binding, index) => {
    const adventure = registries.adventures.find(
      (candidate) => candidate.slug === binding.templateSlug,
    );
    if (
      adventure &&
      manifest.locationSlug !== undefined &&
      adventure.locationSlug !== manifest.locationSlug
    ) {
      report(
        'ADVENTURE_IN_WRONG_LOCATION',
        `adventureBindings[${index}].templateSlug`,
        `"${adventure.slug}" is authored for "${adventure.locationSlug}", not "${manifest.locationSlug}"`,
      );
    }
  });

  manifest.extensions.forEach((extension, index) => {
    if (!registries.extensionIds.includes(extension.extensionId)) {
      report(
        'UNKNOWN_EXTENSION',
        `extensions[${index}].extensionId`,
        `no registered extension "${extension.extensionId}"`,
      );
    }
  });

  requireText(manifest.title, 'title', report);
  requireText(manifest.copy.loading, 'copy.loading', report);
  requireText(manifest.copy.instructions, 'copy.instructions', report);
  requireText(manifest.copy.altNav.label, 'copy.altNav.label', report);

  return issues;
}

type Report = (kind: LocationManifestIssueKind, path: string, detail: string) => void;

/**
 * A collectible's `worldChange`, if it has one: a real location to record
 * against, non-empty keys, and - the check this exists for - a
 * `WORLD_CHANGE_ABSENT` requirement on the same key.
 *
 * Without that requirement the write is pointless: the thing is picked up,
 * the change is recorded, and the next visit builds the scene with it still
 * standing there to be picked up again. That is the live Clockwork Harbor
 * bug the duplication audit recorded (golden gears reappear every visit),
 * and it is an authoring mistake a validator can refuse rather than a bug
 * each region gets to make once.
 */
function checkCollectibleWorldChange(
  collectible: CollectibleSpec,
  path: string,
  manifest: ThreeLocationManifest,
  registries: LocationManifestRegistries,
  report: Report,
): void {
  const change = collectible.worldChange;
  if (!change) return;
  if (change.changeType.trim().length === 0) {
    report('INVALID_VALUE', `${path}.worldChange.changeType`, 'must not be empty');
  }
  if (change.changeKey.trim().length === 0) {
    report('INVALID_VALUE', `${path}.worldChange.changeKey`, 'must not be empty');
  }
  const locationSlug = change.locationSlug ?? manifest.locationSlug;
  if (locationSlug === undefined) {
    report(
      'INVALID_VALUE',
      `${path}.worldChange.locationSlug`,
      'this region has no locationSlug, so the change must name one',
    );
  } else if (!registries.locations.some((location) => location.slug === locationSlug)) {
    report('UNKNOWN_LOCATION', `${path}.worldChange.locationSlug`, `no location "${locationSlug}"`);
  }
  const gated = collectible.requirements?.some(
    (requirement) =>
      requirement.type === 'WORLD_CHANGE_ABSENT' && requirement.changeKey === change.changeKey,
  );
  if (!gated) {
    report(
      'UNGATED_WORLD_CHANGE',
      `${path}.requirements`,
      `needs a WORLD_CHANGE_ABSENT requirement on "${change.changeKey}", or it comes back after being picked up`,
    );
  }
}

function isWalkInTrigger(interaction: WorldInteraction): boolean {
  return interaction.trigger === 'APPROACH' || interaction.trigger === 'ENTER';
}

function checkAction(
  action: WorldAction,
  path: string,
  registries: LocationManifestRegistries,
  report: Report,
): void {
  switch (action.kind) {
    case 'TALK_TO':
      if (!registries.npcIds.includes(action.npcId)) {
        report('UNKNOWN_NPC', `${path}.npcId`, `no NPC "${action.npcId}"`);
      }
      return;
    case 'DISCOVER':
      if (!registries.discoveryIds.includes(action.discoveryId)) {
        report('UNKNOWN_DISCOVERY', `${path}.discoveryId`, `no discovery "${action.discoveryId}"`);
      }
      return;
    case 'START_STORY':
      if (!registries.storySlugs.includes(action.storySlug)) {
        report('UNKNOWN_STORY', `${path}.storySlug`, `no story "${action.storySlug}"`);
      }
      return;
    case 'START_ADVENTURE': {
      const adventure = registries.adventures.find(
        (candidate) => candidate.slug === action.templateSlug,
      );
      if (!adventure) {
        report(
          'UNKNOWN_ADVENTURE',
          `${path}.templateSlug`,
          `no adventure "${action.templateSlug}"`,
        );
      } else if (adventure.locationSlug !== action.locationSlug) {
        report(
          'ADVENTURE_IN_WRONG_LOCATION',
          `${path}.locationSlug`,
          `"${adventure.slug}" is authored for "${adventure.locationSlug}", not "${action.locationSlug}"`,
        );
      }
      return;
    }
    case 'SHOW_MESSAGE':
      requireText(action.message, `${path}.message`, report);
      return;
    case 'NAVIGATE':
      // Route paths are not a registry yet, so there is nothing to resolve against.
      return;
  }
}

function checkRequirement(
  requirement: WorldRequirement,
  path: string,
  registries: LocationManifestRegistries,
  report: Report,
): void {
  switch (requirement.type) {
    case 'DISCOVERY_PRESENT':
      if (!registries.discoveryIds.includes(requirement.discoveryId)) {
        report(
          'UNKNOWN_DISCOVERY',
          `${path}.discoveryId`,
          `no discovery "${requirement.discoveryId}"`,
        );
      }
      return;
    case 'ITEM_OWNED':
      if (!registries.itemIds.includes(requirement.itemId)) {
        report('UNKNOWN_ITEM', `${path}.itemId`, `no item "${requirement.itemId}"`);
      }
      return;
    case 'ALWAYS':
    case 'WORLD_CHANGE_PRESENT':
    case 'WORLD_CHANGE_ABSENT':
      // World-change keys are authored per adventure, with no registry to check against yet.
      return;
  }
}

function requirePositive(value: number, path: string, report: Report): void {
  if (!(Number.isFinite(value) && value > 0)) {
    report('INVALID_VALUE', path, `must be a positive number, got ${String(value)}`);
  }
}

function requireText(value: string, path: string, report: Report): void {
  if (value.trim().length === 0) {
    report('MISSING_COPY', path, 'child-facing text must not be empty');
  }
}
