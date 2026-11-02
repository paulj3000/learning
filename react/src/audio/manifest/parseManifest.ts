import { CHANNEL_IDS, clampVolume } from '../AudioChannels';
import { AudioError, type AudioChannel, type SoundDefinition } from '../AudioTypes';
import type {
  ManifestAssignment,
  ManifestScope,
  ManifestScopeType,
  ParsedManifest,
} from './manifestTypes';

/**
 * Runtime validation of a manifest (CLAUDE.md: validate all external data).
 *
 * Two levels of failure, on purpose:
 * - the document itself is wrong (not an object, an unknown schema version, no arrays): the whole
 *   manifest is refused with an `invalid-manifest` error and nothing is registered;
 * - one sound or assignment is wrong: that entry is skipped and listed in `skipped`, so one bad row
 *   cannot silence a whole area.
 *
 * Only known fields are copied out. A url, a storage key or any other extra field in the input can
 * never reach the Sound Manager.
 */

export const MAX_SOUNDS = 500;
export const MAX_ASSIGNMENTS = 2000;

const CUE_ID = /^(music|ambient|sfx|voice|ui)(\.[a-z0-9_]{1,30}){1,4}$/;
const ASSET_REFERENCE = /^[a-z0-9]+(?:-[a-z0-9]+)*@[1-9][0-9]{0,5}$/;
const SLUG = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const WORD = /^[a-z][a-z_]{0,29}$/;
const SCOPE_TYPES: readonly ManifestScopeType[] = ['island', 'place', 'region'];

function invalid(reason: string): never {
  throw new AudioError('invalid-manifest', `the audio manifest was refused: ${reason}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readScope(value: unknown): ManifestScope {
  if (!isRecord(value)) return invalid('scope is missing');
  const { type, id } = value;
  if (typeof type !== 'string' || !SCOPE_TYPES.includes(type as ManifestScopeType)) {
    return invalid('scope type is not recognised');
  }
  if (typeof id !== 'string' || !SLUG.test(id)) return invalid('scope id is not valid');
  return { type: type as ManifestScopeType, id };
}

function optionalCount(value: unknown, min: number, max: number): number | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    return null; // invalid
  }
  return value;
}

/** A sound, or the reason it was skipped. */
function readSound(value: unknown): SoundDefinition | string {
  if (!isRecord(value)) return 'not an object';
  const { id, assetId, channel, volume, loop } = value;
  if (typeof id !== 'string' || id.length > 80 || !CUE_ID.test(id)) return 'bad id';
  if (typeof assetId !== 'string' || !ASSET_REFERENCE.test(assetId)) return 'bad asset reference';
  if (typeof channel !== 'string' || !CHANNEL_IDS.includes(channel as AudioChannel)) {
    return 'unknown channel';
  }
  if (!id.startsWith(`${channel}.`)) return 'id does not match its channel';
  if (typeof volume !== 'number' || clampVolume(volume) !== volume) return 'bad volume';
  if (typeof loop !== 'boolean') return 'bad loop';
  if (value.stream !== undefined && typeof value.stream !== 'boolean') return 'bad stream';

  const priority = optionalCount(value.priority, 0, 100);
  const maxConcurrent = optionalCount(value.maxConcurrent, 1, 32);
  const cooldownMs = optionalCount(value.cooldownMs, 0, 60_000);
  const fadeInMs = optionalCount(value.fadeInMs, 0, 10_000);
  const fadeOutMs = optionalCount(value.fadeOutMs, 0, 10_000);
  if ([priority, maxConcurrent, cooldownMs, fadeInMs, fadeOutMs].includes(null)) {
    return 'bad playback setting';
  }

  const definition: SoundDefinition = {
    id,
    assetId,
    channel: channel as AudioChannel,
    loop,
    defaultVolume: volume,
  };
  if (value.stream === true) definition.stream = true;
  if (priority !== undefined && priority !== null) definition.priority = priority;
  if (maxConcurrent !== undefined && maxConcurrent !== null) {
    definition.maxConcurrent = maxConcurrent;
  }
  if (cooldownMs !== undefined && cooldownMs !== null) definition.cooldownMs = cooldownMs;
  if (fadeInMs !== undefined && fadeInMs !== null) definition.fadeInMs = fadeInMs;
  if (fadeOutMs !== undefined && fadeOutMs !== null) definition.fadeOutMs = fadeOutMs;
  return definition;
}

function readAssignment(value: unknown, soundIds: ReadonlySet<string>): ManifestAssignment | null {
  if (!isRecord(value)) return null;
  const { event, targetType, targetId, soundId } = value;
  if (typeof event !== 'string' || !WORD.test(event)) return null;
  if (typeof targetType !== 'string' || !WORD.test(targetType)) return null;
  if (typeof targetId !== 'string' || (targetId !== '' && !SLUG.test(targetId))) return null;
  if (typeof soundId !== 'string' || !soundIds.has(soundId)) return null;
  return { event, targetType, targetId, soundId };
}

export function parseAudioManifest(raw: unknown): ParsedManifest {
  if (!isRecord(raw)) return invalid('not an object');
  if (raw.schemaVersion !== 1) return invalid('unsupported schema version');
  const { revision } = raw;
  if (typeof revision !== 'string' || revision.length < 1 || revision.length > 128) {
    return invalid('revision is missing');
  }
  const scope = readScope(raw.scope);
  if (!Array.isArray(raw.sounds) || !Array.isArray(raw.assignments)) {
    return invalid('sounds and assignments must be lists');
  }
  if (raw.sounds.length > MAX_SOUNDS || raw.assignments.length > MAX_ASSIGNMENTS) {
    return invalid('too many entries');
  }

  const skipped: string[] = [];
  const sounds: SoundDefinition[] = [];
  const seen = new Set<string>();
  raw.sounds.forEach((entry, index) => {
    const result = readSound(entry);
    if (typeof result === 'string') {
      skipped.push(`sound #${index}: ${result}`);
    } else if (seen.has(result.id)) {
      skipped.push(`sound ${result.id}: duplicate`);
    } else {
      seen.add(result.id);
      sounds.push(result);
    }
  });

  const assignments: ManifestAssignment[] = [];
  raw.assignments.forEach((entry, index) => {
    const result = readAssignment(entry, seen);
    if (result) assignments.push(result);
    else skipped.push(`assignment #${index}`);
  });

  return { manifest: { schemaVersion: 1, revision, scope, sounds, assignments }, skipped };
}
