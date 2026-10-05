import type { JsonValue } from '../../runtime/locationManifest';

/**
 * The `sanctuary-art` extension's config, parsed rather than trusted.
 *
 * Everything positional comes from the manifest: the interactive things by
 * the entity roots the runtime already placed, and the two decorative sets
 * (sockets, cliffs) by explicit coordinates here.
 */
export interface SanctuaryArtConfig {
  /** The world change that means the forge burns. */
  forgeChangeKey: string;
  hearthEntityId: string;
  emberEntityId: string;
  /** The hearth's three rune sockets; each glows once its own rune is found. */
  sockets: readonly { x: number; z: number; changeKey: string }[];
  runeEntityIds: readonly string[];
  scaleEntityIds: readonly string[];
  gates: readonly {
    entityId: string;
    halfWidth: number;
    height: number;
    thickness: number;
    seam: 'CRYSTAL' | 'EMBER';
  }[];
  skyCliffs: readonly { x: number; z: number; halfWidth: number; height: number }[];
}

function text(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function num(value: JsonValue | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function record(value: JsonValue | undefined): { readonly [key: string]: JsonValue } | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as { readonly [key: string]: JsonValue })
    : undefined;
}

function list(value: JsonValue | undefined): readonly JsonValue[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function stringList(value: JsonValue | undefined): readonly string[] | undefined {
  const items = list(value);
  if (!items || !items.every((item) => typeof item === 'string')) return undefined;
  return items as readonly string[];
}

/** Parses config, or `null` so the runtime skips a broken binding with a warning. */
export function tryParseSanctuaryArtConfig(config: {
  readonly [key: string]: JsonValue;
}): SanctuaryArtConfig | null {
  const forgeChangeKey = text(config.forgeChangeKey);
  const hearthEntityId = text(config.hearthEntityId);
  const emberEntityId = text(config.emberEntityId);
  const runeEntityIds = stringList(config.runeEntityIds);
  const scaleEntityIds = stringList(config.scaleEntityIds);
  if (!forgeChangeKey || !hearthEntityId || !emberEntityId) return null;
  if (!runeEntityIds || !scaleEntityIds) return null;

  const sockets: { x: number; z: number; changeKey: string }[] = [];
  for (const entry of list(config.sockets) ?? []) {
    const socket = record(entry);
    const x = num(socket?.x);
    const z = num(socket?.z);
    const changeKey = text(socket?.changeKey);
    if (x === undefined || z === undefined || !changeKey) return null;
    sockets.push({ x, z, changeKey });
  }

  const gates: SanctuaryArtConfig['gates'][number][] = [];
  for (const entry of list(config.gates) ?? []) {
    const gate = record(entry);
    const entityId = text(gate?.entityId);
    const halfWidth = num(gate?.halfWidth);
    const height = num(gate?.height);
    const thickness = num(gate?.thickness);
    const seam = text(gate?.seam);
    if (!entityId || halfWidth === undefined || height === undefined) return null;
    if (thickness === undefined || (seam !== 'CRYSTAL' && seam !== 'EMBER')) return null;
    gates.push({ entityId, halfWidth, height, thickness, seam });
  }

  const skyCliffs: SanctuaryArtConfig['skyCliffs'][number][] = [];
  for (const entry of list(config.skyCliffs) ?? []) {
    const cliff = record(entry);
    const x = num(cliff?.x);
    const z = num(cliff?.z);
    const halfWidth = num(cliff?.halfWidth);
    const height = num(cliff?.height);
    if (x === undefined || z === undefined) return null;
    if (halfWidth === undefined || height === undefined) return null;
    skyCliffs.push({ x, z, halfWidth, height });
  }

  return {
    forgeChangeKey,
    hearthEntityId,
    emberEntityId,
    sockets,
    runeEntityIds,
    scaleEntityIds,
    gates,
    skyCliffs,
  };
}
