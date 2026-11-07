import type { LightSpec } from '../locationManifest';

/**
 * Render-quality tiers for the location runtime
 * (`docs/regions/storykeeper_castle_art_direction.md` sections 7 and 11).
 * A tier changes how a region *looks* and what it costs to draw, never what
 * a child can do there: colliders, interactions, bindings and copy are the
 * same at every tier. Every number is provisional until the SC-R11 profiling
 * pass measures a real tablet.
 */
export type RenderQuality = 'LOW' | 'MEDIUM' | 'HIGH';

export interface RenderQualityPreset {
  /** Edge length of each procedural surface texture. 0 means flat colour, no texture. */
  textureSize: number;
  /** Placed point lights kept; the rest are dropped by `priority`. */
  maxPlacedLights: number;
  /** Upper bound on the device pixel ratio the renderer draws at. */
  pixelRatioCap: number;
  /** Motes per effect, after the manifest's own count. 0 means no motes. */
  maxMotesPerEffect: number;
}

export const RENDER_QUALITY_PRESETS: Readonly<Record<RenderQuality, RenderQualityPreset>> = {
  LOW: { textureSize: 64, maxPlacedLights: 8, pixelRatioCap: 1, maxMotesPerEffect: 0 },
  MEDIUM: { textureSize: 128, maxPlacedLights: 14, pixelRatioCap: 1.5, maxMotesPerEffect: 40 },
  HIGH: { textureSize: 256, maxPlacedLights: 20, pixelRatioCap: 2, maxMotesPerEffect: 80 },
};

/** The tablet default. HIGH is never chosen automatically. */
export const DEFAULT_RENDER_QUALITY: RenderQuality = 'MEDIUM';

export interface DeviceHints {
  /** `navigator.hardwareConcurrency`, when the browser reports it. */
  hardwareConcurrency?: number;
  /** `navigator.deviceMemory` in GB, when the browser reports it (Chromium only). */
  deviceMemory?: number;
  /** An explicit choice (a developer flag today, a parent setting one day). Wins outright. */
  override?: RenderQuality;
}

const LOW_END_CORES = 4;
const LOW_END_MEMORY_GB = 4;

/**
 * LOW when the device says it is small (at most four cores, or at most 4 GB),
 * otherwise MEDIUM. Missing hints are not evidence of a small device. No
 * GPU sniffing: a renderer string is unreliable and a fingerprinting surface.
 */
export function chooseRenderQuality(hints: DeviceHints = {}): RenderQuality {
  if (hints.override) return hints.override;
  const { hardwareConcurrency, deviceMemory } = hints;
  if (hardwareConcurrency !== undefined && hardwareConcurrency <= LOW_END_CORES) return 'LOW';
  if (deviceMemory !== undefined && deviceMemory <= LOW_END_MEMORY_GB) return 'LOW';
  return DEFAULT_RENDER_QUALITY;
}

/** Reads the hints a browser exposes, tolerating environments that expose none. */
export function deviceHintsFromNavigator(
  nav: Partial<Navigator> | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): DeviceHints {
  if (!nav) return {};
  const memory = (nav as { deviceMemory?: unknown }).deviceMemory;
  return {
    hardwareConcurrency:
      typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0
        ? nav.hardwareConcurrency
        : undefined,
    deviceMemory: typeof memory === 'number' && memory > 0 ? memory : undefined,
  };
}

/**
 * The placed lights a tier keeps: the `max` with the highest `priority`,
 * ties broken by authored order, returned in authored order so the scene
 * graph does not reshuffle between tiers.
 */
export function selectLightsForQuality<T extends Pick<LightSpec, 'priority'>>(
  lights: readonly T[],
  quality: RenderQuality,
): T[] {
  const max = RENDER_QUALITY_PRESETS[quality].maxPlacedLights;
  if (lights.length <= max) return [...lights];
  const kept = new Set(
    lights
      .map((light, index) => ({ index, priority: light.priority ?? 0 }))
      .sort((a, b) => b.priority - a.priority || a.index - b.index)
      .slice(0, max)
      .map((entry) => entry.index),
  );
  return lights.filter((_, index) => kept.has(index));
}

/** The pixel ratio to draw at: the device's own, never above the tier's cap, never below 1. */
export function pixelRatioFor(
  devicePixelRatio: number | undefined,
  quality: RenderQuality,
): number {
  const ratio =
    devicePixelRatio !== undefined && Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  return Math.max(1, Math.min(ratio, RENDER_QUALITY_PRESETS[quality].pixelRatioCap));
}
