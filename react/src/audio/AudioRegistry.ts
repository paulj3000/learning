import { isAudioChannel } from './AudioChannels';
import type { SoundDefinition } from './AudioTypes';

/**
 * Sound ids to definitions. Registration is by stable id; a definition is
 * data, never a loaded file, so registering thousands costs nothing.
 *
 * Re-registering an id replaces it (hot reload, per-game overrides). Playing
 * instances keep the definition they started with.
 */
export class AudioRegistry {
  private readonly definitions = new Map<string, SoundDefinition>();

  register(definition: SoundDefinition): void {
    const problem = validateDefinition(definition);
    if (problem) throw new RangeError(`invalid sound definition: ${problem}`);
    this.definitions.set(definition.id, Object.freeze({ ...definition }));
  }

  registerAll(definitions: readonly SoundDefinition[]): void {
    // Validate first so a bad entry registers nothing.
    for (const definition of definitions) {
      const problem = validateDefinition(definition);
      if (problem) throw new RangeError(`invalid sound definition: ${problem}`);
    }
    for (const definition of definitions) this.register(definition);
  }

  unregister(soundId: string): void {
    this.definitions.delete(soundId);
  }

  has(soundId: string): boolean {
    return this.definitions.has(soundId);
  }

  get(soundId: string): SoundDefinition | undefined {
    return this.definitions.get(soundId);
  }

  get size(): number {
    return this.definitions.size;
  }
}

/** Returns what is wrong with a definition, or `undefined` when it is acceptable. */
export function validateDefinition(definition: SoundDefinition): string | undefined {
  if (typeof definition.id !== 'string' || definition.id.trim() === '') {
    return 'id must be a non-empty string';
  }
  if (!isAudioChannel(definition.channel)) {
    return `${definition.id}: unknown channel "${String(definition.channel)}"`;
  }
  if (
    definition.defaultVolume !== undefined &&
    !(Number.isFinite(definition.defaultVolume) && definition.defaultVolume >= 0)
  ) {
    return `${definition.id}: defaultVolume must be a finite number from 0 to 1`;
  }
  return undefined;
}
