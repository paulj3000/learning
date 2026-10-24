import type { JsonValue } from '../../runtime/locationManifest';

/**
 * The `clockwork-machinery` extension's config, parsed and validated here
 * rather than trusted (engine Phase 7's rule for extension config: the
 * manifest carries plain JSON, and only the extension knows what it means).
 */
export interface ClockworkMachineryConfig {
  /** The world change that means the lighthouse turns again. */
  changeKey: string;
  /** The prop whose empty root gets the mechanism's drum and gear. */
  mechanismEntityId: string;
  /** The collectibles whose empty roots get a brass gear each. */
  gearEntityIds: readonly string[];
  /** The lamp at the top of the tower. */
  lamp: { x: number; y: number; z: number };
  /** The clock tower's face, and the hand that runs backward on it. */
  clockFace: { x: number; y: number; z: number };
}

function num(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function point(value: JsonValue | undefined): { x: number; y: number; z: number } | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as { readonly [key: string]: JsonValue };
  const x = num(record.x);
  const y = num(record.y);
  const z = num(record.z);
  return x === undefined || y === undefined || z === undefined ? undefined : { x, y, z };
}

/** Parses config, or returns `null` so the runtime can skip a broken binding with a warning. */
export function tryParseClockworkMachineryConfig(config: {
  readonly [key: string]: JsonValue;
}): ClockworkMachineryConfig | null {
  const changeKey = config.changeKey;
  const mechanismEntityId = config.mechanismEntityId;
  const gearEntityIds = config.gearEntityIds;
  const lamp = point(config.lamp);
  const clockFace = point(config.clockFace);
  if (typeof changeKey !== 'string' || changeKey.length === 0) return null;
  if (typeof mechanismEntityId !== 'string' || mechanismEntityId.length === 0) return null;
  if (!Array.isArray(gearEntityIds) || !gearEntityIds.every((id) => typeof id === 'string')) {
    return null;
  }
  if (!lamp || !clockFace) return null;
  return {
    changeKey,
    mechanismEntityId,
    gearEntityIds: gearEntityIds as readonly string[],
    lamp,
    clockFace,
  };
}
