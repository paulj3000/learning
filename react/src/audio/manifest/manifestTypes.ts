import type { SoundDefinition } from '../AudioTypes';

/**
 * The published audio manifest Django serves (docs/audio/PHASE_2_ASSET_INTEGRATION.md). It is
 * data only: a sound names its audio as `asset-id@version`, never as a url, so a manifest never
 * holds a link that can expire.
 */

export type ManifestScopeType = 'island' | 'place' | 'region';

export interface ManifestScope {
  type: ManifestScopeType;
  id: string;
}

/** "When `event` happens to `targetType` `targetId`, play `soundId`." */
export interface ManifestAssignment {
  event: string;
  targetType: string;
  targetId: string;
  soundId: string;
}

export interface AudioManifest {
  schemaVersion: 1;
  revision: string;
  scope: ManifestScope;
  sounds: SoundDefinition[];
  assignments: ManifestAssignment[];
}

export interface ParsedManifest {
  manifest: AudioManifest;
  /** What was dropped from an otherwise usable manifest, for diagnostics. Ids only, never contents. */
  skipped: string[];
}
