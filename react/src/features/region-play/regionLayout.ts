import type { JsonObject, JsonValue } from '../../api/parse';
import type {
  AmbientSpec,
  ClusterPosition,
  ColliderSpec,
  LightSpec,
  PlaceholderSize,
  RectZone,
  ScaleSpec,
  ScenerySpec,
  Vec3,
  ZoneSpec,
} from '../island-map/three/runtime/locationManifest';
import {
  MAX_FIREFLIES,
  PROCEDURAL_SHAPES,
  type ProceduralShape,
  type RegionPlayAmbienceConfig,
  type RegionPlayProceduralConfig,
  type RegionPlayPropConfig,
  type RegionPlayUnlockConfig,
} from './regionPlayConfig';

/**
 * Reads a server region's `scene.layout` (TR-13): the spatial layout Django
 * carries as JSON in the manifest's own vocabulary until LAI-0805 decides how
 * layouts are authored (`lai/apps/regions/treasure_cove_layout.py`).
 *
 * Strict and pure. Anything malformed throws `RegionLayoutError` naming the
 * path, so a typo made in Django admin fails the region with a message an
 * author can act on rather than drawing a half-built cove. What the reader
 * cannot know (that an asset id exists, that ids are unique, that a zone sits
 * inside the bounds) is left to `validateLocationManifest`, which checks the
 * assembled manifest before anything renders.
 *
 * Supported: scenery `FLAT_PLANE`, `BOX`, `TILED_GROUND`, `CLUSTER`, `MODEL`
 * and `SCATTER`; colliders; zones; `SPLINE_LOOP` ambient movers; `POINT`
 * lights; and `procedural` placeholders, which go to the `region-play`
 * extension to draw. Two optional blocks go to the same extension: `unlock` (TR-17, what the
 * quest's completion opens) and `ambience` (TR-18, shimmering water and fireflies).
 */

export interface RegionLayout {
  scenery: ScenerySpec[];
  colliders: ColliderSpec[];
  zones: ZoneSpec[];
  ambient: AmbientSpec[];
  lights: LightSpec[];
  procedural: RegionPlayProceduralConfig[];
  /** TR-ENV-06: barrels and logs drawn from the asset library, and what each model replaces. */
  props: RegionPlayPropConfig[];
  propReplaces: { [assetId: string]: string[] };
  /** ENV-2: bushes, flowers and grass from the asset library; walk-through, so no colliders. */
  vegetation: RegionPlayPropConfig[];
  /** What a world change opens, without whether the child has it yet (the builder adds that). */
  unlock?: Omit<RegionPlayUnlockConfig, 'unlocked'>;
  ambience?: RegionPlayAmbienceConfig;
}

export const EMPTY_LAYOUT: RegionLayout = {
  scenery: [],
  colliders: [],
  zones: [],
  ambient: [],
  lights: [],
  procedural: [],
  props: [],
  propReplaces: {},
  vegetation: [],
};

export class RegionLayoutError extends Error {
  readonly path: string;
  readonly detail: string;
  constructor(path: string, detail: string) {
    super(`${path}: ${detail}`);
    this.name = 'RegionLayoutError';
    this.path = path;
    this.detail = detail;
  }
}

type Fields = { readonly [key: string]: JsonValue };

function object(value: JsonValue | undefined, path: string): Fields {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RegionLayoutError(path, 'expected an object');
  }
  return value as Fields;
}

function array(value: JsonValue | undefined, path: string): readonly JsonValue[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new RegionLayoutError(path, 'expected a list');
  return value;
}

function num(value: JsonValue | undefined, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RegionLayoutError(path, 'expected a number');
  }
  return value;
}

function optionalNum(value: JsonValue | undefined, path: string): number | undefined {
  return value === undefined ? undefined : num(value, path);
}

function positive(value: JsonValue | undefined, path: string): number {
  const n = num(value, path);
  if (n <= 0) throw new RegionLayoutError(path, 'expected a positive number');
  return n;
}

function str(value: JsonValue | undefined, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RegionLayoutError(path, 'expected text');
  }
  return value;
}

function color(value: JsonValue | undefined, path: string): number {
  const n = num(value, path);
  if (!Number.isInteger(n) || n < 0 || n > 0xffffff) {
    throw new RegionLayoutError(path, 'expected a 24-bit colour');
  }
  return n;
}

function rect(value: JsonValue | undefined, path: string): RectZone {
  const fields = object(value, path);
  const zone = {
    id: str(fields.id, `${path}.id`),
    minX: num(fields.minX, `${path}.minX`),
    maxX: num(fields.maxX, `${path}.maxX`),
    minZ: num(fields.minZ, `${path}.minZ`),
    maxZ: num(fields.maxZ, `${path}.maxZ`),
  };
  if (zone.minX >= zone.maxX || zone.minZ >= zone.maxZ) {
    throw new RegionLayoutError(path, 'min must be less than max');
  }
  return zone;
}

function vec3(value: JsonValue | undefined, path: string): Vec3 {
  const fields = object(value, path);
  return {
    x: num(fields.x, `${path}.x`),
    y: num(fields.y, `${path}.y`),
    z: num(fields.z, `${path}.z`),
  };
}

function scale(value: JsonValue | undefined, path: string): ScaleSpec | undefined {
  if (value === undefined) return undefined;
  const fields = object(value, path);
  const spec: ScaleSpec = {};
  for (const axis of ['x', 'y', 'z'] as const) {
    if (fields[axis] !== undefined) spec[axis] = positive(fields[axis], `${path}.${axis}`);
  }
  return spec;
}

function placeholderSize(value: JsonValue | undefined, path: string): PlaceholderSize | undefined {
  if (value === undefined) return undefined;
  const fields = object(value, path);
  return {
    width: positive(fields.width, `${path}.width`),
    height: positive(fields.height, `${path}.height`),
    depth: positive(fields.depth, `${path}.depth`),
  };
}

function clusterPosition(value: JsonValue, path: string): ClusterPosition {
  const fields = object(value, path);
  const position: ClusterPosition = {
    x: num(fields.x, `${path}.x`),
    z: num(fields.z, `${path}.z`),
  };
  const y = optionalNum(fields.y, `${path}.y`);
  const rotationY = optionalNum(fields.rotationY, `${path}.rotationY`);
  const scaled = scale(fields.scale, `${path}.scale`);
  return {
    ...position,
    ...(y !== undefined ? { y } : {}),
    ...(rotationY !== undefined ? { rotationY } : {}),
    ...(scaled ? { scale: scaled } : {}),
  };
}

function scenery(value: JsonValue, path: string): ScenerySpec {
  const fields = object(value, path);
  const id = str(fields.id, `${path}.id`);
  switch (fields.kind) {
    case 'FLAT_PLANE':
      return {
        kind: 'FLAT_PLANE',
        id,
        color: color(fields.color, `${path}.color`),
        area: rect(fields.area, `${path}.area`),
        y: num(fields.y, `${path}.y`),
      };
    case 'BOX': {
      const minY = num(fields.minY, `${path}.minY`);
      const maxY = num(fields.maxY, `${path}.maxY`);
      if (minY >= maxY) throw new RegionLayoutError(path, 'minY must be less than maxY');
      return {
        kind: 'BOX',
        id,
        color: color(fields.color, `${path}.color`),
        area: rect(fields.area, `${path}.area`),
        minY,
        maxY,
      };
    }
    case 'TILED_GROUND': {
      const y = optionalNum(fields.y, `${path}.y`);
      return {
        kind: 'TILED_GROUND',
        id,
        assetId: str(fields.assetId, `${path}.assetId`),
        area: rect(fields.area, `${path}.area`),
        tileSize: positive(fields.tileSize, `${path}.tileSize`),
        ...(y !== undefined ? { y } : {}),
      };
    }
    case 'CLUSTER':
      return {
        kind: 'CLUSTER',
        id,
        assetId: str(fields.assetId, `${path}.assetId`),
        positions: array(fields.positions, `${path}.positions`).map((item, index) =>
          clusterPosition(item, `${path}.positions[${index}]`),
        ),
      };
    case 'MODEL': {
      const rotation =
        fields.rotation === undefined ? undefined : vec3(fields.rotation, `${path}.rotation`);
      const scaled = scale(fields.scale, `${path}.scale`);
      const size = placeholderSize(fields.placeholderSize, `${path}.placeholderSize`);
      return {
        kind: 'MODEL',
        id,
        assetId: str(fields.assetId, `${path}.assetId`),
        position: vec3(fields.position, `${path}.position`),
        ...(rotation ? { rotation } : {}),
        ...(scaled ? { scale: scaled } : {}),
        ...(size ? { placeholderSize: size } : {}),
      };
    }
    case 'SCATTER': {
      const seed = num(fields.seed, `${path}.seed`);
      if (!Number.isInteger(seed))
        throw new RegionLayoutError(`${path}.seed`, 'expected an integer');
      return {
        kind: 'SCATTER',
        id,
        assetId: str(fields.assetId, `${path}.assetId`),
        area: rect(fields.area, `${path}.area`),
        spacing: positive(fields.spacing, `${path}.spacing`),
        seed,
        clearance: num(fields.clearance, `${path}.clearance`),
      };
    }
    default:
      throw new RegionLayoutError(
        `${path}.kind`,
        `unsupported scenery kind ${JSON.stringify(fields.kind)}`,
      );
  }
}

function collider(value: JsonValue, path: string): ColliderSpec {
  const fields = object(value, path);
  const minY = optionalNum(fields.minY, `${path}.minY`);
  const maxY = optionalNum(fields.maxY, `${path}.maxY`);
  if (fields.jumpable !== undefined && typeof fields.jumpable !== 'boolean') {
    throw new RegionLayoutError(`${path}.jumpable`, 'expected true or false');
  }
  return {
    rect: rect(fields.rect, `${path}.rect`),
    ...(minY !== undefined ? { minY } : {}),
    ...(maxY !== undefined ? { maxY } : {}),
    // LAI-JMP-01: a low obstacle the child may jump onto or over.
    ...(fields.jumpable === true ? { jumpable: true } : {}),
  };
}

function zone(value: JsonValue, path: string): ZoneSpec {
  const fields = object(value, path);
  return {
    rect: rect(fields.rect, `${path}.rect`),
    ...(fields.enterMessage !== undefined
      ? { enterMessage: str(fields.enterMessage, `${path}.enterMessage`) }
      : {}),
  };
}

function ambient(value: JsonValue, path: string): AmbientSpec {
  const fields = object(value, path);
  if (fields.kind !== 'SPLINE_LOOP') {
    throw new RegionLayoutError(`${path}.kind`, 'expected SPLINE_LOOP');
  }
  const points = array(fields.path, `${path}.path`).map((item, index) =>
    vec3(item, `${path}.path[${index}]`),
  );
  if (points.length < 3) throw new RegionLayoutError(`${path}.path`, 'needs at least three points');
  const look = object(fields.appearance, `${path}.appearance`);
  const appearance: AmbientSpec['appearance'] =
    look.primitive === 'CONE'
      ? { primitive: 'CONE', color: color(look.color, `${path}.appearance.color`) }
      : { assetId: str(look.assetId, `${path}.appearance.assetId`) };
  return {
    kind: 'SPLINE_LOOP',
    id: str(fields.id, `${path}.id`),
    path: points,
    loopsPerSecond: positive(fields.loopsPerSecond, `${path}.loopsPerSecond`),
    appearance,
  };
}

function light(value: JsonValue, path: string): LightSpec {
  const fields = object(value, path);
  if (fields.kind !== 'POINT') throw new RegionLayoutError(`${path}.kind`, 'expected POINT');
  const distance = optionalNum(fields.distance, `${path}.distance`);
  return {
    id: str(fields.id, `${path}.id`),
    kind: 'POINT',
    position: vec3(fields.position, `${path}.position`),
    color: color(fields.color, `${path}.color`),
    intensity: num(fields.intensity, `${path}.intensity`),
    ...(distance !== undefined ? { distance } : {}),
  };
}

function procedural(value: JsonValue, path: string): RegionPlayProceduralConfig {
  const fields = object(value, path);
  const shape = fields.shape;
  if (typeof shape !== 'string' || !(PROCEDURAL_SHAPES as readonly string[]).includes(shape)) {
    throw new RegionLayoutError(
      `${path}.shape`,
      `unknown placeholder shape ${JSON.stringify(shape)}`,
    );
  }
  const rotationY = optionalNum(fields.rotationY, `${path}.rotationY`);
  const height =
    fields.height === undefined ? undefined : positive(fields.height, `${path}.height`);
  const tint = fields.color === undefined ? undefined : color(fields.color, `${path}.color`);
  const assetId =
    fields.assetId === undefined ? undefined : str(fields.assetId, `${path}.assetId`);
  return {
    id: str(fields.id, `${path}.id`),
    shape: shape as ProceduralShape,
    x: num(fields.x, `${path}.x`),
    z: num(fields.z, `${path}.z`),
    ...(rotationY !== undefined ? { rotationY } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(tint !== undefined ? { color: tint } : {}),
    ...(assetId !== undefined ? { assetId } : {}),
  };
}

function prop(value: JsonValue, path: string): RegionPlayPropConfig {
  const fields = object(value, path);
  const rotationY = optionalNum(fields.rotationY, `${path}.rotationY`);
  const rotationZ = optionalNum(fields.rotationZ, `${path}.rotationZ`);
  const scale = fields.scale === undefined ? undefined : positive(fields.scale, `${path}.scale`);
  const height = fields.height === undefined ? undefined : positive(fields.height, `${path}.height`);
  return {
    id: str(fields.id, `${path}.id`),
    assetId: str(fields.assetId, `${path}.assetId`),
    x: num(fields.x, `${path}.x`),
    z: num(fields.z, `${path}.z`),
    ...(rotationY !== undefined ? { rotationY } : {}),
    ...(rotationZ !== undefined ? { rotationZ } : {}),
    ...(scale !== undefined ? { scale } : {}),
    ...(height !== undefined ? { height } : {}),
    colliders: array(fields.colliders, `${path}.colliders`).map((item, index) =>
      rect(item, `${path}.colliders[${index}]`),
    ),
  };
}

function propReplaces(value: JsonValue | undefined, path: string): { [assetId: string]: string[] } {
  if (value === undefined) return {};
  const fields = object(value, path);
  const out: { [assetId: string]: string[] } = {};
  for (const [assetId, ids] of Object.entries(fields)) out[assetId] = strings(ids, `${path}.${assetId}`);
  return out;
}

function strings(value: JsonValue | undefined, path: string): string[] {
  return array(value, path).map((item, index) => str(item, `${path}[${index}]`));
}

function unlock(value: JsonValue, path: string): Omit<RegionPlayUnlockConfig, 'unlocked'> {
  const fields = object(value, path);
  return {
    changeKey: str(fields.changeKey, `${path}.changeKey`),
    openColliders: strings(fields.openColliders, `${path}.openColliders`),
    showWhenOpen: strings(fields.showWhenOpen, `${path}.showWhenOpen`),
    hideWhenOpen: strings(fields.hideWhenOpen, `${path}.hideWhenOpen`),
    liftGates: strings(fields.liftGates, `${path}.liftGates`),
  };
}

function ambience(value: JsonValue, path: string): RegionPlayAmbienceConfig {
  const fields = object(value, path);
  return {
    water: strings(fields.water, `${path}.water`),
    fireflies: array(fields.fireflies, `${path}.fireflies`).map((item, index) => {
      const itemPath = `${path}.fireflies[${index}]`;
      const each = object(item, itemPath);
      const count = positive(each.count, `${itemPath}.count`);
      if (!Number.isInteger(count) || count > MAX_FIREFLIES) {
        throw new RegionLayoutError(
          `${itemPath}.count`,
          `expected a whole number up to ${MAX_FIREFLIES}`,
        );
      }
      return {
        id: str(each.id, `${itemPath}.id`),
        x: num(each.x, `${itemPath}.x`),
        z: num(each.z, `${itemPath}.z`),
        radius: positive(each.radius, `${itemPath}.radius`),
        height: num(each.height, `${itemPath}.height`),
        count,
      };
    }),
  };
}

export function readRegionLayout(value: JsonValue | undefined): RegionLayout {
  if (value === undefined) return EMPTY_LAYOUT;
  const path = 'scene.layout';
  const fields: JsonObject = object(value, path);
  const each = <T>(key: string, read: (item: JsonValue, itemPath: string) => T): T[] =>
    array(fields[key], `${path}.${key}`).map((item, index) =>
      read(item, `${path}.${key}[${index}]`),
    );
  return {
    scenery: each('scenery', scenery),
    colliders: each('colliders', collider),
    zones: each('zones', zone),
    ambient: each('ambient', ambient),
    lights: each('lights', light),
    procedural: each('procedural', procedural),
    props: fields.props === undefined ? [] : each('props', prop),
    propReplaces: propReplaces(fields.propReplaces, `${path}.propReplaces`),
    vegetation: fields.vegetation === undefined ? [] : each('vegetation', prop),
    ...(fields.unlock !== undefined ? { unlock: unlock(fields.unlock, `${path}.unlock`) } : {}),
    ...(fields.ambience !== undefined
      ? { ambience: ambience(fields.ambience, `${path}.ambience`) }
      : {}),
  };
}
