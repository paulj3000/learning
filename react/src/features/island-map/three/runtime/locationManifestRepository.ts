import type { ThreeLocationManifest } from './locationManifest';
import {
  validateLocationManifest,
  type LocationManifestIssue,
  type LocationManifestRegistries,
} from './validateLocationManifest';

/**
 * Where the generic runtime gets a location's manifest from
 * (`docs/engine/10_IMPLEMENTATION_PHASES.md` Phase 2,
 * `docs/engine/02_CONTENT_MODEL_STRATEGY.md` "Canonical Loader Boundary").
 *
 * The runtime only ever sees this interface, never a specific region's
 * module, so the source-controlled implementation below can later be
 * swapped for one reading published Amplify Data snapshots without the
 * runtime changing (acceptance A4).
 */
export interface LocationManifestRepository {
  /** Resolves the published manifest for `regionId`, or rejects with one of the errors below. */
  getPublished(regionId: string): Promise<ThreeLocationManifest>;
  /** Every region id this repository can serve. */
  listRegionIds(): readonly string[];
}

/** No manifest is published for this region id. */
export class LocationManifestNotFoundError extends Error {
  readonly regionId: string;

  constructor(regionId: string) {
    super(`No location manifest is published for region "${regionId}"`);
    this.name = 'LocationManifestNotFoundError';
    this.regionId = regionId;
  }
}

/** A manifest exists but fails validation, so it must not be rendered. */
export class InvalidLocationManifestError extends Error {
  readonly regionId: string;
  readonly issues: readonly LocationManifestIssue[];

  constructor(regionId: string, issues: readonly LocationManifestIssue[]) {
    super(
      `Location manifest "${regionId}" is invalid: ${issues
        .map((issue) => `${issue.path} ${issue.kind}`)
        .join('; ')}`,
    );
    this.name = 'InvalidLocationManifestError';
    this.regionId = regionId;
    this.issues = issues;
  }
}

/**
 * A repository over manifests compiled into the bundle. Each manifest is
 * validated the first time it is requested and the verdict cached, so a
 * broken manifest fails loudly at the door instead of half-rendering, and a
 * good one is not re-validated on every mount.
 *
 * Throws immediately if two manifests claim the same region id: that is an
 * authoring error, not something a child should ever reach.
 */
export function createSourceManifestRepository(
  manifests: readonly ThreeLocationManifest[],
  registries: LocationManifestRegistries,
): LocationManifestRepository {
  const byRegionId = new Map<string, ThreeLocationManifest>();
  for (const manifest of manifests) {
    if (byRegionId.has(manifest.regionId)) {
      throw new Error(`Two location manifests claim region "${manifest.regionId}"`);
    }
    byRegionId.set(manifest.regionId, manifest);
  }

  const verdicts = new Map<string, readonly LocationManifestIssue[]>();

  return {
    getPublished(regionId) {
      const manifest = byRegionId.get(regionId);
      if (!manifest) {
        return Promise.reject(new LocationManifestNotFoundError(regionId));
      }
      let issues = verdicts.get(regionId);
      if (!issues) {
        issues = validateLocationManifest(manifest, registries);
        verdicts.set(regionId, issues);
      }
      if (issues.length > 0) {
        return Promise.reject(new InvalidLocationManifestError(regionId, issues));
      }
      return Promise.resolve(manifest);
    },
    listRegionIds() {
      return [...byRegionId.keys()];
    },
  };
}
