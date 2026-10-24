import { AGE_BAND_LABELS, type AgeBandValue } from '../../../../child-profile/constants';
import type { JsonValue } from '../../runtime/locationManifest';

/**
 * The manifest config for the `tide-trial` extension, parsed at runtime
 * (CLAUDE.md section 13: validate all external data). Every geometric fact
 * comes from here or from the manifest's own scenery, so the mechanic is
 * not tied to Pirate Builder Bay: any region with a channel, a sea and a
 * bridge collider can declare it.
 */
export interface TideTrialConfig {
  /** The `WorldInteraction` an eligible child gets this trial for instead. */
  interactionId: string;
  ageBands: readonly AgeBandValue[];
  /** A `BOX` scenery item: its `minY` is the channel bed, its `maxY` the resting water surface. */
  channelSceneryId: string;
  /** A `FLAT_PLANE` that rises and falls with the channel, so the two never show a step. */
  seaSceneryId: string;
  /** Scenery hidden while a deck is being built (the broken bridge). */
  hideDuringTrialSceneryIds: readonly string[];
  /** Removed once the deck survives a tide, so the child can walk across. */
  bridgeColliderId: string;
  /** Gestures while the trial runs. */
  npcEntityId: string;
  plankAssetId: string;
  /** World height of the bank top, which the tide board calls `bankTopCm`. */
  bankTopY: number;
  bankTopCm: number;
  bridge: { minZ: number; maxZ: number };
  deckPlankXs: readonly number[];
  deckPostXs: readonly number[];
  tidePost: { x: number; z: number };
  /** Recorded once when the trial is won, through `recordWorldChangeOnce`. */
  worldChange: { locationSlug: string; changeType: string; changeKey: string; source: string };
}

type JsonObject = { readonly [key: string]: JsonValue };

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(object: JsonObject, key: string): string {
  const value = object[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${key} must be a string`);
  return value;
}

function num(object: JsonObject, key: string): number {
  const value = object[key];
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`${key} must be a number`);
  return value;
}

function obj(object: JsonObject, key: string): JsonObject {
  const value = object[key];
  if (!isObject(value)) throw new Error(`${key} must be an object`);
  return value;
}

function list<T>(object: JsonObject, key: string, item: (value: JsonValue) => T | undefined): T[] {
  const value = object[key];
  if (!Array.isArray(value)) throw new Error(`${key} must be an array`);
  return value.map((entry: JsonValue, index) => {
    const parsed = item(entry);
    if (parsed === undefined) throw new Error(`${key}[${index}] is invalid`);
    return parsed;
  });
}

const asNumber = (value: JsonValue) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const asString = (value: JsonValue) => (typeof value === 'string' ? value : undefined);
const asAgeBand = (value: JsonValue): AgeBandValue | undefined =>
  typeof value === 'string' && value in AGE_BAND_LABELS ? (value as AgeBandValue) : undefined;

/** Parses a manifest config, or throws an author-facing `Error` naming the first bad field. */
export function parseTideTrialConfig(config: JsonObject): TideTrialConfig {
  const bridge = obj(config, 'bridge');
  const tidePost = obj(config, 'tidePost');
  const worldChange = obj(config, 'worldChange');
  const parsed: TideTrialConfig = {
    interactionId: str(config, 'interactionId'),
    ageBands: list(config, 'ageBands', asAgeBand),
    channelSceneryId: str(config, 'channelSceneryId'),
    seaSceneryId: str(config, 'seaSceneryId'),
    hideDuringTrialSceneryIds: list(config, 'hideDuringTrialSceneryIds', asString),
    bridgeColliderId: str(config, 'bridgeColliderId'),
    npcEntityId: str(config, 'npcEntityId'),
    plankAssetId: str(config, 'plankAssetId'),
    bankTopY: num(config, 'bankTopY'),
    bankTopCm: num(config, 'bankTopCm'),
    bridge: { minZ: num(bridge, 'minZ'), maxZ: num(bridge, 'maxZ') },
    deckPlankXs: list(config, 'deckPlankXs', asNumber),
    deckPostXs: list(config, 'deckPostXs', asNumber),
    tidePost: { x: num(tidePost, 'x'), z: num(tidePost, 'z') },
    worldChange: {
      locationSlug: str(worldChange, 'locationSlug'),
      changeType: str(worldChange, 'changeType'),
      changeKey: str(worldChange, 'changeKey'),
      source: str(worldChange, 'source'),
    },
  };
  if (parsed.bankTopCm <= 0) throw new Error('bankTopCm must be positive');
  if (parsed.bridge.minZ >= parsed.bridge.maxZ) throw new Error('bridge.minZ must be below maxZ');
  return parsed;
}

/** `parseTideTrialConfig` without the throw, for callers that should quietly do nothing on bad config. */
export function tryParseTideTrialConfig(config: JsonObject): TideTrialConfig | null {
  try {
    return parseTideTrialConfig(config);
  } catch {
    return null;
  }
}
